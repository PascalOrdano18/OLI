// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {tool} from 'ai';
import {z} from 'zod';

import type {Issue} from '../types';

const mockIssues: Issue[] = [
    {id: 'ALPHA-1', title: 'CI pipeline failing on main branch', description: 'The CI pipeline on main has been red since last deploy.', status: 'todo', priority: 'urgent', labels: [], createdAt: '2026-03-25T10:00:00Z', updatedAt: '2026-03-25T10:00:00Z'},
    {id: 'ALPHA-2', title: 'Add Slack notifications for deployment events', description: 'Set up Slack webhook notifications when deployments complete.', status: 'in_progress', priority: 'medium', labels: [], createdAt: '2026-03-24T14:00:00Z', updatedAt: '2026-03-26T09:00:00Z'},
    {id: 'ALPHA-3', title: 'Upgrade Node.js from v18 to v22', description: 'Node 18 reaches EOL soon. Plan and execute the upgrade to v22.', status: 'todo', priority: 'high', labels: [], createdAt: '2026-03-20T08:00:00Z', updatedAt: '2026-03-20T08:00:00Z'},
];

export async function executeGetIssues(): Promise<Issue[]> {
    console.log('[TOOL] getIssues → returning', mockIssues.length, 'issues');
    return mockIssues;
}

export const getIssuesTool = tool({
    description: 'Retrieve a list of issues.',
    inputSchema: z.object({}),
    execute: async () => {
        return executeGetIssues();
    },
});
