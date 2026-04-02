// Copyright (c) 2016-present OLI, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import ReactDOM from 'react-dom';
import {FormattedMessage} from 'react-intl';

import {TAB_BAR_HEIGHT, THREE_DOT_MENU_WIDTH_MAC} from 'common/utils/constants';

import type {UniqueServer} from 'types/config';

import './css/dropdown.scss';

import IntlProvider from './intl_provider';
import setupDarkMode from './modals/darkMode';

setupDarkMode();

type State = {
    windowBounds?: Electron.Rectangle;
    nonce?: string;
}

class ServerDropdown extends React.PureComponent<Record<string, never>, State> {
    constructor(props: Record<string, never>) {
        super(props);
        this.state = {};

        window.desktop.serverDropdown.onUpdateServerDropdown(this.handleUpdate);
    }

    handleUpdate = (
        servers: UniqueServer[],
        windowBounds: Electron.Rectangle,
        activeServer?: string,
        enableServerManagement?: boolean,
        expired?: Map<string, boolean>,
        mentions?: Map<string, number>,
        unreads?: Map<string, boolean>,
    ) => {
        this.setState({
            windowBounds,
        });
    };

    closeMenu = () => {
        (document.activeElement as HTMLElement).blur();
        window.desktop.closeServersDropdown();
    };

    preventPropagation = (event: React.MouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
    };

    changeOrganization = () => {
        window.desktop.showChangeOrganization();
        this.closeMenu();
    };

    componentDidMount() {
        window.addEventListener('click', this.closeMenu);
        window.desktop.getNonce().then((nonce) => {
            this.setState({nonce}, () => {
                window.desktop.serverDropdown.requestInfo();
            });
        });
    }

    componentDidUpdate() {
        window.desktop.serverDropdown.sendSize(document.body.scrollWidth, document.body.scrollHeight);
    }

    componentWillUnmount() {
        window.removeEventListener('click', this.closeMenu);
    }

    render() {
        if (!this.state.nonce) {
            return null;
        }

        return (
            <IntlProvider>
                <div
                    onClick={this.preventPropagation}
                    className='ServerDropdown'
                    style={{
                        maxHeight: this.state.windowBounds ? (this.state.windowBounds.height - TAB_BAR_HEIGHT - 16) : undefined,
                        maxWidth: this.state.windowBounds ? (this.state.windowBounds.width - THREE_DOT_MENU_WIDTH_MAC) : undefined,
                    }}
                >
                    <button
                        className='ServerDropdown__button addServer'
                        onClick={this.changeOrganization}
                    >
                        <i className='icon-swap-horizontal'/>
                        <FormattedMessage
                            id='renderer.dropdown.changeOrganization'
                            defaultMessage='Change organization'
                        />
                    </button>
                </div>
            </IntlProvider>
        );
    }
}

ReactDOM.render(
    <ServerDropdown/>,
    document.getElementById('app'),
);
