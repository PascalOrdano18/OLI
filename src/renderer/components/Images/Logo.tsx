// Copyright (c) 2016-present OLI, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

type Props = {
    width?: number;
    height?: number;
}

export default ({
    width = 170,
    height = 28,
}: Props) => (
    <svg
        width={width}
        height={height}
        viewBox='0 0 170 28'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
    >
        <circle
            cx='14'
            cy='14'
            r='13'
            fill='var(--center-channel-color)'
        />
        <circle
            cx='14'
            cy='14'
            r='8'
            fill='var(--center-channel-bg, #ffffff)'
        />
        <text
            x='38'
            y='21'
            fontFamily='-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif'
            fontSize='22'
            fontWeight='700'
            fill='var(--center-channel-color)'
        >
            {'OLI'}
        </text>
    </svg>
);
