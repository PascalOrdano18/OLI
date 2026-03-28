// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import 'dotenv/config';
import {connectWebSocket, getPostsBefore, postMessage} from './src/mattermost.js';
import {interpretAndAct} from './src/agent.js';
import {createIssue, editIssue, deleteIssue} from './src/issues.js';

const FIONA_BOT_USER_ID = process.env.FIONA_BOT_USER_ID;

const TRIGGER_PATTERNS = [
    {regex: /@fiona\s+create\s+issue/i, action: 'create'},
    {regex: /@fiona\s+edit\s+issue/i, action: 'edit'},
    {regex: /@fiona\s+delete\s+issue/i, action: 'delete'},
];

// Track in-flight requests to avoid double-processing
const processing = new Set();

async function handlePost(post) {
    // Ignore own messages
    if (post.user_id === FIONA_BOT_USER_ID) {
        return;
    }

    const matched = TRIGGER_PATTERNS.find(({regex}) => regex.test(post.message));
    if (!matched) {
        return;
    }

    if (processing.has(post.id)) {
        return;
    }
    processing.add(post.id);

    console.log(`\n[FIONA] Triggered by post ${post.id} in channel ${post.channel_id}`);
    console.log(`[FIONA] Action: ${matched.action} | Message: "${post.message}"`);

    try {
        // Fetch conversation context up to this post
        const contextPosts = await getPostsBefore(post.channel_id, post.id);

        const {reply} = await interpretAndAct(
            post,
            contextPosts,
            {create: createIssue, edit: editIssue, delete: deleteIssue},
        );

        await postMessage(post.channel_id, reply);
        console.log(`[FIONA] Replied: "${reply}"`);
    } catch (err) {
        console.error('[FIONA] Error handling post:', err);
        await postMessage(post.channel_id, `Sorry, I ran into an error: ${err.message}`);
    } finally {
        processing.delete(post.id);
    }
}

console.log('[FIONA] Starting bot...');
connectWebSocket(handlePost);
