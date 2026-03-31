// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createHash} from 'crypto';
import {execFile} from 'child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';
import {promisify} from 'util';

import {app, BrowserWindow, dialog} from 'electron';
import {claude} from '@anthropic-ai/claude-code';

import {Logger} from 'common/log';
import ServerManager from 'common/servers/serverManager';
import {AO_OUTPUT_UPDATE} from 'common/communication';
import {createAgentEvent} from 'common/agentEvents';
import type {AgentEvent, AgentStatus} from 'common/agentEvents';

const log = new Logger('AoManager');
const execFileAsync = promisify(execFile);

interface AoIssue {
    id: string;
    identifier: string;
    title: string;
    description: string;
}

interface SessionEntry {
    sessionId: string;
    projectId: string;
    abortController: AbortController | null;
    status: AgentStatus;
    history: AgentEvent[];
    webContentsId: number;
    repoPath: string;
}

interface ProjectPaths {
    [key: string]: string;
}

export class AoManager {
    private sessions: Map<string, SessionEntry> = new Map();

    // ─── Broadcast helpers ───────────────────────────────────────────

    private broadcastEvent(entry: SessionEntry, event: AgentEvent): void {
        entry.history.push(event);
        const allWindows = BrowserWindow.getAllWindows();
        for (const win of allWindows) {
            if (!win.webContents.isDestroyed()) {
                win.webContents.send(AO_OUTPUT_UPDATE, event);
            }
        }
    }

    // ─── SDK event processing ────────────────────────────────────────

    private processSDKEvent(entry: SessionEntry, sdkEvent: any): void {
        if (sdkEvent.type === 'assistant' && sdkEvent.message?.content) {
            for (const block of sdkEvent.message.content) {
                if (block.type === 'text') {
                    const event = createAgentEvent(entry.sessionId, 'assistant_message', {
                        text: block.text,
                    });
                    this.broadcastEvent(entry, event);
                } else if (block.type === 'thinking') {
                    const event = createAgentEvent(entry.sessionId, 'thinking', {
                        text: block.thinking,
                    });
                    this.broadcastEvent(entry, event);
                } else if (block.type === 'tool_use') {
                    const event = createAgentEvent(entry.sessionId, 'tool_use', {
                        toolName: block.name,
                        summary: this.summarizeToolInput(block.name, block.input),
                        callId: block.id,
                    });
                    this.broadcastEvent(entry, event);
                }
            }
        }
    }

    private summarizeToolInput(toolName: string, input: any): string {
        if (!input) {
            return toolName;
        }
        if (typeof input.file_path === 'string') {
            const filename = input.file_path.split('/').pop() ?? input.file_path;
            return `${filename}`;
        }
        if (typeof input.command === 'string') {
            const cmd = input.command.length > 60 ?
                input.command.slice(0, 57) + '...' :
                input.command;
            return cmd;
        }
        if (typeof input.pattern === 'string') {
            return input.pattern;
        }
        if (typeof input.query === 'string') {
            return input.query;
        }
        return toolName;
    }

    // ─── Claude SDK runner ───────────────────────────────────────────

    private async runClaude(entry: SessionEntry, prompt: string): Promise<void> {
        entry.abortController = new AbortController();
        entry.status = 'active';

        const statusEvent = createAgentEvent(entry.sessionId, 'status', {status: 'active' as AgentStatus});
        this.broadcastEvent(entry, statusEvent);

        try {
            const stream = claude(prompt, {
                cwd: entry.repoPath,
                abortController: entry.abortController,
            });

            for await (const event of stream) {
                if (entry.abortController?.signal.aborted) {
                    break;
                }
                this.processSDKEvent(entry, event);
            }

            entry.status = 'idle';
            const idleEvent = createAgentEvent(entry.sessionId, 'status', {status: 'idle' as AgentStatus});
            this.broadcastEvent(entry, idleEvent);
        } catch (err) {
            if (entry.abortController?.signal.aborted) {
                return;
            }
            entry.status = 'error';
            const errorMsg = err instanceof Error ? err.message : String(err);
            const errorEvent = createAgentEvent(entry.sessionId, 'error', {message: errorMsg});
            this.broadcastEvent(entry, errorEvent);

            const errorStatusEvent = createAgentEvent(entry.sessionId, 'status', {status: 'error' as AgentStatus});
            this.broadcastEvent(entry, errorStatusEvent);
        }
    }

    // ─── Server / path helpers (unchanged) ───────────────────────────

    private getServerHash(): string {
        const serverId = ServerManager.getCurrentServerId();
        const server = serverId ? ServerManager.getServer(serverId) : null;
        const url = server?.url?.toString() ?? 'default';
        return createHash('sha256').update(url).digest('hex').slice(0, 12);
    }

    private getServerId(): string {
        return ServerManager.getCurrentServerId() ?? 'default';
    }

    private getPathsFile(): string {
        const dir = join(app.getPath('userData'), 'ao');
        mkdirSync(dir, {recursive: true});
        return join(dir, 'project-paths.json');
    }

    private loadProjectPaths(): ProjectPaths {
        const file = this.getPathsFile();
        if (!existsSync(file)) {
            return {};
        }
        try {
            return JSON.parse(readFileSync(file, 'utf-8'));
        } catch {
            return {};
        }
    }

    private saveProjectPaths(paths: ProjectPaths): void {
        writeFileSync(this.getPathsFile(), JSON.stringify(paths, null, 2));
    }

    private getRepoPath(projectId: string): string | null {
        const key = `${this.getServerId()}:${projectId}`;
        return this.loadProjectPaths()[key] ?? null;
    }

    private setRepoPath(projectId: string, repoPath: string): void {
        const key = `${this.getServerId()}:${projectId}`;
        const paths = this.loadProjectPaths();
        paths[key] = repoPath;
        this.saveProjectPaths(paths);
    }

    private async detectDefaultBranch(repoPath: string): Promise<string> {
        try {
            const {stdout} = await execFileAsync('git', [
                '-C', repoPath, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD',
            ]);
            return stdout.trim().replace(/^origin\//, '');
        } catch {
            try {
                const {stdout} = await execFileAsync('git', [
                    '-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD',
                ]);
                return stdout.trim() || 'main';
            } catch {
                return 'main';
            }
        }
    }

    // ─── Public API ──────────────────────────────────────────────────

    async pickRepoPath(serverId: string, projectId: string, win?: BrowserWindow): Promise<string | null> {
        log.info('pickRepoPath called', {serverId, projectId, hasWin: Boolean(win)});
        const opts = {
            properties: ['openDirectory' as const, 'createDirectory' as const],
            message: 'Select the local git repository for this project',
        };
        const result = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts));
        log.info('dialog result', {canceled: result.canceled, filePaths: result.filePaths});

        if (result.canceled || !result.filePaths[0]) {
            return null;
        }

        const repoPath = result.filePaths[0];

        if (!existsSync(join(repoPath, '.git'))) {
            throw new Error(`"${repoPath}" is not a git repository (.git not found). Please select a valid git repo.`);
        }

        this.setRepoPath(projectId, repoPath);
        return repoPath;
    }

    async spawnSession(
        projectId: string,
        _projectName: string,
        _sessionPrefix: string,
        issue: AoIssue,
        userPrompt: string,
        webContents: Electron.WebContents,
    ): Promise<string> {
        const repoPath = this.getRepoPath(projectId);
        if (!repoPath) {
            throw new Error('No repo linked. Use the folder picker to link a local git repo first.');
        }

        const sessionId = `${projectId}-${Date.now()}`;

        const prompt = [
            'Issue context:',
            `- ID: ${issue.id}`,
            `- Identifier: ${issue.identifier}`,
            `- Title: ${issue.title}`,
            issue.description ? `- Description: ${issue.description}` : '',
            '',
            `Task: ${userPrompt}`,
        ].filter(Boolean).join('\n');

        const entry: SessionEntry = {
            sessionId,
            projectId,
            abortController: null,
            status: 'spawning',
            history: [],
            webContentsId: webContents.id,
            repoPath,
        };

        this.sessions.set(projectId, entry);

        // Broadcast user message and spawning status
        const userEvent = createAgentEvent(sessionId, 'user_message', {text: prompt});
        this.broadcastEvent(entry, userEvent);

        const spawningEvent = createAgentEvent(sessionId, 'status', {status: 'spawning' as AgentStatus});
        this.broadcastEvent(entry, spawningEvent);

        // Run Claude asynchronously — don't await so events stream back in real time
        this.runClaude(entry, prompt).catch((err) => {
            log.error('runClaude failed', {err, sessionId});
        });

        return sessionId;
    }

    async sendMessage(projectId: string, message: string): Promise<void> {
        const entry = this.sessions.get(projectId);
        if (!entry) {
            throw new Error(`No active session for project ${projectId}`);
        }

        // Broadcast user message
        const userEvent = createAgentEvent(entry.sessionId, 'user_message', {text: message});
        this.broadcastEvent(entry, userEvent);

        // Run Claude for the follow-up
        this.runClaude(entry, message).catch((err) => {
            log.error('runClaude (sendMessage) failed', {err, sessionId: entry.sessionId});
        });
    }

    async killSession(projectId: string): Promise<void> {
        const entry = this.sessions.get(projectId);
        if (!entry) {
            return;
        }

        entry.abortController?.abort();
        this.sessions.delete(projectId);
    }

    getSessionStatus(projectId: string): {sessionId: string | null; hasRepoPath: boolean; repoPath: string | null} {
        const entry = this.sessions.get(projectId);
        const sessionId = entry?.sessionId ?? null;
        const repoPath = this.getRepoPath(projectId);

        return {
            sessionId,
            hasRepoPath: Boolean(repoPath),
            repoPath,
        };
    }

    // ─── Git methods (unchanged) ─────────────────────────────────────

    private getWorktreePath(projectId: string): string | null {
        const homedir = require('os').homedir();
        const projectWorktreeDir = join(homedir, '.worktrees', projectId);
        if (!existsSync(projectWorktreeDir)) {
            return null;
        }
        const {readdirSync, statSync} = require('fs');
        const entries = readdirSync(projectWorktreeDir).filter((e: string) => {
            try {
                return statSync(join(projectWorktreeDir, e)).isDirectory();
            } catch {
                return false;
            }
        });
        if (entries.length === 0) {
            return null;
        }
        return join(projectWorktreeDir, entries[entries.length - 1]);
    }

    async getDiff(projectId: string): Promise<string> {
        const wtPath = this.getWorktreePath(projectId);
        if (!wtPath) {
            return '';
        }

        try {
            const repoPath = this.getRepoPath(projectId);
            const defaultBranch = repoPath ? await this.detectDefaultBranch(repoPath) : 'main';

            // Compare the default branch directly against the worktree's current state
            // (committed + uncommitted changes). This is a straight diff of master..HEAD
            // plus any working tree changes.
            try {
                // First: committed changes vs default branch
                const {stdout: committedDiff} = await execFileAsync('git', [
                    '-C', wtPath, 'diff', defaultBranch + '..HEAD',
                ], {maxBuffer: 10 * 1024 * 1024});
                if (committedDiff.trim()) {
                    return committedDiff;
                }
            } catch { /* default branch ref may not exist in worktree */ }

            // Try origin/defaultBranch as fallback
            try {
                const {stdout} = await execFileAsync('git', [
                    '-C', wtPath, 'diff', `origin/${defaultBranch}..HEAD`,
                ], {maxBuffer: 10 * 1024 * 1024});
                if (stdout.trim()) {
                    return stdout;
                }
            } catch { /* fall through */ }

            // Last resort: show all changes in the worktree (uncommitted)
            const {stdout} = await execFileAsync('git', ['-C', wtPath, 'diff', 'HEAD'], {maxBuffer: 10 * 1024 * 1024});
            return stdout;
        } catch (err) {
            log.warn('Failed to get diff', {err, wtPath});
            return '';
        }
    }

    async getGitFiles(projectId: string): Promise<{name: string; type: 'file' | 'dir'}[]> {
        const wtPath = this.getWorktreePath(projectId);
        if (!wtPath) {
            return [];
        }
        try {
            const {stdout} = await execFileAsync('git', [
                '-C', wtPath, 'ls-tree', '-r', '--name-only', 'HEAD',
            ], {maxBuffer: 10 * 1024 * 1024});

            // Get top-level entries (dirs and files)
            const paths = stdout.trim().split('\n').filter(Boolean);
            const topLevel = new Map<string, 'file' | 'dir'>();
            for (const p of paths) {
                const parts = p.split('/');
                if (parts.length === 1) {
                    topLevel.set(parts[0], 'file');
                } else {
                    topLevel.set(parts[0], 'dir');
                }
            }
            return Array.from(topLevel.entries())
                .map(([name, type]) => ({name, type}))
                .sort((a, b) => {
                    if (a.type !== b.type) {
                        return a.type === 'dir' ? -1 : 1;
                    }
                    return a.name.localeCompare(b.name);
                });
        } catch {
            return [];
        }
    }

    async getGitChanges(projectId: string): Promise<{path: string; status: string; additions: number; deletions: number}[]> {
        const wtPath = this.getWorktreePath(projectId);
        if (!wtPath) {
            return [];
        }
        try {
            const repoPath = this.getRepoPath(projectId);
            const defaultBranch = repoPath ? await this.detectDefaultBranch(repoPath) : 'main';

            // Try to get numstat from default branch
            let diffOutput = '';
            try {
                const {stdout} = await execFileAsync('git', [
                    '-C', wtPath, 'diff', '--numstat', `${defaultBranch}..HEAD`,
                ], {maxBuffer: 10 * 1024 * 1024});
                diffOutput = stdout;
            } catch { /* ignore */ }

            if (!diffOutput.trim()) {
                try {
                    const {stdout} = await execFileAsync('git', [
                        '-C', wtPath, 'diff', '--numstat', `origin/${defaultBranch}..HEAD`,
                    ], {maxBuffer: 10 * 1024 * 1024});
                    diffOutput = stdout;
                } catch { /* ignore */ }
            }

            if (!diffOutput.trim()) {
                const {stdout} = await execFileAsync('git', [
                    '-C', wtPath, 'diff', '--numstat', 'HEAD',
                ], {maxBuffer: 10 * 1024 * 1024});
                diffOutput = stdout;
            }

            // Also get name-status for M/A/D info
            let statusOutput = '';
            try {
                const {stdout} = await execFileAsync('git', [
                    '-C', wtPath, 'diff', '--name-status', `${defaultBranch}..HEAD`,
                ], {maxBuffer: 10 * 1024 * 1024});
                statusOutput = stdout;
            } catch { /* ignore */ }

            if (!statusOutput.trim()) {
                try {
                    const {stdout} = await execFileAsync('git', [
                        '-C', wtPath, 'diff', '--name-status', `origin/${defaultBranch}..HEAD`,
                    ], {maxBuffer: 10 * 1024 * 1024});
                    statusOutput = stdout;
                } catch { /* ignore */ }
            }

            if (!statusOutput.trim()) {
                const {stdout} = await execFileAsync('git', [
                    '-C', wtPath, 'diff', '--name-status', 'HEAD',
                ], {maxBuffer: 10 * 1024 * 1024});
                statusOutput = stdout;
            }

            const statusMap = new Map<string, string>();
            for (const line of statusOutput.trim().split('\n').filter(Boolean)) {
                const parts = line.split('\t');
                if (parts.length >= 2) {
                    statusMap.set(parts[parts.length - 1], parts[0]);
                }
            }

            const results: {path: string; status: string; additions: number; deletions: number}[] = [];
            for (const line of diffOutput.trim().split('\n').filter(Boolean)) {
                const parts = line.split('\t');
                if (parts.length >= 3) {
                    const additions = parseInt(parts[0], 10) || 0;
                    const deletions = parseInt(parts[1], 10) || 0;
                    const filePath = parts[2];
                    const status = statusMap.get(filePath) || 'M';
                    results.push({path: filePath, status, additions, deletions});
                }
            }
            return results;
        } catch {
            return [];
        }
    }

    async getGitFullStatus(projectId: string): Promise<{
        hasWorktree: boolean;
        branch: string;
        defaultBranch: string;
        hasUncommittedChanges: boolean;
        hasUnpushedCommits: boolean;
        hasPR: boolean;
        prUrl: string;
        uncommittedFileCount: number;
        unpushedCommitCount: number;
    }> {
        const empty = {
            hasWorktree: false, branch: '', defaultBranch: 'main',
            hasUncommittedChanges: false, hasUnpushedCommits: false,
            hasPR: false, prUrl: '', uncommittedFileCount: 0, unpushedCommitCount: 0,
        };
        const wtPath = this.getWorktreePath(projectId);
        if (!wtPath) { return empty; }

        const repoPath = this.getRepoPath(projectId);
        const defaultBranch = repoPath ? await this.detectDefaultBranch(repoPath) : 'main';

        let branch = '';
        try {
            const {stdout} = await execFileAsync('git', ['-C', wtPath, 'rev-parse', '--abbrev-ref', 'HEAD']);
            branch = stdout.trim();
        } catch { return {...empty, hasWorktree: true, defaultBranch}; }

        // Uncommitted changes (staged + unstaged + untracked)
        let uncommittedFileCount = 0;
        let hasUncommittedChanges = false;
        try {
            const {stdout} = await execFileAsync('git', ['-C', wtPath, 'status', '--porcelain']);
            const lines = stdout.trim().split('\n').filter(Boolean);
            uncommittedFileCount = lines.length;
            hasUncommittedChanges = uncommittedFileCount > 0;
        } catch { /* ignore */ }

        // Unpushed commits
        let unpushedCommitCount = 0;
        let hasUnpushedCommits = false;
        try {
            const {stdout} = await execFileAsync('git', ['-C', wtPath, 'log', `origin/${branch}..HEAD`, '--oneline']);
            const lines = stdout.trim().split('\n').filter(Boolean);
            unpushedCommitCount = lines.length;
            hasUnpushedCommits = unpushedCommitCount > 0;
        } catch {
            // Remote branch may not exist yet — any local commits count as unpushed
            try {
                const {stdout} = await execFileAsync('git', ['-C', wtPath, 'log', `origin/${defaultBranch}..HEAD`, '--oneline']);
                const lines = stdout.trim().split('\n').filter(Boolean);
                unpushedCommitCount = lines.length;
                hasUnpushedCommits = unpushedCommitCount > 0;
            } catch { /* ignore */ }
        }

        // Check if PR exists
        let hasPR = false;
        let prUrl = '';
        try {
            const {stdout} = await execFileAsync('gh', [
                'pr', 'view', branch, '--json', 'url', '--jq', '.url',
            ], {cwd: wtPath});
            if (stdout.trim()) {
                hasPR = true;
                prUrl = stdout.trim();
            }
        } catch { /* no PR */ }

        return {
            hasWorktree: true, branch, defaultBranch,
            hasUncommittedChanges, hasUnpushedCommits,
            hasPR, prUrl, uncommittedFileCount, unpushedCommitCount,
        };
    }

    async gitAction(projectId: string, action: string, extraArgs?: string): Promise<string> {
        const wtPath = this.getWorktreePath(projectId);
        if (!wtPath) {
            throw new Error('No worktree found. Start an agent session first.');
        }

        const repoPath = this.getRepoPath(projectId);
        const defaultBranch = repoPath ? await this.detectDefaultBranch(repoPath) : 'main';

        switch (action) {
        case 'commit': {
            if (!extraArgs?.trim()) {
                throw new Error('Commit message is required.');
            }
            await execFileAsync('git', ['-C', wtPath, 'add', '-A']);
            const {stdout} = await execFileAsync('git', ['-C', wtPath, 'commit', '-m', extraArgs.trim()]);
            return stdout.trim() || 'Committed successfully.';
        }
        case 'push': {
            // Get current branch name
            const {stdout: branch} = await execFileAsync('git', ['-C', wtPath, 'rev-parse', '--abbrev-ref', 'HEAD']);
            const branchName = branch.trim();
            const {stdout} = await execFileAsync('git', ['-C', wtPath, 'push', '-u', 'origin', branchName]);
            return stdout.trim() || `Pushed ${branchName} to origin.`;
        }
        case 'create-pr': {
            const {stdout: branch} = await execFileAsync('git', ['-C', wtPath, 'rev-parse', '--abbrev-ref', 'HEAD']);
            const branchName = branch.trim();
            // Push first
            await execFileAsync('git', ['-C', wtPath, 'push', '-u', 'origin', branchName]);
            // Create PR using gh CLI
            const {stdout} = await execFileAsync('gh', [
                'pr', 'create',
                '--base', defaultBranch,
                '--head', branchName,
                '--title', branchName.replace(/[-_]/g, ' '),
                '--body', 'Created from OLI Issues',
            ], {cwd: wtPath});
            return stdout.trim() || 'Pull request created.';
        }
        case 'merge': {
            const {stdout: branch} = await execFileAsync('git', ['-C', wtPath, 'rev-parse', '--abbrev-ref', 'HEAD']);
            const branchName = branch.trim();
            // Try to merge via gh if a PR exists
            try {
                const {stdout} = await execFileAsync('gh', [
                    'pr', 'merge', branchName, '--merge', '--delete-branch',
                ], {cwd: wtPath});
                return stdout.trim() || 'Merged successfully.';
            } catch {
                // Fallback: merge locally
                await execFileAsync('git', ['-C', wtPath, 'checkout', defaultBranch]);
                await execFileAsync('git', ['-C', wtPath, 'merge', branchName]);
                return `Merged ${branchName} into ${defaultBranch}.`;
            }
        }
        default:
            throw new Error(`Unknown git action: ${action}`);
        }
    }
}

const aoManager = new AoManager();
export default aoManager;
