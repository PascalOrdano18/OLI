// Copyright (c) 2016-present OLI, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {type BrowserWindow, WebContentsView, app, ipcMain} from 'electron';
import type {WebContentsViewConstructorOptions, Event} from 'electron/main';
import type {Options} from 'electron-context-menu';
import {EventEmitter} from 'events';
import path from 'path';
import semver from 'semver';
import {pathToFileURL} from 'url';

import NavigationManager from 'app/navigationManager';
import AppState from 'common/appState';
import {
    LOAD_RETRY,
    LOAD_SUCCESS,
    LOAD_FAILED,
    UPDATE_TARGET_URL,
    LOADSCREEN_END,
    BROWSER_HISTORY_STATUS_UPDATED,
    CLOSE_SERVERS_DROPDOWN,
    CLOSE_DOWNLOADS_DROPDOWN,
    LOAD_INCOMPATIBLE_SERVER,
    SERVER_URL_CHANGED,
    BROWSER_HISTORY_PUSH,
    RELOAD_VIEW,
} from 'common/communication';
import type {Logger} from 'common/log';
import ServerManager from 'common/servers/serverManager';
import {RELOAD_INTERVAL, MAX_SERVER_RETRIES, SECOND, MAX_LOADING_SCREEN_SECONDS} from 'common/utils/constants';
import {isInternalURL, parseURL} from 'common/utils/url';
import {type OLIView} from 'common/views/OLIView';
import ViewManager from 'common/views/viewManager';
import {updateServerInfos} from 'main/app/utils';
import DeveloperMode from 'main/developerMode';
import {localizeMessage} from 'main/i18nManager';
import performanceMonitor from 'main/performanceMonitor';
import {getServerAPI} from 'main/server/serverAPI';

import WebContentsEventManager from './webContentEvents';

import ContextMenu from '../../main/contextMenu';
import {getWindowBoundaries, getLocalPreload, composeUserAgent} from '../../main/utils';

enum Status {
    LOADING,
    READY,
    WAITING_MM,
    ERROR = -1,
}

const buildDesktopSidebarThemeOverrideScript = () => {
    const openSansRegular = pathToFileURL(path.join(app.getAppPath(), 'dist', 'assets', 'fonts', 'open-sans-v13-latin-ext_latin_cyrillic-ext_greek-ext_greek_cyrillic_vietnamese-regular.woff2')).href;
    const openSansSemiBold = pathToFileURL(path.join(app.getAppPath(), 'dist', 'assets', 'fonts', 'open-sans-v13-latin-ext_latin_cyrillic-ext_greek-ext_greek_cyrillic_vietnamese-600.woff2')).href;

    return `
(() => {
    const themeVars = {
        '--sidebar-bg': '#ffffff',
        '--sidebar-header-bg': '#ffffff',
        '--sidebar-team-bar-bg': '#f6f8fa',
        '--sidebar-text-hover-bg': '#f6f8fa',
        '--sidebar-text-active-border': '#d1d9e0',
        '--sidebar-text-active-color': '#000000',
        '--sidebar-text': '#000000',
        '--sidebar-unread-text': '#000000',
        '--sidebar-header-text-color': '#000000',
    };

    const sidebarSurfaceColors = new Map([
        ['rgb(30, 50, 92)', '#ffffff'],
        ['rgb(25, 42, 77)', '#ffffff'],
        ['rgb(22, 37, 69)', '#f6f8fa'],
        ['rgb(40, 66, 123)', '#f6f8fa'],
    ]);

    const sidebarStyle = \`
        @font-face {
            font-family: 'Open Sans';
            font-style: normal;
            font-weight: 400;
            src: url('${openSansRegular}') format('woff2');
        }

        @font-face {
            font-family: 'Open Sans';
            font-style: normal;
            font-weight: 600;
            src: url('${openSansSemiBold}') format('woff2');
        }

        html,
        body,
        input,
        textarea,
        select,
        button {
            font-family: 'Open Sans', sans-serif !important;
        }

        #SidebarContainer,
        .SidebarContainer,
        .sidebar-left,
        [class*="sidebar-left"] {
            background: #ffffff !important;
            color: #000000 !important;
            font-family: 'Open Sans', sans-serif !important;
            border-right: 1px solid rgba(31, 35, 40, 0.12) !important;
            box-sizing: border-box !important;
        }

        #SidebarContainer *,
        .SidebarContainer *,
        .sidebar-left *,
        [class*="sidebar-left"] * {
            color: #000000 !important;
            font-family: 'Open Sans', sans-serif !important;
            opacity: 1 !important;
            text-shadow: none !important;
        }

        #SidebarContainer svg,
        #SidebarContainer svg path,
        .SidebarContainer svg,
        .SidebarContainer svg path,
        .sidebar-left svg,
        .sidebar-left svg path,
        [class*="sidebar-left"] svg,
        [class*="sidebar-left"] svg path {
            fill: currentColor !important;
        }

        #SidebarContainer input,
        .SidebarContainer input,
        .sidebar-left input,
        [class*="sidebar-left"] input {
            color: #000000 !important;
            caret-color: #000000 !important;
        }

        #SidebarContainer input::placeholder,
        .SidebarContainer input::placeholder,
        .sidebar-left input::placeholder,
        [class*="sidebar-left"] input::placeholder {
            color: rgba(0, 0, 0, 0.6) !important;
        }

        #SidebarContainer button,
        .SidebarContainer button,
        .sidebar-left button,
        [class*="sidebar-left"] button {
            color: #000000 !important;
        }

        #SidebarContainer [class*="SidebarChannelGroupHeader"],
        #SidebarContainer [class*="SidebarSectionTitle"],
        #SidebarContainer [class*="SidebarCategory"],
        #SidebarContainer [class*="SidebarGroupLabel"],
        .SidebarContainer [class*="SidebarChannelGroupHeader"],
        .SidebarContainer [class*="SidebarSectionTitle"],
        .SidebarContainer [class*="SidebarCategory"],
        .SidebarContainer [class*="SidebarGroupLabel"],
        .sidebar-left [class*="SidebarChannelGroupHeader"],
        .sidebar-left [class*="SidebarSectionTitle"],
        .sidebar-left [class*="SidebarCategory"],
        .sidebar-left [class*="SidebarGroupLabel"],
        [class*="sidebar-left"] [class*="SidebarChannelGroupHeader"],
        [class*="sidebar-left"] [class*="SidebarSectionTitle"],
        [class*="sidebar-left"] [class*="SidebarCategory"],
        [class*="sidebar-left"] [class*="SidebarGroupLabel"] {
            font-size: 11px !important;
            font-weight: 700 !important;
            text-transform: uppercase !important;
            letter-spacing: 0.6px !important;
            color: rgba(31, 35, 40, 0.56) !important;
            opacity: 1 !important;
        }

        #SidebarContainer [class*="SidebarLinkLabel"],
        #SidebarContainer [class*="SidebarItem"] a,
        #SidebarContainer [class*="SidebarItem"] span,
        #SidebarContainer [class*="SidebarChannel"] a,
        #SidebarContainer [class*="SidebarChannel"] span,
        .SidebarContainer [class*="SidebarLinkLabel"],
        .SidebarContainer [class*="SidebarItem"] a,
        .SidebarContainer [class*="SidebarItem"] span,
        .SidebarContainer [class*="SidebarChannel"] a,
        .SidebarContainer [class*="SidebarChannel"] span,
        .sidebar-left a,
        .sidebar-left button,
        [class*="sidebar-left"] a,
        [class*="sidebar-left"] button {
            font-size: 13px !important;
            font-weight: 400 !important;
            letter-spacing: -0.1px !important;
        }

        #SidebarContainer [class*="SidebarHeader"] a,
        #SidebarContainer [class*="SidebarHeader"] span,
        #SidebarContainer [class*="SidebarHeader"] button,
        .SidebarContainer [class*="SidebarHeader"] a,
        .SidebarContainer [class*="SidebarHeader"] span,
        .SidebarContainer [class*="SidebarHeader"] button,
        .sidebar-left [class*="SidebarHeader"] a,
        .sidebar-left [class*="SidebarHeader"] span,
        .sidebar-left [class*="SidebarHeader"] button,
        [class*="sidebar-left"] [class*="SidebarHeader"] a,
        [class*="sidebar-left"] [class*="SidebarHeader"] span,
        [class*="sidebar-left"] [class*="SidebarHeader"] button {
            font-size: 13px !important;
            font-weight: 600 !important;
            letter-spacing: -0.1px !important;
        }

        #SidebarContainer [aria-current="page"],
        .SidebarContainer [aria-current="page"],
        .sidebar-left [aria-current="page"],
        [class*="sidebar-left"] [aria-current="page"] {
            background: #f6f8fa !important;
            border-radius: 4px !important;
        }

        #SidebarContainer [aria-current="page"] *,
        .SidebarContainer [aria-current="page"] *,
        .sidebar-left [aria-current="page"] *,
        [class*="sidebar-left"] [aria-current="page"] * {
            font-weight: 600 !important;
        }
    \`;

    const headerStyle = \`
        header,
        .global-header,
        [class*="global-header"],
        .channel-header,
        [class*="channel-header"],
        .top-bar,
        [class*="top-bar"] {
            background: #ffffff !important;
            color: #000000 !important;
            font-family: 'Open Sans', sans-serif !important;
            border-bottom: 1px solid rgba(31, 35, 40, 0.12) !important;
            box-shadow: none !important;
            box-sizing: border-box !important;
        }

        header *,
        .global-header *,
        [class*="global-header"] *,
        .channel-header *,
        [class*="channel-header"] *,
        .top-bar *,
        [class*="top-bar"] * {
            color: #000000 !important;
            font-family: 'Open Sans', sans-serif !important;
            border-bottom: none !important;
            box-shadow: none !important;
            text-shadow: none !important;
        }

        header::after,
        .global-header::after,
        [class*="global-header"]::after,
        .channel-header::after,
        [class*="channel-header"]::after,
        .top-bar::after,
        [class*="top-bar"]::after {
            display: none !important;
        }

        header svg,
        header svg path,
        .global-header svg,
        .global-header svg path,
        [class*="global-header"] svg,
        [class*="global-header"] svg path,
        .channel-header svg,
        .channel-header svg path,
        [class*="channel-header"] svg,
        [class*="channel-header"] svg path,
        .top-bar svg,
        .top-bar svg path,
        [class*="top-bar"] svg,
        [class*="top-bar"] svg path {
            fill: currentColor !important;
        }

        .channel-header h1,
        .channel-header h2,
        .channel-header h3,
        [class*="channel-header"] h1,
        [class*="channel-header"] h2,
        [class*="channel-header"] h3,
        [class*="channel-header__title"],
        [class*="channelHeaderTitle"],
        [class*="TitleWrapper"] {
            font-size: 13px !important;
            font-weight: 600 !important;
            letter-spacing: -0.1px !important;
        }

        .channel-header strong,
        .channel-header b,
        [class*="channel-header"] strong,
        [class*="channel-header"] b,
        #SidebarContainer strong,
        #SidebarContainer b,
        .SidebarContainer strong,
        .SidebarContainer b {
            font-weight: 600 !important;
        }
    \`;

    const hideOLIBranding = () => {
        // Inject OLI logo into the header, replacing Mattermost branding
        const headerRoots = Array.from(document.querySelectorAll('header, .global-header, [class*="global-header"], .top-bar, [class*="top-bar"]'));
        const brandedLabels = new Set(['mattermost', 'team edition', 'free edition', 'mattermost free edition']);

        for (const root of headerRoots) {
            // Find and replace the product switcher / logo area
            for (const element of root.querySelectorAll('a, button, div, span')) {
                const label = element.textContent?.trim().toLowerCase();
                if (!label || !brandedLabels.has(label)) {
                    continue;
                }

                const hideTarget = element.closest('a, button') || element.parentElement || element;
                if (hideTarget instanceof HTMLElement) {
                    hideTarget.style.setProperty('display', 'none', 'important');
                }
            }

            // Hide the compass SVG logo and inject OLI logo
            if (!root.querySelector('#oli-header-logo')) {
                const logoSvgs = root.querySelectorAll('svg');
                for (const svg of logoSvgs) {
                    const parent = svg.parentElement;
                    if (!parent) continue;
                    const parentText = parent.textContent?.trim().toLowerCase() || '';
                    // Target the product logo SVG (usually the first SVG in header, near "Mattermost" text)
                    if (parentText === '' || parentText.includes('mattermost') || parentText.includes('free edition')) {
                        parent.style.setProperty('display', 'none', 'important');
                    }
                }

                // Insert OLI branding as the first child of the header
                const oliBrand = document.createElement('div');
                oliBrand.id = 'oli-header-logo';
                oliBrand.style.cssText = 'display:flex;align-items:center;gap:8px;padding:0 12px;height:100%;flex-shrink:0;';
                oliBrand.innerHTML = '<svg width="24" height="24" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><rect width="64" height="64" rx="12" fill="#000"/><circle cx="32" cy="32" r="20" fill="#fff"/></svg><span style="font-weight:700;font-size:15px;color:#000;letter-spacing:-0.3px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">OLI</span>';
                root.prepend(oliBrand);
            }
        }

        for (const element of document.querySelectorAll('[aria-label*="Mattermost"], [title*="Mattermost"]')) {
            if (element instanceof HTMLElement && element.id !== 'oli-header-logo') {
                if (element.getAttribute('aria-label')) {
                    element.setAttribute('aria-label', element.getAttribute('aria-label').replace(/Mattermost/g, 'OLI'));
                }
                if (element.getAttribute('title')) {
                    element.setAttribute('title', element.getAttribute('title').replace(/Mattermost/g, 'OLI'));
                }
            }
        }

        // Replace "Mattermost" text with "OLI" in remaining visible elements
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) {
            if (node.nodeValue && node.nodeValue.includes('Mattermost')) {
                node.nodeValue = node.nodeValue.replace(/Mattermost/g, 'OLI');
            }
        }

        // Replace System user profile pictures (Mattermost compass icon) with OLI logo
        const oliLogoDataUri = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><rect width="64" height="64" rx="12" fill="#000"/><circle cx="32" cy="32" r="20" fill="#fff"/></svg>');
        const avatarImages = document.querySelectorAll('img.Avatar, img[class*="Avatar"], img[class*="avatar"], img[class*="profile"]');
        for (const img of avatarImages) {
            if (img instanceof HTMLImageElement && img.src && img.src.includes('/api/v4/users/') && img.src.includes('/image')) {
                // Check if this is the system bot avatar by looking at nearby username text
                const post = img.closest('[class*="post"], [class*="Post"], [class*="message"]');
                if (post) {
                    const username = post.querySelector('[class*="username"], [class*="user-popover"], [class*="UserProfile"]');
                    const nameText = username?.textContent?.trim().toLowerCase() || '';
                    if (nameText === 'system') {
                        img.src = oliLogoDataUri;
                    }
                }
            }
        }
    };

    const applyTheme = () => {
        const targets = [document.documentElement, document.body].filter(Boolean);
        for (const target of targets) {
            for (const [name, value] of Object.entries(themeVars)) {
                target.style.setProperty(name, value, 'important');
            }
        }

        let styleEl = document.getElementById('desktop-sidebar-theme-override');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'desktop-sidebar-theme-override';
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = sidebarStyle + headerStyle;

        const wrapper = document.querySelector('.main-wrapper');
        if (wrapper) {
            wrapper.style.setProperty('background-color', '#ffffff', 'important');
            wrapper.style.setProperty('background-image', 'none', 'important');

            for (const el of wrapper.querySelectorAll('*')) {
                const bg = getComputedStyle(el).backgroundColor;
                const replacement = sidebarSurfaceColors.get(bg);
                if (replacement) {
                    el.style.setProperty('background-color', replacement, 'important');
                    el.style.setProperty('background-image', 'none', 'important');
                }
            }
        }

        hideOLIBranding();
    };

    applyTheme();
    window.addEventListener('load', applyTheme, {once: true});
    setTimeout(applyTheme, 50);
    setTimeout(applyTheme, 250);
    setTimeout(applyTheme, 1000);
    setTimeout(applyTheme, 3000);
    setTimeout(applyTheme, 5000);

    if (!window.__desktopSidebarThemeObserver) {
        let debounceTimer;
        const debouncedApply = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(applyTheme, 100);
        };
        const observer = new MutationObserver(() => debouncedApply());
        observer.observe(document.documentElement, {attributes: true, attributeFilter: ['style', 'class'], childList: true, subtree: true});
        if (document.body) {
            observer.observe(document.body, {attributes: true, attributeFilter: ['style', 'class'], childList: true, subtree: true});
        }
        window.__desktopSidebarThemeObserver = observer;
    }
})();
`;
};

export class OLIWebContentsView extends EventEmitter {
    private view: OLIView;
    private parentWindow: BrowserWindow;

    private log: Logger;
    private webContentsView: WebContentsView;
    private atRoot: boolean;
    private options: WebContentsViewConstructorOptions;
    private removeLoading?: NodeJS.Timeout;
    private contextMenu?: ContextMenu;
    private status?: Status;
    private retryLoad?: NodeJS.Timeout;
    private maxRetries: number;
    private altPressStatus: boolean;
    private lastPath?: string;

    constructor(view: OLIView, options: WebContentsViewConstructorOptions, parentWindow: BrowserWindow) {
        super();
        this.view = view;
        this.parentWindow = parentWindow;

        const preload = getLocalPreload('externalAPI.js');
        this.options = Object.assign({}, options);
        this.options.webPreferences = {
            preload: DeveloperMode.get('browserOnly') ? undefined : preload,
            additionalArguments: [
                `version=${app.getVersion()}`,
                `appName=${app.name}`,
            ],
            ...options.webPreferences,
        };
        this.atRoot = true;
        this.webContentsView = new WebContentsView(this.options);
        this.resetLoadingStatus();

        this.log = ViewManager.getViewLog(this.id, 'OLIWebContentsView');
        this.log.verbose('View created', this.id, this.view.title);

        this.webContentsView.webContents.on('update-target-url', this.handleUpdateTarget);
        this.webContentsView.webContents.on('input-event', (_, inputEvent) => {
            if (inputEvent.type === 'mouseDown') {
                ipcMain.emit(CLOSE_SERVERS_DROPDOWN);
                ipcMain.emit(CLOSE_DOWNLOADS_DROPDOWN);
            }
        });
        this.webContentsView.webContents.on('did-navigate-in-page', () => this.handlePageTitleUpdated(this.webContentsView.webContents.getTitle()));
        this.webContentsView.webContents.on('page-title-updated', (_, newTitle) => this.handlePageTitleUpdated(newTitle));
        this.webContentsView.webContents.on('did-navigate', (_event, url) => this.handleDidNavigate(url));
        this.webContentsView.webContents.on('did-finish-load', () => {
            const url = this.webContentsView.webContents.getURL();
            if (url.includes('/login')) {
                this.injectCustomLoginUI();
            }
        });

        if (!DeveloperMode.get('disableContextMenu')) {
            this.contextMenu = new ContextMenu(this.generateContextMenu(), this.webContentsView.webContents);
        }
        this.maxRetries = MAX_SERVER_RETRIES;

        this.altPressStatus = false;

        this.parentWindow.on('blur', this.handleAltBlur);

        ServerManager.on(SERVER_URL_CHANGED, this.handleServerWasModified);
    }

    get id() {
        return this.view.id;
    }
    get serverId() {
        return this.view.serverId;
    }
    get parentViewId() {
        return this.view.parentViewId;
    }
    get isAtRoot() {
        return this.atRoot;
    }
    get currentURL() {
        return parseURL(this.webContentsView.webContents.getURL());
    }
    get webContentsId() {
        return this.webContentsView.webContents.id;
    }

    private handleDidNavigate = (url: string) => {
        if (url.includes('/login')) {
            this.injectCustomLoginUI();
        }
    };

    private injectCustomLoginUI = () => {
        const server = ServerManager.getServer(this.view.serverId);
        const serverName = server?.name || 'your organization';
        const HARDCODED_PASSWORD = 'OliUser123!';

        const script = `
(() => {
    if (document.getElementById('oli-custom-login')) return;

    const rootEl = document.getElementById('root');
    if (rootEl) rootEl.style.display = 'none';

    const overlay = document.createElement('div');
    overlay.id = 'oli-custom-login';
    overlay.innerHTML = \`
        <style>
            html, body {
                background: #0f1117 !important;
                margin: 0;
                padding: 0;
            }
            #oli-custom-login {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                background: #0f1117;
                background-image: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(74,124,232,0.08) 0%, transparent 70%);
                font-family: 'Open Sans', -apple-system, BlinkMacSystemFont, sans-serif;
                gap: 20px;
                padding: 24px;
                overflow: hidden;
            }
            #oli-custom-login::before {
                content: '';
                position: absolute;
                inset: 0;
                background-image:
                    linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
                background-size: 48px 48px;
                pointer-events: none;
            }
            #oli-custom-login > * { position: relative; z-index: 1; }
            #oli-custom-login .oli-logo {
                width: 64px;
                height: 64px;
                border-radius: 16px;
                background: linear-gradient(135deg, #4a7ce8 0%, #6c5ce7 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                margin-bottom: 4px;
                box-shadow: 0 8px 32px rgba(74,124,232,0.3), 0 0 0 1px rgba(74,124,232,0.1);
            }
            #oli-custom-login .oli-logo span {
                font-size: 28px;
                font-weight: 800;
                color: #fff;
                letter-spacing: -1px;
            }
            #oli-custom-login h1 {
                font-size: 28px;
                font-weight: 700;
                color: #f0f0f3;
                margin: 0;
                letter-spacing: -0.5px;
            }
            #oli-custom-login .oli-subtitle {
                font-size: 15px;
                color: rgba(240,240,243,0.5);
                margin: 0 0 4px;
                text-align: center;
                line-height: 1.6;
            }
            #oli-custom-login .oli-org-name {
                color: #7c9ef5;
                font-weight: 600;
            }
            #oli-custom-login .oli-card {
                width: 100%;
                max-width: 400px;
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.06);
                border-radius: 16px;
                padding: 28px;
                backdrop-filter: blur(12px);
                display: flex;
                flex-direction: column;
                gap: 16px;
                box-sizing: border-box;
            }
            #oli-custom-login input {
                width: 100%;
                padding: 12px 16px;
                border-radius: 10px;
                border: 1px solid rgba(255,255,255,0.08);
                font-size: 14px;
                line-height: 20px;
                outline: none;
                background: rgba(255,255,255,0.04);
                color: #f0f0f3;
                box-sizing: border-box;
                transition: all 0.2s ease;
                font-family: inherit;
            }
            #oli-custom-login input::placeholder {
                color: rgba(240,240,243,0.3);
            }
            #oli-custom-login input:hover {
                border-color: rgba(255,255,255,0.12);
                background: rgba(255,255,255,0.05);
            }
            #oli-custom-login input:focus {
                border-color: rgba(74,124,232,0.5);
                background: rgba(255,255,255,0.05);
                box-shadow: 0 0 0 3px rgba(74,124,232,0.1);
            }
            #oli-custom-login input.input-error {
                border-color: rgba(218,108,110,0.5);
            }
            #oli-custom-login input.input-error:focus {
                box-shadow: 0 0 0 3px rgba(218,108,110,0.1);
            }
            #oli-custom-login .oli-hint {
                font-size: 13px;
                color: rgba(240,240,243,0.35);
                margin: 0;
                line-height: 1.5;
            }
            #oli-custom-login .oli-error {
                font-size: 12px;
                color: #da6c6e;
                margin: 0;
                line-height: 1.4;
            }
            #oli-custom-login .oli-global-error {
                color: #da6c6e;
                font-size: 13px;
                background: rgba(218,108,110,0.08);
                border: 1px solid rgba(218,108,110,0.12);
                padding: 12px 16px;
                border-radius: 10px;
                width: 100%;
                max-width: 400px;
                box-sizing: border-box;
                text-align: center;
            }
            #oli-custom-login button {
                width: 100%;
                margin-top: 4px;
                border-radius: 10px;
                height: 46px;
                font-size: 15px;
                cursor: pointer;
                border: 0;
                background: linear-gradient(135deg, #4a7ce8 0%, #6c5ce7 100%);
                color: #fff;
                font-weight: 600;
                font-family: inherit;
                transition: all 0.2s ease;
                box-shadow: 0 4px 16px rgba(74,124,232,0.25);
            }
            #oli-custom-login button:hover:not(:disabled) {
                box-shadow: 0 6px 24px rgba(74,124,232,0.35);
                transform: translateY(-1px);
            }
            #oli-custom-login button:active:not(:disabled) {
                transform: translateY(0);
            }
            #oli-custom-login button:disabled {
                background: rgba(255,255,255,0.04);
                color: rgba(240,240,243,0.2);
                box-shadow: none;
                cursor: not-allowed;
            }
            #oli-custom-login .oli-spinner-wrap {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 16px;
                padding: 48px 24px;
            }
            #oli-custom-login .oli-spinner {
                width: 48px;
                height: 48px;
                border: 3px solid rgba(255,255,255,0.06);
                border-top-color: #4a7ce8;
                border-radius: 50%;
                animation: oli-spin 0.8s linear infinite;
            }
            @keyframes oli-spin { to { transform: rotate(360deg); } }
        </style>
        <div class="oli-logo"><span>O</span></div>
        <h1>Welcome back</h1>
        <p class="oli-subtitle">Log in to <span class="oli-org-name">${serverName.replace(/'/g, "\\'")}</span></p>
        <div id="oli-error-banner" style="display:none" class="oli-global-error"></div>
        <div class="oli-card" id="oli-login-form">
            <input id="oli-username" type="text" placeholder="Enter username" autocomplete="off" autofocus />
            <div id="oli-validation" class="oli-hint">3-22 characters. Lowercase letters, numbers, dots, dashes, underscores.</div>
            <button id="oli-continue" disabled>Continue</button>
        </div>
        <div id="oli-spinner-view" style="display:none" class="oli-spinner-wrap">
            <div class="oli-spinner"></div>
            <h1 style="font-size:22px">Logging in...</h1>
            <p class="oli-subtitle">Almost there, hang tight.</p>
        </div>
    \`;
    document.body.appendChild(overlay);

    const input = document.getElementById('oli-username');
    const btn = document.getElementById('oli-continue');
    const validation = document.getElementById('oli-validation');
    const errorBanner = document.getElementById('oli-error-banner');
    const loginForm = document.getElementById('oli-login-form');
    const spinnerView = document.getElementById('oli-spinner-view');
    const PASS = '${HARDCODED_PASSWORD}';

    function validate(val) {
        const errors = [];
        if (val.length > 0 && val.length < 3) errors.push('Username must be at least 3 characters');
        if (val.length > 22) errors.push('Username must be at most 22 characters');
        if (val.length > 0 && !/^[a-z0-9._-]+$/.test(val)) errors.push('Only lowercase letters, numbers, dots, dashes, and underscores allowed');
        return errors;
    }

    input.addEventListener('input', () => {
        const val = input.value.toLowerCase();
        input.value = val;
        const errors = validate(val);
        const valid = val.length >= 3 && val.length <= 22 && /^[a-z0-9._-]+$/.test(val);
        btn.disabled = !valid;
        if (errors.length > 0) {
            validation.innerHTML = errors.map(e => '<p class="oli-error">' + e + '</p>').join('');
            input.classList.add('input-error');
        } else {
            validation.innerHTML = '<p class="oli-hint">3-22 characters. Lowercase letters, numbers, dots, dashes, underscores.</p>';
            input.classList.remove('input-error');
        }
        errorBanner.style.display = 'none';
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !btn.disabled) doLogin();
    });
    btn.addEventListener('click', doLogin);

    async function doLogin() {
        const username = input.value.trim();
        if (!username) return;

        loginForm.style.display = 'none';
        spinnerView.style.display = 'flex';
        errorBanner.style.display = 'none';

        const email = username + '@oli.local';

        try {
            // 1. Try to create user (ignore 409 = already exists)
            const createRes = await fetch('/api/v4/users', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ username, email, password: PASS }),
            });
            if (!createRes.ok && createRes.status !== 409) {
                let msg = 'Failed to create user';
                try { const e = await createRes.json(); if (e.message) msg = e.message; } catch {}
                throw new Error(msg);
            }

            // 2. Login
            const loginRes = await fetch('/api/v4/users/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ login_id: email, password: PASS }),
            });
            if (!loginRes.ok) {
                throw new Error('Failed to log in. Username may already be taken by another account.');
            }

            // Login sets cookies automatically (same origin), reload to enter the app
            window.location.href = '/';
        } catch (err) {
            loginForm.style.display = 'flex';
            spinnerView.style.display = 'none';
            errorBanner.textContent = err.message || 'Something went wrong';
            errorBanner.style.display = 'block';
        }
    }
})();
`;

        void this.webContentsView.webContents.executeJavaScript(script);
    };

    getWebContentsView = () => {
        return this.webContentsView;
    };

    goToOffset = (offset: number) => {
        if (this.webContentsView.webContents.navigationHistory.canGoToOffset(offset)) {
            try {
                this.webContentsView.webContents.navigationHistory.goToOffset(offset);
                this.updateHistoryButton();
            } catch (error) {
                this.log.error(error);
                this.reload();
            }
        }
    };

    getBrowserHistoryStatus = () => {
        if (this.currentURL?.toString() === this.view.getLoadingURL()?.toString()) {
            this.webContentsView.webContents.navigationHistory.clear();
            this.atRoot = true;
        } else {
            this.atRoot = false;
        }

        return {
            canGoBack: this.webContentsView.webContents.navigationHistory.canGoBack(),
            canGoForward: this.webContentsView.webContents.navigationHistory.canGoForward(),
        };
    };

    updateHistoryButton = () => {
        const {canGoBack, canGoForward} = this.getBrowserHistoryStatus();
        this.webContentsView.webContents.send(BROWSER_HISTORY_STATUS_UPDATED, canGoBack, canGoForward);
    };

    load = (someURL?: URL | string) => {
        if (!this.webContentsView) {
            return;
        }

        let loadURL: string;
        if (someURL) {
            const parsedURL = parseURL(someURL);
            if (parsedURL) {
                loadURL = parsedURL.toString();
            } else {
                this.log.error('Cannot parse provided url, using current server url');
                loadURL = this.view.getLoadingURL()?.toString() || '';
            }
        } else {
            loadURL = this.view.getLoadingURL()?.toString() || '';
        }
        this.log.verbose('Loading URL');
        performanceMonitor.registerServerView(`Server ${this.webContentsView.webContents.id}`, this.webContentsView.webContents, this.view.serverId);
        const loading = this.webContentsView.webContents.loadURL(loadURL, {userAgent: composeUserAgent(DeveloperMode.get('browserOnly'))});
        loading.then(this.loadSuccess(loadURL)).catch((err) => {
            if (err.code && err.code.startsWith('ERR_CERT')) {
                this.parentWindow.webContents.send(LOAD_FAILED, this.id, err.toString(), loadURL.toString());
                this.emit(LOAD_FAILED, this.id, err.toString(), loadURL.toString());
                this.log.info(`Invalid certificate, stop retrying until the user decides what to do: ${err}.`);
                this.status = Status.ERROR;
                return;
            }
            if (err.code && err.code.startsWith('ERR_ABORTED')) {
                // If the loading was aborted, we shouldn't be retrying
                return;
            }
            if (err.code && err.code.startsWith('ERR_BLOCKED_BY_CLIENT')) {
                // If the loading was blocked by the client, we should immediately retry
                this.load(loadURL);
                return;
            }
            this.loadRetry(loadURL, err);
        });
    };

    reload = (loadURL?: URL | string) => {
        this.resetLoadingStatus();
        AppState.updateExpired(this.serverId, false);
        this.emit(RELOAD_VIEW, this.id, loadURL);
        this.load(loadURL);
    };

    getBounds = () => {
        return this.webContentsView.getBounds();
    };

    openFind = () => {
        this.webContentsView.webContents.sendInputEvent({type: 'keyDown', keyCode: 'F', modifiers: [process.platform === 'darwin' ? 'cmd' : 'ctrl', 'shift']});
    };

    setBounds = (boundaries: Electron.Rectangle) => {
        this.webContentsView.setBounds(boundaries);
    };

    destroy = () => {
        WebContentsEventManager.removeWebContentsListeners(this.webContentsId);
        AppState.clear(this.id);
        performanceMonitor.unregisterView(this.webContentsView.webContents.id);
        if (this.parentWindow) {
            this.parentWindow.contentView.removeChildView(this.webContentsView);
        }
        if (this.contextMenu) {
            this.contextMenu.dispose();
        }
        this.webContentsView.webContents.close();

        if (this.retryLoad) {
            clearTimeout(this.retryLoad);
        }
        if (this.removeLoading) {
            clearTimeout(this.removeLoading);
        }
    };

    updateParentWindow = (window: BrowserWindow) => {
        this.parentWindow.off('blur', this.handleAltBlur);
        this.parentWindow = window;
        this.parentWindow.on('blur', this.handleAltBlur);
    };

    /**
     * Status hooks
     */

    resetLoadingStatus = () => {
        if (this.status !== Status.LOADING) { // if it's already loading, don't touch anything
            clearTimeout(this.retryLoad);
            delete this.retryLoad;
            this.status = Status.LOADING;
            this.maxRetries = MAX_SERVER_RETRIES;
        }
    };

    isReady = () => {
        return this.status === Status.READY;
    };

    isErrored = () => {
        return this.status === Status.ERROR;
    };

    needsLoadingScreen = () => {
        return !(this.status === Status.READY || this.status === Status.ERROR);
    };

    setInitialized = (timedout?: boolean) => {
        this.status = Status.READY;
        this.emit(LOADSCREEN_END, this.id);

        if (timedout) {
            this.log.verbose('timeout expired will show the browserview');
        }
        clearTimeout(this.removeLoading);
        delete this.removeLoading;
    };

    setLastPath = (path: string) => {
        this.lastPath = path;
    };

    useLastPath = () => {
        if (this.lastPath) {
            if (ViewManager.isPrimaryView(this.view.id)) {
                this.webContentsView.webContents.send(BROWSER_HISTORY_PUSH, this.lastPath);
            } else {
                this.webContentsView.webContents.once('did-finish-load', () => {
                    this.webContentsView.webContents.send(BROWSER_HISTORY_PUSH, this.lastPath);
                });
                this.webContentsView.webContents.reload();
            }
            this.lastPath = undefined;
        }
    };

    openDevTools = () => {
        // Workaround for a bug with our Dev Tools on Mac
        // For some reason if you open two Dev Tools windows and close the first one, it won't register the closing
        // So what we do here is check to see if it's opened correctly and if not we reset it
        if (process.platform === 'darwin') {
            const timeout = setTimeout(() => {
                if (this.webContentsView.webContents.isDevToolsOpened()) {
                    this.webContentsView.webContents.closeDevTools();
                    this.webContentsView.webContents.openDevTools({mode: 'detach'});
                }
            }, 500);
            this.webContentsView.webContents.on('devtools-opened', () => {
                clearTimeout(timeout);
            });
        }

        this.webContentsView.webContents.openDevTools({mode: 'detach'});
    };

    /**
     * WebContents hooks
     */

    sendToRenderer = (channel: string, ...args: any[]) => {
        this.webContentsView.webContents.send(channel, ...args);
    };

    isDestroyed = () => {
        return this.webContentsView.webContents.isDestroyed();
    };

    focus = () => {
        if (this.parentWindow.isFocused()) {
            this.webContentsView.webContents.focus();
        }
    };

    /**
     * ALT key handling for the 3-dot menu (Windows/Linux)
     */

    /**
     * Loading/retry logic
     */

    private retry = (loadURL: string) => {
        return () => {
            // window was closed while retrying
            if (!this.webContentsView || !this.webContentsView.webContents || this.isDestroyed()) {
                return;
            }
            const loading = this.webContentsView.webContents.loadURL(loadURL, {userAgent: composeUserAgent(DeveloperMode.get('browserOnly'))});
            loading.then(this.loadSuccess(loadURL)).catch((err) => {
                if (this.maxRetries-- > 0) {
                    this.loadRetry(loadURL, err);
                } else {
                    this.parentWindow.webContents.send(LOAD_FAILED, this.id, err.toString(), loadURL.toString());
                    this.emit(LOAD_FAILED, this.id, err.toString(), loadURL.toString());
                    this.log.info('Could not establish a connection, will continue to retry in the background', {err});
                    this.status = Status.ERROR;
                    this.retryLoad = setTimeout(this.retryInBackground(loadURL), RELOAD_INTERVAL);
                }
            });
        };
    };

    private retryInBackground = (loadURL: string) => {
        return () => {
            // window was closed while retrying
            if (!this.webContentsView || !this.webContentsView.webContents) {
                return;
            }
            const parsedURL = parseURL(loadURL);
            if (!parsedURL) {
                return;
            }
            const server = ServerManager.getServer(this.view.serverId);
            if (!server) {
                return;
            }
            getServerAPI(
                parsedURL,
                false,
                async () => {
                    await updateServerInfos([server]);
                    this.reload(loadURL);
                },
                () => {},
                (error: Error) => {
                    this.log.debug(`Cannot reach server: ${error}`);
                    this.retryLoad = setTimeout(this.retryInBackground(loadURL), RELOAD_INTERVAL);
                });
        };
    };

    private loadRetry = (loadURL: string, err: Error) => {
        if (this.isDestroyed()) {
            return;
        }
        this.retryLoad = setTimeout(this.retry(loadURL), RELOAD_INTERVAL);
        this.parentWindow.webContents.send(LOAD_RETRY, this.id, Date.now() + RELOAD_INTERVAL, err.toString(), loadURL.toString());
        this.log.info(`failed loading URL: ${err}, retrying in ${RELOAD_INTERVAL / SECOND} seconds`);
    };

    private loadSuccess = (loadURL: string) => {
        return () => {
            const serverInfo = ServerManager.getRemoteInfo(this.view.serverId);
            if (!serverInfo?.serverVersion || semver.gte(serverInfo.serverVersion, '9.4.0')) {
                this.log.verbose('finished loading URL');
                this.parentWindow.webContents.send(LOAD_SUCCESS, this.id);
                this.maxRetries = MAX_SERVER_RETRIES;
                this.status = Status.WAITING_MM;
                this.removeLoading = setTimeout(this.setInitialized, MAX_LOADING_SCREEN_SECONDS, true);
                this.emit(LOAD_SUCCESS, this.id, loadURL);
                if (this.parentWindow && this.currentURL) {
                    this.setBounds(getWindowBoundaries(this.parentWindow));
                }
            } else {
                this.parentWindow.webContents.send(LOAD_INCOMPATIBLE_SERVER, this.id, loadURL.toString());
                this.emit(LOAD_FAILED, this.id, 'Incompatible server version', loadURL.toString());
                this.status = Status.ERROR;
            }
        };
    };

    applyDesktopThemeOverride = () => {
        void this.webContentsView.webContents.executeJavaScript(buildDesktopSidebarThemeOverrideScript());
    };

    /**
     * WebContents event handlers
     */

    private handleUpdateTarget = (e: Event, url: string) => {
        this.log.silly('handleUpdateTarget');
        const parsedURL = parseURL(url);
        if (parsedURL && isInternalURL(parsedURL, ServerManager.getServer(this.view.serverId)?.url ?? this.view.getLoadingURL())) {
            this.emit(UPDATE_TARGET_URL);
        } else {
            this.emit(UPDATE_TARGET_URL, url);
        }
    };

    private handleServerWasModified = (serverId: string) => {
        if (serverId === this.view.serverId) {
            this.reload();
        }
    };

    private handlePageTitleUpdated = (newTitle: string) => {
        this.log.silly('handlePageTitleUpdated');

        if (!ServerManager.getServer(this.view.serverId)?.isLoggedIn) {
            return;
        }

        // Extract just the channel name (everything before the first " - ")
        // Remove any mention count in parentheses at the start
        const parts = newTitle.split(' - ');
        if (parts.length <= 1) {
            ViewManager.updateViewTitle(this.id, newTitle);
            return;
        }

        let channelName = parts.slice(0, -1).join(' - ');

        // Remove mention count if present
        if (channelName.startsWith('(')) {
            const endParenIndex = channelName.indexOf(')');
            if (endParenIndex !== -1) {
                channelName = channelName.substring(endParenIndex + 1).trim();
            }
        }

        // Team name and server name
        const secondPart = parts[parts.length - 1];
        const serverInfo = ServerManager.getRemoteInfo(this.serverId);
        if (serverInfo?.siteName) {
            ViewManager.updateViewTitle(this.id, channelName, secondPart.replace(serverInfo.siteName, '').trim());
        } else {
            ViewManager.updateViewTitle(this.id, channelName, secondPart);
        }
    };

    private handleAltBlur = () => {
        this.altPressStatus = false;
    };

    private generateContextMenu = (): Options => {
        const server = ServerManager.getServer(this.view.serverId);
        if (!server) {
            return {};
        }

        return {
            append: (_, parameters) => {
                const parsedURL = parseURL(parameters.linkURL);
                if (parsedURL && isInternalURL(parsedURL, server.url)) {
                    return [
                        {
                            type: 'separator' as const,
                        },
                        {
                            label: localizeMessage('app.menus.contextMenu.openInNewTab', 'Open in new tab'),
                            enabled: !ViewManager.isViewLimitReached(),
                            click() {
                                NavigationManager.openLinkInNewTab(parsedURL.toString());
                            },
                        },
                        {
                            label: localizeMessage('app.menus.contextMenu.openInNewWindow', 'Open in new window'),
                            enabled: !ViewManager.isViewLimitReached(),
                            click() {
                                NavigationManager.openLinkInNewWindow(parsedURL.toString());
                            },
                        },
                    ];
                }
                return [];
            },
        };
    };
}
