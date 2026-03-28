// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {anthropic} from '@ai-sdk/anthropic';
import {ToolLoopAgent, stepCountIs} from 'ai';

import {buildSystemPrompt} from './systemPrompt';

import {createIssueTool} from '../../common/tools/createIssue';
import {deleteIssueTool} from '../../common/tools/deleteIssue';
import {getIssuesTool} from '../../common/tools/getIssues';
import {updateIssueTool} from '../../common/tools/updateIssue';
import type {Context} from '../../common/types';

export function createAgent(context: Context, transcript: string) {
    return new ToolLoopAgent({
        id: 'fiona-calls-agent',
        model: anthropic('claude-sonnet-4-20250514'),
        instructions: buildSystemPrompt(context, transcript),
        tools: {
            createIssue: createIssueTool,
            updateIssue: updateIssueTool,
            deleteIssue: deleteIssueTool,
            getIssues: getIssuesTool,
        },
        stopWhen: stepCountIs(10),
        temperature: 0,
    });
}

export default createAgent;
