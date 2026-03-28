// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

function getEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}. Set it in your .env file.`);
    }
    return value;
}

export type MattermostPost = {
    id: string;
    channel_id: string;
    user_id: string;
    message: string;
    create_at: number;
};

function mattermostUrl(): string {
    return getEnv('MATTERMOST_URL');
}

function botToken(): string {
    return getEnv('FIONA_BOT_TOKEN');
}

function authHeaders(): Record<string, string> {
    return {Authorization: `Bearer ${botToken()}`};
}

/**
 * Fetch posts in a channel between the previous @fiona mention and `untilPostId`.
 * Returns posts in chronological order.
 */
export async function getPostsBefore(channelId: string, untilPostId?: string): Promise<MattermostPost[]> {
    const url = `${mattermostUrl()}/api/v4/channels/${channelId}/posts?per_page=200`;
    const resp = await fetch(url, {headers: authHeaders()});
    const data = await resp.json();

    const ordered: MattermostPost[] = (data.order || []).map((id: string) => data.posts[id]);
    ordered.sort((a, b) => a.create_at - b.create_at);

    if (!untilPostId) {
        return ordered;
    }

    const triggerIdx = ordered.findIndex((p) => p.id === untilPostId);
    if (triggerIdx === -1) {
        return ordered;
    }

    let startIdx = 0;
    for (let i = triggerIdx - 1; i >= 0; i--) {
        if (ordered[i].message?.includes('@fiona')) {
            startIdx = i + 1;
            break;
        }
    }

    return ordered.slice(startIdx, triggerIdx + 1);
}

const channelCache = new Map<string, string>();
export async function getChannelName(channelId: string): Promise<string> {
    if (channelCache.has(channelId)) {
        return channelCache.get(channelId)!;
    }
    const resp = await fetch(`${mattermostUrl()}/api/v4/channels/${channelId}`, {
        headers: authHeaders(),
    });
    const channel = await resp.json();
    const name: string = channel.display_name || channel.name || channelId;
    channelCache.set(channelId, name);
    return name;
}

const userCache = new Map<string, string>();
export async function getUsername(userId: string): Promise<string> {
    if (userCache.has(userId)) {
        return userCache.get(userId)!;
    }
    const resp = await fetch(`${mattermostUrl()}/api/v4/users/${userId}`, {
        headers: authHeaders(),
    });
    const user = await resp.json();
    const name: string = user.username || userId;
    userCache.set(userId, name);
    return name;
}

export async function postMessage(channelId: string, message: string): Promise<MattermostPost> {
    const resp = await fetch(`${mattermostUrl()}/api/v4/posts`, {
        method: 'POST',
        headers: {
            ...authHeaders(),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({channel_id: channelId, message}),
    });
    return resp.json();
}
