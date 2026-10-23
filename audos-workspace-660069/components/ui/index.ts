/**
 * Vidverge shared UI layer.
 *
 *   import { AppShell, Card, Button, Badge, Input, Textarea } from '../../components/ui/index';
 *
 * The trailing `/index` is deliberate — every import in this space addresses a
 * file rather than a directory, which keeps module resolution identical to the
 * rest of the codebase.
 */

export { default as AppShell } from './AppShell';
export type { AppShellProps } from './AppShell';

export { default as SectionHeader } from './SectionHeader';
export type { SectionHeaderProps } from './SectionHeader';

export { default as Card } from './Card';
export type { CardProps } from './Card';

export { default as Button, Spinner } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { default as Badge } from './Badge';
export type { BadgeProps, BadgeVariant } from './Badge';

export { default as Input } from './Input';
export type { InputProps } from './Input';

export { default as Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';

export { default as VergeMark } from './VergeMark';
export type { VergeMarkProps } from './VergeMark';

export { default as GlobalStyles, GLOBAL_CSS, GLOBAL_STYLE_ID } from './GlobalStyles';

export { Field, Select, Tabs, Menu, Dialog, Drawer, Toast, Skeleton } from './V3Primitives';
export type { TabItem, MenuItem } from './V3Primitives';

export {
  Stepper,
  ProgressBar,
  StatChip,
  StatusDot,
  Waveform,
  UploadZone,
  PhoneFrame,
  EmptyState,
} from './primitives';
export type { StepperProps, StepperStep, UploadZoneProps } from './primitives';

export { COLORS, FONT, TYPE, RADIUS, SPACING, MOTION, SHADOW, GRADIENT, CSS_VARS, alpha, MOBILE_BREAKPOINT, CONTENT_MAX_WIDTH } from '../theme';
export { default as BeamBackground } from '../BeamBackground';
export { default as GridOverlay } from '../GridOverlay';
