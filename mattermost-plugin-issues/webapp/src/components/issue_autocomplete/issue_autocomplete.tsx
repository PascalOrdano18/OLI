// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useState, useRef, useCallback} from 'react';

import client from '../../client/client';
import type {Issue} from '../../types/model';
import {STATUS_COLORS, PRIORITY_COLORS} from '../../types/model';

const PRIORITY_ICONS: Record<string, string> = {
    urgent: '!!!',
    high: '\u2191',
    medium: '\u2014',
    low: '\u2193',
    none: '\u25CB',
};

const TRIGGER = '#';
const MAX_RESULTS = 5;
const DEBOUNCE_MS = 200;

const IssueAutocomplete: React.FC = () => {
    const [open, setOpen] = useState(false);
    const [results, setResults] = useState<Issue[]>([]);
    const [highlightIndex, setHighlightIndex] = useState(0);
    const [position, setPosition] = useState({bottom: 0, left: 0, width: 0});
    const triggerStartRef = useRef<number>(-1);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const textboxRef = useRef<HTMLTextAreaElement | null>(null);

    const getTextbox = useCallback((): HTMLTextAreaElement | null => {
        if (textboxRef.current && document.body.contains(textboxRef.current)) {
            return textboxRef.current;
        }
        const el = document.getElementById('post_textbox') as HTMLTextAreaElement | null;
        textboxRef.current = el;
        return el;
    }, []);

    const insertIssueRef = useCallback((issue: Issue) => {
        const textbox = getTextbox();
        if (!textbox || triggerStartRef.current < 0) {
            return;
        }
        const value = textbox.value;
        const before = value.substring(0, triggerStartRef.current);
        const after = value.substring(textbox.selectionStart);
        const token = `{{issue:${issue.identifier}}}`;
        const newValue = before + token + after;

        // Set value via native input setter to trigger React's onChange.
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeSetter) {
            nativeSetter.call(textbox, newValue);
        } else {
            textbox.value = newValue;
        }
        textbox.dispatchEvent(new Event('input', {bubbles: true}));

        const cursorPos = before.length + token.length;
        textbox.setSelectionRange(cursorPos, cursorPos);
        textbox.focus();

        setOpen(false);
        setResults([]);
        triggerStartRef.current = -1;
    }, [getTextbox]);

    const search = useCallback(async (query: string) => {
        if (query.length < 1) {
            setResults([]);
            return;
        }
        try {
            const issues = await client.searchAllIssues(query, MAX_RESULTS);
            setResults(issues || []);
            setHighlightIndex(0);
        } catch {
            setResults([]);
        }
    }, []);

    useEffect(() => {
        const handleInput = () => {
            const textbox = getTextbox();
            if (!textbox) {
                return;
            }
            const value = textbox.value;
            const cursor = textbox.selectionStart;

            // Find the last # before cursor that is preceded by space or is at position 0.
            let triggerPos = -1;
            for (let i = cursor - 1; i >= 0; i--) {
                if (value[i] === ' ' || value[i] === '\n') {
                    break;
                }
                if (value[i] === TRIGGER) {
                    if (i === 0 || value[i - 1] === ' ' || value[i - 1] === '\n') {
                        triggerPos = i;
                    }
                    break;
                }
            }

            if (triggerPos < 0) {
                setOpen(false);
                triggerStartRef.current = -1;
                return;
            }

            triggerStartRef.current = triggerPos;
            const query = value.substring(triggerPos + 1, cursor);

            // Position dropdown above the textbox.
            const rect = textbox.getBoundingClientRect();
            setPosition({
                bottom: window.innerHeight - rect.top + 4,
                left: rect.left,
                width: rect.width,
            });

            setOpen(true);

            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
            debounceRef.current = setTimeout(() => search(query), DEBOUNCE_MS);
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (!open || results.length === 0) {
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightIndex((prev) => (prev + 1) % results.length);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightIndex((prev) => (prev - 1 + results.length) % results.length);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                e.stopPropagation();
                insertIssueRef(results[highlightIndex]);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
                triggerStartRef.current = -1;
            }
        };

        // Observe DOM for the textbox (it might not exist on mount).
        const interval = setInterval(() => {
            const textbox = getTextbox();
            if (textbox && !(textbox as any).__issueAutocompleteAttached) {
                textbox.addEventListener('input', handleInput);
                textbox.addEventListener('keydown', handleKeyDown, true);
                (textbox as any).__issueAutocompleteAttached = true;
            }
        }, 500);

        return () => {
            clearInterval(interval);
            const textbox = getTextbox();
            if (textbox) {
                textbox.removeEventListener('input', handleInput);
                textbox.removeEventListener('keydown', handleKeyDown, true);
                (textbox as any).__issueAutocompleteAttached = false;
            }
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, [open, results, highlightIndex, getTextbox, search, insertIssueRef]);

    if (!open || results.length === 0) {
        return null;
    }

    return (
        <div
            style={{
                position: 'fixed',
                bottom: position.bottom,
                left: position.left,
                width: position.width,
                zIndex: 10001,
                backgroundColor: '#2a2a2e',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '8px',
                boxShadow: '0 -4px 16px rgba(0, 0, 0, 0.4)',
                overflow: 'hidden',
            }}
        >
            <div
                style={{
                    padding: '8px 12px',
                    fontSize: '11px',
                    color: '#888',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                }}
            >
                {'Issues'}
            </div>
            {results.map((issue, i) => {
                const statusColor = STATUS_COLORS[issue.status as keyof typeof STATUS_COLORS] || '#909399';
                const priorityColor = PRIORITY_COLORS[issue.priority as keyof typeof PRIORITY_COLORS] || '#909399';
                return (
                    <div
                        key={issue.id}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '8px 12px',
                            cursor: 'pointer',
                            backgroundColor: i === highlightIndex ? 'rgba(64, 158, 255, 0.1)' : 'transparent',
                        }}
                        onMouseEnter={() => setHighlightIndex(i)}
                        onMouseDown={(e) => {
                            e.preventDefault(); // Prevent textbox blur.
                            insertIssueRef(issue);
                        }}
                    >
                        <div
                            style={{
                                width: '24px',
                                height: '24px',
                                borderRadius: '4px',
                                backgroundColor: statusColor + '20',
                                border: `1px solid ${statusColor}40`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            <span style={{color: priorityColor, fontSize: '10px', fontWeight: 700}}>
                                {PRIORITY_ICONS[issue.priority] || '\u25CB'}
                            </span>
                        </div>
                        <span
                            style={{
                                fontFamily: 'monospace',
                                fontSize: '12px',
                                fontWeight: 600,
                                color: statusColor,
                                flexShrink: 0,
                            }}
                        >
                            {issue.identifier}
                        </span>
                        <span
                            style={{
                                fontSize: '13px',
                                color: '#ddd',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {issue.title}
                        </span>
                    </div>
                );
            })}
            <div
                style={{
                    padding: '6px 12px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                    fontSize: '11px',
                    color: '#666',
                }}
            >
                <kbd style={{background: 'rgba(255,255,255,0.08)', padding: '1px 4px', borderRadius: '3px', fontSize: '10px'}}>{'\u2191\u2193'}</kbd>{' navigate  '}
                <kbd style={{background: 'rgba(255,255,255,0.08)', padding: '1px 4px', borderRadius: '3px', fontSize: '10px'}}>{'Enter'}</kbd>{' select  '}
                <kbd style={{background: 'rgba(255,255,255,0.08)', padding: '1px 4px', borderRadius: '3px', fontSize: '10px'}}>{'Esc'}</kbd>{' dismiss'}
            </div>
        </div>
    );
};

export default IssueAutocomplete;
