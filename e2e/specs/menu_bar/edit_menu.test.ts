// Copyright (c) 2016-present OLI, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {test, expect} from '../../fixtures/index';
import {waitForAppReady} from '../../helpers/appReadiness';
import {appDir, demoOLIConfig, electronBinaryPath, writeConfigFile} from '../../helpers/config';
import {waitForWindow, closeElectronApp} from '../../helpers/electronApp';
import {loginToOLI} from '../../helpers/login';
import {buildServerMap} from '../../helpers/serverMap';
import type {ServerView} from '../../helpers/serverView';

type ElectronApplication = Awaited<ReturnType<typeof import('playwright')['_electron']['launch']>>;
type ElectronPage = import('playwright').Page;

let electronApp: ElectronApplication;
let mainWindow: ElectronPage;
let firstServer: ServerView;
let firstServerId: number;
let userDataDir: string;

async function focusPostTextbox(server: ServerView) {
    const textbox = await server.waitForSelector('#post_textbox', {timeout: 15_000});
    await textbox.focus();
}

async function focusEditor() {
    await mainWindow.bringToFront().catch(() => {});
    await focusPostTextbox(firstServer);
}

async function movePostTextboxCursorToEnd(server: ServerView) {
    await focusPostTextbox(server);
    await server.evaluate(() => {
        const element = document.querySelector('#post_textbox');
        if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
            throw new Error('#post_textbox is not a text input');
        }

        const cursor = element.value.length;
        element.setSelectionRange(cursor, cursor);
    });
}

async function typeInPostTextbox(server: ServerView, text: string) {
    await focusPostTextbox(server);
    for (const character of text) {
        await server.keyboard.type(character);
    }
}

async function clickEditMenuItem(role: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') {
    await focusEditor();

    await electronApp.evaluate(({webContents}, payload) => {
        const wc = webContents.fromId(payload.id);
        if (!wc || wc.isDestroyed()) {
            throw new Error(`webContents ${payload.id} is not available`);
        }

        wc.focus();
        const action = payload.role as 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';
        wc[action]();
    }, {id: firstServerId, role});
}

async function getSelectedText(server: ServerView) {
    return server.evaluate(() => {
        const element = document.querySelector('#post_textbox');
        if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
            throw new Error('#post_textbox is not a text input');
        }

        const selectionStart = element.selectionStart ?? 0;
        const selectionEnd = element.selectionEnd ?? 0;
        return element.value.slice(selectionStart, selectionEnd);
    });
}

test.describe('edit_menu', () => {
    test.describe.configure({mode: 'serial'});
    test.skip(!process.env.MM_TEST_SERVER_URL, 'MM_TEST_SERVER_URL required');

    test.beforeAll(async () => {
        userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-edit-menu-e2e-'));
        writeConfigFile(userDataDir, demoOLIConfig);

        const {_electron: electron} = await import('playwright');
        electronApp = await electron.launch({
            executablePath: electronBinaryPath,
            args: [
                appDir,
                `--user-data-dir=${userDataDir}`,
                '--no-sandbox',
                '--disable-gpu',
                '--disable-gpu-sandbox',
                '--disable-dev-shm-usage',
                '--no-zygote',
                '--disable-software-rasterizer',
                '--disable-breakpad',
                '--disable-features=SpareRendererForSitePerProcess',
                '--disable-features=CrossOriginOpenerPolicy',
                '--disable-renderer-backgrounding',
                '--force-color-profile=srgb',
                '--mute-audio',
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                RESOURCES_PATH: appDir,
                ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
                ELECTRON_NO_ATTACH_CONSOLE: 'true',
                NODE_OPTIONS: '--no-warnings',
            },
            timeout: 90_000,
        });

        await waitForAppReady(electronApp);
        mainWindow = await waitForWindow(electronApp, 'index');
        const serverMap = await buildServerMap(electronApp);
        firstServer = serverMap[demoOLIConfig.servers[0].name][0].win;
        firstServerId = serverMap[demoOLIConfig.servers[0].name][0].webContentsId;
        await loginToOLI(firstServer);
        await mainWindow.waitForSelector('.ServerDropdownButton', {timeout: 30_000});
    });

    test.beforeEach(async () => {
        await mainWindow.bringToFront().catch(() => {});
        await focusPostTextbox(firstServer);
        await firstServer.fill('#post_textbox', '');
    });

    test.afterAll(async () => {
        await closeElectronApp(electronApp, userDataDir);
    });

    test('MM-T807 Undo in the post textbox', {tag: ['@P2', '@all']}, async () => {
        await typeInPostTextbox(firstServer, 'OLI');
        await clickEditMenuItem('undo');
        const content = await firstServer.inputValue('#post_textbox');
        expect(content).toBe('Mattermos');
    });

    test('MM-T808 Redo in the post textbox', {tag: ['@P2', '@all']}, async () => {
        await typeInPostTextbox(firstServer, 'OLI');
        await clickEditMenuItem('undo');
        const textAfterUndo = await firstServer.inputValue('#post_textbox');
        expect(textAfterUndo).toBe('Mattermos');
        await clickEditMenuItem('redo');
        const content = await firstServer.inputValue('#post_textbox');
        expect(content).toBe('OLI');
    });

    test('MM-T809 Cut in the post textbox', {tag: ['@P2', '@all']}, async () => {
        await typeInPostTextbox(firstServer, 'OLI');
        await clickEditMenuItem('selectAll');
        await clickEditMenuItem('cut');
        const content = await firstServer.inputValue('#post_textbox');
        expect(content).toBe('');
    });

    test('MM-T810 Copy in the post textbox', {tag: ['@P2', '@all']}, async () => {
        await typeInPostTextbox(firstServer, 'OLI');
        await clickEditMenuItem('selectAll');
        await clickEditMenuItem('copy');
        await movePostTextboxCursorToEnd(firstServer);
        await clickEditMenuItem('paste');
        const content = await firstServer.inputValue('#post_textbox');
        expect(content).toBe('OLIOLI');
    });

    test('MM-T811 Paste in the post textbox', {tag: ['@P2', '@all']}, async () => {
        await typeInPostTextbox(firstServer, 'OLI');
        await clickEditMenuItem('selectAll');
        await clickEditMenuItem('copy');
        await clickEditMenuItem('selectAll');
        await clickEditMenuItem('paste');
        const content = await firstServer.inputValue('#post_textbox');
        expect(content).toBe('OLI');
    });

    test('MM-T812 Select All in the post textbox', {tag: ['@P2', '@all']}, async () => {
        await firstServer.fill('#post_textbox', 'OLI');
        await clickEditMenuItem('selectAll');
        const channelHeaderText = await getSelectedText(firstServer);
        expect(channelHeaderText).toBe('OLI');
    });
});
