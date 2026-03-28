// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {tool} from 'ai';
import {z} from 'zod';

import type {Issue} from '../types';

export async function executeGetIssues(): Promise<Issue[]> {
    throw new Error('Not implemented');
}

export const getIssuesTool = tool({
    description: 'Retrieve a list of issues.',
    inputSchema: z.object({}),
    execute: async () => {
        return executeGetIssues();
    },
});
