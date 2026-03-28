// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import CodeSnippetCard from './code_snippet_card';
import IssueRefCard from './issue_ref_card';

interface OliData {
    code_snippets?: Array<{
        file: string;
        lines: string;
        language: string;
        content: string;
    }>;
    issue_refs?: Array<{
        id: string;
        identifier: string;
        title: string;
        status: string;
        priority: string;
    }>;
}

interface Props {
    post: {
        message: string;
        props?: {
            oli_data?: OliData;
        };
    };
}

const OliResponsePost: React.FC<Props> = ({post}) => {
    const oliData = post.props?.oli_data;
    const codeSnippets = oliData?.code_snippets || [];
    const issueRefs = oliData?.issue_refs || [];

    const hasCards = codeSnippets.length > 0 || issueRefs.length > 0;
    if (!hasCards) {
        // No rich cards — let Mattermost render the post normally.
        return null;
    }

    // Render only the rich embeds below the message.
    // Mattermost renders the message text itself; we append cards.
    return (
        <div className='issues-oli-response' style={{marginTop: '8px'}}>
            {codeSnippets.length > 0 && (
                <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
                    {codeSnippets.map((snippet, i) => (
                        <CodeSnippetCard key={`snippet-${i}`} snippet={snippet} />
                    ))}
                </div>
            )}
            {issueRefs.length > 0 && (
                <div style={{display: 'flex', flexDirection: 'column', gap: '4px', marginTop: codeSnippets.length > 0 ? '8px' : 0}}>
                    {issueRefs.map((ref) => (
                        <IssueRefCard key={ref.id} issueRef={ref} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default OliResponsePost;
