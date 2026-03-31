// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import ReactDOM from 'react-dom';

import IntlProvider from 'renderer/intl_provider';
import setupDarkMode from 'renderer/modals/darkMode';

import buildConfig from 'common/config/buildConfig';

import type {UniqueServer} from 'types/config';

import OrganizationList from '../../components/OrganizationList';

const onConnect = (data: UniqueServer) => {
    window.desktop.modals.finishModal(data);
};

setupDarkMode();

const WelcomeScreenModalWrapper = () => {
    return (
        <IntlProvider>
            <OrganizationList
                provisioningApiUrl={buildConfig.provisioningApiUrl}
                onConnect={onConnect}
            />
        </IntlProvider>
    );
};

const start = () => {
    ReactDOM.render(
        <WelcomeScreenModalWrapper/>,
        document.getElementById('app'),
    );
};

start();
