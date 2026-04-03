// Copyright (c) 2016-present OLI, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState, useEffect, useCallback} from 'react';

import type {UniqueServer} from 'types/config';

import './OrganizationList.scss';

type Organization = {
    id: string;
    name: string;
    is_private: boolean;
    server_url: string | null;
    status: string;
    created_at: string;
    provision_error?: string | null;
};

type OrganizationListProps = {
    provisioningApiUrl: string;
    onConnect: (data: UniqueServer) => void;
};

type Step = 'org' | 'username' | 'settingUp';

const HARDCODED_PASSWORD = 'OliUser123!';

function sanitizeTeamName(orgName: string): string {
    return orgName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 59) + '-team';
}

function validateUsername(value: string): string[] {
    const errors: string[] = [];
    if (value.length < 3) {
        errors.push('Username must be at least 3 characters');
    }
    if (value.length > 22) {
        errors.push('Username must be at most 22 characters');
    }
    if (value.length > 0 && !/^[a-z0-9._-]+$/.test(value)) {
        errors.push('Only lowercase letters, numbers, dots, dashes, and underscores allowed');
    }
    return errors;
}

function StepIndicator({step}: {step: Step}) {
    return (
        <div className='OrganizationList__step-indicator'>
            <div className={`OrganizationList__step-indicator-dot ${step === 'org' ? 'OrganizationList__step-indicator-dot--active' : 'OrganizationList__step-indicator-dot--done'}`}/>
            <div className={`OrganizationList__step-indicator-dot ${step === 'username' ? 'OrganizationList__step-indicator-dot--active' : ''}`}/>
        </div>
    );
}

function OrganizationList({provisioningApiUrl, onConnect}: OrganizationListProps) {
    const [step, setStep] = useState<Step>('org');

    // Org step state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResult, setSearchResult] = useState<Organization | null>(null);
    const [searchDone, setSearchDone] = useState(false);
    const [searching, setSearching] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);
    const [provisioningOrgId, setProvisioningOrgId] = useState<string | null>(null);
    const [error, setError] = useState('');

    // Resolved org (ready to use)
    const [resolvedOrg, setResolvedOrg] = useState<Organization | null>(null);

    // Username step state
    const [username, setUsername] = useState('');
    const [usernameErrors, setUsernameErrors] = useState<string[]>([]);
    const [setupError, setSetupError] = useState('');

    const handleSearch = useCallback(async () => {
        if (!searchQuery.trim()) {
            return;
        }

        setSearching(true);
        setSearchResult(null);
        setSearchDone(false);
        setError('');

        try {
            const res = await fetch(`${provisioningApiUrl}/organizations`);
            if (!res.ok) {
                throw new Error(`HTTP ${res.status} ${res.statusText}`);
            }

            const orgs: Organization[] = await res.json();
            const match = orgs.find((org) => org.name.toLowerCase() === searchQuery.trim().toLowerCase());

            if (match) {
                setSearchResult(match);
            }
            setSearchDone(true);
        } catch {
            setError('Could not connect to provisioning API');
        } finally {
            setSearching(false);
        }
    }, [provisioningApiUrl, searchQuery]);

    const handleOrgClick = (org: Organization) => {
        if (org.status === 'ready' && org.server_url) {
            setResolvedOrg(org);
            setStep('username');
        } else if (org.status !== 'failed') {
            setProvisioningOrgId(org.id);
        }
    };

    const handleCreate = async () => {
        if (!newName.trim()) {
            return;
        }

        setCreating(true);
        setError('');

        try {
            const res = await fetch(`${provisioningApiUrl}/organizations`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    name: newName.trim(),
                    created_by: 'desktop-user',
                }),
            });

            if (!res.ok) {
                throw new Error('Failed to create organization');
            }

            const org = await res.json();
            setShowCreate(false);
            setNewName('');
            setProvisioningOrgId(org.id);
        } catch {
            setError('Failed to create organization');
        } finally {
            setCreating(false);
        }
    };

    // Poll for provisioning status
    useEffect(() => {
        if (!provisioningOrgId) {
            return;
        }

        const pollUrl = `${provisioningApiUrl}/organizations/${provisioningOrgId}`;
        let intervalId: ReturnType<typeof setInterval>;

        const pollOnce = async () => {
            try {
                const res = await fetch(pollUrl);
                if (!res.ok) {
                    return;
                }

                const org: Organization = await res.json();

                if (org.status === 'ready' && org.server_url) {
                    clearInterval(intervalId);
                    setProvisioningOrgId(null);
                    setResolvedOrg(org);
                    setStep('username');
                } else if (org.status === 'failed') {
                    clearInterval(intervalId);
                    setProvisioningOrgId(null);
                    const reason = org.provision_error?.trim();
                    setError(
                        reason
                            ? `Provisioning failed: ${reason.slice(0, 400)}${reason.length > 400 ? '…' : ''}`
                            : 'Provisioning failed. Please try again.',
                    );
                }
            } catch {
                // will retry on next interval
            }
        };

        intervalId = setInterval(pollOnce, 5000);
        void pollOnce();

        return () => clearInterval(intervalId);
    }, [provisioningOrgId, provisioningApiUrl]);

    const handleUsernameChange = (value: string) => {
        const lowered = value.toLowerCase();
        setUsername(lowered);
        if (lowered.length > 0) {
            setUsernameErrors(validateUsername(lowered));
        } else {
            setUsernameErrors([]);
        }
        setSetupError('');
    };

    const isUsernameValid = username.length >= 3 && username.length <= 22 && /^[a-z0-9._-]+$/.test(username);

    const handleContinue = async () => {
        if (!resolvedOrg?.server_url || !isUsernameValid) {
            return;
        }

        setStep('settingUp');
        setSetupError('');

        const serverUrl = resolvedOrg.server_url.replace(/\/+$/, '');
        const email = `${username}@oli.local`;

        // Use IPC proxy to avoid CORS issues with Mattermost API
        const proxyFetch = async (url: string, options: {method?: string; headers?: Record<string, string>; body?: string}) => {
            return window.desktop.proxyFetch(url, options) as Promise<{ok: boolean; status: number; headers: Record<string, string>; body: string}>;
        };

        try {
            // 1. Create user
            const createUserRes = await proxyFetch(`${serverUrl}/api/v4/users`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    username,
                    email,
                    password: HARDCODED_PASSWORD,
                }),
            });

            if (!createUserRes.ok) {
                if (createUserRes.status === 409) {
                    // Username taken — that's fine, try to log in
                } else {
                    let message = 'Failed to create user';
                    try {
                        const err = JSON.parse(createUserRes.body);
                        if (err.message) {
                            message = err.message;
                        }
                    } catch {
                        // use default message
                    }
                    throw new Error(message);
                }
            }

            // 2. Login
            const loginRes = await proxyFetch(`${serverUrl}/api/v4/users/login`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    login_id: email,
                    password: HARDCODED_PASSWORD,
                }),
            });

            if (!loginRes.ok) {
                throw new Error('Failed to log in. Username may already be taken by another account.');
            }

            const token = loginRes.headers.token || loginRes.headers.Token;
            let user: {id: string};
            try {
                user = JSON.parse(loginRes.body);
            } catch {
                throw new Error('Invalid login response');
            }

            console.log('[org-setup] login response headers:', JSON.stringify(loginRes.headers));
            console.log('[org-setup] token extracted:', token ? `${token.substring(0, 8)}...` : 'NONE');

            if (!token) {
                throw new Error('Login succeeded but no auth token received');
            }

            // 3. Create team or join existing one
            const teamName = sanitizeTeamName(resolvedOrg.name);
            let teamId: string;

            const createTeamRes = await proxyFetch(`${serverUrl}/api/v4/teams`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    name: teamName,
                    display_name: resolvedOrg.name,
                    type: 'O',
                }),
            });

            if (createTeamRes.ok) {
                const team = JSON.parse(createTeamRes.body);
                teamId = team.id;
            } else {
                // Team already exists — get all teams user can join and find it
                const allTeamsRes = await proxyFetch(`${serverUrl}/api/v4/teams?page=0&per_page=200`, {
                    headers: {'Authorization': `Bearer ${token}`},
                });

                if (!allTeamsRes.ok) {
                    throw new Error('Failed to list teams');
                }

                const allTeams = JSON.parse(allTeamsRes.body);
                const match = allTeams.find((t: {name: string}) => t.name === teamName);

                if (match) {
                    teamId = match.id;
                } else {
                    // Last resort: extract team ID from the detailed_error in the create response
                    try {
                        const err = JSON.parse(createTeamRes.body);
                        const idMatch = err.detailed_error?.match(/id=([a-z0-9]+)/);
                        if (idMatch) {
                            teamId = idMatch[1];
                        } else {
                            throw new Error('Could not find team');
                        }
                    } catch {
                        throw new Error('Team exists but could not be found. Ask an admin to invite you.');
                    }
                }
            }

            // 4. Join team
            const joinRes = await proxyFetch(`${serverUrl}/api/v4/teams/${teamId}/members`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    team_id: teamId,
                    user_id: user.id,
                }),
            });

            console.log('[org-setup] join team response:', joinRes.status);

            // 5. Set auth cookie so the Mattermost web app loads already logged in
            await window.desktop.setServerAuthCookie(serverUrl, token, user.id);

            // 6. Skip all Mattermost onboarding/landing pages via preferences API
            const authHeaders = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            };

            // Mark tutorial as completed, skip "tips", skip landing page
            await proxyFetch(`${serverUrl}/api/v4/users/${user.id}/preferences`, {
                method: 'PUT',
                headers: authHeaders,
                body: JSON.stringify([
                    {user_id: user.id, category: 'tutorial_step', name: user.id, value: '999'},
                    {user_id: user.id, category: 'insights', name: 'insights_tutorial_state', value: '{"insights_modal_viewed":true}'},
                    {user_id: user.id, category: 'recommended_next_steps', name: 'hide', value: 'true'},
                    {user_id: user.id, category: 'drafts', name: 'drafts_tour_tip_showed', value: '{"drafts_tour_tip_showed":true}'},
                    {user_id: user.id, category: 'crt_thread_pane_step', name: user.id, value: '999'},
                ]),
            });

            // Also complete onboarding via the dedicated endpoint
            await proxyFetch(`${serverUrl}/api/v4/users/${user.id}/preferences`, {
                method: 'PUT',
                headers: authHeaders,
                body: JSON.stringify([
                    {user_id: user.id, category: 'system_notice', name: 'GMasDM', value: 'true'},
                    {user_id: user.id, category: 'onboarding_task_list', name: 'onboarding_task_list_show', value: 'false'},
                    {user_id: user.id, category: 'onboarding_task_list', name: 'onboarding_task_list_open', value: 'false'},
                ]),
            });

            // 7. Store auto-login credentials so the server view can log in automatically
            await window.desktop.storeAutoLogin(serverUrl, email, HARDCODED_PASSWORD);

            // 8. Done — pass server URL and initial path to skip Mattermost landing pages
            onConnect({url: serverUrl, name: resolvedOrg.name, initialPath: `/${teamName}/channels/town-square`});
        } catch (err) {
            setSetupError(err instanceof Error ? err.message : 'Something went wrong');
            setStep('username');
        }
    };

    // Provisioning spinner
    if (provisioningOrgId) {
        return (
            <div className='OrganizationList'>
                <div className='OrganizationList__provisioning-status'>
                    <div className='OrganizationList__spinner'/>
                    <h1 className='OrganizationList__title'>{'Setting up your organization...'}</h1>
                    <p className='OrganizationList__subtitle'>{'This may take a couple of minutes.'}</p>
                </div>
            </div>
        );
    }

    // Setting up account spinner
    if (step === 'settingUp') {
        return (
            <div className='OrganizationList'>
                <div className='OrganizationList__provisioning-status'>
                    <div className='OrganizationList__spinner'/>
                    <h1 className='OrganizationList__title'>{'Setting up your account...'}</h1>
                    <p className='OrganizationList__subtitle'>{'Almost there, hang tight.'}</p>
                </div>
            </div>
        );
    }

    // Page 2: Username
    if (step === 'username') {
        return (
            <div className='OrganizationList'>
                <div className='OrganizationList__logo'>
                    <span className='OrganizationList__logo-text'>{'O'}</span>
                </div>
                <StepIndicator step='username'/>
                <h1 className='OrganizationList__title'>{'Choose your username'}</h1>
                <p className='OrganizationList__subtitle'>
                    {'This is how others will see you in '}
                    <span className='OrganizationList__org-highlight'>{resolvedOrg?.name}</span>
                </p>

                {setupError && <span className='OrganizationList__error'>{setupError}</span>}

                <div className='OrganizationList__card'>
                    <input
                        className={`OrganizationList__input ${usernameErrors.length > 0 ? 'OrganizationList__input--error' : ''}`}
                        type='text'
                        placeholder='Enter username'
                        value={username}
                        onChange={(e) => handleUsernameChange(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && isUsernameValid && handleContinue()}
                        autoFocus={true}
                    />

                    {usernameErrors.length > 0 ? (
                        <div className='OrganizationList__validation-errors'>
                            {usernameErrors.map((err) => (
                                <p
                                    key={err}
                                    className='OrganizationList__validation-error'
                                >{err}</p>
                            ))}
                        </div>
                    ) : (
                        <p className='OrganizationList__hint'>
                            {'3-22 characters. Lowercase letters, numbers, dots, dashes, underscores.'}
                        </p>
                    )}

                    <button
                        className='OrganizationList__continue-button'
                        onClick={handleContinue}
                        disabled={!isUsernameValid}
                    >
                        {'Continue'}
                    </button>
                </div>
            </div>
        );
    }

    // Page 1: Organization
    return (
        <div className='OrganizationList'>
            <div className='OrganizationList__logo'>
                <span className='OrganizationList__logo-text'>{'O'}</span>
            </div>
            <StepIndicator step='org'/>
            <h1 className='OrganizationList__title'>{'Welcome to OLI'}</h1>
            <p className='OrganizationList__subtitle'>{'Find your organization or create a new one'}</p>

            {error && <span className='OrganizationList__error'>{error}</span>}

            {showCreate ? (
                <div className='OrganizationList__card'>
                    <input
                        className='OrganizationList__input'
                        type='text'
                        placeholder='Organization name'
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && newName.trim() && handleCreate()}
                        autoFocus={true}
                    />
                    <div className='OrganizationList__button-row'>
                        <button
                            className='OrganizationList__cancel-button'
                            onClick={() => {
                                setShowCreate(false);
                                setNewName('');
                            }}
                        >
                            {'Cancel'}
                        </button>
                        <button
                            className='OrganizationList__create-button'
                            onClick={handleCreate}
                            disabled={creating || !newName.trim()}
                        >
                            {creating ? 'Creating...' : 'Create'}
                        </button>
                    </div>
                </div>
            ) : (
                <div className='OrganizationList__card'>
                    <div className='OrganizationList__search-row'>
                        <input
                            className='OrganizationList__input'
                            type='text'
                            placeholder='Search organization by name...'
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setSearchResult(null);
                                setSearchDone(false);
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            autoFocus={true}
                        />
                        <button
                            className='OrganizationList__search-button'
                            onClick={handleSearch}
                            disabled={searching || !searchQuery.trim()}
                        >
                            {searching ? 'Searching...' : 'Search'}
                        </button>
                    </div>

                    {searchResult && (
                        <div
                            className='OrganizationList__result'
                            onClick={() => handleOrgClick(searchResult)}
                        >
                            <span className='OrganizationList__result-name'>{searchResult.name}</span>
                            {searchResult.status === 'ready' ? (
                                <span className='OrganizationList__result-badge OrganizationList__result-badge--ready'>{'ready'}</span>
                            ) : (
                                <span className='OrganizationList__result-badge'>{searchResult.status}</span>
                            )}
                        </div>
                    )}

                    {searchDone && !searchResult && (
                        <p className='OrganizationList__no-result'>{'No organization found with that name'}</p>
                    )}

                    {!searchDone && !searching && (
                        <p className='OrganizationList__hint'>{'Enter the exact organization name to find it'}</p>
                    )}

                    <div className='OrganizationList__divider'/>

                    <div className='OrganizationList__create-section'>
                        <p className='OrganizationList__hint'>{"Don't have an organization?"}</p>
                        <button
                            className='OrganizationList__create-button'
                            onClick={() => setShowCreate(true)}
                        >
                            {'Create Organization'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default OrganizationList;
