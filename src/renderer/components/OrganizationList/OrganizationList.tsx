// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
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

function OrganizationList({provisioningApiUrl, onConnect}: OrganizationListProps) {
    const [orgs, setOrgs] = useState<Organization[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Create form state
    const [showCreate, setShowCreate] = useState(false);
    const [newName, setNewName] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [creating, setCreating] = useState(false);

    // Password prompt state for private orgs
    const [passwordOrg, setPasswordOrg] = useState<Organization | null>(null);
    const [password, setPassword] = useState('');
    const [passwordError, setPasswordError] = useState('');

    // Provisioning poll state
    const [provisioningOrgId, setProvisioningOrgId] = useState<string | null>(null);

    const fetchOrgs = useCallback(async () => {
        const url = `${provisioningApiUrl}/organizations`;
        console.log(`[ProvisioningAPI] GET ${url}`);

        try {
            const res = await fetch(url);
            const bodyText = await res.text();

            if (!res.ok) {
                console.error(
                    `[ProvisioningAPI] GET /organizations HTTP error ${JSON.stringify({
                        url,
                        status: res.status,
                        statusText: res.statusText,
                        bodyPreview: bodyText.slice(0, 800),
                    })}`,
                );
                throw new Error(`HTTP ${res.status} ${res.statusText}`);
            }

            let data: Organization[];
            try {
                data = JSON.parse(bodyText) as Organization[];
            } catch (parseErr) {
                console.error(
                    `[ProvisioningAPI] GET /organizations not JSON ${JSON.stringify({
                        url,
                        parseError: parseErr instanceof Error ? parseErr.message : String(parseErr),
                        bodyPreview: bodyText.slice(0, 600),
                    })}`,
                );
                throw parseErr;
            }

            setOrgs(data);
            setError('');
            console.log(`[ProvisioningAPI] GET /organizations ok count=${Array.isArray(data) ? data.length : 'n/a'}`);
        } catch (err) {
            console.error(
                `[ProvisioningAPI] GET /organizations failed ${JSON.stringify({
                    url,
                    provisioningApiUrl,
                    error: err instanceof Error ? err.message : String(err),
                    errorName: err instanceof Error ? err.name : undefined,
                })}`,
            );
            if (err instanceof Error && err.stack) {
                console.error(`[ProvisioningAPI] stack ${err.stack}`);
            }
            setError('Could not connect to provisioning API');
        } finally {
            setLoading(false);
        }
    }, [provisioningApiUrl]);

    useEffect(() => {
        fetchOrgs();
    }, [fetchOrgs]);

    // Poll for provisioning status
    useEffect(() => {
        if (!provisioningOrgId) {
            return;
        }

        const pollUrl = `${provisioningApiUrl}/organizations/${provisioningOrgId}`;
        console.log(`[Provisioning] started polling ${pollUrl}`);

        let intervalId: ReturnType<typeof setInterval>;

        const pollOnce = async () => {
            try {
                const res = await fetch(pollUrl);
                const bodyText = await res.text();
                if (!res.ok) {
                    console.error(`[Provisioning] poll HTTP ${res.status} ${res.statusText} body=${bodyText.slice(0, 600)}`);
                    return;
                }

                let org: Organization;
                try {
                    org = JSON.parse(bodyText) as Organization;
                } catch (parseErr) {
                    console.error(`[Provisioning] poll response not JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)} body=${bodyText.slice(0, 400)}`);
                    return;
                }

                console.log(`[Provisioning] poll result ${JSON.stringify({
                    id: org.id,
                    name: org.name,
                    status: org.status,
                    server_url: org.server_url,
                    is_private: org.is_private,
                    provision_error: org.provision_error,
                })}`);

                if (org.status === 'ready' && org.server_url) {
                    clearInterval(intervalId);
                    setProvisioningOrgId(null);
                    console.log(`[Provisioning] ready, connecting to ${org.server_url}`);
                    onConnect({url: org.server_url, name: org.name});
                } else if (org.status === 'failed') {
                    clearInterval(intervalId);
                    setProvisioningOrgId(null);
                    const reason = org.provision_error?.trim();
                    console.error(`[Provisioning] FAILED reason=${reason || '(none)'} fullOrg=${bodyText}`);
                    setError(
                        reason
                            ? `Provisioning failed: ${reason.slice(0, 400)}${reason.length > 400 ? '…' : ''}`
                            : 'Provisioning failed. Please try again.',
                    );
                }
            } catch (err) {
                console.error(`[Provisioning] poll threw (will retry): ${err instanceof Error ? err.message : String(err)}`);
            }
        };

        intervalId = setInterval(pollOnce, 5000);
        void pollOnce();

        return () => clearInterval(intervalId);
    }, [provisioningOrgId, provisioningApiUrl, onConnect]);

    const handleOrgClick = (org: Organization) => {
        if (org.status !== 'ready' || !org.server_url) {
            return;
        }

        if (org.is_private) {
            setPasswordOrg(org);
            setPassword('');
            setPasswordError('');
            return;
        }

        onConnect({url: org.server_url, name: org.name});
    };

    const handleJoin = async () => {
        if (!passwordOrg) {
            return;
        }

        try {
            const res = await fetch(`${provisioningApiUrl}/organizations/${passwordOrg.id}/join`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({password}),
            });

            if (!res.ok) {
                setPasswordError('Incorrect password');
                return;
            }

            const org = await res.json();
            onConnect({url: org.server_url, name: org.name});
        } catch {
            setPasswordError('Connection error');
        }
    };

    const handleCreate = async () => {
        if (!newName.trim()) {
            return;
        }

        setCreating(true);
        try {
            const res = await fetch(`${provisioningApiUrl}/organizations`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    name: newName.trim(),
                    created_by: 'desktop-user',
                    password: newPassword || undefined,
                }),
            });

            if (!res.ok) {
                throw new Error('Failed to create organization');
            }

            const org = await res.json();
            setShowCreate(false);
            setNewName('');
            setNewPassword('');
            setProvisioningOrgId(org.id);
            fetchOrgs();
        } catch {
            setError('Failed to create organization');
        } finally {
            setCreating(false);
        }
    };

    if (provisioningOrgId) {
        return (
            <div className='OrganizationList'>
                <div className='OrganizationList__provisioning-status'>
                    <h1 className='OrganizationList__title'>Setting up your organization...</h1>
                    <p>{'This may take a couple of minutes. Provisioning server and database...'}</p>
                </div>
            </div>
        );
    }

    if (passwordOrg) {
        return (
            <div className='OrganizationList'>
                <h1 className='OrganizationList__title'>{`Join ${passwordOrg.name}`}</h1>
                <p className='OrganizationList__subtitle'>{'This organization requires a password'}</p>
                <div className='OrganizationList__password-prompt'>
                    <input
                        className='OrganizationList__password-input'
                        type='password'
                        placeholder='Enter password'
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                        autoFocus={true}
                    />
                    {passwordError && <span className='OrganizationList__password-error'>{passwordError}</span>}
                    <div className='OrganizationList__password-buttons'>
                        <button
                            className='secondary-button secondary-medium-button'
                            onClick={() => setPasswordOrg(null)}
                        >
                            {'Back'}
                        </button>
                        <button
                            className='primary-button primary-medium-button'
                            onClick={handleJoin}
                        >
                            {'Join'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className='OrganizationList'>
            <h1 className='OrganizationList__title'>{'Choose an Organization'}</h1>
            <p className='OrganizationList__subtitle'>{'Join an existing organization or create a new one'}</p>

            {error && <span className='OrganizationList__error'>{error}</span>}

            {loading ? (
                <span className='OrganizationList__loading'>{'Loading organizations...'}</span>
            ) : (
                <div className='OrganizationList__list'>
                    {orgs.length === 0 && (
                        <div className='OrganizationList__empty'>
                            {'No organizations yet. Create one to get started.'}
                        </div>
                    )}
                    {orgs.map((org) => (
                        <div
                            key={org.id}
                            className={`OrganizationList__item ${org.is_private ? 'OrganizationList__item--private' : ''} ${org.status !== 'ready' ? 'OrganizationList__item--provisioning' : ''}`}
                            onClick={() => handleOrgClick(org)}
                        >
                            <span className='OrganizationList__item-name'>
                                {org.is_private ? '\uD83D\uDD12 ' : ''}{org.name}
                            </span>
                            {org.status !== 'ready' && (
                                <span className='OrganizationList__item-badge'>{org.status}</span>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {showCreate ? (
                <div className='OrganizationList__create'>
                    <input
                        className='OrganizationList__create-input'
                        type='text'
                        placeholder='Organization name'
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        autoFocus={true}
                    />
                    <input
                        className='OrganizationList__create-input'
                        type='password'
                        placeholder='Password (optional, for private orgs)'
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                    />
                    <div className='OrganizationList__create-buttons'>
                        <button
                            className='secondary-button secondary-medium-button'
                            onClick={() => {
                                setShowCreate(false);
                                setNewName('');
                                setNewPassword('');
                            }}
                        >
                            {'Cancel'}
                        </button>
                        <button
                            className='primary-button primary-medium-button'
                            onClick={handleCreate}
                            disabled={creating || !newName.trim()}
                        >
                            {creating ? 'Creating...' : 'Create'}
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    className='primary-button primary-medium-button'
                    onClick={() => setShowCreate(true)}
                >
                    {'Create Organization'}
                </button>
            )}
        </div>
    );
}

export default OrganizationList;
