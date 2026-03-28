// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

export type IssueStatus =
    | 'backlog'
    | 'todo'
    | 'in_progress'
    | 'in_review'
    | 'done'
    | 'cancelled';

export type Issue = {
    id: string;
    title: string;
    description: string;
    status: IssueStatus;
    priority: IssuePriority;
    assigneeId?: string;
    labels: string[];
    projectId?: string;
    teamId?: string;
    dueDate?: string;
    createdAt: string;
    updatedAt: string;
};

export type Project = {
    name: string;
    general: string; // contents of general.md
    issues: Issue[];
};

export type Context = {
    general: string; // contents of context/general.md
    projects: Project[];
};

export type NewIssue = Omit<Issue, 'id' | 'createdAt' | 'updatedAt'>;
