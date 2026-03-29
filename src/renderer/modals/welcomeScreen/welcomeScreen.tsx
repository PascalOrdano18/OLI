// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useState} from 'react';
import ReactDOM from 'react-dom';

import IntlProvider from 'renderer/intl_provider';
import setupDarkMode from 'renderer/modals/darkMode';

import type {UniqueServer} from 'types/config';

import ConfigureServer from '../../components/ConfigureServer';
import WelcomeScreen from '../../components/WelcomeScreen';
import RepoPickerStep from '../../components/WelcomeScreen/RepoPickerStep';

const MOBILE_SCREEN_WIDTH = 1200;

type OnboardingStep = 'welcome' | 'configureServer' | 'repoPicker';

setupDarkMode();

const WelcomeScreenModalWrapper = () => {
    const [data, setData] = useState<{prefillURL?: string}>();
    const [step, setStep] = useState<OnboardingStep>('welcome');
    const [serverData, setServerData] = useState<UniqueServer | null>(null);
    const [mobileView, setMobileView] = useState(false);

    const handleWindowResize = () => {
        setMobileView(window.innerWidth < MOBILE_SCREEN_WIDTH);
    };

    useEffect(() => {
        window.desktop.modals.getModalInfo<{prefillURL?: string}>().
            then((data) => {
                setData(data);
                if (data.prefillURL) {
                    setStep('configureServer');
                }
            });

        handleWindowResize();
        window.addEventListener('resize', handleWindowResize);

        return () => {
            window.removeEventListener('resize', handleWindowResize);
        };
    }, []);

    const onGetStarted = () => {
        setStep('configureServer');
    };

    const onConnect = useCallback((data: UniqueServer) => {
        setServerData(data);
        setStep('repoPicker');
    }, []);

    const onRepoPickerContinue = useCallback(() => {
        if (serverData) {
            window.desktop.modals.finishModal(serverData);
        }
    }, [serverData]);

    return (
        <IntlProvider>
            {step === 'welcome' && (
                <WelcomeScreen
                    onGetStarted={onGetStarted}
                />
            )}
            {step === 'configureServer' && (
                <ConfigureServer
                    mobileView={mobileView}
                    onConnect={onConnect}
                    prefillURL={data?.prefillURL}
                />
            )}
            {step === 'repoPicker' && (
                <div className='LoadingScreen WelcomeScreen'>
                    <div className='WelcomeScreen__body'>
                        <div className='WelcomeScreen__content'>
                            <RepoPickerStep onContinue={onRepoPickerContinue}/>
                        </div>
                    </div>
                </div>
            )}
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
