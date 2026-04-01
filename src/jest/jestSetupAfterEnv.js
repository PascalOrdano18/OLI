// Copyright (c) 2016-present OLI, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/* eslint-disable no-undef */

function toContainObject(received, argument) {
    const pass = this.equals(received,
        expect.arrayContaining([
            expect.objectContaining(argument),
        ]),
    );

    if (pass) {
        return {
            message: () => (`expected ${this.utils.printReceived(received)} not to contain object ${this.utils.printExpected(argument)}`),
            pass: true,
        };
    }
    return {
        message: () => (`expected ${this.utils.printReceived(received)} to contain object ${this.utils.printExpected(argument)}`),
        pass: false,
    };
}

expect.extend({
    toContainObject,
});
