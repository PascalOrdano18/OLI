// Copyright (c) 2016-present OLI, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useState, useCallback, useRef} from 'react';
import {Terminal} from 'xterm';
import {FitAddon} from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

import './IssuesView.scss';

// ── Types ──────────────────────────────────────────────────────────────────

type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
type IssuePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
type SubTab = 'agents' | 'diff' | 'docs';

interface Project { id: string; name: string; prefix: string; next_issue_number: number }
interface Issue {
    id: string; project_id: string; identifier: string; title: string; description: string;
    status: IssueStatus; priority: IssuePriority; label_ids: string[]; assignee_id: string;
    cycle_id: string; estimate_hours: number; sort_order: number;
}
interface IssueLabel { id: string; name: string; color: string }
// ── Constants ──────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<IssueStatus, string> = {
    backlog: 'Backlog', todo: 'Todo', in_progress: 'In Progress',
    in_review: 'In Review', done: 'Done', cancelled: 'Cancelled',
};
const STATUS_COLORS: Record<IssueStatus, string> = {
    backlog: '#8b95a1', todo: '#96afc5', in_progress: '#f5a623',
    in_review: '#9b59b6', done: '#3dc779', cancelled: '#e05c5c',
};
const PRIORITY_LABELS: Record<IssuePriority, string> = {
    urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', none: 'No Priority',
};
const PRIORITY_COLORS: Record<IssuePriority, string> = {
    urgent: '#e05c5c', high: '#f5a623', medium: '#f5d63d', low: '#96afc5', none: '#8b95a1',
};
const PRIORITY_ICONS: Record<IssuePriority, string> = {
    urgent: '!', high: '↑', medium: '—', low: '↓', none: '·',
};

// ── API helper ─────────────────────────────────────────────────────────────

function api<T>(method: string, path: string, body?: unknown): Promise<T> {
    return window.desktop.issuesApiRequest(method, path, body) as Promise<T>;
}

// ── IssueSidebar ───────────────────────────────────────────────────────────

interface IssueSidebarProps {
    projects: Project[];
    activeProjectId: string;
    allIssues: Record<string, Issue[]>;
    activeIssueId: string | null;
    loading: boolean;
    onSelectProject: (id: string) => void;
    onCreateProject: () => void;
    onNewIssue: (projectId: string) => void;
    onClickIssue: (issue: Issue) => void;
}

const IssueSidebar: React.FC<IssueSidebarProps> = ({
    projects, activeProjectId, allIssues, activeIssueId, loading,
    onSelectProject, onCreateProject, onNewIssue, onClickIssue,
}) => (
    <div className='IV__sidebar'>
        <div className='IV__workspacesHeader'>
            <span className='IV__workspacesLabel'>{'Workspaces'}</span>
            <button
                className='IV__iconBtn'
                onClick={() => {
                    console.log('[Issues: create project] opened inline create form (+)');
                    onCreateProject();
                }}
                title='New project'
            >{'⊕'}</button>
        </div>
        <div className='IV__sidebarList'>
            {loading && projects.length === 0 ? (
                <div className='IV__loading'>{'Loading...'}</div>
            ) : projects.map((project) => {
                const issues = allIssues[project.id] || [];
                return (
                    <div key={project.id}>
                        <div
                            className={`IV__projectRow${activeProjectId === project.id ? ' IV__projectRow--active' : ''}`}
                            onClick={() => onSelectProject(project.id)}
                        >
                            <span className='IV__projectAvatar'>{project.name[0]?.toUpperCase()}</span>
                            <span className='IV__projectName'>{project.name}</span>
                            <button
                                className='IV__iconBtn IV__iconBtn--newIssue'
                                onClick={(e) => { e.stopPropagation(); onNewIssue(project.id); }}
                                title='New issue'
                            >{'+'}</button>
                        </div>
                        {issues.map((issue) => {
                            const num = issue.identifier?.split('-')[1] ?? '';
                            return (
                                <div
                                    key={issue.id}
                                    className={`IV__issueRow${activeIssueId === issue.id ? ' IV__issueRow--active' : ''}`}
                                    onClick={() => onClickIssue(issue)}
                                >
                                    <span
                                        className='IV__branchIcon'
                                        style={{color: PRIORITY_COLORS[issue.priority]}}
                                        title={PRIORITY_LABELS[issue.priority]}
                                    >{PRIORITY_ICONS[issue.priority]}</span>
                                    <span className='IV__issueTitle'>{issue.title}</span>
                                    <span className='IV__issueNum'>{num}</span>
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    </div>
);

// ── CreateProjectModal ─────────────────────────────────────────────────────

const CreateProjectModal: React.FC<{
    serverId: string;
    onCreate: (data: {name: string; prefix: string}) => Promise<void>;
    onClose: () => void;
}> = ({onCreate, onClose}) => {
    const [name, setName] = useState('');
    const [creating, setCreating] = useState(false);

    const derivePrefix = (n: string) => n.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'PRJ';

    const handleCreate = async () => {
        const trimmedName = name.trim();
        const prefix = derivePrefix(name);
        if (!trimmedName || !prefix) {
            console.log('[Issues: create project] submit blocked — need non-empty name and prefix', {name: trimmedName, prefix});
            return;
        }
        if (creating) { return; }

        console.log('[Issues: create project] submitting from ProjectSelector', {name: trimmedName, prefix});
        setCreating(true);
        try { await onCreate({name: trimmedName, prefix}); } finally { setCreating(false); }
    };

    return (
        <div className='IV__modalBackdrop' onClick={onClose}>
            <div className='IV__modal' onClick={(e) => e.stopPropagation()}>
                <div className='IV__modalHeader'>
                    <h3 className='IV__modalTitle'>{'New Project'}</h3>
                    <button onClick={onClose} className='IV__iconBtn'>{'✕'}</button>
                </div>
                <div className='IV__modalBody'>
                    <div className='IV__field'>
                        <label className='IV__label'>{'Name *'}</label>
                        <input
                            autoFocus={true} type='text' value={name} placeholder='Project name'
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { handleCreate(); } else if (e.key === 'Escape') { onClose(); } }}
                            className='IV__input'
                        />
                    </div>
                    <p className='IV__fieldHint'>{'After creating the project, you will be prompted to link a local git repository.'}</p>
                </div>
                <div className='IV__modalFooter'>
                    <div/>
                    <div className='IV__modalActions'>
                        <button onClick={onClose} className='IV__btn IV__btn--ghost'>{'Cancel'}</button>
                        <button
                            onClick={handleCreate}
                            disabled={!name.trim() || creating}
                            className={`IV__btn IV__btn--primary${(!name.trim() || creating) ? ' IV__btn--disabled' : ''}`}
                        >{creating ? 'Creating…' : 'Create & Link Repo'}</button>
                    </div>
                </div>
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
                background: '#f5f5f7',
                foreground: '#1d1d1f',
                cursor: '#000000',
                cursorAccent: '#ffffff',
                selectionBackground: 'rgba(178, 215, 255, 0.5)',
                selectionInactiveBackground: 'rgba(180, 180, 200, 0.2)',
                black: '#000000', red: '#c91b00', green: '#00a600', yellow: '#c7c400',
                blue: '#0225c7', magenta: '#c930c7', cyan: '#00a6b2', white: '#c7c7c7',
                brightBlack: '#676767', brightRed: '#ff6d67', brightGreen: '#5ff967',
                brightYellow: '#fefb67', brightBlue: '#6871ff', brightMagenta: '#ff76ff',
                brightCyan: '#5ffdff', brightWhite: '#feffff',
            },
            fontFamily: '"Menlo", "Monaco", "Courier New", monospace',
            fontSize: 13,
            lineHeight: 1.3,
            cursorBlink: true,
            scrollback: 10000,
            allowProposedApi: true,
            disableStdin: false,
            allowTransparency: false,
            fastScrollModifier: 'alt',
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(containerRef.current);
        fit.fit();
        termRef.current = term;
        fitRef.current = fit;

        // XDA handler so tmux enables clipboard (OSC 52) support
        term.parser.registerCsiHandler({prefix: '>', final: 'q'}, () => {
            term.write('\x1bP>|XTerm(370)\x1b\\');
            return true;
        });

        // OSC 52 handler — write tmux-copied text to clipboard
        term.parser.registerOscHandler(52, (data) => {
            const parts = data.split(';');
            if (parts.length < 2) { return false; }
            try {
                const binary = atob(parts[parts.length - 1]);
                const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
                navigator.clipboard?.writeText(new TextDecoder().decode(bytes)).catch(() => { /* ignore */ });
            } catch { /* ignore */ }
            return true;
        });

        // Cmd+C / Ctrl+Shift+C to copy selection
        term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
            if (e.type !== 'keydown') { return true; }
            const isCopy =
                (e.metaKey && !e.ctrlKey && !e.altKey && e.code === 'KeyC') ||
                (e.ctrlKey && e.shiftKey && e.code === 'KeyC');
            if (isCopy && term.hasSelection()) {
                navigator.clipboard?.writeText(term.getSelection()).catch(() => { /* ignore */ });
                term.clearSelection();
                return false;
            }
            return true;
        });

        // Buffer writes while selection is active so highlights aren't wiped
        const writeBuffer: string[] = [];
        let selectionActive = false;
        let safetyTimer: ReturnType<typeof setTimeout> | null = null;

        const flushBuffer = () => {
            if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
            if (writeBuffer.length > 0) {
                term.write(writeBuffer.join(''));
                writeBuffer.length = 0;
            }
        };

        const selDisposable = term.onSelectionChange(() => {
            if (term.hasSelection()) {
                selectionActive = true;
                if (!safetyTimer) {
                    safetyTimer = setTimeout(() => { selectionActive = false; flushBuffer(); }, 5000);
                }
            } else {
                selectionActive = false;
                flushBuffer();
            }
        });

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

        // Receive streaming data from main process
        const handleOutput = (data: {data: string; isInitial?: boolean}) => {
            const chunk = data.data;
            if (selectionActive) {
                writeBuffer.push(chunk);
            } else {
                term.write(chunk);
            }
        };
        window.desktop.ao.onOutputUpdate(handleOutput);

        const ro = new ResizeObserver(syncSize);
        if (containerRef.current) { ro.observe(containerRef.current); }

        syncSize();

        return () => {
            inputDisposable.dispose();
            selDisposable.dispose();
            if (safetyTimer) { clearTimeout(safetyTimer); }
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

interface DiffFile { path: string; additions: number; deletions: number; hunks: DiffHunk[] }
interface DiffHunk { header: string; lines: DiffLine[] }
interface DiffLine { type: 'context' | 'add' | 'remove'; oldNum?: number; newNum?: number; content: string }

function parseDiff(raw: string): DiffFile[] {
    const files: DiffFile[] = [];
    const fileSections = raw.split(/^diff --git /m).filter(Boolean);

    for (const section of fileSections) {
        const lines = section.split('\n');

        // Extract file path from "a/path b/path"
        const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
        const path = headerMatch ? headerMatch[2] : 'unknown';

        let additions = 0;
        let deletions = 0;
        const hunks: DiffHunk[] = [];
        let currentHunk: DiffHunk | null = null;
        let oldNum = 0;
        let newNum = 0;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];

            // Hunk header
            const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)/);
            if (hunkMatch) {
                oldNum = parseInt(hunkMatch[1], 10);
                newNum = parseInt(hunkMatch[2], 10);
                currentHunk = {header: line, lines: []};
                hunks.push(currentHunk);
                continue;
            }

            if (!currentHunk) { continue; }

            // Skip binary / no-newline markers
            if (line.startsWith('\\')) { continue; }

            if (line.startsWith('+')) {
                additions++;
                currentHunk.lines.push({type: 'add', newNum, content: line.slice(1)});
                newNum++;
            } else if (line.startsWith('-')) {
                deletions++;
                currentHunk.lines.push({type: 'remove', oldNum, content: line.slice(1)});
                oldNum++;
            } else if (line.startsWith(' ') || line === '') {
                currentHunk.lines.push({type: 'context', oldNum, newNum, content: line.slice(1)});
                oldNum++;
                newNum++;
            }
        }

        if (hunks.length > 0 || additions > 0 || deletions > 0) {
            files.push({path, additions, deletions, hunks});
        }
    }

    return files;
}

const DiffFileBlock: React.FC<{file: DiffFile; defaultCollapsed?: boolean}> = ({file, defaultCollapsed}) => {
    const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);
    const total = file.additions + file.deletions;
    const blocks = Math.min(5, total);
    const addBlocks = total > 0 ? Math.round((file.additions / total) * blocks) : 0;
    const delBlocks = blocks - addBlocks;

    return (
        <div className='IV__diffFile'>
            <div className='IV__diffFileHeader' onClick={() => setCollapsed((c) => !c)}>
                <span className='IV__diffFileCaret'>{collapsed ? '▸' : '▾'}</span>
                <span className='IV__diffFilePath'>{file.path}</span>
                <div className='IV__diffFileMeta'>
                    <span className='IV__diffAdd'>{`+${file.additions}`}</span>
                    <span className='IV__diffDel'>{`-${file.deletions}`}</span>
                    <div className='IV__diffBar'>
                        {Array.from({length: 5}).map((_, i) => (
                            <span key={i} className={`IV__diffBarCell ${i < addBlocks ? 'IV__diffBarCell--add' : i < addBlocks + delBlocks ? 'IV__diffBarCell--del' : 'IV__diffBarCell--empty'}`}/>
                        ))}
                    </div>
                </div>
            </div>
            {!collapsed && file.hunks.map((hunk, hi) => (
                <div key={hi} className='IV__diffHunk'>
                    <div className='IV__diffHunkHeader'>{hunk.header}</div>
                    {hunk.lines.map((line, li) => (
                        <div key={li} className={`IV__diffLine IV__diffLine--${line.type}`}>
                            <span className='IV__diffLineNum IV__diffLineNum--old'>{line.type === 'add' ? '' : line.oldNum ?? ''}</span>
                            <span className='IV__diffLineNum IV__diffLineNum--new'>{line.type === 'remove' ? '' : line.newNum ?? ''}</span>
                            <span className='IV__diffLineSign'>{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</span>
                            <span className='IV__diffLineContent'>{line.content}</span>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
};

const DiffTab: React.FC<{projectId: string; visible: boolean}> = ({projectId, visible}) => {
    const [files, setFiles] = useState<DiffFile[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const hasFetched = useRef(false);

    const fetchDiff = useCallback(async () => {
        if (!projectId) { return; }
        setLoading(true);
        setError('');
        try {
            const raw = await window.desktop.ao.getDiff(projectId);
            setFiles(parseDiff(raw));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        if (visible && projectId) {
            fetchDiff();
            hasFetched.current = true;
        }
    }, [visible, projectId, fetchDiff]);

    const totalAdd = files.reduce((s, f) => s + f.additions, 0);
    const totalDel = files.reduce((s, f) => s + f.deletions, 0);

    if (loading) {
        return <div className='IV__diffTab'><div className='IV__diffEmpty'>{'Loading diff...'}</div></div>;
    }

    if (error) {
        return <div className='IV__diffTab'><div className='IV__diffEmpty IV__diffEmpty--error'>{error}</div></div>;
    }

    if (files.length === 0) {
        return (
            <div className='IV__diffTab'>
                <div className='IV__diffEmpty'>
                    <div>{'No changes yet'}</div>
                    <button className='IV__btn IV__btn--ghost IV__btn--sm' onClick={fetchDiff}>{'Refresh'}</button>
                </div>
            </div>
        );
    }

    return (
        <div className='IV__diffTab'>
            <div className='IV__diffHeader'>
                <span className='IV__diffSummary'>{`${files.length} file${files.length === 1 ? '' : 's'} changed`}</span>
                <span className='IV__diffSummaryAdd'>{`+${totalAdd}`}</span>
                <span className='IV__diffSummaryDel'>{`-${totalDel}`}</span>
                <button className='IV__btn IV__btn--ghost IV__btn--xs' onClick={fetchDiff} title='Refresh diff'>{'↻'}</button>
            </div>
            <div className='IV__diffBody'>
                {files.map((file) => <DiffFileBlock key={file.path} file={file}/>)}
            </div>
        </div>
    );
};

// ── DocsTab ────────────────────────────────────────────────────────────────

const DocsTab: React.FC<{
    issue: Issue | null;
    labelsMap: Record<string, IssueLabel>;
    labelsList: IssueLabel[];
    onSave: (data: Partial<Issue>) => Promise<void>;
}> = ({issue, labelsMap, labelsList, onSave}) => {
    const [title, setTitle] = useState(issue?.title ?? '');
    const [description, setDescription] = useState(issue?.description ?? '');
    const [status, setStatus] = useState<IssueStatus>(issue?.status ?? 'backlog');
    const [priority, setPriority] = useState<IssuePriority>(issue?.priority ?? 'none');
    const [labelIds, setLabelIds] = useState<string[]>(issue?.label_ids ?? []);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setTitle(issue?.title ?? '');
        setDescription(issue?.description ?? '');
        setStatus(issue?.status ?? 'backlog');
        setPriority(issue?.priority ?? 'none');
        setLabelIds(issue?.label_ids ?? []);
        setDirty(false);
    }, [issue?.id]);

    if (!issue) {
        return (
            <div className='IV__docsEmpty'>
                <div className='IV__docsEmptyIcon'>{'📄'}</div>
                <div>{'Select an issue to view its document'}</div>
            </div>
        );
    }

    const handleSave = async () => {
        if (!title.trim() || saving) { return; }
        setSaving(true);
        try {
            await onSave({title: title.trim(), description, status, priority, label_ids: labelIds});
            setDirty(false);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className='IV__docs'>
            <div className='IV__docsContent'>
                <div className='IV__docsMeta'>
                    <span className='IV__docsMetaItem IV__docsMetaItem--id'>{issue.identifier}</span>
                    <select
                        value={status}
                        onChange={(e) => { setStatus(e.target.value as IssueStatus); setDirty(true); }}
                        className='IV__docsMetaSelect'
                        style={{background: STATUS_COLORS[status] + '22', color: STATUS_COLORS[status], border: `1px solid ${STATUS_COLORS[status]}44`}}
                    >
                        {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <select
                        value={priority}
                        onChange={(e) => { setPriority(e.target.value as IssuePriority); setDirty(true); }}
                        className='IV__docsMetaSelect'
                        style={{color: PRIORITY_COLORS[priority]}}
                    >
                        {Object.entries(PRIORITY_LABELS).map(([v, l]) => <option key={v} value={v}>{PRIORITY_ICONS[v as IssuePriority]} {l}</option>)}
                    </select>
                    {dirty && (
                        <button
                            className='IV__btn IV__btn--primary IV__docsSaveBtn'
                            onClick={handleSave}
                            disabled={!title.trim() || saving}
                        >{saving ? 'Saving…' : 'Save'}</button>
                    )}
                </div>
                <input
                    className='IV__docsTitleInput'
                    value={title}
                    onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
                    placeholder='Issue title'
                />
                <div className='IV__docsSection IV__docsSection--grow'>
                    <h2 className='IV__docsH2'>{'Description'}</h2>
                    <textarea
                        className='IV__docsDescInput'
                        value={description}
                        onChange={(e) => { setDescription(e.target.value); setDirty(true); }}
                        placeholder='Add a description...'
                    />
                </div>
                {labelsList.length > 0 && (
                    <div className='IV__docsSection'>
                        <h2 className='IV__docsH2'>{'Labels'}</h2>
                        <div className='IV__labelPicker'>
                            {labelsList.map((label) => {
                                const sel = labelIds.includes(label.id);
                                return (
                                    <button
                                        key={label.id}
                                        onClick={() => { setLabelIds((p) => p.includes(label.id) ? p.filter((x) => x !== label.id) : [...p, label.id]); setDirty(true); }}
                                        className='IV__labelToggle'
                                        style={{border: `1px solid ${label.color}`, background: sel ? label.color + '30' : 'transparent', color: label.color}}
                                    >{label.name}</button>
                                );
                            })}
                        </div>
                    </div>
                )}
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
                    <div>{'No git repo linked to this project. Create a new project or re-link via the ⊕ button.'}</div>
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
                <div className='IV__terminalBody'>
                    <EmbeddedTerminal projectId={activeProjectId}/>
                </div>
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

// ── GitActionsPanel ────────────────────────────────────────────────────────

interface GitStatus {
    hasWorktree: boolean;
    branch: string;
    defaultBranch: string;
    hasUncommittedChanges: boolean;
    hasUnpushedCommits: boolean;
    hasPR: boolean;
    prUrl: string;
    uncommittedFileCount: number;
    unpushedCommitCount: number;
}

const EMPTY_STATUS: GitStatus = {
    hasWorktree: false, branch: '', defaultBranch: 'main',
    hasUncommittedChanges: false, hasUnpushedCommits: false,
    hasPR: false, prUrl: '', uncommittedFileCount: 0, unpushedCommitCount: 0,
};

const GitActionsPanel: React.FC<{projectId: string; visible: boolean}> = ({projectId, visible}) => {
    const [status, setStatus] = useState<GitStatus>(EMPTY_STATUS);
    const [commitMsg, setCommitMsg] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [result, setResult] = useState<{type: 'success' | 'error'; text: string} | null>(null);
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(async () => {
        if (!projectId) { return; }
        setLoading(true);
        try {
            const s = await window.desktop.ao.getGitStatus(projectId);
            setStatus(s);
        } catch { /* ignore */ } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        if (visible && projectId) { refresh(); }
    }, [visible, projectId, refresh]);

    const runAction = async (action: string, extraArgs?: string) => {
        setBusy(action);
        setResult(null);
        try {
            const res = await window.desktop.ao.gitAction(projectId, action, extraArgs);
            setResult({type: 'success', text: res || `${action} completed`});
            if (action === 'commit') { setCommitMsg(''); }
            await refresh();
        } catch (err) {
            setResult({type: 'error', text: err instanceof Error ? err.message : String(err)});
        } finally {
            setBusy(null);
        }
    };

    if (!visible) { return null; }

    if (!status.hasWorktree) {
        return (
            <div className='IV__gitPanel'>
                <div className='IV__gitPanelHeader'>
                    <span className='IV__gitPanelTitle'>{'Git'}</span>
                    <button className='IV__gitPanelRefresh' onClick={refresh} title='Refresh'>{'↻'}</button>
                </div>
                <div className='IV__gitPanelEmpty'>
                    {loading ? 'Loading...' : 'No active worktree. Start an agent to begin.'}
                </div>
            </div>
        );
    }

    return (
        <div className='IV__gitPanel'>
            <div className='IV__gitPanelHeader'>
                <span className='IV__gitPanelTitle'>{'Git'}</span>
                <button className='IV__gitPanelRefresh' onClick={refresh} title='Refresh'>{'↻'}</button>
            </div>

            <div className='IV__gitPanelBranch'>
                <span className='IV__gitPanelBranchIcon'>{'⎇'}</span>
                <span className='IV__gitPanelBranchName'>{status.branch}</span>
            </div>

            {/* Step 1: Commit — show only when there are uncommitted changes */}
            {status.hasUncommittedChanges && (
                <>
                    <div className='IV__gitPanelSection'>
                        <div className='IV__gitPanelStepHeader'>
                            <span className='IV__gitPanelStepNum'>{'1'}</span>
                            <span className='IV__gitPanelStepTitle'>{`Commit ${status.uncommittedFileCount} changed file${status.uncommittedFileCount === 1 ? '' : 's'}`}</span>
                        </div>
                        <textarea
                            className='IV__gitPanelCommitInput'
                            value={commitMsg}
                            onChange={(e) => setCommitMsg(e.target.value)}
                            placeholder='Commit message...'
                            rows={2}
                        />
                        <button
                            className='IV__gitPanelBtn IV__gitPanelBtn--commit'
                            onClick={() => runAction('commit', commitMsg)}
                            disabled={busy !== null || !commitMsg.trim()}
                        >
                            {busy === 'commit' ? 'Committing...' : 'Commit'}
                        </button>
                    </div>
                    <div className='IV__gitPanelDivider'/>
                </>
            )}

            {/* Step 2: Push — show when there are unpushed commits and nothing to commit */}
            {!status.hasUncommittedChanges && status.hasUnpushedCommits && (
                <>
                    <div className='IV__gitPanelSection'>
                        <div className='IV__gitPanelStepHeader'>
                            <span className='IV__gitPanelStepNum'>{status.hasUncommittedChanges ? '2' : '1'}</span>
                            <span className='IV__gitPanelStepTitle'>{`Push ${status.unpushedCommitCount} commit${status.unpushedCommitCount === 1 ? '' : 's'}`}</span>
                        </div>
                        <button
                            className='IV__gitPanelBtn'
                            onClick={() => runAction('push')}
                            disabled={busy !== null}
                        >
                            {busy === 'push' ? 'Pushing...' : `Push to origin/${status.branch}`}
                        </button>
                    </div>
                    <div className='IV__gitPanelDivider'/>
                </>
            )}

            {/* Step 3: Create PR — show when pushed but no PR exists */}
            {!status.hasUncommittedChanges && !status.hasUnpushedCommits && !status.hasPR && status.branch !== status.defaultBranch && (
                <>
                    <div className='IV__gitPanelSection'>
                        <div className='IV__gitPanelStepHeader'>
                            <span className='IV__gitPanelStepNum'>{'1'}</span>
                            <span className='IV__gitPanelStepTitle'>{'Create pull request'}</span>
                        </div>
                        <button
                            className='IV__gitPanelBtn IV__gitPanelBtn--primary'
                            onClick={() => runAction('create-pr')}
                            disabled={busy !== null}
                        >
                            {busy === 'create-pr' ? 'Creating...' : `Create PR → ${status.defaultBranch}`}
                        </button>
                    </div>
                    <div className='IV__gitPanelDivider'/>
                </>
            )}

            {/* Step 4: Merge — show when PR exists */}
            {status.hasPR && (
                <div className='IV__gitPanelSection'>
                    <div className='IV__gitPanelStepHeader'>
                        <span className='IV__gitPanelStepNum'>{'✓'}</span>
                        <span className='IV__gitPanelStepTitle'>{'PR ready'}</span>
                    </div>
                    {status.prUrl && (
                        <div className='IV__gitPanelPrLink'>{status.prUrl}</div>
                    )}
                    <button
                        className='IV__gitPanelBtn IV__gitPanelBtn--merge'
                        onClick={() => runAction('merge')}
                        disabled={busy !== null}
                    >
                        {busy === 'merge' ? 'Merging...' : `Merge to ${status.defaultBranch}`}
                    </button>
                </div>
            )}

            {/* All done state */}
            {!status.hasUncommittedChanges && !status.hasUnpushedCommits && !status.hasPR && status.branch === status.defaultBranch && (
                <div className='IV__gitPanelEmpty'>{'All changes merged. Nothing to do.'}</div>
            )}

            {result && (
                <div className={`IV__gitPanelResult IV__gitPanelResult--${result.type}`}>
                    {result.text}
                </div>
            )}
        </div>
    );
};

// ── Main IssuesView ────────────────────────────────────────────────────────

const IssuesView: React.FC = () => {
    const [projects, setProjects] = useState<Project[]>([]);
    const [activeProjectId, setActiveProjectId] = useState('');
    const [serverId, setServerId] = useState('');
    const [allIssues, setAllIssues] = useState<Record<string, Issue[]>>({});
    const [labelsMap, setLabelsMap] = useState<Record<string, IssueLabel>>({});
    const [labelsList, setLabelsList] = useState<IssueLabel[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalIssue, setModalIssue] = useState<Issue | null | undefined>(undefined);
    const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
    const [hasRepoPath, setHasRepoPath] = useState(false);
    const [subTab, setSubTab] = useState<SubTab>('agents');
    const [showCreateProject, setShowCreateProject] = useState(false);
    const [newIssueProjectId, setNewIssueProjectId] = useState('');
    const initialized = useRef(false);

    const fetchProjects = useCallback(async () => {
        console.log('[Issues] fetchProjects: GET /projects');
        try {
            const data = await api<Project[]>('GET', '/projects');
            console.log('[Issues] fetchProjects: success', {count: data?.length ?? 0, projects: data?.map((p) => ({id: p.id, name: p.name}))});
            setProjects(data || []);
            if (data && data.length > 0) { setActiveProjectId((prev) => prev || data[0].id); }
        } catch (err) {
            console.error('[Issues] fetchProjects: FAILED — plugin may not be installed or enabled', err);
        } finally { setLoading(false); }
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
                console.log('[Issues] fetching labels for project', activeProjectId);
                const lbls = await api<IssueLabel[]>('GET', `/projects/${activeProjectId}/labels`);
                console.log('[Issues] labels fetched', {count: lbls?.length ?? 0});
                const lmap: Record<string, IssueLabel> = {};
                (lbls || []).forEach((l) => { lmap[l.id] = l; });
                setLabelsMap(lmap); setLabelsList(lbls || []);
            } catch (err) {
                console.error('[Issues] failed to fetch labels', err);
            }
        })();
    }, [activeProjectId]);

    useEffect(() => {
        projects.forEach(async (p) => {
            setAllIssues((prev) => {
                if (prev[p.id] !== undefined) { return prev; }
                api<{issues: Issue[]} | Issue[]>('GET', `/projects/${p.id}/issues`).then((resp) => {
                    const list = Array.isArray(resp) ? resp : (resp as any).issues || [];
                    setAllIssues((cur) => ({...cur, [p.id]: list}));
                }).catch(() => { /* ignore */ });
                return {...prev, [p.id]: []};
            });
        });
    }, [projects]);

    useEffect(() => {
        const handler = async (issueId: string) => {
            // Try to find in already-loaded issues first.
            for (const projIssues of Object.values(allIssues)) {
                const found = projIssues.find((i) => i.id === issueId);
                if (found) {
                    setActiveProjectId(found.project_id);
                    setActiveIssue(found);
                    setSubTab('docs');
                    return;
                }
            }

            // Issues not loaded yet — fetch directly.
            try {
                const issue = await api<Issue>('GET', `/issues/${issueId}`);
                if (issue) {
                    setActiveProjectId(issue.project_id);
                    setActiveIssue(issue);
                    setSubTab('docs');
                }
            } catch {
                // Issue not found
            }
        };
        const off = (window as any).desktop.onNavigateToIssue(handler);
        return off;
    }, [allIssues]);

    const handleSaveIssue = async (data: Partial<Issue>) => {
        const projId = newIssueProjectId || activeProjectId;
        if (modalIssue) {
            const updated = await api<Issue>('PUT', `/issues/${modalIssue.id}`, data);
            setAllIssues((prev) => ({...prev, [projId]: (prev[projId] || []).map((i) => (i.id === updated.id ? updated : i))}));
        } else {
            const created = await api<Issue>('POST', `/projects/${projId}/issues`, data);
            setAllIssues((prev) => ({...prev, [projId]: [created, ...(prev[projId] || [])]}));
        }
        setModalIssue(undefined);
        setNewIssueProjectId('');
    };

    const handleUpdateActiveIssue = async (data: Partial<Issue>) => {
        if (!activeIssue) { return; }
        const updated = await api<Issue>('PUT', `/issues/${activeIssue.id}`, data);
        setAllIssues((prev) => ({...prev, [activeProjectId]: (prev[activeProjectId] || []).map((i) => (i.id === updated.id ? updated : i))}));
        setActiveIssue(updated);
    };

    const handleDeleteIssue = async () => {
        if (!modalIssue) { return; }
        if (window.confirm(`Delete "${modalIssue.identifier} ${modalIssue.title}"?`)) {
            await api('DELETE', `/issues/${modalIssue.id}`);
            setAllIssues((prev) => ({...prev, [activeProjectId]: (prev[activeProjectId] || []).filter((i) => i.id !== modalIssue.id)}));
            if (activeIssue?.id === modalIssue.id) { setActiveIssue(null); }
            setModalIssue(undefined);
        }
    };

    return (
        <div className='IssuesView'>
            <IssueSidebar
                projects={projects}
                activeProjectId={activeProjectId}
                allIssues={allIssues}
                activeIssueId={activeIssue?.id ?? null}
                loading={loading}
                onSelectProject={setActiveProjectId}
                onCreateProject={() => setShowCreateProject(true)}
                onNewIssue={(projId) => { setNewIssueProjectId(projId); setActiveProjectId(projId); setModalIssue(null); }}
                onClickIssue={(issue) => { setActiveProjectId(issue.project_id); setActiveIssue((prev) => (prev?.id === issue.id ? null : issue)); }}
            />

            <div className='IV__main'>
                <SubTabBar active={subTab} onChange={setSubTab}/>
                <div className='IV__mainContent'>
                    <div className='IV__tabPanel' style={{display: subTab === 'agents' ? 'flex' : 'none'}}>
                        <WorkArea
                            activeIssue={activeIssue}
                            activeProjectId={activeProjectId}
                            activeProject={projects.find((p) => p.id === activeProjectId) ?? null}
                            hasRepoPath={hasRepoPath}
                        />
                    </div>
                    <div className='IV__tabPanel' style={{display: subTab === 'diff' ? 'flex' : 'none'}}>
                        <DiffTab projectId={activeProjectId} visible={subTab === 'diff'}/>
                    </div>
                    <div className='IV__tabPanel' style={{display: subTab === 'docs' ? 'flex' : 'none'}}>
                        <DocsTab issue={activeIssue} labelsMap={labelsMap} labelsList={labelsList} onSave={handleUpdateActiveIssue}/>
                    </div>
                </div>
            </div>

            {subTab === 'agents' && (
                <GitActionsPanel projectId={activeProjectId} visible={subTab === 'agents'}/>
            )}

            {showCreateProject && (
                <CreateProjectModal
                    serverId={serverId}
                    onClose={() => setShowCreateProject(false)}
                    onCreate={async (data) => {
                        console.log('[Issues: create project] POST /projects via issuesApiRequest', {data, serverId});
                        try {
                            const proj = await api<Project>('POST', '/projects', data);
                            console.log('[Issues: create project] success', proj);
                            setProjects((prev) => [...prev, proj]);
                            setActiveProjectId(proj.id);
                            setAllIssues((prev) => ({...prev, [proj.id]: []}));
                            setShowCreateProject(false);
                            try {
                                console.log('[Issues: create project] opening repo picker', {serverId, projectId: proj.id});
                                const picked = await window.desktop.ao.pickRepoPath(serverId, proj.id);
                                console.log('[Issues: create project] repo picker result', {picked});
                                if (picked) { setHasRepoPath(true); }
                            } catch (pickErr) {
                                console.warn('[Issues: create project] repo picker failed or cancelled', pickErr);
                            }
                        } catch (err) {
                            console.error('[Issues: create project] FAILED — check plugin status and auth', err);
                        }
                    }}
                />
            )}
            {modalIssue !== undefined && (
                <CreateIssueModal
                    issue={modalIssue}
                    labels={labelsList}
                    onSave={handleSaveIssue}
                    onDelete={modalIssue ? handleDeleteIssue : undefined}
                    onClose={() => { setModalIssue(undefined); setNewIssueProjectId(''); }}
                />
            )}
        </div>
    );
};

export default IssuesView;
