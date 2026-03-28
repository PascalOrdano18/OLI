// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Fake issue API — all operations are logged, no real persistence.
// In production, replace these with real HTTP calls to your issue tracker.

export function createIssue(issue) {
    const id = `ALPHA-${Date.now()}`;
    console.log('[ISSUE API] CREATE', JSON.stringify({id, ...issue}, null, 2));
    return {id, ...issue, status: 'open', createdAt: new Date().toISOString()};
}

export function editIssue(id, patch) {
    console.log('[ISSUE API] EDIT', id, JSON.stringify(patch, null, 2));
    return {id, ...patch, updatedAt: new Date().toISOString()};
}

export function deleteIssue(id) {
    console.log('[ISSUE API] DELETE', id);
    return {id, deletedAt: new Date().toISOString()};
}
