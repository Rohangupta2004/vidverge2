// ONE INPUT DESIGN for every SceneForge surface.
//
// The studio, the HeyGen suite and the workbench each grew their own field
// styling, so a text box, a select and a textarea three panels apart had three
// heights, three paddings and three focus treatments — and some of them had no
// visible focus state at all, only a border tint. This file is the single
// definition both halves of the app read from:
//
//   * `SF_FIELD_CSS` — the scoped stylesheet the `.sfstudio` surfaces inject,
//     so `className="st-field"` means exactly one thing everywhere.
//   * `FIELD_CLASS` and friends — the same design as Tailwind utilities, for
//     components (ElevenVoicePicker) that are mounted on BOTH the `.sfstudio`
//     surfaces and the `--sf-*` workbench and therefore cannot depend on the
//     scoped sheet.
//
// THE RULES IT ENFORCES:
//   * One control height (44px) and one radius, so a row of mixed controls
//     lines up instead of stair-stepping.
//   * A real focus ring — a 3px halo, not a border that changes colour by ten
//     per cent. Keyboard users have to be able to see where they are.
//   * An error STATE on the field (red border) with helper text beneath it, so
//     a validation failure is attached to the input that caused it rather than
//     living in a toast that disappears.
//   * Padding that cannot be eaten by a leading icon: `st-field--icon` exists
//     because a Tailwind `pl-9` loses to the scoped `.sfstudio .st-field`
//     padding on specificity, which is why those search boxes used to render
//     their text underneath the magnifier.

/** Control height, in px, shared by inputs, selects, textarea rows and buttons. */
export const FIELD_HEIGHT_PX = 44;

// The caret is inlined as a data URL so a select looks like the rest of the
// family instead of falling back to the browser's own chrome.
const CARET = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%237A6030' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6.5 8 10.5l4-4'/%3E%3C/svg%3E";

/**
 * The scoped field stylesheet. Injected by every `.sfstudio` surface (the Avatar
 * Studio and the HeyGen suite) so the classes below behave identically on both.
 */
export const SF_FIELD_CSS = [
  '.sfstudio .st-field, .sfstudio .st-select, .sfstudio .st-textarea {',
  `  width: 100%; min-height: ${FIELD_HEIGHT_PX / 16}rem; border-radius: .75rem;`,
  '  border: 1px solid var(--space-border-default);',
  '  background: var(--space-surface-panel);',
  '  padding: .625rem .875rem;',
  '  font: inherit; font-size: .875rem; line-height: 1.45;',
  '  color: var(--space-text-primary);',
  '  outline: none;',
  '  transition: border-color .18s ease, box-shadow .18s ease, background-color .18s ease;',
  '}',
  // A leading icon needs room that the base padding would otherwise claim.
  '.sfstudio .st-field--icon { padding-left: 2.5rem; }',
  '.sfstudio .st-textarea { min-height: 5.75rem; resize: vertical; }',
  '.sfstudio .st-select {',
  '  appearance: none; -webkit-appearance: none; cursor: pointer;',
  '  padding-right: 2.5rem;',
  `  background-image: url("${CARET}");`,
  '  background-repeat: no-repeat; background-position: right .875rem center; background-size: 1rem 1rem;',
  '}',
  '.sfstudio .st-field::placeholder, .sfstudio .st-textarea::placeholder { color: var(--space-text-muted); opacity: 1; }',
  '.sfstudio .st-field:hover:not(:disabled), .sfstudio .st-select:hover:not(:disabled), .sfstudio .st-textarea:hover:not(:disabled) { border-color: var(--space-border-strong); }',
  // The focus ring is deliberately loud: a colour-only focus state is not a
  // focus state.
  '.sfstudio .st-field:focus, .sfstudio .st-select:focus, .sfstudio .st-textarea:focus {',
  '  border-color: #C8920A;',
  '  box-shadow: 0 0 0 3px rgba(200, 146, 10, .42), 0 0 0 6px rgba(200, 146, 10, .14);',
  '}',
  '.sfstudio .st-field:disabled, .sfstudio .st-select:disabled, .sfstudio .st-textarea:disabled { opacity: .55; cursor: not-allowed; }',
  // File inputs sit in the same frame as everything else rather than as a bare
  // browser control floating in a panel.
  '.sfstudio .st-field[type="file"] { padding: .5rem .75rem; display: flex; align-items: center; cursor: pointer; }',
  // Error state: on the field itself, with its own ring, so the eye lands on
  // the control that needs fixing.
  '.sfstudio .st-field--error, .sfstudio .st-select--error, .sfstudio .st-textarea--error { border-color: var(--space-semantic-danger-500, #f43f5e); }',
  '.sfstudio .st-field--error:focus, .sfstudio .st-select--error:focus, .sfstudio .st-textarea--error:focus {',
  '  border-color: var(--space-semantic-danger-500, #f43f5e);',
  '  box-shadow: 0 0 0 3px rgba(153, 27, 27, .38);',
  '}',
  '.sfstudio .st-field-error { display: block; margin-top: .375rem; font-size: .75rem; line-height: 1.45; color: var(--space-semantic-danger, #fb7185); }',
  '.sfstudio .st-field-hint { display: block; margin-top: .375rem; font-size: .75rem; line-height: 1.45; color: var(--space-text-muted); }',
  '.sfstudio .st-field-label { display: block; margin-bottom: .375rem; font-size: .6875rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--space-text-muted); }',
].join('\n');

/**
 * The same field design, scoped to the Motion Graphics Editor (`.sfme`).
 *
 * The editor's inspector is a narrow sidebar, so its TYPE stays one step
 * smaller — but the BOX is identical: the same 44px height, radius, padding and
 * focus ring as every other SceneForge control. The old definition used .45rem
 * of padding and a .6rem radius, which is why a select in the inspector looked
 * like it came from a different product than the same select in the studio.
 */
export const SFME_FIELD_CSS = [
  '.sfme .sf-input, .sfme .sf-select, .sfme .sf-textarea {',
  `  width: 100%; min-height: ${FIELD_HEIGHT_PX / 16}rem; border-radius: .75rem;`,
  '  border: 1px solid var(--space-border-default);',
  '  background: var(--space-surface-panel);',
  '  padding: .5rem .75rem;',
  '  font: inherit; font-size: .8125rem; line-height: 1.45;',
  '  color: var(--space-text-primary);',
  '  outline: none;',
  '  transition: border-color .18s ease, box-shadow .18s ease;',
  '}',
  '.sfme .sf-textarea { min-height: 5rem; resize: vertical; }',
  '.sfme .sf-select, .sfme select.sf-input { cursor: pointer; }',
  '.sfme .sf-input::placeholder, .sfme .sf-textarea::placeholder { color: var(--space-text-muted); opacity: 1; }',
  '.sfme .sf-input:hover:not(:disabled) { border-color: var(--space-border-strong); }',
  '.sfme .sf-input:focus, .sfme .sf-select:focus, .sfme .sf-textarea:focus {',
  '  border-color: #C8920A;',
  '  box-shadow: 0 0 0 3px rgba(200, 146, 10, .42), 0 0 0 6px rgba(200, 146, 10, .14);',
  '}',
  '.sfme .sf-input:disabled { opacity: .55; cursor: not-allowed; }',
  '.sfme .sf-input--error { border-color: var(--space-semantic-danger-500, #f43f5e); }',
  '.sfme .sf-input--error:focus { border-color: var(--space-semantic-danger-500, #f43f5e); box-shadow: 0 0 0 3px rgba(153, 27, 27, .38); }',
  '.sfme .sf-field-error { display: block; margin-top: .375rem; font-size: .6875rem; line-height: 1.45; color: var(--space-semantic-danger, #fb7185); }',
].join('\n');

// ——— The same design as Tailwind utilities ———
//
// For components mounted on surfaces that do NOT carry the `.sfstudio` scope.
// Keep these in step with the stylesheet above — they describe one design, and
// a customer meeting the ElevenLabs voice picker in the workbench should not be
// able to tell it apart from the same picker in the studio.

const FIELD_BASE = 'w-full rounded-xl border bg-[var(--space-surface-panel)] text-sm leading-normal text-[var(--space-text-primary)] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-[var(--space-text-muted)] disabled:cursor-not-allowed disabled:opacity-55';
const FIELD_RESTING = 'border-[var(--space-border-default)] hover:border-[var(--space-border-strong)] focus:border-[#C8920A] focus:shadow-[0_0_0_3px_color-mix(in_srgb,#C8920A_42%,transparent)]';
const FIELD_INVALID = 'border-[var(--space-semantic-danger-500)] focus:border-[var(--space-semantic-danger-500)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--space-semantic-danger-500)_38%,transparent)]';

/** A single-line text input. */
export const FIELD_CLASS = `h-11 px-3.5 ${FIELD_BASE} ${FIELD_RESTING}`;
/** The same input with room for a leading icon. */
export const FIELD_ICON_CLASS = `h-11 px-3.5 pl-10 ${FIELD_BASE} ${FIELD_RESTING}`;
/** A select, caret drawn by the browser (a native caret beats a missing one). */
export const SELECT_CLASS = `h-11 cursor-pointer px-3.5 ${FIELD_BASE} ${FIELD_RESTING}`;
/** A multi-line input. */
export const TEXTAREA_CLASS = `min-h-[5.75rem] resize-y px-3.5 py-2.5 ${FIELD_BASE} ${FIELD_RESTING}`;

/** The error variants — same geometry, red border and red focus ring. */
export const FIELD_ERROR_CLASS = `h-11 px-3.5 ${FIELD_BASE} ${FIELD_INVALID}`;
export const SELECT_ERROR_CLASS = `h-11 cursor-pointer px-3.5 ${FIELD_BASE} ${FIELD_INVALID}`;
export const TEXTAREA_ERROR_CLASS = `min-h-[5.75rem] resize-y px-3.5 py-2.5 ${FIELD_BASE} ${FIELD_INVALID}`;

/** The helper line under a field that failed validation. */
export const FIELD_ERROR_TEXT_CLASS = 'mt-1.5 block text-xs leading-relaxed text-[var(--space-semantic-danger)]';
/** The helper line under a field that is merely explaining itself. */
export const FIELD_HINT_TEXT_CLASS = 'mt-1.5 block text-xs leading-relaxed text-[var(--space-text-muted)]';
/** The small caps label above a field. */
export const FIELD_LABEL_CLASS = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[.08em] text-[var(--space-text-muted)]';

/** Pick the right class for a control that may be in an error state. */
export function fieldClass(invalid?: boolean, withIcon?: boolean): string {
  if (invalid) return FIELD_ERROR_CLASS;
  return withIcon ? FIELD_ICON_CLASS : FIELD_CLASS;
}
export function selectClass(invalid?: boolean): string {
  return invalid ? SELECT_ERROR_CLASS : SELECT_CLASS;
}
export function textareaClass(invalid?: boolean): string {
  return invalid ? TEXTAREA_ERROR_CLASS : TEXTAREA_CLASS;
}
