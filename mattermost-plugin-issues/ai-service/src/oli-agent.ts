// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import { createOliTools } from './oli-tools';
import { PluginClient } from './plugin-client';
import type { ChatRequest, ChatResponse, CodeSnippet, IssueRef } from './types';

const SYSTEM_PROMPT = `You are Oli, a team member in this Mattermost workspace. You answer questions about the codebase, company, and issues.

Be concise and direct — like a senior dev responding to a quick ping. Short answers, code snippets when relevant, file paths with line numbers. Don't over-explain.

Always start your response with a brief natural intro. For example:
- "Here are the current issues:" before listing issues
- "Found it:" before showing code
- "Done — created the issue." after creating one
- "No issues found." when there are none

IMPORTANT: When referencing issues, do NOT list their details (title, status, priority) in your text — those are rendered as rich cards automatically. However, you MUST mention the identifier (e.g. BCK-1) of every issue you want shown as a card. For example:
- "Here are the latest 3 issues: BCK-1, BACK-1, FRON-1"
- "Done — created BACK-3."
- "Found 2 matching issues: BCK-1 and BCK-2"
Only issues whose identifiers appear in your text will be shown as cards.

You have access to:
- The codebase (read-only): search files, read code, list directories
- The issue tracker: list, search, create, update, and delete issues
- Company info: read and update company details, mission, state
- Channel history: see recent messages for context

When answering codebase questions, look at the actual code — don't guess.
When managing issues, confirm what you did briefly.`;

export async function chatWithOli(request: ChatRequest): Promise<ChatResponse> {
    const { message, channel_id, username, callback_url, internal_secret, openai_api_key } = request;

    const client = new PluginClient(callback_url, internal_secret);
    const tools = createOliTools(client);

    const openai = createOpenAI({ apiKey: openai_api_key });

    const prompt = `@${username} asks: ${message}

Channel ID (for fetching history if needed): ${channel_id}`;

    console.log(`[Oli] Question from @${username}: ${message}`);

    const codeSnippets: CodeSnippet[] = [];
    const issueRefs: IssueRef[] = [];

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
                    console.log(`[Oli] Tool call: ${tc.toolName}(${JSON.stringify(tc.args).substring(0, 300)})`);
                }
            }
            if (step.toolResults?.length) {
                for (const tr of step.toolResults) {
                    console.log(`[Oli] Tool result [${tr.toolName}]: ${JSON.stringify(tr.result).substring(0, 300)}`);

                    // Capture code snippets from read_file results.
                    if (tr.toolName === 'read_file' && tr.result && typeof tr.result === 'object' && 'content' in tr.result) {
                        const r = tr.result as { file: string; language: string; start_line: number; end_line: number; content: string };
                        codeSnippets.push({
                            file: r.file,
                            lines: `${r.start_line}-${r.end_line}`,
                            language: r.language,
                            content: r.content,
                        });
                    }

                    // Capture issue refs from single-issue tool results.
                    if (['get_issue', 'create_issue', 'update_issue'].includes(tr.toolName) &&
                        tr.result && typeof tr.result === 'object' && 'identifier' in tr.result) {
                        const r = tr.result as { id: string; identifier: string; title: string; status: string; priority: string };
                        if (!issueRefs.some((ref) => ref.id === r.id)) {
                            issueRefs.push({
                                id: r.id,
                                identifier: r.identifier,
                                title: r.title,
                                status: r.status,
                                priority: r.priority,
                            });
                        }
                    }

                    // Capture issue refs from list_issues and search_all_issues results.
                    if (['list_issues', 'search_all_issues'].includes(tr.toolName) &&
                        tr.result && typeof tr.result === 'object' && 'issues' in tr.result) {
                        const r = tr.result as { issues: Array<{ id: string; identifier: string; title: string; status: string; priority: string }> };
                        for (const issue of r.issues) {
                            if (!issueRefs.some((ref) => ref.id === issue.id)) {
                                issueRefs.push({
                                    id: issue.id,
                                    identifier: issue.identifier,
                                    title: issue.title,
                                    status: issue.status,
                                    priority: issue.priority,
                                });
                            }
                        }
                    }
                }
            }
            if (step.text) {
                console.log(`[Oli] Text: ${step.text.substring(0, 300)}`);
            }
        },
    });

    console.log(`[Oli] Response: ${result.text?.substring(0, 300)}`);

    const responseText = result.text || '';

    // Only show issue cards for identifiers the LLM explicitly mentioned in its response.
    const filteredIssueRefs = issueRefs.filter((ref) => responseText.includes(ref.identifier));

    console.log(`[Oli] Snippets: ${codeSnippets.length}, Issues: ${filteredIssueRefs.length} (of ${issueRefs.length} captured)`);

    return {
        text: responseText,
        code_snippets: codeSnippets,
        issue_refs: filteredIssueRefs,
    };
}
