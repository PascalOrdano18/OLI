// Copyright (c) 2016-present OLI, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {test, expect} from '../../fixtures/index';
import {demoOLIConfig} from '../../helpers/config';
import {loginToOLI} from '../../helpers/login';

test.describe('copylink', () => {
    test.use({appConfig: demoOLIConfig});
    test.skip(!process.env.MM_TEST_SERVER_URL, 'MM_TEST_SERVER_URL required');

    test('MM-T1308 Check that external links dont open in the app', {tag: ['@P2', '@all']}, async ({electronApp, serverMap}) => {
        const firstServer = serverMap[demoOLIConfig.servers[0].name]?.[0]?.win;
        if (!firstServer) {
            throw new Error('No server view available');
        }

        await loginToOLI(firstServer);
        await firstServer.waitForSelector('#post_textbox');
        await firstServer.click('#post_textbox');
        await firstServer.fill('#post_textbox', 'https://electronjs.org/apps/mattermost');
        await firstServer.press('#post_textbox', 'Enter');

        // Use waitForEvent with a short timeout to reliably detect any window that might open.
        // Expect the wait to time out (i.e. no new window opens for external links).
        let externalWindowOpened = false;
        try {
            await electronApp.waitForEvent('window', {
                predicate: (w) => w.url().includes('apps/mattermost'),
                timeout: 2000,
            });
            externalWindowOpened = true;
        } catch {
            // Expected: timeout means no window opened
        }
        expect(externalWindowOpened).toBe(false);
    });
});
