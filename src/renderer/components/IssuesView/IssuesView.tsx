// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useState, useCallback, useRef} from 'react';
import {Terminal} from 'xterm';
import {FitAddon} from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

import './IssuesView.scss';

// ── Types ──────────────────────────────────────────────────────────────────

type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
type IssuePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
type GroupBy = 'status' | 'priority' | 'none';
type SubTab = 'agents' | 'diff' | 'docs';

interface Project { id: string; name: string; prefix: string; next_issue_number: number }
interface Issue {
    id: string; project_id: string; identifier: string; title: string; description: string;
    status: IssueStatus; priority: IssuePriority; label_ids: string[]; assignee_id: string;
    cycle_id: string; estimate_hours: number; sort_order: number;
}
interface IssueLabel { id: string; name: string; color: string }
interface IssueFilters { status?: IssueStatus; priority?: IssuePriority; searchQuery?: string; groupBy: GroupBy }

// ── Constants ──────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<IssueStatus, string> = {
    backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress',
    in_review: 'In Review', done: 'Done', cancelled: 'Cancelled',
};
const STATUS_COLORS: Record<IssueStatus, string> = {
    backlog: '#8b95a1', todo: '#3d9ef5', in_progress: '#f5a623',
    in_review: '#9b59b6', done: '#3dc779', cancelled: '#e05c5c',
};
const PRIORITY_LABELS: Record<IssuePriority, string> = {
    urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', none: 'No Priority',
};
const PRIORITY_COLORS: Record<IssuePriority, string> = {
    urgent: '#e05c5c', high: '#f5a623', medium: '#f5d63d', low: '#3d9ef5', none: '#8b95a1',
};
const PRIORITY_ICONS: Record<IssuePriority, string> = {
    urgent: '!', high: '↑', medium: '—', low: '↓', none: '·',
};
const STATUS_ORDER: IssueStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'];
const PRIORITY_ORDER: IssuePriority[] = ['urgent', 'high', 'medium', 'low', 'none'];

// ── API helper ─────────────────────────────────────────────────────────────

function api<T>(method: string, path: string, body?: unknown): Promise<T> {
    return window.desktop.issuesApiRequest(method, path, body) as Promise<T>;
}

// ── Sidebar sub-components ─────────────────────────────────────────────────

const PriorityIcon: React.FC<{priority: IssuePriority}> = ({priority}) => (
    <span className='IV__priorityIcon' title={PRIORITY_LABELS[priority]} style={{color: PRIORITY_COLORS[priority]}}>
        {PRIORITY_ICONS[priority]}
    </span>
);

const StatusDot: React.FC<{status: IssueStatus}> = ({status}) => (
    <span
        className='IV__statusDot'
        style={{background: STATUS_COLORS[status], boxShadow: `0 0 0 1px ${STATUS_COLORS[status]}60`}}
        title={STATUS_LABELS[status]}
    />
);

const LabelPill: React.FC<{label: IssueLabel}> = ({label}) => (
    <span
        className='IV__labelPill'
        style={{background: label.color + '28', color: label.color, border: `1px solid ${label.color}55`}}
    >
        {label.name}
    </span>
);

// ── ProjectSelector ────────────────────────────────────────────────────────

const ProjectSelector: React.FC<{
    projects: Project[];
    activeProjectId: string;
    serverId: string;
    onSelect: (id: string) => void;
    onCreate: (data: {name: string; prefix: string}) => void;
    onRepoPicked: (path: string) => void;
}> = ({projects, activeProjectId, serverId, onSelect, onCreate, onRepoPicked}) => {
    const [isCreating, setIsCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [newPrefix, setNewPrefix] = useState('');
    const [repoPath, setRepoPath] = useState<string | null>(null);

    useEffect(() => {
        if (!activeProjectId) { return; }
        window.desktop.ao.getSessionStatus(activeProjectId).then((s) => {
            setRepoPath(s.repoPath);
        }).catch(() => { /* ignore */ });
    }, [activeProjectId]);

    const handlePickRepo = async () => {
        if (!activeProjectId) {
            alert('Create a project first before linking a git repo.');
            return;
        }
        try {
            const picked = await window.desktop.ao.pickRepoPath(serverId, activeProjectId);
            if (picked) {
                setRepoPath(picked);
                onRepoPicked(picked);
            }
        } catch (err) {
            alert(`Failed to link repo: ${err instanceof Error ? err.message : String(err)}`);
        }
    };

    const handleCreate = () => {
        if (newName.trim() && newPrefix.trim()) {
            onCreate({name: newName.trim(), prefix: newPrefix.trim()});
            setNewName(''); setNewPrefix(''); setIsCreating(false);
        }
    };

    if (isCreating) {
        return (
            <div className='IV__createProject'>
                <input autoFocus={true} type='text' placeholder='Name' value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { handleCreate(); } else if (e.key === 'Escape') { setIsCreating(false); } }}
                    className='IV__input IV__input--sm'/>
                <input type='text' placeholder='PRE' value={newPrefix}
                    onChange={(e) => setNewPrefix(e.target.value.toUpperCase())}
                    className='IV__input IV__input--sm IV__input--prefix'/>
                <button onClick={handleCreate} className='IV__btn IV__btn--xs'>{'OK'}</button>
                <button onClick={() => setIsCreating(false)} className='IV__btn IV__btn--xs IV__btn--ghost'>{'✕'}</button>
            </div>
        );
    }

    return (
        <div className='IV__projectSelector'>
            <select value={activeProjectId} onChange={(e) => onSelect(e.target.value)} className='IV__projectSelect'>
                {projects.length === 0 && <option value=''>{'No projects'}</option>}
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button onClick={() => setIsCreating(true)} title='New project' className='IV__iconBtn'>{'+'}</button>
            <button
                onClick={handlePickRepo}
                title={repoPath ? `Repo: ${repoPath}` : 'Link a local git repo'}
                className={`IV__iconBtn${repoPath ? ' IV__iconBtn--active' : ''}`}
            >{'📁'}</button>
        </div>
    );
};

// ── IssueRow ───────────────────────────────────────────────────────────────

const IssueRow: React.FC<{
    issue: Issue;
    labels: Record<string, IssueLabel>;
    isActive: boolean;
    onClick: () => void;
}> = ({issue, labels, isActive, onClick}) => {
    const issueLabels = (issue.label_ids || []).map((id) => labels[id]).filter(Boolean);
    return (
        <div onClick={onClick} className={`IV__issueRow${isActive ? ' IV__issueRow--active' : ''}`}>
            <PriorityIcon priority={issue.priority}/>
            <StatusDot status={issue.status}/>
            <span className='IV__issueId'>{issue.identifier}</span>
            <span className='IV__issueTitle'>{issue.title}</span>
            {issueLabels.length > 0 && (
                <div className='IV__issueLabelRow'>
                    {issueLabels.map((label) => <LabelPill key={label.id} label={label}/>)}
                </div>
            )}
        </div>
    );
};

// ── IssueList ──────────────────────────────────────────────────────────────

const IssueList: React.FC<{
    groupedIssues: Record<string, Issue[]>;
    labels: Record<string, IssueLabel>;
    filters: IssueFilters;
    activeIssueId: string | null;
    onClickIssue: (issue: Issue) => void;
}> = ({groupedIssues, labels, filters, activeIssueId, onClickIssue}) => {
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const entries = Object.entries(groupedIssues);
    const groupBy = filters.groupBy || 'status';

    if (entries.length === 0) {
        return <div className='IV__empty'>{'No issues found'}</div>;
    }

    const getLabel = (key: string) => {
        if (groupBy === 'status') { return STATUS_LABELS[key as IssueStatus] || key; }
        if (groupBy === 'priority') { return PRIORITY_LABELS[key as IssuePriority] || key; }
        return key;
    };
    const getColor = (key: string) => {
        if (groupBy === 'status') { return STATUS_COLORS[key as IssueStatus] || '#8b95a1'; }
        if (groupBy === 'priority') { return PRIORITY_COLORS[key as IssuePriority] || '#8b95a1'; }
        return '#8b95a1';
    };

    return (
        <div className='IV__list'>
            {entries.map(([key, issues]) => {
                if (groupBy !== 'none' && issues.length === 0) { return null; }
                const isCollapsed = collapsed[key];
                const color = getColor(key);
                return (
                    <div key={key}>
                        {groupBy !== 'none' && (
                            <div className='IV__groupHeader' onClick={() => setCollapsed({...collapsed, [key]: !isCollapsed})}>
                                <span className='IV__groupCaret'>{isCollapsed ? '▸' : '▾'}</span>
                                <span className='IV__groupDot' style={{background: color}}/>
                                <span className='IV__groupLabel' style={{color}}>{getLabel(key)}</span>
                                <span className='IV__groupCount'>({issues.length})</span>
                            </div>
                        )}
                        {!isCollapsed && issues.map((issue) => (
                            <IssueRow
                                key={issue.id}
                                issue={issue}
                                labels={labels}
                                isActive={activeIssueId === issue.id}
                                onClick={() => onClickIssue(issue)}
                            />
                        ))}
                    </div>
                );
            })}
        </div>
    );
};

// ── IssueSidebar ───────────────────────────────────────────────────────────

interface IssueSidebarProps {
    projects: Project[];
    activeProjectId: string;
    serverId: string;
    issues: Issue[];
    labelsMap: Record<string, IssueLabel>;
    filters: IssueFilters;
    loading: boolean;
    activeIssueId: string | null;
    onSelectProject: (id: string) => void;
    onCreateProject: (data: {name: string; prefix: string}) => void;
    onNewIssue: () => void;
    onClickIssue: (issue: Issue) => void;
    onFiltersChange: (f: IssueFilters) => void;
    onRepoPicked: (path: string) => void;
}

const IssueSidebar: React.FC<IssueSidebarProps> = ({
    projects, activeProjectId, serverId, issues, labelsMap, filters, loading, activeIssueId,
    onSelectProject, onCreateProject, onNewIssue, onClickIssue, onFiltersChange, onRepoPicked,
}) => {
    const filtered = issues.filter((issue) => {
        if (filters.status && issue.status !== filters.status) { return false; }
        if (filters.priority && issue.priority !== filters.priority) { return false; }
        if (filters.searchQuery) {
            const q = filters.searchQuery.toLowerCase();
            if (!issue.title.toLowerCase().includes(q) && !issue.identifier?.toLowerCase().includes(q)) { return false; }
        }
        return true;
    });

    const groupedIssues = (() => {
        const gb = filters.groupBy || 'status';
        if (gb === 'none') { return {all: filtered}; }
        const order = gb === 'status' ? STATUS_ORDER : PRIORITY_ORDER;
        const map: Record<string, Issue[]> = {};
        order.forEach((k) => { map[k] = []; });
        filtered.forEach((issue) => {
            const key = gb === 'status' ? issue.status : issue.priority;
            if (!map[key]) { map[key] = []; }
            map[key].push(issue);
        });
        return map;
    })();

    return (
        <div className='IV__sidebar'>
            <div className='IV__sidebarHeader'>
                <ProjectSelector
                    projects={projects}
                    activeProjectId={activeProjectId}
                    serverId={serverId}
                    onSelect={onSelectProject}
                    onCreate={onCreateProject}
                    onRepoPicked={onRepoPicked}
                />
                <button
                    onClick={onNewIssue}
                    disabled={!activeProjectId}
                    className={`IV__btn IV__btn--primary IV__btn--sm${!activeProjectId ? ' IV__btn--disabled' : ''}`}
                >{'+ New'}</button>
            </div>
            <div className='IV__sidebarFilters'>
                <input
                    type='text'
                    placeholder='Search issues...'
                    value={filters.searchQuery || ''}
                    onChange={(e) => onFiltersChange({...filters, searchQuery: e.target.value})}
                    className='IV__input IV__input--search'
                />
                <div className='IV__filterRow'>
                    <select value={filters.status || ''} onChange={(e) => onFiltersChange({...filters, status: (e.target.value || undefined) as IssueStatus | undefined})} className='IV__filterSelect'>
                        <option value=''>{'All stati'}</option>
                        {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <select value={filters.priority || ''} onChange={(e) => onFiltersChange({...filters, priority: (e.target.value || undefined) as IssuePriority | undefined})} className='IV__filterSelect'>
                        <option value=''>{'All prio'}</option>
                        {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <label className='IV__groupByLabel'>
                        {'Group:'}
                        <select value={filters.groupBy} onChange={(e) => onFiltersChange({...filters, groupBy: e.target.value as GroupBy})} className='IV__filterSelect'>
                            <option value='status'>{'Status'}</option>
                            <option value='priority'>{'Priority'}</option>
                            <option value='none'>{'None'}</option>
                        </select>
                    </label>
                </div>
            </div>
            <div className='IV__sidebarList'>
                {loading ? (
                    <div className='IV__loading'>{'Loading...'}</div>
                ) : (
                    <IssueList
                        groupedIssues={groupedIssues}
                        labels={labelsMap}
                        filters={filters}
                        activeIssueId={activeIssueId}
                        onClickIssue={onClickIssue}
                    />
                )}
            </div>
        </div>
    );
};

// ── CreateIssueModal ───────────────────────────────────────────────────────

const CreateIssueModal: React.FC<{
    issue?: Issue | null;
    labels: IssueLabel[];
    onSave: (data: Partial<Issue>) => void;
    onDelete?: () => void;
    onClose: () => void;
}> = ({issue, labels, onSave, onDelete, onClose}) => {
    const [title, setTitle] = useState(issue?.title ?? '');
    const [description, setDescription] = useState(issue?.description ?? '');
    const [status, setStatus] = useState<IssueStatus>(issue?.status ?? 'backlog');
    const [priority, setPriority] = useState<IssuePriority>(issue?.priority ?? 'none');
    const [labelIds, setLabelIds] = useState<string[]>(issue?.label_ids ?? []);

    return (
        <div className='IV__modalBackdrop' onClick={onClose}>
            <div className='IV__modal' onClick={(e) => e.stopPropagation()}>
                <div className='IV__modalHeader'>
                    <h3 className='IV__modalTitle'>{issue ? `Edit ${issue.identifier}` : 'New Issue'}</h3>
                    <button onClick={onClose} className='IV__iconBtn'>{'✕'}</button>
                </div>
                <div className='IV__modalBody'>
                    <div className='IV__field'>
                        <label className='IV__label'>{'Title *'}</label>
                        <input autoFocus={true} type='text' value={title} onChange={(e) => setTitle(e.target.value)} placeholder='Issue title' className='IV__input'/>
                    </div>
                    <div className='IV__field'>
                        <label className='IV__label'>{'Description'}</label>
                        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder='Add a description...' rows={3} className='IV__input IV__input--textarea'/>
                    </div>
                    <div className='IV__fieldRow'>
                        <div className='IV__field'>
                            <label className='IV__label'>{'Status'}</label>
                            <select value={status} onChange={(e) => setStatus(e.target.value as IssueStatus)} className='IV__input'>
                                {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                        </div>
                        <div className='IV__field'>
                            <label className='IV__label'>{'Priority'}</label>
                            <select value={priority} onChange={(e) => setPriority(e.target.value as IssuePriority)} className='IV__input'>
                                {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                        </div>
                    </div>
                    {labels.length > 0 && (
                        <div className='IV__field'>
                            <label className='IV__label'>{'Labels'}</label>
                            <div className='IV__labelPicker'>
                                {labels.map((label) => {
                                    const sel = labelIds.includes(label.id);
                                    return (
                                        <button key={label.id}
                                            onClick={() => setLabelIds((p) => p.includes(label.id) ? p.filter((x) => x !== label.id) : [...p, label.id])}
                                            className='IV__labelToggle'
                                            style={{border: `1px solid ${label.color}`, background: sel ? label.color + '30' : 'transparent', color: label.color}}
                                        >{label.name}</button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
                <div className='IV__modalFooter'>
                    <div>{issue && onDelete && <button onClick={onDelete} className='IV__btn IV__btn--danger'>{'Delete'}</button>}</div>
                    <div className='IV__modalActions'>
                        <button onClick={onClose} className='IV__btn IV__btn--ghost'>{'Cancel'}</button>
                        <button
                            onClick={() => title.trim() && onSave({title: title.trim(), description, status, priority, label_ids: labelIds})}
                            disabled={!title.trim()}
                            className={`IV__btn IV__btn--primary${!title.trim() ? ' IV__btn--disabled' : ''}`}
                        >{issue ? 'Save' : 'Create'}</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ── EmbeddedTerminal ───────────────────────────────────────────────────────

const EmbeddedTerminal: React.FC<{projectId: string}> = ({projectId}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);

    useEffect(() => {
        if (!containerRef.current) { return; }
        const term = new Terminal({
            theme: {
                background: '#1e1e2e',
                foreground: '#cdd6f4',
                cursor: '#f5e0dc',
                selectionBackground: '#45475a',
                black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
                blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
                brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1',
                brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7',
                brightCyan: '#94e2d5', brightWhite: '#a6adc8',
            },
            fontFamily: '"Menlo", "Monaco", "Courier New", monospace',
            fontSize: 13,
            lineHeight: 1.3,
            cursorBlink: true,
            scrollback: 5000,
            disableStdin: false,
            allowTransparency: false,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(containerRef.current);
        fit.fit();
        termRef.current = term;
        fitRef.current = fit;

        // Sync terminal size to tmux on resize
        const syncSize = () => {
            if (!fitRef.current || !termRef.current) { return; }
            fitRef.current.fit();
            window.desktop.ao.resizeTerminal(projectId, termRef.current.cols, termRef.current.rows).catch(() => { /* ignore */ });
        };
        term.onResize(({cols, rows}) => {
            window.desktop.ao.resizeTerminal(projectId, cols, rows).catch(() => { /* ignore */ });
        });

        // Forward keystrokes to tmux
        const inputDisposable = term.onData((input) => {
            window.desktop.ao.sendRawInput(projectId, input).catch(() => { /* ignore */ });
        });

        // Receive screen snapshot from main process
        const handleOutput = (data: {screen: string}) => {
            term.write('\x1b[H\x1b[J'); // cursor home + clear to end of screen (no scrollback wipe)
            term.write(data.screen);
        };
        window.desktop.ao.onOutputUpdate(handleOutput);

        const ro = new ResizeObserver(syncSize);
        if (containerRef.current) { ro.observe(containerRef.current); }

        // Initial size sync
        syncSize();

        return () => {
            inputDisposable.dispose();
            window.desktop.ao.offOutputUpdate(handleOutput);
            ro.disconnect();
            term.dispose();
        };
    }, [projectId]);

    return <div ref={containerRef} className='IV__terminal'/>;
};

// ── SubTabBar ──────────────────────────────────────────────────────────────

const SubTabBar: React.FC<{active: SubTab; onChange: (t: SubTab) => void}> = ({active, onChange}) => (
    <div className='IV__subTabs'>
        {(['agents', 'diff', 'docs'] as SubTab[]).map((t) => (
            <button
                key={t}
                className={`IV__subTab${active === t ? ' IV__subTab--active' : ''}`}
                onClick={() => onChange(t)}
            >
                {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
        ))}
    </div>
);

// ── DiffTab ────────────────────────────────────────────────────────────────

interface DiffFile { path: string; additions: number; deletions: number; collapsed: boolean; hunks: DiffHunk[] }
interface DiffHunk { header: string; lines: DiffLine[] }
interface DiffLine { type: 'context' | 'add' | 'remove'; oldNum?: number; newNum?: number; content: string }

const HARDCODED_DIFF: DiffFile[] = [
    {
        path: 'src/renderer/components/IssuesView/IssuesView.tsx',
        additions: 47, deletions: 12, collapsed: false,
        hunks: [{
            header: "@@ -1,7 +1,7 @@ import React from 'react';",
            lines: [
                {type: 'context', oldNum: 1, newNum: 1, content: ' // Copyright (c) 2016-present Mattermost, Inc.'},
                {type: 'remove', oldNum: 4, content: "-import React, { useState } from 'react';"},
                {type: 'add', newNum: 4, content: "+import React, { useEffect, useState, useCallback } from 'react';"},
            ],
        }],
    },
    {
        path: 'src/common/communication.ts',
        additions: 3, deletions: 0, collapsed: true, hunks: [],
    },
];

const DiffFileBlock: React.FC<{file: DiffFile}> = ({file}) => {
    const [collapsed, setCollapsed] = useState(file.collapsed);
    const addBar = Math.min(5, file.additions);
    const delBar = Math.min(5, file.deletions);
    return (
        <div className='IV__diffFile'>
            <div className='IV__diffFileHeader' onClick={() => setCollapsed((c) => !c)}>
                <span className='IV__diffFileCaret'>{collapsed ? '▸' : '▾'}</span>
                <span className='IV__diffFilePath'>{file.path}</span>
                <div className='IV__diffFileMeta'>
                    <span className='IV__diffAdd'>+{file.additions}</span>
                    <span className='IV__diffDel'>-{file.deletions}</span>
                    <div className='IV__diffBar'>
                        {Array.from({length: 5}).map((_, i) => (
                            <span key={i} className={`IV__diffBarCell ${i < addBar ? 'IV__diffBarCell--add' : i < addBar + delBar ? 'IV__diffBarCell--del' : 'IV__diffBarCell--empty'}`}/>
                        ))}
                    </div>
                </div>
            </div>
            {!collapsed && file.hunks.map((hunk, hi) => (
                <div key={hi} className='IV__diffHunk'>
                    <div className='IV__diffHunkHeader'>{hunk.header}</div>
                    {hunk.lines.map((line, li) => (
                        <div key={li} className={`IV__diffLine IV__diffLine--${line.type}`}>
                            <span className='IV__diffLineNum'>{line.oldNum ?? ''}</span>
                            <span className='IV__diffLineNum'>{line.newNum ?? ''}</span>
                            <span className='IV__diffLineSign'>{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</span>
                            <span className='IV__diffLineContent'>{line.content}</span>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
};

const DiffTab: React.FC = () => (
    <div className='IV__diffTab'>
        <div className='IV__diffHeader'>
            <span className='IV__diffSummary'>{'2 files changed'}</span>
            <span className='IV__diffSummaryAdd'>{'+50'}</span>
            <span className='IV__diffSummaryDel'>{'-12'}</span>
        </div>
        <div className='IV__diffBody'>
            {HARDCODED_DIFF.map((file) => <DiffFileBlock key={file.path} file={file}/>)}
        </div>
    </div>
);

// ── DocsTab ────────────────────────────────────────────────────────────────

const DocsTab: React.FC<{issue: Issue | null; labelsMap: Record<string, IssueLabel>}> = ({issue, labelsMap}) => {
    if (!issue) {
        return (
            <div className='IV__docsEmpty'>
                <div className='IV__docsEmptyIcon'>{'📄'}</div>
                <div>{'Select an issue to view its document'}</div>
            </div>
        );
    }
    const issueLabels = (issue.label_ids || []).map((id) => labelsMap[id]).filter(Boolean);
    return (
        <div className='IV__docs'>
            <div className='IV__docsContent'>
                <div className='IV__docsMeta'>
                    <span className='IV__docsMetaItem' style={{background: STATUS_COLORS[issue.status] + '22', color: STATUS_COLORS[issue.status], border: `1px solid ${STATUS_COLORS[issue.status]}44`}}>
                        {STATUS_LABELS[issue.status]}
                    </span>
                    <span className='IV__docsMetaItem' style={{color: PRIORITY_COLORS[issue.priority]}}>
                        {PRIORITY_ICONS[issue.priority]} {PRIORITY_LABELS[issue.priority]}
                    </span>
                    <span className='IV__docsMetaItem IV__docsMetaItem--id'>{issue.identifier}</span>
                    {issueLabels.map((label) => (
                        <span key={label.id} className='IV__docsMetaItem' style={{background: label.color + '22', color: label.color, border: `1px solid ${label.color}44`}}>{label.name}</span>
                    ))}
                </div>
                <h1 className='IV__docsTitle'>{issue.title}</h1>
                <div className='IV__docsSection'>
                    <h2 className='IV__docsH2'>{'Overview'}</h2>
                    {issue.description ? (
                        <p className='IV__docsText'>{issue.description}</p>
                    ) : (
                        <p className='IV__docsText IV__docsText--placeholder'>{'No description provided.'}</p>
                    )}
                </div>
                <div className='IV__docsSection'>
                    <h2 className='IV__docsH2'>{'Acceptance criteria'}</h2>
                    <ul className='IV__docsList'>
                        <li className='IV__docsListItem'>{'[ ] Define the expected behavior'}</li>
                        <li className='IV__docsListItem'>{'[ ] Cover edge cases'}</li>
                        <li className='IV__docsListItem'>{'[ ] Write tests'}</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

// ── WorkArea ───────────────────────────────────────────────────────────────

type AgentStatus = 'idle' | 'spawning' | 'running';

const WorkArea: React.FC<{
    activeIssue: Issue | null;
    activeProjectId: string;
    activeProject: Project | null;
    hasRepoPath: boolean;
}> = ({activeIssue, activeProjectId, activeProject, hasRepoPath}) => {
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [elapsedSecs, setElapsedSecs] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const spawningRef = useRef(false);

    useEffect(() => {
        if (!activeProjectId) { return; }
        window.desktop.ao.getSessionStatus(activeProjectId).then((s) => {
            if (s.sessionId) {
                setSessionId(s.sessionId);
                setAgentStatus('running');
            }
        }).catch(() => { /* ignore */ });
    }, [activeProjectId]);

    useEffect(() => {
        setErrorMsg('');
    }, [activeIssue?.id]);

    useEffect(() => {
        if (agentStatus === 'spawning' || agentStatus === 'running') {
            setElapsedSecs(0);
            timerRef.current = setInterval(() => setElapsedSecs((s) => s + 1), 1000);
        } else {
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        }
        return () => { if (timerRef.current) { clearInterval(timerRef.current); } };
    }, [agentStatus]);

    const handleSpawn = async () => {
        if (!activeIssue || !activeProjectId || !hasRepoPath || spawningRef.current || sessionId) { return; }
        spawningRef.current = true;
        setErrorMsg('');
        setAgentStatus('spawning');
        try {
            const newSessionId = await window.desktop.ao.spawnSession(
                activeProjectId,
                activeProject?.name ?? activeProjectId,
                activeProject?.prefix ?? activeProjectId.slice(0, 4),
                activeIssue,
                activeIssue.description || activeIssue.title,
            );
            setSessionId(newSessionId);
            setAgentStatus('running');
        } catch (err) {
            setAgentStatus('idle');
            setErrorMsg(err instanceof Error ? err.message : String(err));
        } finally {
            spawningRef.current = false;
        }
    };

    const handleKill = async () => {
        try { await window.desktop.ao.killSession(activeProjectId); } catch { /* ignore */ }
        setSessionId(null);
        setAgentStatus('idle');
    };

    const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

    // No issue selected
    if (!activeIssue) {
        return (
            <div className='IV__workArea'>
                <div className='IV__workAreaEmpty'>
                    <div className='IV__workAreaEmptyIcon'>{'←'}</div>
                    <div>{'Select an issue to get started'}</div>
                </div>
            </div>
        );
    }

    // No repo linked
    if (!hasRepoPath) {
        return (
            <div className='IV__workArea'>
                <div className='IV__workAreaEmpty'>
                    <div className='IV__workAreaEmptyIcon'>{'📁'}</div>
                    <div>{'Link a local git repo using the 📁 button'}</div>
                </div>
            </div>
        );
    }

    // Agent running — show terminal
    if (sessionId) {
        return (
            <div className='IV__workArea'>
                <div className='IV__terminalHeader'>
                    <span className='IV__terminalSessionId'>{sessionId}</span>
                    <span className='IV__terminalPulse'>{'● running'}</span>
                    <span className='IV__terminalTimer'>{fmtTime(elapsedSecs)}</span>
                    <button className='IV__btn IV__btn--danger IV__btn--sm' onClick={handleKill}>{'■ Kill'}</button>
                </div>
                <EmbeddedTerminal projectId={activeProjectId}/>
            </div>
        );
    }

    // Spawn panel
    return (
        <div className='IV__workArea'>
            <div className='IV__spawnPanel'>
                <div className='IV__spawnIssueCard'>
                    <span className='IV__spawnIssueId'>{activeIssue.identifier}</span>
                    <h2 className='IV__spawnIssueTitle'>{activeIssue.title}</h2>
                    {activeIssue.description && (
                        <p className='IV__spawnIssueDesc'>{activeIssue.description}</p>
                    )}
                </div>
                {errorMsg && <div className='IV__spawnError'>{errorMsg}</div>}
                <button
                    className='IV__btn IV__btn--primary IV__spawnBtn'
                    onClick={handleSpawn}
                    disabled={agentStatus === 'spawning'}
                >
                    {agentStatus === 'spawning' ? '⟳ Spawning agent...' : '▶ Spawn Agent'}
                </button>
            </div>
        </div>
    );
};

// ── Main IssuesView ────────────────────────────────────────────────────────

const IssuesView: React.FC = () => {
    const [projects, setProjects] = useState<Project[]>([]);
    const [activeProjectId, setActiveProjectId] = useState('');
    const [serverId, setServerId] = useState('');
    const [issues, setIssues] = useState<Issue[]>([]);
    const [labelsMap, setLabelsMap] = useState<Record<string, IssueLabel>>({});
    const [labelsList, setLabelsList] = useState<IssueLabel[]>([]);
    const [filters, setFilters] = useState<IssueFilters>({groupBy: 'status'});
    const [loading, setLoading] = useState(true);
    const [modalIssue, setModalIssue] = useState<Issue | null | undefined>(undefined);
    const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
    const [hasRepoPath, setHasRepoPath] = useState(false);
    const [subTab, setSubTab] = useState<SubTab>('agents');
    const initialized = useRef(false);

    const fetchProjects = useCallback(async () => {
        try {
            const data = await api<Project[]>('GET', '/projects');
            setProjects(data || []);
            if (data && data.length > 0) { setActiveProjectId((prev) => prev || data[0].id); }
        } catch { /* plugin not installed */ } finally { setLoading(false); }
    }, []);

    useEffect(() => {
        if (!initialized.current) {
            initialized.current = true;
            fetchProjects();
            window.desktop.getCurrentServer().then((s) => { if (s.id) { setServerId(s.id); } }).catch(() => { /* ignore */ });
        }
    }, [fetchProjects]);

    useEffect(() => {
        if (!activeProjectId) { return; }
        window.desktop.ao.getSessionStatus(activeProjectId).then((s) => {
            setHasRepoPath(s.hasRepoPath);
        }).catch(() => { /* ignore */ });
    }, [activeProjectId]);

    useEffect(() => {
        if (!activeProjectId) { return; }
        (async () => {
            try {
                const [issueResp, lbls] = await Promise.all([
                    api<{issues: Issue[]} | Issue[]>('GET', `/projects/${activeProjectId}/issues`),
                    api<IssueLabel[]>('GET', `/projects/${activeProjectId}/labels`),
                ]);
                const issueList = Array.isArray(issueResp) ? issueResp : (issueResp as any).issues || [];
                setIssues(issueList);
                const lmap: Record<string, IssueLabel> = {};
                (lbls || []).forEach((l) => { lmap[l.id] = l; });
                setLabelsMap(lmap); setLabelsList(lbls || []);
            } catch { /* ignore */ }
        })();
    }, [activeProjectId]);

    const handleSaveIssue = async (data: Partial<Issue>) => {
        if (modalIssue) {
            const updated = await api<Issue>('PUT', `/issues/${modalIssue.id}`, data);
            setIssues((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
        } else {
            const created = await api<Issue>('POST', `/projects/${activeProjectId}/issues`, data);
            setIssues((prev) => [created, ...prev]);
        }
        setModalIssue(undefined);
    };

    const handleDeleteIssue = async () => {
        if (!modalIssue) { return; }
        if (window.confirm(`Delete "${modalIssue.identifier} ${modalIssue.title}"?`)) {
            await api('DELETE', `/issues/${modalIssue.id}`);
            setIssues((prev) => prev.filter((i) => i.id !== modalIssue.id));
            if (activeIssue?.id === modalIssue.id) { setActiveIssue(null); }
            setModalIssue(undefined);
        }
    };

    return (
        <div className='IssuesView'>
            <IssueSidebar
                projects={projects}
                activeProjectId={activeProjectId}
                serverId={serverId}
                issues={issues}
                labelsMap={labelsMap}
                filters={filters}
                loading={loading}
                activeIssueId={activeIssue?.id ?? null}
                onSelectProject={setActiveProjectId}
                onCreateProject={async (data) => {
                    const proj = await api<Project>('POST', '/projects', data);
                    setProjects((prev) => [...prev, proj]);
                    setActiveProjectId(proj.id);
                }}
                onNewIssue={() => setModalIssue(null)}
                onClickIssue={(issue) => setActiveIssue((prev) => (prev?.id === issue.id ? null : issue))}
                onFiltersChange={setFilters}
                onRepoPicked={() => setHasRepoPath(true)}
            />

            <div className='IV__main'>
                <SubTabBar active={subTab} onChange={setSubTab}/>
                <div className='IV__mainContent'>
                    {subTab === 'agents' && (
                        <WorkArea
                            activeIssue={activeIssue}
                            activeProjectId={activeProjectId}
                            activeProject={projects.find((p) => p.id === activeProjectId) ?? null}
                            hasRepoPath={hasRepoPath}
                        />
                    )}
                    {subTab === 'diff' && <DiffTab/>}
                    {subTab === 'docs' && <DocsTab issue={activeIssue} labelsMap={labelsMap}/>}
                </div>
            </div>

            <div className='IV__rightSidebar'>
                {/* Future: git control */}
            </div>

            {modalIssue !== undefined && (
                <CreateIssueModal
                    issue={modalIssue}
                    labels={labelsList}
                    onSave={handleSaveIssue}
                    onDelete={modalIssue ? handleDeleteIssue : undefined}
                    onClose={() => setModalIssue(undefined)}
                />
            )}
        </div>
    );
};

export default IssuesView;
