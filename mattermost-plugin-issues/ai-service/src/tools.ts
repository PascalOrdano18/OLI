// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import { tool } from 'ai';
import { z } from 'zod';

import type { PluginClient } from './plugin-client';

// Wraps an async execute function so errors return an error message
// instead of throwing, allowing the LLM to recover and retry.
function safe<T, R>(fn: (args: T) => Promise<R>): (args: T) => Promise<R | { error: string }> {
    return async (args: T) => {
        try {
            return await fn(args);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[Tool Error] ${message}`);
            return { error: message };
        }
    };
}

export function createTools(client: PluginClient) {
    return {
        list_projects: tool({
            description: 'List all projects in the issue tracker. Call this first to discover available projects. IMPORTANT: Use the "id" field (a UUID like "c2634e45-...") when calling other tools, NOT the prefix.',
            parameters: z.object({}),
            execute: safe(async () => {
                const projects = await client.listProjects();
                return projects.map((p) => ({
                    id: p.id,
                    name: p.name,
                    prefix: p.prefix,
                }));
            }),
        }),

        list_issues: tool({
            description: 'List issues for a specific project. Supports an optional search query that matches against title, description, and identifier.',
            parameters: z.object({
                project_id: z.string().describe('The project UUID from list_projects "id" field. Do NOT use the prefix.'),
                query: z.string().optional().describe('Optional search query to filter issues'),
            }),
            execute: safe(async ({ project_id, query }) => {
                const result = await client.listIssues(project_id, query);
                return {
                    issues: result.issues.map((i) => ({
                        id: i.id,
                        identifier: i.identifier,
                        title: i.title,
                        status: i.status,
                        priority: i.priority,
                        description: i.description.length > 200
                            ? i.description.substring(0, 200) + '...'
                            : i.description,
                    })),
                    total_count: result.total_count,
                };
            }),
        }),

        get_issue: tool({
            description: 'Get the full details of a specific issue, including its complete description.',
            parameters: z.object({
                issue_id: z.string().describe('The issue UUID'),
            }),
            execute: safe(async ({ issue_id }) => {
                return client.getIssue(issue_id);
            }),
        }),

        search_all_issues: tool({
            description: 'Search for issues across ALL projects. Use this to check if an issue already exists before creating a new one.',
            parameters: z.object({
                query: z.string().describe('Search query to find in issue titles, descriptions, and identifiers'),
            }),
            execute: safe(async ({ query }) => {
                const projects = await client.listProjects();
                const allIssues: Array<{
                    id: string;
                    identifier: string;
                    title: string;
                    status: string;
                    priority: string;
                    project_name: string;
                    description: string;
                }> = [];

                for (const project of projects) {
                    const result = await client.listIssues(project.id, query);
                    for (const issue of result.issues) {
                        allIssues.push({
                            id: issue.id,
                            identifier: issue.identifier,
                            title: issue.title,
                            status: issue.status,
                            priority: issue.priority,
                            project_name: project.name,
                            description: issue.description.length > 200
                                ? issue.description.substring(0, 200) + '...'
                                : issue.description,
                        });
                    }
                }

                return { issues: allIssues, total_count: allIssues.length };
            }),
        }),

        create_issue: tool({
            description: 'Create a new issue in a project. Use this when you find actionable items in the conversation that are not already tracked.',
            parameters: z.object({
                project_id: z.string().describe('The project UUID from list_projects "id" field (e.g. "c2634e45-960b-4f05-960c-b6308260995b"). Do NOT use the prefix.'),
                title: z.string().describe('Concise, descriptive issue title'),
                description: z.string().describe('Detailed description including relevant context from the conversation'),
                status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'])
                    .default('backlog')
                    .describe('Issue status'),
                priority: z.enum(['urgent', 'high', 'medium', 'low', 'none'])
                    .default('none')
                    .describe('Issue priority based on urgency signals in the conversation'),
            }),
            execute: safe(async ({ project_id, title, description, status, priority }) => {
                const issue = await client.createIssue(project_id, {
                    title,
                    description,
                    status,
                    priority,
                });
                return {
                    id: issue.id,
                    identifier: issue.identifier,
                    title: issue.title,
                    status: issue.status,
                    priority: issue.priority,
                };
            }),
        }),

        update_issue: tool({
            description: 'Update an existing issue with new information from the conversation. Use this to append details, change status, or adjust priority.',
            parameters: z.object({
                issue_id: z.string().describe('The issue UUID'),
                title: z.string().optional().describe('Updated title'),
                description: z.string().optional().describe('Updated description (replaces existing)'),
                status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'])
                    .optional()
                    .describe('Updated status'),
                priority: z.enum(['urgent', 'high', 'medium', 'low', 'none'])
                    .optional()
                    .describe('Updated priority'),
            }),
            execute: safe(async ({ issue_id, title, description, status, priority }) => {
                const updates: Record<string, string> = {};
                if (title) updates.title = title;
                if (description) updates.description = description;
                if (status) updates.status = status;
                if (priority) updates.priority = priority;

                const issue = await client.updateIssue(issue_id, updates);
                return {
                    id: issue.id,
                    identifier: issue.identifier,
                    title: issue.title,
                    status: issue.status,
                    priority: issue.priority,
                };
            }),
        }),
    };
}
