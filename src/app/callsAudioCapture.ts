// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {net, session} from 'electron';
import type {BrowserWindow} from 'electron';

import {Logger} from 'common/log';

const log = new Logger('CallsAudioCapture');

/**
 * JavaScript code injected into the Calls widget page to capture all WebRTC
 * audio tracks (local + remote) via a MediaRecorder. Runs in the page's main
 * world so it has direct access to RTCPeerConnection.
 */
const AUDIO_CAPTURE_INJECTION = `
(function() {
    if (window.__callsAudioCapture) return;
    window.__callsAudioCapture = { chunks: [], recorder: null, tracks: [], ctx: null };
    const cap = window.__callsAudioCapture;

    // AudioContext for mixing all tracks into one stream.
    cap.ctx = new AudioContext();
    const dest = cap.ctx.createMediaStreamDestination();

    function addTrackToMixer(track) {
        if (track.kind !== 'audio') return;
        if (cap.tracks.includes(track)) return;
        cap.tracks.push(track);
        try {
            const stream = new MediaStream([track]);
            const source = cap.ctx.createMediaStreamSource(stream);
            source.connect(dest);
            console.log('[CallsAudioCapture] Added audio track to mixer, total:', cap.tracks.length);
        } catch (e) {
            console.error('[CallsAudioCapture] Failed to add track:', e);
        }
    }

    // Patch RTCPeerConnection to intercept audio tracks.
    const OrigPeerConnection = window.RTCPeerConnection;
    const origAddTrack = OrigPeerConnection.prototype.addTrack;

    OrigPeerConnection.prototype.addTrack = function(track, ...streams) {
        addTrackToMixer(track);
        return origAddTrack.call(this, track, ...streams);
    };

    const origSetRemoteDesc = OrigPeerConnection.prototype.setRemoteDescription;
    OrigPeerConnection.prototype.setRemoteDescription = function(desc) {
        // Hook ontrack after remote description is set.
        const origOnTrack = this.ontrack;
        this.addEventListener('track', (event) => {
            if (event.track) {
                addTrackToMixer(event.track);
            }
        });
        return origSetRemoteDesc.call(this, desc);
    };

    // Start the MediaRecorder on the mixed destination stream.
    function startRecording() {
        if (cap.recorder && cap.recorder.state === 'recording') return;
        cap.chunks = [];
        try {
            cap.recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });
        } catch (e) {
            // Fallback if opus codec is not available.
            cap.recorder = new MediaRecorder(dest.stream);
        }
        cap.recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                cap.chunks.push(event.data);
            }
        };
        // Record in 5-second chunks to avoid losing data.
        cap.recorder.start(5000);
        console.log('[CallsAudioCapture] Recording started');
    }

    // Wait a moment for WebRTC to initialize, then start recording.
    // Also start immediately if tracks already exist.
    setTimeout(startRecording, 2000);

    console.log('[CallsAudioCapture] Injection complete');
})();
`;

/**
 * JavaScript code to stop recording and return the audio data as base64.
 * Must be run via executeJavaScript after AUDIO_CAPTURE_INJECTION.
 */
const STOP_AND_RETRIEVE = `
(function() {
    return new Promise((resolve) => {
        const cap = window.__callsAudioCapture;
        if (!cap || !cap.recorder) {
            console.log('[CallsAudioCapture] No recorder found');
            resolve(null);
            return;
        }

        if (cap.recorder.state === 'inactive') {
            // Already stopped, just return what we have.
            if (cap.chunks.length === 0) {
                resolve(null);
                return;
            }
            const blob = new Blob(cap.chunks, { type: cap.recorder.mimeType || 'audio/webm' });
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
            return;
        }

        cap.recorder.onstop = () => {
            console.log('[CallsAudioCapture] Recorder stopped, chunks:', cap.chunks.length);
            if (cap.chunks.length === 0) {
                resolve(null);
                return;
            }
            const blob = new Blob(cap.chunks, { type: cap.recorder.mimeType || 'audio/webm' });
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        };
        cap.recorder.stop();

        if (cap.ctx) {
            cap.ctx.close().catch(() => {});
        }
    });
})();
`;

/**
 * Injects the audio capture script into the Calls widget window.
 * Should be called after the widget page has loaded and the call is joined.
 */
export async function startCallAudioCapture(win: BrowserWindow): Promise<void> {
    try {
        await win.webContents.executeJavaScript(AUDIO_CAPTURE_INJECTION);
        log.info('Audio capture injected into calls widget');
    } catch (err) {
        log.error('Failed to inject audio capture', {err});
    }
}

/**
 * Stops the audio recording and retrieves the recorded audio as a Buffer.
 * Returns null if no audio was captured.
 */
export async function stopCallAudioCapture(win: BrowserWindow): Promise<Buffer | null> {
    try {
        const dataURL: string | null = await win.webContents.executeJavaScript(STOP_AND_RETRIEVE);
        if (!dataURL) {
            log.info('No audio data captured');
            return null;
        }

        // dataURL format: "data:audio/webm;base64,AAAA..."
        const base64Match = dataURL.match(/^data:[^;]+;base64,(.+)$/);
        if (!base64Match) {
            log.error('Invalid data URL format');
            return null;
        }

        const buffer = Buffer.from(base64Match[1], 'base64');
        log.info('Audio captured', {sizeBytes: buffer.length});
        return buffer;
    } catch (err) {
        log.error('Failed to stop audio capture', {err});
        return null;
    }
}

/**
 * Uploads the recorded call audio to the Mattermost Issues plugin for
 * transcription and analysis.
 */
export async function uploadCallAudio(
    serverURL: string,
    channelID: string,
    audioBuffer: Buffer,
): Promise<void> {
    const pluginURL = `${serverURL.replace(/\/$/, '')}/plugins/com.mattermost.issues/api/v1/call-audio`;

    // Build multipart form data manually for Electron's net module.
    const boundary = `----CallAudioBoundary${Date.now()}`;
    const parts: Buffer[] = [];

    // Audio file part.
    parts.push(Buffer.from(
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="audio"; filename="call_audio.webm"\r\n' +
        'Content-Type: audio/webm\r\n\r\n',
    ));
    parts.push(audioBuffer);
    parts.push(Buffer.from('\r\n'));

    // Channel ID part.
    parts.push(Buffer.from(
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="channel_id"\r\n\r\n' +
        `${channelID}\r\n`,
    ));

    // Closing boundary.
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    return new Promise((resolve, reject) => {
        const req = net.request({
            url: pluginURL,
            method: 'POST',
            session: session.defaultSession,
            useSessionCookies: true,
        });

        req.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`);
        req.setHeader('Content-Length', String(body.length));

        req.on('response', (response) => {
            if (response.statusCode === 202) {
                log.info('Call audio upload accepted by plugin');
                resolve();
            } else {
                let responseBody = '';
                response.on('data', (chunk: Buffer) => {
                    responseBody += chunk.toString();
                });
                response.on('end', () => {
                    log.error('Call audio upload failed', {status: response.statusCode, body: responseBody});
                    reject(new Error(`Upload failed with status ${response.statusCode}: ${responseBody}`));
                });
            }
        });

        req.on('error', (err) => {
            log.error('Call audio upload request error', {err});
            reject(err);
        });

        req.write(body);
        req.end();
    });
}
