// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {net, session} from 'electron';
import type {BrowserWindow} from 'electron';

import {Logger} from 'common/log';

const log = new Logger('CallsAudioCapture');

/**
 * Non-invasive audio capture.
 *
 * The PREVIOUS version monkey-patched RTCPeerConnection.addTrack and
 * setRemoteDescription, which broke WebRTC audio playback (users could
 * see "talking" indicators but couldn't hear each other).
 *
 * This version ONLY wraps the RTCPeerConnection constructor to attach a
 * read-only 'track' event listener. It never touches addTrack,
 * setRemoteDescription, or any other prototype method. Remote tracks
 * are cloned before being fed to the mixer so the original tracks
 * remain untouched.
 *
 * For local audio, a SEPARATE getUserMedia call is made (after a delay
 * so the Calls plugin's own mic request completes first).
 */
const AUDIO_CAPTURE_INJECTION = `
(function() {
    if (window.__callsAudioCapture) {
        console.log('[CallsAudioCapture] Already injected, skipping');
        return;
    }

    console.log('[CallsAudioCapture] Injecting non-invasive audio capture...');

    window.__callsAudioCapture = {
        chunks: [],
        recorder: null,
        remoteTrackIds: [],
        ctx: null,
        dest: null,
        localStream: null,
        localTrackAdded: false,
        peerConnections: [],
    };
    const cap = window.__callsAudioCapture;

    cap.ctx = new AudioContext();
    cap.dest = cap.ctx.createMediaStreamDestination();

    function addRemoteTrackToMixer(track) {
        if (track.kind !== 'audio') return;
        if (cap.remoteTrackIds.includes(track.id)) return;
        cap.remoteTrackIds.push(track.id);
        try {
            // Clone the track so we don't interfere with WebRTC's usage of it.
            const cloned = track.clone();
            const stream = new MediaStream([cloned]);
            const source = cap.ctx.createMediaStreamSource(stream);
            source.connect(cap.dest);
            console.log('[CallsAudioCapture] Added REMOTE audio track (cloned), total:', cap.remoteTrackIds.length);
        } catch (e) {
            console.error('[CallsAudioCapture] Failed to add remote track:', e);
        }
    }

    // Wrap RTCPeerConnection constructor — attach a track listener.
    // We do NOT touch any prototype methods.
    const OrigPC = window.RTCPeerConnection;
    window.RTCPeerConnection = function(...args) {
        const pc = new OrigPC(...args);
        console.log('[CallsAudioCapture] RTCPeerConnection created, attaching track listener');
        cap.peerConnections.push(pc);

        pc.addEventListener('track', (event) => {
            console.log('[CallsAudioCapture] ontrack fired, kind:', event.track?.kind, 'id:', event.track?.id);
            if (event.track) {
                addRemoteTrackToMixer(event.track);
                maybeStartRecording();
            }
        });

        return pc;
    };
    window.RTCPeerConnection.prototype = OrigPC.prototype;
    window.RTCPeerConnection.generateCertificate = OrigPC.generateCertificate;

    function maybeStartRecording() {
        if (cap.recorder && cap.recorder.state === 'recording') return;
        cap.chunks = [];
        try {
            try {
                cap.recorder = new MediaRecorder(cap.dest.stream, { mimeType: 'audio/webm;codecs=opus' });
            } catch (e) {
                cap.recorder = new MediaRecorder(cap.dest.stream);
            }
            cap.recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    cap.chunks.push(event.data);
                    console.log('[CallsAudioCapture] Chunk recorded, size:', event.data.size, 'total chunks:', cap.chunks.length);
                }
            };
            cap.recorder.onerror = (event) => {
                console.error('[CallsAudioCapture] Recorder error:', event.error);
            };
            cap.recorder.start(5000);
            console.log('[CallsAudioCapture] MediaRecorder started');
        } catch (e) {
            console.error('[CallsAudioCapture] Failed to start MediaRecorder:', e);
        }
    }

    // Strategy: capture audio from ALL sources we can find.
    // 1. Scan for <audio> and <video> elements and use captureStream()
    // 2. Scan for existing RTCPeerConnection receivers
    // 3. Capture local mic as fallback

    function scanExistingMediaElements() {
        // Capture audio from any <audio> or <video> elements on the page.
        const elements = [...document.querySelectorAll('audio, video')];
        console.log('[CallsAudioCapture] Found', elements.length, 'audio/video elements');
        for (const el of elements) {
            try {
                const stream = el.captureStream ? el.captureStream() : (el.mozCaptureStream ? el.mozCaptureStream() : null);
                if (stream) {
                    const audioTracks = stream.getAudioTracks();
                    console.log('[CallsAudioCapture] Element', el.tagName, 'has', audioTracks.length, 'audio tracks');
                    for (const track of audioTracks) {
                        addRemoteTrackToMixer(track);
                    }
                }
            } catch (e) {
                console.log('[CallsAudioCapture] Cannot capture stream from element:', e.message);
            }
        }
    }

    function scanExistingPeerConnections() {
        // Look for existing peer connections stored by the wrapper or on window
        for (const pc of cap.peerConnections) {
            try {
                // Receivers = remote audio (other participants)
                const receivers = pc.getReceivers();
                console.log('[CallsAudioCapture] Existing PC has', receivers.length, 'receivers');
                for (const receiver of receivers) {
                    if (receiver.track && receiver.track.kind === 'audio') {
                        console.log('[CallsAudioCapture] Found REMOTE audio receiver track:', receiver.track.id, 'state:', receiver.track.readyState);
                        addRemoteTrackToMixer(receiver.track);
                    }
                }

                // Senders = local audio (YOUR mic as sent to other participants)
                const senders = pc.getSenders();
                console.log('[CallsAudioCapture] Existing PC has', senders.length, 'senders');
                for (const sender of senders) {
                    if (sender.track && sender.track.kind === 'audio') {
                        console.log('[CallsAudioCapture] Found LOCAL audio sender track:', sender.track.id, 'state:', sender.track.readyState, 'enabled:', sender.track.enabled);
                        // Add the sender track (local mic) to the mixer.
                        // This is the exact track the Calls plugin is using — no need for a separate getUserMedia.
                        if (!cap.localTrackAdded) {
                            try {
                                const cloned = sender.track.clone();
                                const stream = new MediaStream([cloned]);
                                const source = cap.ctx.createMediaStreamSource(stream);
                                source.connect(cap.dest);
                                cap.localTrackAdded = true;
                                console.log('[CallsAudioCapture] LOCAL mic track (from sender) added to mixer');
                            } catch (e) {
                                console.error('[CallsAudioCapture] Failed to add local sender track:', e);
                            }
                        }
                    }
                }
            } catch (e) {
                console.log('[CallsAudioCapture] Error scanning PC:', e.message);
            }
        }
    }

    // Fallback: capture local mic via getUserMedia if we couldn't get it from senders.
    async function captureLocalMicFallback() {
        if (cap.localTrackAdded) {
            console.log('[CallsAudioCapture] Local track already added from PC sender, skipping getUserMedia');
            return;
        }
        try {
            console.log('[CallsAudioCapture] Fallback: requesting local mic via getUserMedia...');
            cap.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
                video: false,
            });
            const tracks = cap.localStream.getAudioTracks();
            console.log('[CallsAudioCapture] Fallback mic, tracks:', tracks.length, 'state:', tracks[0]?.readyState, 'enabled:', tracks[0]?.enabled);
            const localSource = cap.ctx.createMediaStreamSource(cap.localStream);
            localSource.connect(cap.dest);
            cap.localTrackAdded = true;
            console.log('[CallsAudioCapture] Fallback local mic connected to mixer');
        } catch (e) {
            console.error('[CallsAudioCapture] Fallback getUserMedia failed:', e.message);
        }
    }

    // Run all capture strategies with delays.
    setTimeout(async () => {
        scanExistingMediaElements();
        scanExistingPeerConnections(); // Gets both remote (receivers) AND local (senders)
        await captureLocalMicFallback(); // Only if sender track wasn't found
        maybeStartRecording();
    }, 3000);

    // Scan again later in case elements/connections appear after initial scan.
    setTimeout(async () => {
        console.log('[CallsAudioCapture] Re-scanning for media sources...');
        scanExistingMediaElements();
        scanExistingPeerConnections();
        await captureLocalMicFallback();
    }, 8000);

    console.log('[CallsAudioCapture] Injection complete, waiting for tracks...');
})();
`;

const STOP_AND_RETRIEVE = `
(function() {
    return new Promise((resolve) => {
        const cap = window.__callsAudioCapture;
        if (!cap || !cap.recorder) {
            console.log('[CallsAudioCapture] No recorder found');
            resolve(null);
            return;
        }

        console.log('[CallsAudioCapture] Stopping recorder, state:', cap.recorder.state, 'chunks:', cap.chunks.length);

        if (cap.localStream) {
            cap.localStream.getTracks().forEach(t => t.stop());
            console.log('[CallsAudioCapture] Local mic stream stopped');
        }

        function blobToBase64(chunks, mimeType) {
            if (chunks.length === 0) {
                console.log('[CallsAudioCapture] No chunks to convert');
                resolve(null);
                return;
            }
            const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
            console.log('[CallsAudioCapture] Converting blob to base64, size:', blob.size);
            const reader = new FileReader();
            reader.onloadend = () => {
                console.log('[CallsAudioCapture] FileReader done, result type:', typeof reader.result, 'length:', (reader.result || '').length, 'prefix:', (reader.result || '').substring(0, 60));
                resolve(reader.result);
            };
            reader.onerror = (e) => {
                console.error('[CallsAudioCapture] FileReader error:', e);
                resolve(null);
            };
            reader.readAsDataURL(blob);
        }

        // If recorder is already stopped, use existing chunks.
        if (cap.recorder.state === 'inactive') {
            console.log('[CallsAudioCapture] Recorder already inactive, using existing chunks');
            blobToBase64(cap.chunks, cap.recorder.mimeType);
            return;
        }

        // Request a final data flush before stopping.
        // requestData() triggers ondataavailable synchronously with buffered data.
        try {
            cap.recorder.requestData();
            console.log('[CallsAudioCapture] Requested final data flush, chunks now:', cap.chunks.length);
        } catch (e) {
            console.log('[CallsAudioCapture] requestData failed (ok):', e.message);
        }

        cap.recorder.onstop = () => {
            console.log('[CallsAudioCapture] Recorder onstop fired, chunks:', cap.chunks.length);
            blobToBase64(cap.chunks, cap.recorder.mimeType);
        };

        try {
            cap.recorder.stop();
        } catch (e) {
            console.error('[CallsAudioCapture] recorder.stop() failed:', e);
            // Fall back to whatever chunks we have.
            blobToBase64(cap.chunks, cap.recorder.mimeType || 'audio/webm');
        }

        if (cap.ctx) {
            cap.ctx.close().catch(() => {});
        }
    });
})();
`;

/**
 * Injects the audio capture script into the Calls widget window.
 */
export async function startCallAudioCapture(win: BrowserWindow): Promise<void> {
    log.info('Injecting audio capture into calls widget...');
    try {
        await win.webContents.executeJavaScript(AUDIO_CAPTURE_INJECTION);
        log.info('Audio capture injection successful');
    } catch (err) {
        log.error('Failed to inject audio capture', {err});
    }
}

/**
 * Stops the audio recording and retrieves the recorded audio as a Buffer.
 */
export async function stopCallAudioCapture(win: BrowserWindow): Promise<Buffer | null> {
    log.info('Stopping audio capture...');
    try {
        const dataURL: string | null = await win.webContents.executeJavaScript(STOP_AND_RETRIEVE);
        log.info('STOP_AND_RETRIEVE result', {
            type: typeof dataURL,
            isNull: dataURL === null,
            length: dataURL?.length ?? 0,
            prefix: dataURL?.substring(0, 100) ?? '(null)',
        });
        if (!dataURL) {
            log.info('No audio data captured');
            return null;
        }

        const base64Match = dataURL.match(/^data:[^,]+;base64,(.+)$/);
        if (!base64Match) {
            log.error('Invalid data URL format from audio capture', {
                firstChars: dataURL.substring(0, 200),
                length: dataURL.length,
            });
            return null;
        }

        const buffer = Buffer.from(base64Match[1], 'base64');
        log.info('Audio captured successfully', {sizeBytes: buffer.length});
        return buffer;
    } catch (err) {
        log.error('Failed to stop audio capture', {err});
        return null;
    }
}

/**
 * Uploads the recorded call audio to the Mattermost Issues plugin.
 */
export async function uploadCallAudio(
    serverURL: string,
    channelID: string,
    audioBuffer: Buffer,
): Promise<void> {
    const pluginURL = `${serverURL.replace(/\/$/, '')}/plugins/com.mattermost.issues/internal/call-audio`;
    log.info('Uploading call audio', {pluginURL, channelID, audioSize: audioBuffer.length});

    // Use Electron's net module with chunked upload to avoid ERR_INVALID_ARGUMENT
    // on large binary payloads.
    const boundary = `----CallAudioBoundary${Date.now()}`;

    const preamble = Buffer.from(
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="audio"; filename="call_audio.webm"\r\n' +
        'Content-Type: audio/webm\r\n\r\n',
    );
    const afterAudio = Buffer.from(
        `\r\n--${boundary}\r\n` +
        'Content-Disposition: form-data; name="channel_id"\r\n\r\n' +
        `${channelID}\r\n` +
        `--${boundary}--\r\n`,
    );

    const totalLength = preamble.length + audioBuffer.length + afterAudio.length;
    log.info('Upload body size', {preamble: preamble.length, audio: audioBuffer.length, after: afterAudio.length, total: totalLength});

    return new Promise((resolve, reject) => {
        const req = net.request({
            url: pluginURL,
            method: 'POST',
            session: session.defaultSession,
            useSessionCookies: true,
        });

        req.setHeader('Content-Type', `multipart/form-data; boundary=${boundary}`);
        req.setHeader('X-Internal-Secret', 'fiona-secret-2024');

        req.on('response', (response) => {
            let responseBody = '';
            response.on('data', (chunk: Buffer) => {
                responseBody += chunk.toString();
            });
            response.on('end', () => {
                if (response.statusCode === 202) {
                    log.info('Call audio upload accepted', {response: responseBody});
                    resolve();
                } else {
                    log.error('Call audio upload failed', {status: response.statusCode, body: responseBody});
                    reject(new Error(`Upload failed with status ${response.statusCode}: ${responseBody}`));
                }
            });
        });

        req.on('error', (err) => {
            log.error('Call audio upload request error', {err});
            reject(err);
        });

        // Write in chunks to avoid ERR_INVALID_ARGUMENT with large buffers.
        req.write(preamble);
        req.write(audioBuffer);
        req.write(afterAudio);
        req.end();
    });
}
