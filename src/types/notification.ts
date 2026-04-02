// Copyright (c) 2016-present OLI, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {NotificationConstructorOptions} from 'electron/common';

export type MentionOptions = NotificationConstructorOptions & {
    soundName: string;
}
