// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

interface CodeSnippetData {
    file: string;
    lines: string;
    language: string;
    content: string;
}

interface Props {
    snippet: CodeSnippetData;
}

const CodeSnippetCard: React.FC<Props> = ({snippet}) => {
    // Strip line numbers from content for display (they come as "123: code").
    const lines = snippet.content.split('\n');

    return (
        <div
            className='issues-oli-code-snippet'
            style={{
                borderRadius: '8px',
                overflow: 'hidden',
                border: '1px solid rgba(0, 0, 0, 0.12)',
                marginTop: '4px',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 12px',
                    backgroundColor: 'rgba(0, 0, 0, 0.06)',
                    borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
                }}
            >
                <span
                    style={{
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        fontWeight: 600,
                        backgroundColor: 'rgba(0, 0, 0, 0.08)',
                        padding: '2px 8px',
                        borderRadius: '4px',
                    }}
                >
                    {snippet.file}
                </span>
                {snippet.lines && (
                    <span
                        style={{
                            fontSize: '11px',
                            color: '#909399',
                        }}
                    >
                        {'L'}{snippet.lines}
                    </span>
                )}
                <span
                    style={{
                        fontSize: '10px',
                        color: '#909399',
                        marginLeft: 'auto',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                    }}
                >
                    {snippet.language}
                </span>
            </div>
            <pre
                style={{
                    margin: 0,
                    padding: '10px 12px',
                    backgroundColor: '#1e1e1e',
                    color: '#d4d4d4',
                    fontSize: '12px',
                    lineHeight: '1.5',
                    overflow: 'auto',
                    maxHeight: '400px',
                }}
            >
                <code>
                    {lines.map((line, i) => (
                        <div key={i} style={{display: 'flex'}}>
                            <span
                                style={{
                                    color: '#858585',
                                    userSelect: 'none',
                                    minWidth: '40px',
                                    textAlign: 'right',
                                    paddingRight: '12px',
                                    flexShrink: 0,
                                }}
                            >
                                {line.match(/^(\d+):/)?.[1] || ''}
                            </span>
                            <span style={{flex: 1}}>
                                {line.replace(/^\d+:\s?/, '')}
                            </span>
                        </div>
                    ))}
                </code>
            </pre>
        </div>
    );
};

export default CodeSnippetCard;
