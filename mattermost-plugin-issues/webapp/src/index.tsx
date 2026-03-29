// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import manifest from './manifest';
import reducer from './reducers';
import client from './client/client';
import ActionTypes from './actions/action_types';
import {fetchProjects} from './actions';

import CreateIssueModal from './components/create_issue_modal/create_issue_modal';
import IssueAutocomplete from './components/issue_autocomplete/issue_autocomplete';
import IssueRefRenderer from './components/issue_ref_renderer/issue_ref_renderer';
import SidebarHeader from './components/sidebar_header/sidebar_header';
import OliResponsePost from './components/oli/oli_response_post';

import './styles/main.scss';

type Store = {dispatch: (action: any) => void; getState: () => any};
type PluginRegistry = {
    registerReducer: (reducer: any) => void;
    registerRightHandSidebarComponent: (component: any, title: string) => any;
    registerChannelHeaderButtonAction: (icon: any, action: () => void, dropdownText: string, tooltipText: string) => void;
    registerLeftSidebarHeaderComponent: (component: any) => void;
    registerPostTypeComponent: (typeName: string, component: any) => void;
    registerRootComponent: (component: any) => void;
    registerWebSocketEventHandler: (event: string, handler: (msg: any) => void) => void;
};

class Plugin {
    public async initialize(registry: PluginRegistry, store: Store) {
        // Set up API client.
        const basename = (window as any).basename || '';
        client.setServerRoute(basename);

        // Register Redux reducer for plugin state.
        registry.registerReducer(reducer);

        // Register the create/edit issue modal (rendered globally).
        registry.registerRootComponent(CreateIssueModal);

        // Register issue autocomplete overlay (listens to chat textarea).
        registry.registerRootComponent(IssueAutocomplete);

        // Register issue reference renderer (scans posts for {{issue:ID}} patterns).
        registry.registerRootComponent(IssueRefRenderer);

        // Register left sidebar header component.
        registry.registerLeftSidebarHeaderComponent(SidebarHeader);

        // Register custom post type for Oli responses.
        registry.registerPostTypeComponent('custom_oli_response', OliResponsePost);

        // Register WebSocket handlers for real-time updates.
        registry.registerWebSocketEventHandler(
            `custom_${manifest.id}_issue_created`,
            (msg: any) => {
                try {
                    const issue = JSON.parse(msg.data.issue);
                    store.dispatch({type: ActionTypes.RECEIVED_ISSUE, data: issue});

                    // Auto-spawn agent for bot-created issues (Fiona)
                    const currentUserId = store.getState()?.entities?.users?.currentUserId;
                    if (issue.created_by && issue.created_by !== currentUserId) {
                        const desktopAPI = (window as any).desktopAPI;
                        if (desktopAPI?.autoSpawnAgent) {
                            desktopAPI.autoSpawnAgent({
                                id: issue.id,
                                project_id: issue.project_id,
                                identifier: issue.identifier,
                                title: issue.title,
                                description: issue.description || '',
                            }).then((result: any) => {
                                if (result?.spawned) {
                                    console.log(`[Issues Plugin] Auto-spawned agent for issue ${issue.identifier}`);
                                } else {
                                    console.log(`[Issues Plugin] Agent not spawned for ${issue.identifier}: ${result?.reason}`);
                                }
                            }).catch((err: any) => {
                                console.error(`[Issues Plugin] Failed to auto-spawn agent for ${issue.identifier}:`, err);
                            });
                        }
                    }
                } catch (e) {
                    // Ignore parse errors.
                }
            },
        );

        registry.registerWebSocketEventHandler(
            `custom_${manifest.id}_issue_updated`,
            (msg: any) => {
                try {
                    const issue = JSON.parse(msg.data.issue);
                    store.dispatch({type: ActionTypes.RECEIVED_ISSUE, data: issue});
                } catch (e) {
                    // Ignore parse errors.
                }
            },
        );

        registry.registerWebSocketEventHandler(
            `custom_${manifest.id}_issue_deleted`,
            (msg: any) => {
                const id = msg.data.id;
                if (id) {
                    store.dispatch({type: ActionTypes.ISSUE_DELETED, data: id});
                }
            },
        );

        registry.registerWebSocketEventHandler(
            `custom_${manifest.id}_label_created`,
            (msg: any) => {
                try {
                    const label = JSON.parse(msg.data.label);
                    store.dispatch({type: ActionTypes.RECEIVED_LABEL, data: label});
                } catch (e) {
                    // Ignore parse errors.
                }
            },
        );

        registry.registerWebSocketEventHandler(
            `custom_${manifest.id}_label_updated`,
            (msg: any) => {
                try {
                    const label = JSON.parse(msg.data.label);
                    store.dispatch({type: ActionTypes.RECEIVED_LABEL, data: label});
                } catch (e) {
                    // Ignore parse errors.
                }
            },
        );

        registry.registerWebSocketEventHandler(
            `custom_${manifest.id}_label_deleted`,
            (msg: any) => {
                const id = msg.data.id;
                if (id) {
                    store.dispatch({type: ActionTypes.LABEL_DELETED, data: id});
                }
            },
        );

        registry.registerWebSocketEventHandler(
            `custom_${manifest.id}_cycle_created`,
            (msg: any) => {
                try {
                    const cycle = JSON.parse(msg.data.cycle);
                    store.dispatch({type: ActionTypes.RECEIVED_CYCLE, data: cycle});
                } catch (e) {
                    // Ignore parse errors.
                }
            },
        );

        registry.registerWebSocketEventHandler(
            `custom_${manifest.id}_cycle_updated`,
            (msg: any) => {
                try {
                    const cycle = JSON.parse(msg.data.cycle);
                    store.dispatch({type: ActionTypes.RECEIVED_CYCLE, data: cycle});
                } catch (e) {
                    // Ignore parse errors.
                }
            },
        );

        registry.registerWebSocketEventHandler(
            `custom_${manifest.id}_cycle_deleted`,
            (msg: any) => {
                const id = msg.data.id;
                if (id) {
                    store.dispatch({type: ActionTypes.CYCLE_DELETED, data: id});
                }
            },
        );

        // Fetch initial data.
        try {
            await store.dispatch(fetchProjects() as any);
        } catch (e) {
            console.error('[Issues Plugin] Error fetching initial projects:', e);
        }
    }
}

(window as any).registerPlugin(manifest.id, new Plugin());
