// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import { createIssueTools, createContextTools } from './shared-tools';

import type { PluginClient } from './plugin-client';

export function createTools(client: PluginClient) {
    return {
        ...createIssueTools(client),
        ...createContextTools(client),
    };
}
