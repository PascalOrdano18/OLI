// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// import Anthropic from '@anthropic-ai/sdk';
import {getUsername, getChannelName} from './mattermost.js';

// const client = new Anthropic({apiKey: process.env.ANTHROPIC_API_KEY});

const SYSTEM_PROMPT = `You are Fiona, an AI assistant embedded in a Mattermost team chat.
Your job is to manage issues based on team conversations.

You will be given:
1. A conversation excerpt (from the last @fiona call up to this one)
2. A trigger message: one of "@fiona create issue", "@fiona edit issue", or "@fiona delete issue"

Based on the conversation, determine:
- For CREATE: what issue should be created (title, description, priority, project)
- For EDIT: which existing issue (by ID like ALPHA-1, ALPHA-2, ALPHA-3) and what fields to change
- For DELETE: which existing issue to delete

Known issues:
- ALPHA-1: CI pipeline failing on main branch (status: open, priority: P0)
- ALPHA-2: Add Slack notifications for deployment events (status: in-progress, priority: P2)
- ALPHA-3: Upgrade Node.js from v18 to v22 (status: open, priority: P1)

Respond ONLY with a JSON object (no markdown, no explanation) in one of these shapes:

For create:
{"action":"create","title":"...","description":"...","priority":"P0|P1|P2|P3","project":"project-alpha"}

For edit:
{"action":"edit","issueId":"ALPHA-N","patch":{"field":"value",...}}

For delete:
{"action":"delete","issueId":"ALPHA-N","reason":"..."}

If you cannot determine the intent clearly, respond:
{"action":"unknown","reason":"..."}`;

// Format conversation posts into a readable transcript
async function buildTranscript(posts) {
    const lines = [];
    for (const post of posts) {
        const username = await getUsername(post.user_id);
        lines.push(`${username}: ${post.message}`);
    }
    return lines.join('\n');
}

export async function interpretAndAct(triggerPost, contextPosts, issueActions) {
    const [transcript, channelName] = await Promise.all([
        buildTranscript(contextPosts),
        getChannelName(triggerPost.channel_id),
    ]);

    console.log('\n[AGENT] Conversation context:\n' + transcript);
    console.log('\n[AGENT] Trigger:', triggerPost.message);

    const userMessage = `Channel: ${channelName}\n\nConversation context:\n${transcript}\n\nTrigger: ${triggerPost.message}`;

    console.log('\n[AGENT] ===== INPUT TO AI =====');
    console.log('[AGENT] SYSTEM:\n' + SYSTEM_PROMPT);
    console.log('\n[AGENT] USER:\n' + userMessage);
    console.log('[AGENT] =========================\n');

    // const response = await client.messages.create({
    //     model: 'claude-sonnet-4-6',
    //     max_tokens: 1024,
    //     system: SYSTEM_PROMPT,
    //     messages: [{role: 'user', content: userMessage}],
    // });
    // const raw = response.content[0].text.trim();
    // console.log('[AGENT] Claude response:', raw);

    return {intent: {action: 'dry-run'}, result: null, reply: '(dry-run mode — AI call skipped)'};

    // let intent;
    // try {
    //     intent = JSON.parse(raw);
    // } catch {
    //     console.error('[AGENT] Failed to parse intent JSON:', raw);
    //     return {action: 'unknown', reason: 'Failed to parse AI response'};
    // }

    // Execute the fake issue API call
    // eslint-disable-next-line no-unreachable
    let result;
    switch (intent.action) {
        case 'create':
            result = issueActions.create({
                title: intent.title,
                description: intent.description,
                priority: intent.priority,
                project: intent.project,
            });
            return {intent, result, reply: `Created issue **${result.id}**: ${intent.title} (${intent.priority})`};

        case 'edit':
            result = issueActions.edit(intent.issueId, intent.patch);
            return {intent, result, reply: `Updated issue **${intent.issueId}**: ${JSON.stringify(intent.patch)}`};

        case 'delete':
            result = issueActions.delete(intent.issueId);
            return {intent, result, reply: `Deleted issue **${intent.issueId}**. Reason: ${intent.reason}`};

        default:
            return {intent, result: null, reply: `I couldn't determine the intent. ${intent.reason || ''}`};
    }
}
