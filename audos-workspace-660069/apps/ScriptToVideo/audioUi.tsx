/**
 * Shared look for the post-production audio screen (voice / music / SFX).
 *
 * Every value is a Vidverge Design System v3 token (components/theme.ts,
 * injected as --vg-* by components/ui/GlobalStyles.tsx): 44px controls with a
 * 10px radius, 12px cards, 24px padding (16px at <=480px, as `.vg-panel`),
 * `--vg-control-border` on form controls and `--vg-gradient-selected` for the
 * selected state. Nothing here hard-codes a colour, so form controls can no
 * longer fall back to the browser's white defaults.
 */
import { ChevronDown } from 'lucide-react';
import type { CSSProperties, ReactNode, SelectHTMLAttributes } from 'react';

const AUDIO_UI_CSS = `
.s2v-au, .s2v-au * { box-sizing: border-box; }
.s2v-au-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; padding: 4px; background: var(--vg-bg); border: 1px solid var(--vg-border); border-radius: 12px; }
.s2v-au-tab { display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 2px; min-width: 0; min-height: 44px; padding: 8px 12px; border: 0; border-radius: 10px; background: transparent; color: var(--vg-secondary); text-align: left; cursor: pointer; font: inherit; }
.s2v-au-tab:hover { background: var(--vg-hover); }
.s2v-au-tab[aria-selected="true"] { background: var(--vg-gradient-selected); box-shadow: inset 0 0 0 1px var(--vg-accent); color: var(--vg-text); }
.s2v-au-tab-top { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 13px; font-weight: 700; }
.s2v-au-tab-state { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 500; color: var(--vg-muted); }
.s2v-au-panel { margin-top: 12px; display: flex; flex-direction: column; gap: 16px; padding: 24px; background: var(--vg-surface); border: 1px solid var(--vg-border); border-radius: 12px; }
@media (max-width: 480px) { .s2v-au-panel { padding: 16px; } }
.s2v-au-label { font-size: 12px; font-weight: 600; color: var(--vg-secondary); }
.s2v-au-help { margin: 0; font-size: 12px; line-height: 1.5; color: var(--vg-muted); }
.s2v-au-msg { margin: 0; font-size: 13px; line-height: 1.5; color: var(--vg-secondary); }
.s2v-au-alert { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--vg-danger) 45%, transparent); border-radius: 10px; background: var(--vg-danger-bg); color: var(--vg-text); font-size: 13px; line-height: 1.5; }
.s2v-au-alert svg { flex-shrink: 0; margin-top: 2px; color: var(--vg-danger); }
.s2v-au-alert span { min-width: 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.s2v-au-item { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding: 16px; background: var(--vg-raised); border: 1px solid var(--vg-border); border-radius: 12px; }
.s2v-au-item-main { display: flex; align-items: center; gap: 12px; flex: 1 1 220px; min-width: 0; }
.s2v-au-item-text { min-width: 0; flex: 1; }
.s2v-au-item-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; font-weight: 700; color: var(--vg-text); }
.s2v-au-item-sub { margin-top: 2px; font-size: 12px; line-height: 1.4; color: var(--vg-secondary); overflow-wrap: anywhere; }
.s2v-au-item-sub.is-error { color: var(--vg-danger); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.s2v-au-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-left: auto; }
.s2v-au-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 16px; border: 1px solid var(--vg-control-border); border-radius: 10px; background: var(--vg-raised); color: var(--vg-text); font: inherit; font-size: 13px; font-weight: 650; white-space: nowrap; cursor: pointer; }
.s2v-au-btn:hover:not(:disabled) { background: var(--vg-hover); }
.s2v-au-btn.is-primary { border-color: transparent; background: var(--vg-gradient-action); color: var(--vg-on-accent); font-weight: 700; }
.s2v-au-btn.is-primary:hover:not(:disabled) { background: var(--vg-gradient-action-hover); }
.s2v-au-btn.is-primary:active:not(:disabled) { background: var(--vg-accent-pressed); }
.s2v-au-btn.is-icon { flex: 0 0 44px; width: 44px; padding: 0; border-radius: 999px; }
.s2v-au-btn:disabled { cursor: not-allowed; color: var(--vg-muted); }
.s2v-au-btn.is-primary:disabled { background: var(--vg-raised); border-color: var(--vg-border); }
.s2v-au-btn:focus-visible, .s2v-au-tab:focus-visible, .s2v-au-source:focus-visible, .s2v-au-field:focus-visible { outline: 2px solid var(--vg-focus); outline-offset: 3px; }
.s2v-au-select { position: relative; width: 100%; }
.s2v-au-select svg { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: var(--vg-muted); pointer-events: none; }
.s2v-au-field { display: block; width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid var(--vg-control-border); border-radius: 10px; background-color: var(--vg-bg); color: var(--vg-text); font: inherit; font-size: 13px; color-scheme: dark; }
.s2v-au-field::placeholder { color: var(--vg-muted); }
select.s2v-au-field { appearance: none; -webkit-appearance: none; padding-right: 36px; cursor: pointer; text-overflow: ellipsis; }
select.s2v-au-field option { background: var(--vg-raised); color: var(--vg-text); }
.s2v-au-field:hover:not(:disabled) { border-color: var(--vg-secondary); }
.s2v-au-field:focus { border-color: var(--vg-accent); }
.s2v-au-field:disabled { opacity: 0.55; cursor: not-allowed; }
.s2v-au-sources { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; }
.s2v-au-source { display: flex; align-items: flex-start; gap: 10px; min-height: 44px; padding: 12px; border: 1px solid var(--vg-control-border); border-radius: 10px; background: var(--vg-bg); color: var(--vg-text); text-align: left; font: inherit; cursor: pointer; }
.s2v-au-source:hover:not(:disabled) { background: var(--vg-hover); }
.s2v-au-source[aria-checked="true"] { border-color: var(--vg-accent); background: var(--vg-gradient-selected); }
.s2v-au-source:disabled { cursor: not-allowed; opacity: 0.5; }
.s2v-au-source-dot { flex: 0 0 12px; width: 12px; height: 12px; margin-top: 3px; border: 2px solid var(--vg-control-border); border-radius: 999px; }
.s2v-au-source[aria-checked="true"] .s2v-au-source-dot { border-color: var(--vg-accent); background: var(--vg-accent); }
.s2v-au-source-name { display: block; font-size: 13px; font-weight: 700; }
.s2v-au-source-blurb { display: block; margin-top: 2px; font-size: 12px; line-height: 1.45; color: var(--vg-muted); }
.s2v-au-effects { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.s2v-au-effects li { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--vg-border); font-size: 13px; color: var(--vg-secondary); }
.s2v-au-effects li:last-child { border-bottom: 0; }
.s2v-au-effects .s2v-au-effect-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.s2v-au-effects .s2v-au-effect-meta { flex-shrink: 0; font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace; font-size: 12px; color: var(--vg-muted); }
@media (prefers-reduced-motion: reduce) { .s2v-au * { transition-duration: 0.01ms !important; } }
`;

export function AudioUiStyles() {
  return <style>{AUDIO_UI_CSS}</style>;
}

/** A native select drawn in the dark control style, with its own chevron. */
export function SelectField(props: SelectHTMLAttributes<HTMLSelectElement> & { wrapStyle?: CSSProperties; children: ReactNode }) {
  const { wrapStyle, children, className, ...rest } = props;
  return (
    <div className="s2v-au-select" style={wrapStyle}>
      <select {...rest} className={`s2v-au-field${className ? ` ${className}` : ''}`}>{children}</select>
      <ChevronDown size={14} aria-hidden />
    </div>
  );
}
