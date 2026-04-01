// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createHash} from 'crypto';
import {execFile, spawn, ChildProcess} from 'child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'fs';
import {join, resolve} from 'path';
import {promisify} from 'util';
import {createInterface} from 'readline';

import {app, BrowserWindow, dialog} from 'electron';

import {Logger} from 'common/log';
import ServerManager from 'common/servers/serverManager';
import {AO_OUTPUT_UPDATE} from 'common/communication';
import {createAgentEvent} from 'common/agentEvents';
import type {AgentEvent, AgentStatus} from 'common/agentEvents';

const log = new Logger('AoManager');
const execFileAsync = promisify(execFile);

const CLAUDE_CLI_PATH = resolve(app.getAppPath(), '../node_modules/@anthropic-ai/claude-code/cli.js');

interface AoIssue {
    id: string;
    identifier: string;
    title: string;
    description: string;
}

interface SessionEntry {
    sessionId: string;
    projectId: string;
    claudeProcess: ChildProcess | null;
    status: AgentStatus;
    history: AgentEvent[];
    webContentsId: number;
    repoPath: string;
    worktreePath: string | null;
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

    // ─── Claude CLI runner ────────────────────────────────────────────

    private runClaude(entry: SessionEntry, prompt: string, resumeSessionId?: string): void {
        entry.status = 'active';
        this.broadcastEvent(entry, createAgentEvent(entry.sessionId, 'status', {status: 'active' as AgentStatus}));

        const args = [
            CLAUDE_CLI_PATH,
            '--print',
            '--output-format', 'stream-json',
            '--verbose',
            '--dangerously-skip-permissions',
        ];

        if (resumeSessionId) {
            args.push('--resume', resumeSessionId);
        }

        args.push(prompt);

        const proc = spawn('node', args, {
            cwd: entry.repoPath,
            env: {...process.env},
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        entry.claudeProcess = proc;

        // Parse newline-delimited JSON from stdout
        const rl = createInterface({input: proc.stdout!});
        rl.on('line', (line: string) => {
            if (!line.trim()) {
                return;
            }
            try {
                const sdkEvent = JSON.parse(line);
                this.processSDKEvent(entry, sdkEvent);

                // Capture the session ID from the init event for future --resume
                if (sdkEvent.type === 'system' && sdkEvent.subtype === 'init' && sdkEvent.session_id) {
                    entry.sessionId = sdkEvent.session_id;
                }
            } catch {
                // Non-JSON output — ignore
            }
        });

        proc.stderr?.on('data', (data: Buffer) => {
            log.warn('Claude CLI stderr', {data: data.toString().slice(0, 200)});
        });

        proc.on('close', (code) => {
            entry.claudeProcess = null;
            if (code === 0 || code === null) {
                entry.status = 'idle';
                this.broadcastEvent(entry, createAgentEvent(entry.sessionId, 'status', {status: 'idle' as AgentStatus}));
            } else {
                entry.status = 'error';
                this.broadcastEvent(entry, createAgentEvent(entry.sessionId, 'error', {message: `Claude exited with code ${code}`}));
                this.broadcastEvent(entry, createAgentEvent(entry.sessionId, 'status', {status: 'error' as AgentStatus}));
            }
        });

        proc.on('error', (err) => {
            entry.claudeProcess = null;
            entry.status = 'error';
            this.broadcastEvent(entry, createAgentEvent(entry.sessionId, 'error', {message: err.message}));
            this.broadcastEvent(entry, createAgentEvent(entry.sessionId, 'status', {status: 'error' as AgentStatus}));
        });
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
        // Try origin/HEAD symbolic ref (most reliable)
        try {
            const {stdout} = await execFileAsync('git', [
                '-C', repoPath, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD',
            ]);
            return stdout.trim().replace(/^origin\//, '');
        } catch { /* origin/HEAD not set */ }

        // Try common default branch names by checking if they exist as remote refs
        for (const candidate of ['main', 'master']) {
            try {
                await execFileAsync('git', [
                    '-C', repoPath, 'rev-parse', '--verify', `refs/remotes/origin/${candidate}`,
                ]);
                return candidate;
            } catch { /* branch doesn't exist */ }
        }

        return 'main';
    }

    // ─── Worktree lifecycle ─────────────────────────────────────────

    private sanitizeForBranch(identifier: string): string {
        return identifier.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    }

    /**
     * Create an isolated git worktree for an issue.
     * Path: ~/.worktrees/{projectId}/{sanitized-identifier}/
     * Branch: oli/{sanitized-identifier} based on origin/{defaultBranch}
     */
    private async createWorktree(projectId: string, issueIdentifier: string, repoPath: string): Promise<string> {
        const homedir = require('os').homedir();
        const sanitizedId = this.sanitizeForBranch(issueIdentifier);
        const projectWorktreeDir = join(homedir, '.worktrees', projectId);
        const worktreePath = join(projectWorktreeDir, sanitizedId);

        // Reuse existing valid worktree
        if (existsSync(worktreePath)) {
            try {
                await execFileAsync('git', ['-C', worktreePath, 'rev-parse', '--is-inside-work-tree']);
                log.info('Reusing existing worktree', {worktreePath});
                return worktreePath;
            } catch {
                // Directory exists but isn't a valid worktree — prune and recreate
                rmSync(worktreePath, {recursive: true, force: true});
                try {
                    await execFileAsync('git', ['-C', repoPath, 'worktree', 'prune']);
                } catch { /* best effort */ }
            }
        }

        mkdirSync(projectWorktreeDir, {recursive: true});

        // Fetch latest from remote (non-fatal if offline)
        try {
            await execFileAsync('git', ['-C', repoPath, 'fetch', 'origin', '--quiet']);
        } catch { /* offline is fine */ }

        const defaultBranch = await this.detectDefaultBranch(repoPath);
        const branch = `oli/${sanitizedId}`;
        const baseRef = `origin/${defaultBranch}`;

        try {
            // Create worktree with a new branch based on the default branch
            await execFileAsync('git', [
                '-C', repoPath, 'worktree', 'add', '-b', branch, worktreePath, baseRef,
            ]);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes('already exists')) {
                throw new Error(`Failed to create worktree for "${issueIdentifier}": ${msg}`);
            }

            // Branch already exists — create worktree on base ref, then checkout the branch
            await execFileAsync('git', ['-C', repoPath, 'worktree', 'add', worktreePath, baseRef]);
            try {
                await execFileAsync('git', ['-C', worktreePath, 'checkout', branch]);
            } catch (checkoutErr: unknown) {
                // Clean up orphaned worktree before rethrowing
                try {
                    await execFileAsync('git', ['-C', repoPath, 'worktree', 'remove', '--force', worktreePath]);
                } catch { /* best effort */ }
                const checkoutMsg = checkoutErr instanceof Error ? checkoutErr.message : String(checkoutErr);
                throw new Error(`Failed to checkout branch "${branch}": ${checkoutMsg}`);
            }
        }

        log.info('Created worktree', {projectId, branch, worktreePath});
        return worktreePath;
    }

    /**
     * Remove a git worktree. Does NOT delete the branch (can be cleaned up separately).
     */
    private async destroyWorktree(worktreePath: string): Promise<void> {
        try {
            const {stdout} = await execFileAsync('git', [
                '-C', worktreePath, 'rev-parse', '--path-format=absolute', '--git-common-dir',
            ]);
            const repoRoot = resolve(stdout.trim(), '..');
            await execFileAsync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', worktreePath]);
        } catch {
            // If git commands fail, fall back to rm
            if (existsSync(worktreePath)) {
                rmSync(worktreePath, {recursive: true, force: true});
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

        // Create an isolated worktree for this issue
        const worktreePath = await this.createWorktree(projectId, issue.identifier, repoPath);

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
            claudeProcess: null,
            status: 'spawning',
            history: [],
            webContentsId: webContents.id,
            repoPath: worktreePath,
            worktreePath,
        };

        this.sessions.set(projectId, entry);

        // Broadcast user message and spawning status
        this.broadcastEvent(entry, createAgentEvent(sessionId, 'user_message', {text: prompt}));
        this.broadcastEvent(entry, createAgentEvent(sessionId, 'status', {status: 'spawning' as AgentStatus}));

        // Spawn Claude CLI in the worktree
        this.runClaude(entry, prompt);

        return sessionId;
    }

    async sendMessage(projectId: string, message: string): Promise<void> {
        const entry = this.sessions.get(projectId);
        if (!entry) {
            throw new Error(`No active session for project ${projectId}`);
        }

        // Broadcast user message
        this.broadcastEvent(entry, createAgentEvent(entry.sessionId, 'user_message', {text: message}));

        // Resume the Claude session with the follow-up message
        this.runClaude(entry, message, entry.sessionId);
    }

    async killSession(projectId: string): Promise<void> {
        const entry = this.sessions.get(projectId);
        if (!entry) {
            return;
        }

        if (entry.claudeProcess) {
            entry.claudeProcess.kill('SIGTERM');
            entry.claudeProcess = null;
        }
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
        const repoPath = this.getRepoPath(projectId);

        // Use worktree if available, otherwise fall back to the linked repo path
        const gitPath = wtPath ?? repoPath;
        if (!gitPath) {
            return '';
        }

        try {
            const defaultBranch = repoPath ? await this.detectDefaultBranch(repoPath) : 'main';

            // Use `git diff <ref>` (without ..HEAD) to compare against the working tree,
            // which captures committed branch changes AND uncommitted modifications.
            try {
                const {stdout} = await execFileAsync('git', [
                    '-C', gitPath, 'diff', defaultBranch,
                ], {maxBuffer: 10 * 1024 * 1024});
                if (stdout.trim()) {
                    return stdout;
                }
            } catch { /* default branch ref may not exist in worktree */ }

            // Try origin/defaultBranch as fallback
            try {
                const {stdout} = await execFileAsync('git', [
                    '-C', gitPath, 'diff', `origin/${defaultBranch}`,
                ], {maxBuffer: 10 * 1024 * 1024});
                if (stdout.trim()) {
                    return stdout;
                }
            } catch { /* fall through */ }

            // Last resort: show uncommitted changes vs HEAD
            const {stdout} = await execFileAsync('git', ['-C', gitPath, 'diff', 'HEAD'], {maxBuffer: 10 * 1024 * 1024});
            return stdout;
        } catch (err) {
            log.warn('Failed to get diff', {err, gitPath});
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

            // Use `git diff <ref>` (without ..HEAD) to capture committed + uncommitted changes
            let diffOutput = '';
            try {
                const {stdout} = await execFileAsync('git', [
                    '-C', wtPath, 'diff', '--numstat', defaultBranch,
                ], {maxBuffer: 10 * 1024 * 1024});
                diffOutput = stdout;
            } catch { /* ignore */ }

            if (!diffOutput.trim()) {
                try {
                    const {stdout} = await execFileAsync('git', [
                        '-C', wtPath, 'diff', '--numstat', `origin/${defaultBranch}`,
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
                    '-C', wtPath, 'diff', '--name-status', defaultBranch,
                ], {maxBuffer: 10 * 1024 * 1024});
                statusOutput = stdout;
            } catch { /* ignore */ }

            if (!statusOutput.trim()) {
                try {
                    const {stdout} = await execFileAsync('git', [
                        '-C', wtPath, 'diff', '--name-status', `origin/${defaultBranch}`,
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
