// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import WebSocket from 'ws';

const {MATTERMOST_URL, FIONA_BOT_TOKEN} = process.env;
const WS_URL = MATTERMOST_URL.replace('http', 'ws') + '/api/v4/websocket';

// Fetch posts in a channel up to (but not including) the post at `untilPostId`.
// Returns posts in chronological order.
export async function getPostsBefore(channelId, untilPostId) {
    const url = `${MATTERMOST_URL}/api/v4/channels/${channelId}/posts?per_page=200`;
    const resp = await fetch(url, {headers: {Authorization: `Bearer ${FIONA_BOT_TOKEN}`}});
    const data = await resp.json();

    const ordered = (data.order || []).map((id) => data.posts[id]);

    // Sort chronologically
    ordered.sort((a, b) => a.create_at - b.create_at);

    if (!untilPostId) {
        return ordered;
    }

    // Find the trigger post and walk backwards to the previous @fiona mention
    const triggerIdx = ordered.findIndex((p) => p.id === untilPostId);
    if (triggerIdx === -1) {
        return ordered;
    }

    // Find the most recent previous @fiona mention
    let startIdx = 0;
    for (let i = triggerIdx - 1; i >= 0; i--) {
        if (ordered[i].message && ordered[i].message.includes('@fiona')) {
            startIdx = i + 1; // start after the previous @fiona call
            break;
        }
    }

    return ordered.slice(startIdx, triggerIdx + 1);
}

// Fetch channel name for a channel id
const channelCache = new Map();
export async function getChannelName(channelId) {
    if (channelCache.has(channelId)) {
        return channelCache.get(channelId);
    }
    const resp = await fetch(`${MATTERMOST_URL}/api/v4/channels/${channelId}`, {
        headers: {Authorization: `Bearer ${FIONA_BOT_TOKEN}`},
    });
    const channel = await resp.json();
    const name = channel.display_name || channel.name || channelId;
    channelCache.set(channelId, name);
    return name;
}

// Fetch username for a user id
const userCache = new Map();
export async function getUsername(userId) {
    if (userCache.has(userId)) {
        return userCache.get(userId);
    }
    const resp = await fetch(`${MATTERMOST_URL}/api/v4/users/${userId}`, {
        headers: {Authorization: `Bearer ${FIONA_BOT_TOKEN}`},
    });
    const user = await resp.json();
    const name = user.username || userId;
    userCache.set(userId, name);
    return name;
}

// Post a message back to a channel as Fiona
export async function postMessage(channelId, message) {
    const resp = await fetch(`${MATTERMOST_URL}/api/v4/posts`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${FIONA_BOT_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({channel_id: channelId, message}),
    });
    return resp.json();
}

// Connect to the Mattermost WebSocket and call onPost for each new post event
export function connectWebSocket(onPost) {
    const ws = new WebSocket(WS_URL);
    let seq = 1;

    ws.on('open', () => {
        console.log('[WS] Connected to', WS_URL);
        ws.send(JSON.stringify({
            seq: seq++,
            action: 'authentication_challenge',
            data: {token: FIONA_BOT_TOKEN},
        }));
    });

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }

        if (msg.event === 'posted') {
            try {
                const post = JSON.parse(msg.data.post);
                onPost(post);
            } catch {
                // ignore malformed
            }
        }
    });

    ws.on('error', (err) => console.error('[WS] Error:', err.message));
    ws.on('close', () => {
        console.log('[WS] Disconnected — reconnecting in 5s...');
        setTimeout(() => connectWebSocket(onPost), 5000);
    });

    return ws;
}
