import React from 'react';
import { ScreenBase, type ScreenProps } from './ScreenBase';

/** Feature-two workflow builder: cursor click, node transitions and activation state. */
export default function Screen2(props: ScreenProps) {
  return <ScreenBase {...props} variant="automation" />;
}
