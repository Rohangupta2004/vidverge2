import React from 'react';
import { ScreenBase, type ScreenProps } from './ScreenBase';

/** Feature-three analytics screen: animated chart, export click and completed state. */
export default function Screen3(props: ScreenProps) {
  return <ScreenBase {...props} variant="analytics" />;
}
