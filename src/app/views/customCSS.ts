// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Custom CSS injected into the Mattermost web app to unify its visual style
 * with the desktop app's Issues view: sharp edges, compact scale, matching
 * color palette (light with subtle blue accents), and consistent typography.
 */

const CUSTOM_MM_CSS = `
/* ═══════════════════════════════════════════════════════════════════════════
   0. THEME VARIABLE OVERRIDES
   Mattermost applies theme via inline styles on #app / body, so we must
   override with maximum specificity on every possible container.
   ═══════════════════════════════════════════════════════════════════════════ */

:root,
body,
body.app__body,
#root,
#app,
#root > *,
.app__body,
.channel-view,
.GlobalHeader,
.sidebar--left,
.SidebarContainer {
    /* ── Light sidebar to match Issues view ── */
    --sidebar-bg: #f8fafd !important;
    --sidebar-bg-rgb: 248, 250, 253 !important;
    --sidebar-text: #3f4350 !important;
    --sidebar-text-rgb: 63, 67, 80 !important;
    --sidebar-unread-text: #1f2328 !important;
    --sidebar-unread-text-rgb: 31, 35, 40 !important;
    --sidebar-text-hover-bg: #e8f1fc !important;
    --sidebar-text-hover-bg-rgb: 232, 241, 252 !important;
    --sidebar-text-active-border: #166de0 !important;
    --sidebar-text-active-border-rgb: 22, 109, 224 !important;
    --sidebar-text-active-color: #166de0 !important;
    --sidebar-text-active-color-rgb: 22, 109, 224 !important;
    --sidebar-header-bg: #f0f4f9 !important;
    --sidebar-header-bg-rgb: 240, 244, 249 !important;
    --sidebar-header-text-color: #1f2328 !important;
    --sidebar-header-text-color-rgb: 31, 35, 40 !important;
    --sidebar-teambar-bg: #e8edf4 !important;
    --sidebar-teambar-bg-rgb: 232, 237, 244 !important;

    /* ── Main content ── */
    --center-channel-bg: #ffffff !important;
    --center-channel-bg-rgb: 255, 255, 255 !important;
    --center-channel-color: #3f4350 !important;
    --center-channel-color-rgb: 63, 67, 80 !important;

    /* ── Subtle blue accent as the primary ── */
    --button-bg: #4a90d9 !important;
    --button-bg-rgb: 74, 144, 217 !important;
    --button-color: #ffffff !important;
    --button-color-rgb: 255, 255, 255 !important;
    --link-color: #4a90d9 !important;
    --link-color-rgb: 74, 144, 217 !important;

    /* ── Status ── */
    --online-indicator: #3dc779 !important;
    --online-indicator-rgb: 61, 199, 121 !important;
    --away-indicator: #f5a623 !important;
    --away-indicator-rgb: 245, 166, 35 !important;
    --dnd-indicator: #e05c5c !important;
    --dnd-indicator-rgb: 224, 92, 92 !important;
    --mention-bg: #4a90d9 !important;
    --mention-bg-rgb: 74, 144, 217 !important;
    --mention-color: #ffffff !important;
    --mention-color-rgb: 255, 255, 255 !important;
    --error-text: #e05c5c !important;
    --error-text-color-rgb: 224, 92, 92 !important;
    --new-message-separator: #4a90d9 !important;
    --new-message-separator-rgb: 74, 144, 217 !important;
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. TYPOGRAPHY — single font across the whole app
   ═══════════════════════════════════════════════════════════════════════════ */

body,
body * {
    font-family: 'Open Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI',
                 Roboto, Helvetica, Arial, sans-serif !important;
}

code, pre, .code, .hljs,
.post-code code, .post-code pre,
.markdown__table code {
    font-family: 'SFMono-Regular', 'Menlo', 'Monaco', 'Courier New', monospace !important;
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. SHARP EDGES — square/angular corners everywhere
   ═══════════════════════════════════════════════════════════════════════════ */

*,
*::before,
*::after {
    border-radius: 0 !important;
}

/* Keep circles only for avatars and status dots */
.Avatar,
.avatar,
.status,
.status-wrapper .status,
.StatusIcon,
.avatar-image,
img.Avatar,
.post__header .status,
.sidebar-item__avatar,
.RoundButton,
.ChannelHeaderCountBadge,
.Badge,
.badge,
.unread-badge,
.mention-badge,
.emoticon,
.emoji {
    border-radius: 50% !important;
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. SIDEBAR — light background with subtle blue accents
   ═══════════════════════════════════════════════════════════════════════════ */

/* Force light sidebar background */
.sidebar--left,
.SidebarContainer,
#SidebarContainer,
.SidebarContainer *[class*="sidebar"],
.sidebar--left .team-sidebar {
    background: #f8fafd !important;
    color: #3f4350 !important;
}

/* Team sidebar strip */
.team-sidebar,
.TeamSidebar,
#teamSidebarContainer,
.team-sidebar__content {
    background: #e8edf4 !important;
    border-right: 1px solid rgba(63, 67, 80, 0.1) !important;
}

.team-container .team-btn,
.TeamSidebarItem,
.teamSidebarItem {
    background: #ffffff !important;
    border: 1px solid rgba(63, 67, 80, 0.1) !important;
    color: #3f4350 !important;
}

.team-container .team-btn:hover,
.team-container .team-btn.active {
    background: #e8f1fc !important;
    border-color: #4a90d9 !important;
}

/* Sidebar header */
.SidebarHeaderContainer,
.SidebarHeader,
.sidebar--left .sidebar-header,
#lhsNavigator,
.GlobalHeader {
    background: #f0f4f9 !important;
    color: #1f2328 !important;
    border-bottom: 1px solid rgba(63, 67, 80, 0.1) !important;
}

.GlobalHeader .header-icon,
.GlobalHeader button,
.SidebarHeader button {
    color: #3f4350 !important;
}

/* Channel links */
.SidebarLink,
.SidebarChannel .SidebarLink {
    color: #3f4350 !important;
}

.SidebarLink:hover,
.SidebarChannel:hover .SidebarLink {
    background: #e8f1fc !important;
    color: #1f2328 !important;
}

/* Active / selected channel */
.SidebarChannel.active .SidebarLink,
.SidebarLink.active,
.SidebarChannel--active .SidebarLink {
    background: rgba(74, 144, 217, 0.13) !important;
    color: #4a90d9 !important;
    font-weight: 600 !important;
}

/* Active left border accent */
.SidebarChannel.active::before,
.SidebarChannel--active::before {
    background: #4a90d9 !important;
}

/* Unread channels */
.SidebarChannel.unread .SidebarLink,
.SidebarLink.unread {
    color: #1f2328 !important;
    font-weight: 600 !important;
}

/* Category headers */
.SidebarChannelGroupHeader,
.SidebarCategoryHeader,
.SidebarCategoryHeader__text {
    color: rgba(63, 67, 80, 0.55) !important;
}

/* Sidebar icons */
.SidebarMenu,
.SidebarChannelNavigator,
.AddChannelDropdown,
.SidebarFilters {
    color: #3f4350 !important;
}

.SidebarMenu button,
.SidebarChannelNavigator button,
.AddChannelDropdown button {
    color: #656d76 !important;
}

.SidebarMenu button:hover,
.SidebarChannelNavigator button:hover,
.AddChannelDropdown button:hover {
    background: #e8f1fc !important;
    color: #4a90d9 !important;
}

/* Mention/unread badges in sidebar */
.SidebarChannel .badge,
.SidebarChannel .unread-badge {
    background: #4a90d9 !important;
    color: #ffffff !important;
}

/* Sidebar border */
.sidebar--left,
.SidebarContainer {
    border-right: 1px solid rgba(63, 67, 80, 0.1) !important;
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. CENTER CHANNEL — subtle blue accents
   ═══════════════════════════════════════════════════════════════════════════ */

/* Post hover — subtle light blue tint */
.post:hover,
.post.post--hovered {
    background: #f5f9fe !important;
}

.post.post--highlight {
    background: #e8f1fc !important;
}

/* New message separator */
.new-separator .separator__text {
    color: #4a90d9 !important;
}

.new-separator .separator__hr {
    border-color: #4a90d9 !important;
}

/* Links in posts */
.post .markdown__link,
.post a {
    color: #4a90d9 !important;
}

/* Channel header */
.channel-header,
#channelHeaderInfo {
    border-bottom: 1px solid rgba(63, 67, 80, 0.1) !important;
    background: #ffffff !important;
}

/* Thread/RHS panel */
#rhsContainer {
    border-left: 1px solid rgba(63, 67, 80, 0.1) !important;
}

/* Buttons */
.btn-primary,
.GenericBtn--primary {
    background: #4a90d9 !important;
    border-color: #4a90d9 !important;
    color: #ffffff !important;
}

.btn-primary:hover,
.GenericBtn--primary:hover {
    background: #3d7ec4 !important;
    border-color: #3d7ec4 !important;
}

/* Input focus */
input:focus,
textarea:focus,
select:focus,
.form-control:focus {
    border-color: #4a90d9 !important;
    box-shadow: 0 0 0 2px rgba(74, 144, 217, 0.15) !important;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. COMPACT SCALE — smaller sizing to match Issues view density
   ═══════════════════════════════════════════════════════════════════════════ */

body {
    font-size: 13px !important;
}

/* Sidebar — tighter spacing */
.SidebarChannel {
    height: auto !important;
    min-height: unset !important;
}

.SidebarLink {
    padding: 4px 12px 4px 10px !important;
    font-size: 12px !important;
    height: auto !important;
    min-height: 26px !important;
}

.SidebarChannelGroupHeader,
.SidebarCategoryHeader {
    padding: 6px 12px 4px 10px !important;
    font-size: 11px !important;
    height: auto !important;
    min-height: 24px !important;
}

.SidebarCategoryHeader__text {
    font-size: 11px !important;
    font-weight: 700 !important;
    text-transform: uppercase !important;
    letter-spacing: 0.5px !important;
}

/* Channel header — compact */
#channelHeaderInfo,
.channel-header {
    min-height: 40px !important;
    height: 40px !important;
    font-size: 13px !important;
}

.channel-header__top {
    padding: 0 12px !important;
}

.channel-header .channel-header__title {
    font-size: 14px !important;
    font-weight: 600 !important;
}

/* Posts — tighter */
.post {
    padding: 4px 16px !important;
}

.post .post__header {
    margin-bottom: 2px !important;
}

.post .post__header .col__name {
    font-size: 12px !important;
    font-weight: 600 !important;
}

.post .post__body {
    font-size: 13px !important;
    line-height: 1.5 !important;
}

.post .post__time {
    font-size: 10px !important;
    opacity: 0.45 !important;
}

/* Create post box — compact */
.post-create__container {
    padding: 8px 16px !important;
}

.post-create__container .custom-textarea {
    font-size: 13px !important;
    min-height: 28px !important;
    padding: 6px 10px !important;
}

/* Search bar */
.search-bar__container {
    height: 30px !important;
}

.search-bar__container input {
    font-size: 12px !important;
    padding: 4px 10px !important;
}

/* General buttons */
.btn {
    padding: 5px 12px !important;
    font-size: 12px !important;
    font-weight: 600 !important;
}

/* Modal — compact */
.modal-content {
    border: 1px solid rgba(63, 67, 80, 0.15) !important;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35) !important;
}

.modal-header {
    padding: 12px 16px !important;
    font-size: 14px !important;
}

.modal-body {
    padding: 12px 16px !important;
    font-size: 13px !important;
}

.modal-footer {
    padding: 10px 16px !important;
}

/* Tooltips */
.tooltip-inner {
    font-size: 11px !important;
    padding: 3px 8px !important;
}

/* Team sidebar — compact */
.team-sidebar {
    width: 54px !important;
}

.team-container .team-btn {
    width: 36px !important;
    height: 36px !important;
    margin: 3px auto !important;
}

/* Scrollbar — thin */
::-webkit-scrollbar {
    width: 6px !important;
    height: 6px !important;
}

::-webkit-scrollbar-thumb {
    background: rgba(63, 67, 80, 0.18) !important;
}

::-webkit-scrollbar-thumb:hover {
    background: rgba(63, 67, 80, 0.3) !important;
}

::-webkit-scrollbar-track {
    background: transparent !important;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. GLOBAL HEADER / TOP BAR — light with subtle blue
   ═══════════════════════════════════════════════════════════════════════════ */

.GlobalHeader,
.global-header {
    background: #f0f4f9 !important;
    color: #1f2328 !important;
    border-bottom: 1px solid rgba(63, 67, 80, 0.1) !important;
}

.GlobalHeader *,
.global-header * {
    color: #3f4350 !important;
}

.GlobalHeader button:hover,
.global-header button:hover {
    background: #e8f1fc !important;
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. MENUS & DROPDOWNS — light theme
   ═══════════════════════════════════════════════════════════════════════════ */

.Menu__content,
.dropdown-menu,
.popover,
.SubMenu__content {
    background: #ffffff !important;
    border: 1px solid rgba(63, 67, 80, 0.12) !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1) !important;
}

.MenuItem:hover,
.MenuItemButton:hover,
.SubMenuItem:hover,
.dropdown-menu li:hover,
.dropdown-menu a:hover {
    background: #e8f1fc !important;
}
`;

export default CUSTOM_MM_CSS;
