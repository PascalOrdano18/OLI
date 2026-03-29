// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createHash} from 'crypto';
import {execFile, spawn} from 'child_process';
import {createReadStream, existsSync, mkdirSync, ReadStream, readFileSync, unlinkSync, writeFileSync} from 'fs';
import {join, resolve} from 'path';
import {tmpdir} from 'os';
import {promisify} from 'util';

import {app, BrowserWindow, dialog, WebContents} from 'electron';

import {Logger} from 'common/log';
import ServerManager from 'common/servers/serverManager';

import {AO_OUTPUT_UPDATE} from 'common/communication';

const log = new Logger('AoManager');
const execFileAsync = promisify(execFile);

const AO_CLI_PATH = resolve(app.getAppPath(), '../agent-orchestrator-main/packages/cli/dist/index.js');

interface AoIssue {
    id: string;
    identifier: string;
    title: string;
    description: string;
}

interface SessionEntry {
    sessionId: string;
    tmuxName: string;
    projectId: string;
    pollInterval: ReturnType<typeof setInterval> | null;
    pipeStream: ReadStream | null;
    pipePath: string | null;
    lastOutput: string;
    webContentsId: number;
}

interface ProjectPaths {
    [key: string]: string;
}

interface PersistedSessions {
    [projectId: string]: {sessionId: string; tmuxName: string};
}

export class AoManager {
    private sessions: Map<string, SessionEntry> = new Map();

    private getSessionsFile(): string {
        const dir = join(app.getPath('userData'), 'ao');
        mkdirSync(dir, {recursive: true});
        return join(dir, 'sessions.json');
    }

    private loadPersistedSessions(): PersistedSessions {
        try {
            const file = this.getSessionsFile();
            if (!existsSync(file)) {
                return {};
            }
            return JSON.parse(readFileSync(file, 'utf-8'));
        } catch {
            return {};
        }
    }

    private persistSession(projectId: string, sessionId: string, tmuxName: string): void {
        const sessions = this.loadPersistedSessions();
        sessions[projectId] = {sessionId, tmuxName};
        writeFileSync(this.getSessionsFile(), JSON.stringify(sessions, null, 2));
    }

    private removePersistedSession(projectId: string): void {
        const sessions = this.loadPersistedSessions();
        delete sessions[projectId];
        writeFileSync(this.getSessionsFile(), JSON.stringify(sessions, null, 2));
    }

    private getTmuxName(projectId: string): string | null {
        const entry = this.sessions.get(projectId);
        if (entry) {
            return entry.tmuxName;
        }
        const persisted = this.loadPersistedSessions()[projectId];
        return persisted?.tmuxName ?? null;
    }

    private getServerHash(): string {
        const serverId = ServerManager.getCurrentServerId();
        const server = serverId ? ServerManager.getServer(serverId) : null;
        const url = server?.url?.toString() ?? 'default';
        return createHash('sha256').update(url).digest('hex').slice(0, 12);
    }

    private getServerId(): string {
        return ServerManager.getCurrentServerId() ?? 'default';
    }

    private getConfigDir(): string {
        const dir = join(app.getPath('userData'), 'ao', this.getServerHash());
        mkdirSync(dir, {recursive: true});
        return dir;
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

    private generateConfig(
        projectId: string,
        projectName: string,
        sessionPrefix: string,
        repoPath: string,
        defaultBranch: string,
    ): string {
        const configDir = this.getConfigDir();
        const dataDir = join(configDir, '.ao-data');
        const worktreeDir = join(configDir, '.worktrees');

        return [
            `dataDir: ${dataDir}`,
            `worktreeDir: ${worktreeDir}`,
            `port: 3100`,
            '',
            `projects:`,
            `  ${projectId}:`,
            `    repo: local/${projectName}`,
            `    path: ${repoPath}`,
            `    defaultBranch: ${defaultBranch}`,
            `    sessionPrefix: "${sessionPrefix}"`,
            `    agentRules: |`,
            `      You are working in an isolated git worktree on a dedicated feature branch.`,
            `      Your job is to implement the changes described in the issue.`,
            ``,
            `      ## Rules`,
            `      - Do NOT create pull requests or push to any remote.`,
            `      - Do NOT create new branches — you are already on the correct feature branch.`,
            `      - Commit your changes locally when the implementation is complete.`,
            ``,
            `      ## When finished`,
            `      Output a clear "## How to Test" section at the end with exact instructions:`,
            `      how to run the app or script, what commands to execute, and what to look for`,
            `      to verify your changes work correctly.`,
            `    scm:`,
            `      plugin: local`,
            `    tracker:`,
            `      plugin: local`,
        ].join('\n');
    }

    private writeConfig(
        projectId: string,
        projectName: string,
        sessionPrefix: string,
        repoPath: string,
        defaultBranch: string,
    ): void {
        const configDir = this.getConfigDir();
        const yaml = this.generateConfig(projectId, projectName, sessionPrefix, repoPath, defaultBranch);
        writeFileSync(join(configDir, 'agent-orchestrator.yaml'), yaml);
        log.debug('Wrote AO config', {configDir, projectId});
    }

    private runAo(args: string[], cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            log.debug('Running AO', {args, cwd});
            const proc = spawn('node', [AO_CLI_PATH, ...args], {
                cwd,
                env: {...process.env},
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (d: Buffer) => {
                stdout += d.toString();
            });
            proc.stderr.on('data', (d: Buffer) => {
                stderr += d.toString();
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`ao ${args[0]} exited ${code}: ${stderr}`));
                }
            });

            proc.on('error', reject);
        });
    }

    private async autoAcceptBypassPrompt(tmuxName: string): Promise<void> {
        // Wait for Claude to start, then auto-accept the bypass permissions warning
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 500));
            const output = await this.captureTmux(tmuxName);
            if (/Bypass Permissions mode|bypass.*permissions/i.test(output)) {
                // Single key "2" selects "Yes, I accept" — no Enter needed for Claude's TUI
                await execFileAsync('tmux', ['send-keys', '-t', tmuxName, '2']);
                await new Promise((r) => setTimeout(r, 500));
                return;
            }
            // Claude started without showing the bypass prompt (already accepted before)
            if (/^\s*❯/.test(output) || /claude code/i.test(output)) {
                return;
            }
        }
    }

    private async captureTmux(tmuxName: string): Promise<string> {
        try {
            const {stdout} = await execFileAsync('tmux', [
                'capture-pane', '-t', tmuxName, '-p', '-e', '-S', '-200',
            ]);
            return stdout;
        } catch {
            return '';
        }
    }

    private getPipePath(projectId: string): string {
        const safe = projectId.replace(/[^a-z0-9]/gi, '-');
        return join(tmpdir(), `ao-term-${safe}.pipe`);
    }

    private async startStreaming(entry: SessionEntry, webContents: WebContents): Promise<void> {
        const pipePath = this.getPipePath(entry.projectId);
        entry.pipePath = pipePath;

        // Clean up any leftover pipe from a previous session
        if (existsSync(pipePath)) {
            try { unlinkSync(pipePath); } catch { /* ignore */ }
        }

        // Send current screen as initial state so the terminal isn't blank
        const initial = await this.captureTmux(entry.tmuxName);
        if (!webContents.isDestroyed() && initial) {
            webContents.send(AO_OUTPUT_UPDATE, {data: '\x1b[H\x1b[2J' + initial, isInitial: true});
        }

        // Create FIFO for streaming
        try {
            await execFileAsync('mkfifo', [pipePath]);
        } catch (err) {
            log.warn('mkfifo failed, falling back to polling', {err});
            this.startPolling(entry, webContents);
            return;
        }

        // Start streaming pipe in background — createReadStream will unblock once
        // tmux pipe-pane opens the write end via its spawned cat process.
        const stream = createReadStream(pipePath, {encoding: 'utf8'});
        entry.pipeStream = stream;

        stream.on('data', (chunk: string | Buffer) => {
            if (webContents.isDestroyed()) {
                this.stopStreaming(entry);
                return;
            }
            webContents.send(AO_OUTPUT_UPDATE, {data: chunk.toString()});
        });

        stream.on('error', (err) => {
            log.warn('Terminal stream error', {err});
        });

        // Tell tmux to pipe pane output into the FIFO (-o = output only)
        execFileAsync('tmux', ['pipe-pane', '-t', entry.tmuxName, '-o', `cat > '${pipePath}'`]).
            catch((err) => log.warn('pipe-pane failed', {err}));
    }

    private stopStreaming(entry: SessionEntry): void {
        if (entry.pipeStream) {
            entry.pipeStream.destroy();
            entry.pipeStream = null;
        }
        if (entry.tmuxName) {
            // Stop pipe-pane by calling pipe-pane with no command
            execFileAsync('tmux', ['pipe-pane', '-t', entry.tmuxName]).catch(() => { /* ignore */ });
        }
        if (entry.pipePath) {
            if (existsSync(entry.pipePath)) {
                try { unlinkSync(entry.pipePath); } catch { /* ignore */ }
            }
            entry.pipePath = null;
        }
    }

    private startPolling(entry: SessionEntry, webContents: WebContents): void {
        entry.pollInterval = setInterval(async () => {
            if (webContents.isDestroyed()) {
                this.stopPolling(entry);
                return;
            }

            const output = await this.captureTmux(entry.tmuxName);
            if (output && output !== entry.lastOutput) {
                entry.lastOutput = output;
                webContents.send(AO_OUTPUT_UPDATE, {data: output, isInitial: true});
            }
        }, 1000);
    }

    private stopPolling(entry: SessionEntry): void {
        if (entry.pollInterval) {
            clearInterval(entry.pollInterval);
            entry.pollInterval = null;
        }
    }

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
        projectName: string,
        sessionPrefix: string,
        issue: AoIssue,
        userPrompt: string,
        webContents: WebContents,
    ): Promise<string> {
        const repoPath = this.getRepoPath(projectId);
        if (!repoPath) {
            throw new Error('No repo linked. Use the folder picker to link a local git repo first.');
        }

        const defaultBranch = await this.detectDefaultBranch(repoPath);
        this.writeConfig(projectId, projectName, sessionPrefix, repoPath, defaultBranch);

        const configDir = this.getConfigDir();
        const spawnOutput = await this.runAo(['spawn'], configDir);

        const match = spawnOutput.match(/SESSION=(\S+)/);
        if (!match) {
            throw new Error(`Could not parse session ID from ao spawn output: ${spawnOutput}`);
        }
        const sessionId = match[1];

        const tmuxMatch = spawnOutput.match(/tmux attach -t (\S+)/);
        const tmuxName = tmuxMatch ? tmuxMatch[1] : sessionId;

        // Auto-accept bypass permissions warning (single key "2" = Yes I accept, no Enter needed)
        await this.autoAcceptBypassPrompt(tmuxName);

        // Capture baseline output so polling only shows new content
        const baseline = await this.captureTmux(tmuxName);

        const prompt = [
            `Issue context:`,
            `- ID: ${issue.id}`,
            `- Identifier: ${issue.identifier}`,
            `- Title: ${issue.title}`,
            issue.description ? `- Description: ${issue.description}` : '',
            ``,
            `Task: ${userPrompt}`,
        ].filter(Boolean).join('\n');

        // Use ao send so AO handles timing/delivery properly
        await this.runAo(['send', sessionId, prompt], configDir);

        const entry: SessionEntry = {
            sessionId,
            tmuxName,
            projectId,
            pollInterval: null,
            pipeStream: null,
            pipePath: null,
            lastOutput: baseline,
            webContentsId: webContents.id,
        };

        this.sessions.set(projectId, entry);
        this.persistSession(projectId, sessionId, tmuxName);
        this.startStreaming(entry, webContents);

        return sessionId;
    }

    async resizeTerminal(projectId: string, cols: number, rows: number): Promise<void> {
        const tmuxName = this.getTmuxName(projectId);
        if (!tmuxName) { return; }
        try {
            await execFileAsync('tmux', ['resize-window', '-t', tmuxName, '-x', String(cols), '-y', String(rows)]);
        } catch { /* ignore if session is gone */ }
    }

    async sendRawInput(projectId: string, input: string): Promise<void> {
        const tmuxName = this.getTmuxName(projectId);
        if (!tmuxName) {
            throw new Error(`No active session for project ${projectId}`);
        }
        // Use -l (literal) so xterm's raw bytes (arrows, ctrl sequences, etc.) pass through unchanged
        await execFileAsync('tmux', ['send-keys', '-t', tmuxName, '-l', input]);
    }

    async sendMessage(projectId: string, message: string): Promise<void> {
        const entry = this.sessions.get(projectId);
        const tmuxName = this.getTmuxName(projectId);
        if (!tmuxName) {
            throw new Error(`No active session for project ${projectId}`);
        }

        if (message.trim() === '') {
            await execFileAsync('tmux', ['send-keys', '-t', tmuxName, 'C-m']);
        } else if (/^\d$/.test(message.trim())) {
            // Single digit for Claude's permission TUI — no Enter needed
            await execFileAsync('tmux', ['send-keys', '-t', tmuxName, message.trim()]);
        } else if (entry) {
            // Use ao send for proper delivery with timing
            const configDir = this.getConfigDir();
            await this.runAo(['send', entry.sessionId, message], configDir);
        } else {
            await execFileAsync('tmux', ['send-keys', '-t', tmuxName, message, 'C-m']);
        }
    }

    async openTerminal(projectId: string): Promise<void> {
        const tmuxName = this.getTmuxName(projectId);
        if (!tmuxName) {
            throw new Error('No active session to open');
        }
        const script = `tell application "Terminal" to do script "tmux attach -t ${tmuxName}"`;
        await execFileAsync('osascript', ['-e', script]);
    }

    async killSession(projectId: string): Promise<void> {
        const entry = this.sessions.get(projectId);
        if (!entry) {
            return;
        }

        this.stopPolling(entry);
        this.stopStreaming(entry);
        this.sessions.delete(projectId);
        this.removePersistedSession(projectId);

        try {
            const configDir = this.getConfigDir();
            await this.runAo(['session', 'kill', entry.sessionId], configDir);
        } catch (err) {
            log.warn('Failed to kill session (may already be dead)', {err});
        }
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

    getSessionStatus(projectId: string, webContents?: WebContents): {sessionId: string | null; hasRepoPath: boolean; repoPath: string | null} {
        const entry = this.sessions.get(projectId);
        const persisted = this.loadPersistedSessions()[projectId];
        const sessionId = entry?.sessionId ?? persisted?.sessionId ?? null;
        const repoPath = this.getRepoPath(projectId);

        // Restart polling if there's a persisted session but no active polling
        if (!entry && persisted && webContents && !webContents.isDestroyed()) {
            const restoredEntry: SessionEntry = {
                sessionId: persisted.sessionId,
                tmuxName: persisted.tmuxName,
                projectId,
                pollInterval: null,
                pipeStream: null,
                pipePath: null,
                lastOutput: '',
                webContentsId: webContents.id,
            };
            this.sessions.set(projectId, restoredEntry);
            this.startStreaming(restoredEntry, webContents);
        }

        return {
            sessionId,
            hasRepoPath: Boolean(repoPath),
            repoPath,
        };
    }
}

const aoManager = new AoManager();
export default aoManager;
