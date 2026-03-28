// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import { tool } from 'ai';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';

import type { PluginClient } from './plugin-client';
import { safe, createIssueTools, createContextTools } from './shared-tools';

const REPO_PATH = process.env.REPO_PATH || process.cwd();

const IGNORED_PATTERNS = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/release/**',
    '**/*.png',
    '**/*.jpg',
    '**/*.jpeg',
    '**/*.gif',
    '**/*.ico',
    '**/*.woff',
    '**/*.woff2',
    '**/*.ttf',
    '**/*.eot',
    '**/*.mp3',
    '**/*.mp4',
    '**/*.zip',
    '**/*.tar.gz',
    '**/*.exe',
    '**/*.dll',
    '**/*.so',
    '**/*.dylib',
];

const MAX_FILE_SIZE = 100 * 1024; // 100KB

function safePath(requested: string): string | null {
    const resolved = path.resolve(REPO_PATH, requested);
    if (!resolved.startsWith(REPO_PATH + path.sep) && resolved !== REPO_PATH) {
        return null;
    }
    return resolved;
}

function detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
        '.ts': 'typescript', '.tsx': 'typescript',
        '.js': 'javascript', '.jsx': 'javascript',
        '.go': 'go',
        '.py': 'python',
        '.rs': 'rust',
        '.java': 'java',
        '.css': 'css', '.scss': 'scss',
        '.html': 'html',
        '.json': 'json',
        '.yaml': 'yaml', '.yml': 'yaml',
        '.md': 'markdown',
        '.sql': 'sql',
        '.sh': 'bash',
        '.toml': 'toml',
        '.xml': 'xml',
    };
    return map[ext] || 'text';
}

function createFileTools() {
    return {
        search_files: tool({
            description: 'Search for files by glob pattern (e.g. "**/*.go", "**/plugin.go"). Returns file paths relative to the repo root. Max 50 results.',
            parameters: z.object({
                pattern: z.string().describe('Glob pattern to match files'),
            }),
            execute: safe(async ({ pattern }) => {
                const files = await fg(pattern, {
                    cwd: REPO_PATH,
                    ignore: IGNORED_PATTERNS,
                    onlyFiles: true,
                    dot: false,
                });
                const limited = files.slice(0, 50);
                return { files: limited, total: files.length, truncated: files.length > 50 };
            }),
        }),

        read_file: tool({
            description: 'Read the contents of a file. Returns file content with line numbers. Optionally specify a line range. Max 500 lines per read.',
            parameters: z.object({
                file_path: z.string().describe('File path relative to repo root'),
                start_line: z.number().optional().describe('Start line (1-based, inclusive)'),
                end_line: z.number().optional().describe('End line (1-based, inclusive)'),
            }),
            execute: safe(async ({ file_path, start_line, end_line }) => {
                const resolved = safePath(file_path);
                if (!resolved) {
                    return { error: 'Path traversal not allowed' };
                }

                const stat = fs.statSync(resolved);
                if (stat.size > MAX_FILE_SIZE) {
                    return { error: `File too large (${Math.round(stat.size / 1024)}KB). Max 100KB.` };
                }

                const raw = fs.readFileSync(resolved, 'utf-8');
                const allLines = raw.split('\n');

                const start = Math.max(1, start_line || 1);
                const end = Math.min(allLines.length, end_line || start + 499);
                const lines = allLines.slice(start - 1, end);

                const numbered = lines.map((line, i) => `${start + i}: ${line}`).join('\n');
                return {
                    file: file_path,
                    language: detectLanguage(file_path),
                    start_line: start,
                    end_line: end,
                    total_lines: allLines.length,
                    content: numbered,
                };
            }),
        }),

        list_directory: tool({
            description: 'List files and subdirectories in a directory (one level deep).',
            parameters: z.object({
                dir_path: z.string().describe('Directory path relative to repo root. Use "." for root.'),
            }),
            execute: safe(async ({ dir_path }) => {
                const resolved = safePath(dir_path);
                if (!resolved) {
                    return { error: 'Path traversal not allowed' };
                }

                const entries = fs.readdirSync(resolved, { withFileTypes: true });
                const result = entries
                    .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist' && e.name !== 'release')
                    .map((e) => ({
                        name: e.name,
                        type: e.isDirectory() ? 'dir' : 'file',
                    }))
                    .sort((a, b) => {
                        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
                        return a.name.localeCompare(b.name);
                    });

                return { path: dir_path, entries: result };
            }),
        }),
    };
}

function createCompanyTools(client: PluginClient) {
    return {
        get_company_info: tool({
            description: 'Get company information: name, mission, description, team members, repository details, and current state.',
            parameters: z.object({}),
            execute: safe(async () => {
                return client.getCompanyInfo();
            }),
        }),

        update_company_info: tool({
            description: 'Update company information. Pass only the fields you want to change.',
            parameters: z.object({
                company: z.object({
                    name: z.string().optional(),
                    mission: z.string().optional(),
                    description: z.string().optional(),
                    team_members: z.array(z.string()).optional(),
                }).optional().describe('Company details to update'),
                repository: z.object({
                    url: z.string().optional(),
                    description: z.string().optional(),
                    tech_stack: z.array(z.string()).optional(),
                    main_branch: z.string().optional(),
                }).optional().describe('Repository details to update'),
                current_state: z.object({
                    summary: z.string().optional(),
                    phase: z.string().optional(),
                }).optional().describe('Current state to update'),
            }),
            execute: safe(async (args) => {
                return client.updateCompanyInfo(args);
            }),
        }),
    };
}

export function createOliTools(client: PluginClient) {
    return {
        ...createFileTools(),
        ...createCompanyTools(client),
        ...createIssueTools(client),
        ...createContextTools(client),
    };
}
