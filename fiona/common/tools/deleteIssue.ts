// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {tool} from 'ai';
import {z} from 'zod';

export async function executeDeleteIssue(issueId: string): Promise<{deleted: boolean}> {
    console.log('[TOOL] deleteIssue →', issueId);
    return {deleted: true};
}

export const deleteIssueTool = tool({
    description: 'Delete an issue by its ID. This action is permanent and cannot be undone.',
    inputSchema: z.object({
        issueId: z.string().describe('ID of the issue to delete'),
    }),
    execute: async ({issueId}) => {
        return executeDeleteIssue(issueId);
    },
});
