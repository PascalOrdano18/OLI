// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {anthropic} from '@ai-sdk/anthropic';
import {generateText, stepCountIs} from 'ai';

import {createIssueTool} from '../common/tools/createIssue';
import {deleteIssueTool} from '../common/tools/deleteIssue';
import {getIssuesTool} from '../common/tools/getIssues';
import {updateIssueTool} from '../common/tools/updateIssue';
import type {Context} from '../common/types';

import {buildSystemPrompt} from './systemPrompt';

export async function runAgent(context: Context, transcript: string): Promise<{reply: string}> {
    const systemPrompt = buildSystemPrompt(context, transcript);

    console.log('\n[CALLS AGENT] Running for transcript of', transcript.length, 'characters');

    const {text, steps} = await generateText({
        model: anthropic('claude-sonnet-4-6'),
        system: systemPrompt,
        prompt: 'Analyze the video call transcript above and manage issues accordingly.',
        tools: {
            getIssues: getIssuesTool,
            createIssue: createIssueTool,
            updateIssue: updateIssueTool,
            deleteIssue: deleteIssueTool,
        },
        stopWhen: stepCountIs(10),
        temperature: 0,
    });

    for (const step of steps) {
        for (const tc of step.staticToolCalls) {
            console.log(`[CALLS AGENT] Tool: ${tc.toolName}(${JSON.stringify(tc.input)})`);
        }
    }
    console.log('[CALLS AGENT] Final response:', text);

    return {reply: text};
}
