// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useState} from 'react';

import type {IssueStatus, IssuePriority} from '../../types/model';
import {STATUS_COLORS, STATUS_LABELS, PRIORITY_COLORS} from '../../types/model';

export interface IssueRefData {
    id: string;
    identifier: string;
    title: string;
    status: string;
    priority: string;
}

interface Props {
    issueRef: IssueRefData;
    onClick?: (issueRef: IssueRefData) => void;
}

const PRIORITY_ICONS: Record<string, string> = {
    urgent: '!!!',
    high: '\u2191',
    medium: '\u2014',
    low: '\u2193',
    none: '\u25CB',
};

const IssueRefCard: React.FC<Props> = ({issueRef, onClick}) => {
    const [hovered, setHovered] = useState(false);
    const status = issueRef.status as IssueStatus;
    const priority = issueRef.priority as IssuePriority;
    const statusColor = STATUS_COLORS[status] || '#909399';
    const priorityColor = PRIORITY_COLORS[priority] || '#909399';
    const isClickable = Boolean(onClick);

    const handleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (onClick) {
            onClick(issueRef);
        }
    }, [onClick, issueRef]);

    return (
        <div
            className='issues-oli-issue-ref'
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 12px',
                backgroundColor: hovered && isClickable ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0.04)',
                borderRadius: '8px',
                border: '1px solid rgba(0, 0, 0, 0.08)',
                marginTop: '4px',
                cursor: isClickable ? 'pointer' : 'default',
                transition: 'background-color 0.15s',
            }}
            onClick={handleClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <div
                style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '6px',
                    backgroundColor: statusColor + '20',
                    border: `1px solid ${statusColor}40`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                }}
            >
                <span
                    style={{
                        color: priorityColor,
                        fontSize: '12px',
                        fontWeight: 700,
                    }}
                >
                    {PRIORITY_ICONS[priority] || '\u25CB'}
                </span>
            </div>
            <div style={{flex: 1, minWidth: 0}}>
                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <span
                        style={{
                            fontFamily: 'monospace',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: statusColor,
                        }}
                    >
                        {issueRef.identifier}
                    </span>
                    <span
                        style={{
                            backgroundColor: statusColor + '20',
                            color: statusColor,
                            border: `1px solid ${statusColor}40`,
                            padding: '1px 6px',
                            borderRadius: '12px',
                            fontSize: '10px',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {STATUS_LABELS[status] || issueRef.status}
                    </span>
                </div>
                <div
                    style={{
                        fontSize: '13px',
                        marginTop: '2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {issueRef.title}
                </div>
            </div>
            {isClickable && (
                <div style={{color: '#999', fontSize: '16px', flexShrink: 0}}>{'\u2192'}</div>
            )}
        </div>
    );
};

export default IssueRefCard;
