import React from 'react';
import { ScreenBase, type ScreenProps } from './ScreenBase';

/** Feature-one workspace: typed input, upload state, animated run and success preview. */
export default function Screen1(props: ScreenProps) {
  return <ScreenBase {...props} variant="workspace" />;
}
