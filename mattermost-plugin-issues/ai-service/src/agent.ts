// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import { createTools } from './tools';
import { PluginClient } from './plugin-client';
import type { AnalyzeRequest, AnalyzeResponse } from './types';

const SYSTEM_PROMPT = `You are an AI assistant that analyzes team conversations to keep the issue tracker up-to-date.

When a conversation ends, you review the transcript and determine if any actionable information was discussed — features, bugs, requirements, specifications, action items, decisions, or tasks.

Your workflow:
1. Read the conversation carefully.
2. If there's nothing actionable (casual chat, greetings, etc.), respond with a brief note and take no action.
3. If there are actionable items, first list_projects to see what projects exist.
4. Then search_all_issues to check if related issues already exist.
5. If a related issue exists, get its full details with get_issue and update it with new information using update_issue. When updating descriptions, preserve existing content and append the new information.
6. If no related issue exists, create a new one with create_issue.

Guidelines:
- Be judicious. Only create/update issues for genuinely actionable information.
- Set priority based on urgency signals in the conversation (e.g., "critical", "ASAP", "blocking" → high/urgent).
- Include conversation context in issue descriptions: who discussed it, key points, and any decisions made.
- Use concise, clear issue titles.
- If no projects exist, report that you cannot create issues and suggest creating a project first.`;

export async function analyzeConversation(request: AnalyzeRequest): Promise<AnalyzeResponse> {
    const { conversation, callback_url, internal_secret, openai_api_key } = request;

    const client = new PluginClient(callback_url, internal_secret);
    const tools = createTools(client);

    const openai = createOpenAI({ apiKey: openai_api_key });

    const channelTypeLabel =
        conversation.channel_type === 'D' ? 'Direct Message' :
            conversation.channel_type === 'G' ? 'Group Message' :
                conversation.channel_type === 'P' ? 'Private Channel' : 'Channel';

    const participantList = conversation.participants
        .map((p) => `@${p.username}`)
        .join(', ');

    const transcript = conversation.messages
        .map((m) => {
            const ts = new Date(m.timestamp).toLocaleTimeString('en-US', { hour12: false });
            return `[${ts}] @${m.username}: ${m.message}`;
        })
        .join('\n');

    const prompt = `A ${channelTypeLabel} conversation just ended.

**Participants:** ${participantList}
**Duration:** ${Math.round(conversation.duration_seconds / 60)} minutes
**Messages:** ${conversation.messages.length}

**Transcript:**
${transcript}

Analyze this conversation and take appropriate action.`;

    const result = await generateText({
        model: openai('gpt-4o-mini'),
        tools,
        maxSteps: 10,
        system: SYSTEM_PROMPT,
        prompt,
        toolChoice: 'auto',
        onStepFinish: (step) => {
            if (step.toolCalls?.length) {
                for (const tc of step.toolCalls) {
                    console.log(`[AI Agent] Tool call: ${tc.toolName}(${JSON.stringify(tc.args).substring(0, 200)})`);
                }
            }
        },
    });

    const actionsTaken = result.steps
        .flatMap((s) => s.toolCalls || [])
        .filter((tc) => tc.toolName === 'create_issue' || tc.toolName === 'update_issue')
        .length;

    return {
        summary: result.text,
        actions_taken: actionsTaken,
    };
}
