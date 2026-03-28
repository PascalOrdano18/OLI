// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {tool} from 'ai';
import {z} from 'zod';

import type {Issue} from '../types';

export async function executeUpdateIssue(issue: Issue): Promise<Issue> {
    const updated = {...issue, updatedAt: new Date().toISOString()};
    console.log('[TOOL] updateIssue →', JSON.stringify(updated, null, 2));
    return updated;
}

export const updateIssueTool = tool({
    description: 'Update an existing issue. Provide the issue ID and any fields to change.',
    inputSchema: z.object({
        id: z.string().describe('ID of the issue to update'),
        title: z.string().optional().describe('New title for the issue'),
        description: z.string().optional().describe('New description for the issue'),
        priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional().describe('New priority level'),
        status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled']).optional().describe('New status'),
        assigneeId: z.string().optional().describe('New assignee user ID'),
        labels: z.array(z.string()).optional().describe('New set of labels (replaces existing)'),
        projectId: z.string().optional().describe('New project ID'),
        teamId: z.string().optional().describe('New team ID'),
        dueDate: z.string().optional().describe('New due date in ISO 8601 format'),
    }),
    execute: async (params) => {
        return executeUpdateIssue(params as Issue);
    },
});
