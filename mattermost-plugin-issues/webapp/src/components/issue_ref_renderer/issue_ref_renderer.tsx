// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useRef, useCallback} from 'react';
import ReactDOM from 'react-dom';

import client from '../../client/client';
import type {Issue} from '../../types/model';
import {STATUS_COLORS} from '../../types/model';
import IssueRefCard from '../oli/issue_ref_card';
import type {IssueRefData} from '../oli/issue_ref_card';

const ISSUE_REF_REGEX = /\{\{issue:([A-Z]+-\d+)\}\}/g;
const PROCESSED_ATTR = 'data-issue-refs-processed';

const issueCache = new Map<string, Issue>();

async function resolveIssue(identifier: string): Promise<Issue | null> {
    if (issueCache.has(identifier)) {
        return issueCache.get(identifier)!;
    }
    try {
        const issue = await client.getIssueByIdentifier(identifier);
        issueCache.set(identifier, issue);
        return issue;
    } catch {
        return null;
    }
}

function handleIssueClick(issueRef: IssueRefData) {
    console.log('[IssueRefRenderer] Card clicked!', issueRef.id, issueRef.identifier);
    console.log('[IssueRefRenderer] desktopAPI:', (window as any).desktopAPI);
    console.log('[IssueRefRenderer] navigateToIssue:', (window as any).desktopAPI?.navigateToIssue);
    const api = (window as any).desktopAPI;
    if (api?.navigateToIssue) {
        console.log('[IssueRefRenderer] Calling navigateToIssue...');
        api.navigateToIssue(issueRef.id);
    } else {
        console.log('[IssueRefRenderer] navigateToIssue NOT available!');
    }
}

async function processPost(postEl: Element) {
    if (postEl.getAttribute(PROCESSED_ATTR)) {
        return;
    }
    postEl.setAttribute(PROCESSED_ATTR, 'true');

    // Find the message body element.
    const messageEl = postEl.querySelector('.post-message__text, .post-message__text-container');
    if (!messageEl) {
        return;
    }

    const textContent = messageEl.textContent || '';
    const matches = [...textContent.matchAll(ISSUE_REF_REGEX)];
    if (matches.length === 0) {
        return;
    }

    // Collect unique identifiers.
    const identifiers = [...new Set(matches.map((m) => m[1]))];
    const issues: Issue[] = [];
    for (const identifier of identifiers) {
        const issue = await resolveIssue(identifier);
        if (issue) {
            issues.push(issue);
        }
    }

    if (issues.length === 0) {
        return;
    }

    // Replace {{issue:ID}} tokens in the text with styled inline identifiers.
    const walker = document.createTreeWalker(messageEl, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
        if (ISSUE_REF_REGEX.test(node.textContent || '')) {
            textNodes.push(node);
        }
        ISSUE_REF_REGEX.lastIndex = 0;
    }

    for (const textNode of textNodes) {
        const text = textNode.textContent || '';
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        const regex = new RegExp(ISSUE_REF_REGEX.source, 'g');

        while ((match = regex.exec(text)) !== null) {
            // Text before the match.
            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
            }

            // Create styled inline identifier.
            const identifier = match[1];
            const issue = issues.find((i) => i.identifier === identifier);
            const span = document.createElement('span');
            span.textContent = identifier;
            const color = issue ? (STATUS_COLORS[issue.status as keyof typeof STATUS_COLORS] || '#909399') : '#909399';
            span.style.fontWeight = '600';
            span.style.color = color;
            fragment.appendChild(span);

            lastIndex = regex.lastIndex;
        }

        if (lastIndex < text.length) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
        }

        textNode.parentNode?.replaceChild(fragment, textNode);
    }

    // Append issue cards below the message.
    const cardsContainer = document.createElement('div');
    cardsContainer.style.display = 'flex';
    cardsContainer.style.flexDirection = 'column';
    cardsContainer.style.gap = '4px';
    cardsContainer.style.marginTop = '8px';
    messageEl.parentElement?.appendChild(cardsContainer);

    ReactDOM.render(
        <React.Fragment>
            {issues.map((issue) => (
                <IssueRefCard
                    key={issue.id}
                    issueRef={{
                        id: issue.id,
                        identifier: issue.identifier,
                        title: issue.title,
                        status: issue.status,
                        priority: issue.priority,
                    }}
                    onClick={handleIssueClick}
                />
            ))}
        </React.Fragment>,
        cardsContainer,
    );
}

const IssueRefRenderer: React.FC = () => {
    const observerRef = useRef<MutationObserver | null>(null);
    const scanPendingRef = useRef(false);

    const scanPosts = useCallback(() => {
        const posts = document.querySelectorAll(`.post:not([${PROCESSED_ATTR}])`);
        posts.forEach((post) => processPost(post));
    }, []);

    useEffect(() => {
        // Initial scan.
        scanPosts();

        // Observe for new posts with RAF throttling to avoid feedback loops.
        const container = document.getElementById('post-list') || document.body;
        observerRef.current = new MutationObserver(() => {
            if (scanPendingRef.current) {
                return;
            }
            scanPendingRef.current = true;
            requestAnimationFrame(() => {
                scanPosts();
                scanPendingRef.current = false;
            });
        });
        observerRef.current.observe(container, {childList: true, subtree: true});

        return () => {
            observerRef.current?.disconnect();
        };
    }, [scanPosts]);

    return null;
};

export default IssueRefRenderer;
