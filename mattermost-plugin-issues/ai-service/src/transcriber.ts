// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Transcribes audio using OpenAI's Whisper API.
 *
 * @param audioBuffer - Raw audio data (WebM/Opus, mp3, wav, etc.)
 * @param apiKey - OpenAI API key
 * @param filename - Original filename hint for the API (helps with format detection)
 * @returns The transcribed text
 */
export async function transcribeAudio(
    audioBuffer: Buffer,
    apiKey: string,
    filename = 'audio.webm',
): Promise<string> {
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(audioBuffer)]), filename);
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'text');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Whisper API error ${response.status}: ${errorText}`);
    }

    const text = await response.text();
    return text.trim();
}
