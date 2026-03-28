// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {anthropic} from '@ai-sdk/anthropic';
import {generateText, stepCountIs} from 'ai';

import type {MattermostPost} from '../common/mattermost';
import {getUsername, getChannelName} from '../common/mattermost';
import {createIssueTool} from '../common/tools/createIssue';
import {deleteIssueTool} from '../common/tools/deleteIssue';
import {getIssuesTool} from '../common/tools/getIssues';
import {updateIssueTool} from '../common/tools/updateIssue';

import {buildSystemPrompt} from './systemPrompt';

async function buildTranscript(posts: MattermostPost[]): Promise<string> {
    const lines = await Promise.all(
        posts.map(async (post) => {
            const username = await getUsername(post.user_id);
            return `${username}: ${post.message}`;
        }),
    );
    return lines.join('\n');
}

export async function runAgent(triggerPost: MattermostPost, contextPosts: MattermostPost[]): Promise<{reply: string}> {
    const [transcript, channelName] = await Promise.all([
        buildTranscript(contextPosts),
        getChannelName(triggerPost.channel_id),
    ]);

    const systemPrompt = buildSystemPrompt(channelName, transcript);

    console.log('\n[MESSAGES AGENT] Running for channel:', channelName);
    console.log('[MESSAGES AGENT] Transcript:\n' + transcript);
    console.log('[MESSAGES AGENT] Trigger:', triggerPost.message);

    const {text, steps} = await generateText({
        model: anthropic('claude-sonnet-4-6'),
        system: systemPrompt,
        prompt: triggerPost.message,
        tools: {
            getIssues: getIssuesTool,
            createIssue: createIssueTool,
            updateIssue: updateIssueTool,
            deleteIssue: deleteIssueTool,
        },
        stopWhen: stepCountIs(5),
    });

    for (const step of steps) {
        for (const tc of step.staticToolCalls) {
            console.log(`[MESSAGES AGENT] Tool: ${tc.toolName}(${JSON.stringify(tc.input)})`);
        }
    }
    console.log('[MESSAGES AGENT] Final response:', text);

    return {reply: text};
}
