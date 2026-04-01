// Copyright (c) 2016-present OLI, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export type SavedWindowState = Electron.Rectangle & {
    maximized: boolean;
    fullscreen: boolean;
}
