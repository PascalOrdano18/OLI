// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {tool} from 'ai';
import {z} from 'zod';

import type {Issue, NewIssue} from '../types';

export async function executeCreateIssue(_issue: NewIssue): Promise<Issue> {
    throw new Error('Not implemented');
}

export const createIssueTool = tool({
    description: 'Create a new issue with a title, description, priority, and optional metadata like assignee, labels, and due date.',
    inputSchema: z.object({
        title: z.string().describe('Short summary of the issue'),
        description: z.string().describe('Detailed description of the issue'),
        priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).describe('Priority level'),
        status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled']).optional().describe('Initial status (defaults to backlog)'),
        assigneeId: z.string().optional().describe('User ID to assign the issue to'),
        labels: z.array(z.string()).optional().describe('Labels to tag the issue with'),
        projectId: z.string().optional().describe('Project to associate the issue with'),
        teamId: z.string().optional().describe('Team to associate the issue with'),
        dueDate: z.string().optional().describe('Due date in ISO 8601 format'),
    }),
    execute: async (params) => {
        return executeCreateIssue(params as NewIssue);
    },
});
