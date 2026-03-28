// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import express from 'express';
import multer from 'multer';

import { analyzeConversation } from './agent';
import { transcribeAudio } from './transcriber';
import type { AnalyzeRequest, TranscribeAndAnalyzeRequest } from './types';

const app = express();
app.use(express.json());

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
});

app.post('/analyze', async (req, res) => {
    const request = req.body as AnalyzeRequest;

    if (!request.conversation || !request.openai_api_key) {
        res.status(400).json({ error: 'missing conversation or openai_api_key' });
        return;
    }

    const isCallTranscription = !!request.call_transcription;
    console.log(
        `[AI Service] Analyzing ${isCallTranscription ? 'call transcription' : 'conversation'}: ` +
        `${request.conversation.messages.length} messages, ` +
        `${request.conversation.participants.length} participants, ` +
        `channel_type=${request.conversation.channel_type}` +
        (isCallTranscription ? `, transcription_length=${request.call_transcription!.length}` : ''),
    );

    try {
        const result = await analyzeConversation(request);
        console.log(`[AI Service] Done: ${result.actions_taken} actions taken`);
        res.json(result);
    } catch (error) {
        console.error('[AI Service] Error:', error);
        res.status(500).json({ error: 'analysis failed' });
    }
});

app.post('/transcribe-and-analyze', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        res.status(400).json({ error: 'missing audio file' });
        return;
    }

    let metadata: TranscribeAndAnalyzeRequest;
    try {
        metadata = JSON.parse(req.body.metadata) as TranscribeAndAnalyzeRequest;
    } catch {
        res.status(400).json({ error: 'missing or invalid metadata JSON field' });
        return;
    }

    if (!metadata.openai_api_key) {
        res.status(400).json({ error: 'missing openai_api_key in metadata' });
        return;
    }

    console.log(
        `[AI Service] Transcribe-and-analyze: ` +
        `audio_size=${req.file.size} bytes, ` +
        `channel=${metadata.channel_name}, ` +
        `participants=${metadata.participants.length}`,
    );

    try {
        // Step 1: Transcribe audio via Whisper.
        console.log('[AI Service] Transcribing audio with Whisper...');
        const transcription = await transcribeAudio(
            req.file.buffer,
            metadata.openai_api_key,
            req.file.originalname || 'audio.webm',
        );
        console.log(`[AI Service] Transcription complete: ${transcription.length} chars`);

        if (transcription.length === 0) {
            console.log('[AI Service] Empty transcription, skipping analysis');
            res.json({ summary: 'No speech detected in call audio.', actions_taken: 0 });
            return;
        }
        console.log(`[AI Service] Transcription text: "${transcription}"`);

        // Step 2: Analyze the transcription using the existing agent.
        const analyzeRequest: AnalyzeRequest = {
            conversation: {
                channel_id: metadata.channel_id,
                channel_type: metadata.channel_type,
                channel_name: metadata.channel_name,
                participants: metadata.participants,
                messages: [],
                started_at: '',
                ended_at: '',
                duration_seconds: 0,
            },
            call_transcription: transcription,
            callback_url: metadata.callback_url,
            internal_secret: metadata.internal_secret,
            openai_api_key: metadata.openai_api_key,
        };

        const result = await analyzeConversation(analyzeRequest);
        console.log(`[AI Service] Done: ${result.actions_taken} actions taken`);
        res.json(result);
    } catch (error) {
        console.error('[AI Service] Transcribe-and-analyze error:', error);
        res.status(500).json({ error: 'transcription or analysis failed' });
    }
});

app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
    console.log(`[AI Service] Listening on port ${port}`);
});
