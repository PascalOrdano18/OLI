// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import 'dotenv/config';
import express from 'express';

import type {MattermostPost} from './common/mattermost';
import {getPostsBefore, postMessage} from './common/mattermost';
import type {Context} from './common/types';

import {runAgent as runMessagesAgent} from './messages/agent';
import {runAgent as runCallsAgent} from './calls/agent';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.post('/fiona/messages', async (req, res) => {
    const {triggerPost, channelId} = req.body as {triggerPost: MattermostPost; channelId: string};

    if (!triggerPost || !channelId) {
        res.status(400).json({error: 'Missing triggerPost or channelId'});
        return;
    }

    try {
        const contextPosts = await getPostsBefore(channelId, triggerPost.id);
        const {reply} = await runMessagesAgent(triggerPost, contextPosts);

        await postMessage(channelId, reply);
        res.json({reply});
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[POST /fiona/messages] Error:', err);
        res.status(500).json({error: message});
    }
});

app.post('/fiona/calls', async (req, res) => {
    const {context, transcript} = req.body as {context: Context; transcript: string};

    if (!context || !transcript) {
        res.status(400).json({error: 'Missing context or transcript'});
        return;
    }

    try {
        const {reply} = await runCallsAgent(context, transcript);
        res.json({reply});
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[POST /fiona/calls] Error:', err);
        res.status(500).json({error: message});
    }
});

app.listen(PORT, () => {
    console.log(`[FIONA] Server listening on port ${PORT}`);
});
