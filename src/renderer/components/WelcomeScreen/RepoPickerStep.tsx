// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useState, useEffect} from 'react';

import 'renderer/css/components/Button.scss';
import './RepoPickerStep.scss';

type RepoPickerStepProps = {
    onContinue: () => void;
};

function RepoPickerStep({onContinue}: RepoPickerStepProps) {
    const [repoPath, setRepoPath] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [picking, setPicking] = useState(false);

    useEffect(() => {
        window.desktop.ao.getDefaultRepo().then((path: string | null) => {
            if (path) {
                setRepoPath(path);
            }
        });
    }, []);

    const handlePickRepo = async () => {
        setPicking(true);
        setError(null);
        try {
            const path = await window.desktop.ao.pickDefaultRepo();
            if (path) {
                setRepoPath(path);
            }
        } catch (err: any) {
            setError(err?.message || 'Failed to select repository');
        } finally {
            setPicking(false);
        }
    };

    return (
        <div className='RepoPickerStep'>
            <div className='RepoPickerStep__icon'>
                <svg
                    width='64'
                    height='64'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                >
                    <path d='M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4'/>
                    <path d='M9 18c-4.51 2-5-2-7-2'/>
                </svg>
            </div>
            <h1 className='RepoPickerStep__title'>
                {'Link your repository'}
            </h1>
            <p className='RepoPickerStep__subtitle'>
                {'Select a local git repository so AI agents can automatically start working on issues created from your conversations.'}
            </p>

            {repoPath ? (
                <div className='RepoPickerStep__selected'>
                    <div className='RepoPickerStep__path'>
                        <svg
                            width='16'
                            height='16'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='2'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                        >
                            <polyline points='20 6 9 17 4 12'/>
                        </svg>
                        <span>{repoPath}</span>
                    </div>
                    <button
                        className='RepoPickerStep__change'
                        onClick={handlePickRepo}
                        disabled={picking}
                    >
                        {'Change'}
                    </button>
                </div>
            ) : (
                <button
                    className={classNames(
                        'RepoPickerStep__browse',
                        'secondary-button secondary-medium-button',
                    )}
                    onClick={handlePickRepo}
                    disabled={picking}
                >
                    {picking ? 'Selecting...' : 'Browse for repository'}
                </button>
            )}

            {error && (
                <p className='RepoPickerStep__error'>{error}</p>
            )}

            <button
                className={classNames(
                    'RepoPickerStep__continue',
                    'primary-button primary-medium-button',
                )}
                onClick={onContinue}
            >
                {repoPath ? 'Continue' : 'Skip for now'}
            </button>
        </div>
    );
}

export default RepoPickerStep;
