import type { ButtonProps } from 'react-bootstrap';

import type { ComponentType } from 'react';

import { Button } from 'react-bootstrap';

/**
 * react-bootstrap's `Button`, typed as a plain (non-polymorphic) component.
 * Its polymorphic `as` typing can blow TypeScript's union limit (TS2590,
 * "Expression produces a union type that is too complex to represent"),
 * and which `<Button>` trips it depends on check order — so suppressing it
 * per call site kept moving. Same runtime component; use this where TS2590
 * shows up.
 */
const BsButton = Button as unknown as ComponentType<ButtonProps>;

export default BsButton;
