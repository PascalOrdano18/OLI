// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createHash} from 'crypto';
import {execFile, spawn} from 'child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {join, resolve} from 'path';
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
            `    sessionPrefix: ${sessionPrefix}`,
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

    private startPolling(entry: SessionEntry, webContents: WebContents): void {
        entry.pollInterval = setInterval(async () => {
            if (webContents.isDestroyed()) {
                this.stopPolling(entry);
                return;
            }

            const output = await this.captureTmux(entry.tmuxName);
            if (output && output !== entry.lastOutput) {
                entry.lastOutput = output;
                webContents.send(AO_OUTPUT_UPDATE, {screen: output});
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
            lastOutput: baseline,
            webContentsId: webContents.id,
        };

        this.sessions.set(projectId, entry);
        this.persistSession(projectId, sessionId, tmuxName);
        this.startPolling(entry, webContents);

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
        this.sessions.delete(projectId);
        this.removePersistedSession(projectId);

        try {
            const configDir = this.getConfigDir();
            await this.runAo(['session', 'kill', entry.sessionId], configDir);
        } catch (err) {
            log.warn('Failed to kill session (may already be dead)', {err});
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
                lastOutput: '',
                webContentsId: webContents.id,
            };
            this.sessions.set(projectId, restoredEntry);
            this.startPolling(restoredEntry, webContents);
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
