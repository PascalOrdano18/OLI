// Copyright (c) 2016-present OLI, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useEffect} from 'react';
import {FormattedMessage} from 'react-intl';

import './ServerDropdownButton.scss';

type Props = {
    isDisabled?: boolean;
    activeServerName?: string;
    isMenuOpen: boolean;
}

const ServerDropdownButton: React.FC<Props> = (props: Props) => {
    const {isDisabled, activeServerName, isMenuOpen} = props;
    const buttonRef: React.RefObject<HTMLButtonElement> = React.createRef();

    useEffect(() => {
        if (!isMenuOpen) {
            buttonRef.current?.blur();
        }
    }, [isMenuOpen]);

    const handleToggleButton = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (isMenuOpen) {
            window.desktop.closeServersDropdown();
        } else {
            window.desktop.openServersDropdown();
        }
    };

    return (
        <button
            ref={buttonRef}
            disabled={isDisabled}
            className={classNames('ServerDropdownButton', {
                disabled: isDisabled,
                isMenuOpen,
            })}
            onClick={handleToggleButton}
            onDoubleClick={(event) => {
                event.stopPropagation();
            }}
        >
            <i className='icon-server-variant'/>
            {activeServerName && <span>{activeServerName}</span>}
            {!activeServerName &&
                <FormattedMessage
                    id='renderer.components.serverDropdownButton.noServersConfigured'
                    defaultMessage='No servers configured'
                />
            }
            <i className='icon-chevron-down'/>
        </button>
    );
};

export default ServerDropdownButton;
