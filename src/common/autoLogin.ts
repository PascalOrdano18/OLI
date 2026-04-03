// Copyright (c) 2016-present OLI, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Stores auto-login credentials from the org setup flow so the server view can
// automatically log in without showing any Mattermost login pages.

const pendingLogins = new Map<string, {email: string; password: string}>();

export function storeAutoLogin(serverUrl: string, email: string, password: string) {
    // Normalize URL
    const normalized = serverUrl.replace(/\/+$/, '');
    pendingLogins.set(normalized, {email, password});
}

export function consumeAutoLogin(serverUrl: string): {email: string; password: string} | undefined {
    const normalized = serverUrl.replace(/\/+$/, '');
    const creds = pendingLogins.get(normalized);
    if (creds) {
        pendingLogins.delete(normalized);
    }
    return creds;
}

export function getAutoLogin(serverUrl: string): {email: string; password: string} | undefined {
    const normalized = serverUrl.replace(/\/+$/, '');
    return pendingLogins.get(normalized);
}
