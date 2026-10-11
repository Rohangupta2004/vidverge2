/**
 * SAAS VERGER — ADVANCED OPTIONS.
 *
 * Three OPTIONAL inputs that sit below the primary URL hero, collapsed by
 * default so the one-URL route stays the headline:
 *
 *   1. Paste your script    — overrides the auto-generated brief copy.
 *   2. Upload voiceover     — replaces the generated ElevenLabs narration.
 *   3. Screenshots (max 6)  — extra B-roll visuals for scene matching.
 *
 * Every input is additive: leaving the panel untouched leaves the autonomous
 * pipeline exactly as it was. Uploads reuse the app's own /api/upload/file
 * pattern (App.tsx owns the calls) — this component is presentation plus the
 * file-picker plumbing.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  AlertTriangle, ChevronDown, FileText, Image as PictureIcon, Loader2, Upload, Volume2, X,
} from 'lucide-react';

export type UploadedAudio = {
  name: string;
  url: string;
  /** Measured in the browser at upload time so the render can be made long
   * enough to hold the whole track. 0 when the browser could not read it. */
  durationSeconds?: number;
};
export type BrollShot = { id: string; name: string; previewUrl: string; url: string | null; uploading: boolean };

export const MAX_BROLL = 6;

export type AdvancedInputsProps = {
  disabled: boolean;
  scriptText: string;
  onScriptText: (value: string) => void;
  audio: UploadedAudio | null;
  audioBusy: boolean;
  audioError: string;
  onAudioPick: (file: File) => void;
  onAudioRemove: () => void;
  shots: BrollShot[];
  shotsError: string;
  onShotsPick: (files: File[]) => void;
  onShotRemove: (id: string) => void;
};

/** Scoped keyframes + hover/press behaviour. Inline styles cannot express
 * either, and the app ships no global stylesheet. */
export const ADVANCED_CSS = `
@keyframes sv-fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes sv-pop { from { opacity: 0; transform: scale(.94) translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes sv-pulse { 0%, 100% { opacity: .45; } 50% { opacity: .85; } }
.sv-fade-up { animation: sv-fade-up .34s cubic-bezier(.22,.9,.3,1) both; }
.sv-pop { animation: sv-pop .32s cubic-bezier(.22,.9,.3,1) both; }
.sv-skeleton { animation: sv-pulse 1.5s ease-in-out infinite; }
.sv-press { transition: transform .16s cubic-bezier(.22,.9,.3,1), background-color .16s ease, border-color .16s ease, box-shadow .16s ease, opacity .16s ease; }
.sv-press:active:not(:disabled) { transform: scale(.97); }
.sv-lift { transition: transform .22s cubic-bezier(.22,.9,.3,1), box-shadow .22s ease, border-color .22s ease; }
.sv-lift:hover { transform: translateY(-2px); box-shadow: 0 16px 38px rgba(120,80,0,0.12); }
.sv-field { transition: box-shadow .18s ease, border-color .18s ease, background-color .18s ease; }
.sv-field:focus { outline: none; box-shadow: 0 0 0 1px #C8920A, 0 0 0 4px rgba(200,146,10,.16); border-color: #C8920A; }
.sv-drop { transition: border-color .18s ease, background-color .18s ease, transform .18s ease; }
.sv-drop[data-over="true"] { border-color: #C8920A; background: rgba(200,146,10,.1); transform: translateY(-1px); }
.sv-ghost:hover:not(:disabled) { background: rgba(180,120,0,0.10); color: #1A1000; }
@media (prefers-reduced-motion: reduce) {
  .sv-fade-up, .sv-pop, .sv-skeleton { animation: none !important; }
  .sv-press, .sv-lift, .sv-field, .sv-drop { transition: none !important; }
}
`;

const AUDIO_TYPES = '.mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-m4a,audio/mp4';
const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif';

const LABEL: CSSProperties = {
  fontSize: 13, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#7A6030',
};
const HINT: CSSProperties = { fontSize: 13, color: '#7A6030', lineHeight: 1.55 };
const SECTION: CSSProperties = {
  padding: 16, borderRadius: 16, background: '#FFFFFF', border: '1px solid rgba(180,120,0,0.14)',
};

function Chip({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' | 'bad' }) {
  const palette = tone === 'accent'
    ? { color: '#B4720A', background: 'rgba(200,146,10,.16)', border: '1px solid rgba(180,120,0,0.36)' }
    : tone === 'bad'
      ? { color: '#991B1B', background: 'rgba(153,27,27,.10)', border: '1px solid rgba(153,27,27,.26)' }
      : { color: '#7A6030', background: '#FFFAEB', border: '1px solid rgba(180,120,0,0.14)' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, letterSpacing: '.02em', ...palette }}>
      {children}
    </span>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="sv-fade-up" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8, padding: '10px 12px', borderRadius: 12, color: '#991B1B', background: 'rgba(153,27,27,.08)', border: '1px solid rgba(153,27,27,.26)', fontSize: 13, lineHeight: 1.5 }}>
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{message}</span>
    </div>
  );
}

/** A one-line description of what the customer has added, shown while the
 * panel is closed so nothing optional is ever silently in play. */
export function advancedSummary(scriptText: string, audio: UploadedAudio | null, shots: BrollShot[]): string {
  const parts: string[] = [];
  if (scriptText.trim()) parts.push('Script');
  if (audio) parts.push('Voiceover');
  if (shots.length) parts.push(`${shots.length} screenshot${shots.length === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' + ') : 'Script, voiceover and screenshots — all optional';
}

export default function AdvancedInputs(props: AdvancedInputsProps) {
  const { disabled, scriptText, audio, shots } = props;
  const [open, setOpen] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [audioOver, setAudioOver] = useState(false);
  const [shotsOver, setShotsOver] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scriptRef = useRef<HTMLDivElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const shotsInput = useRef<HTMLInputElement>(null);
  const [bodyHeight, setBodyHeight] = useState(0);
  const [scriptHeight, setScriptHeight] = useState(0);

  // Measured heights keep the open/close a real height transition rather than
  // a display toggle, and re-measure whenever the contents grow (a thumbnail
  // lands, an error appears) so the panel never clips its own children.
  useEffect(() => {
    const measure = () => {
      if (bodyRef.current) setBodyHeight(bodyRef.current.scrollHeight);
      if (scriptRef.current) setScriptHeight(scriptRef.current.scrollHeight);
    };
    measure();
    const timer = window.setTimeout(measure, 360);
    return () => window.clearTimeout(timer);
  }, [open, scriptOpen, scriptText, audio, props.audioBusy, props.audioError, props.shotsError, shots.length, shots.map((s) => s.uploading).join('')]);

  const atMax = shots.length >= MAX_BROLL;
  const anything = Boolean(scriptText.trim() || audio || shots.length);

  const takeShots = (list: FileList | File[] | null) => {
    const picked = Array.from(list || []).filter((file) => file.type.startsWith('image/'));
    if (picked.length) props.onShotsPick(picked);
  };

  return (
    <section style={{ marginTop: 16, borderRadius: 20, border: '1px solid rgba(180,120,0,0.14)', background: '#FFFFFF', overflow: 'hidden' }}>
      <button
        type="button"
        className="sv-press"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', border: 0, background: 'transparent', color: '#1A1000', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 650 }}>Advanced options</span>
          <span style={{ display: 'block', marginTop: 3, fontSize: 13, color: anything ? '#B4720A' : '#7A6030' }}>
            {advancedSummary(scriptText, audio, shots)}
          </span>
        </span>
        {anything ? <Chip tone="accent">In use</Chip> : <Chip>Optional</Chip>}
        <ChevronDown
          size={18}
          color="#7A6030"
          style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .3s cubic-bezier(.22,.9,.3,1)' }}
        />
      </button>

      <div
        style={{
          maxHeight: open ? bodyHeight + 40 : 0,
          opacity: open ? 1 : 0,
          overflow: 'hidden',
          transition: 'max-height .38s cubic-bezier(.22,.9,.3,1), opacity .28s ease',
        }}
      >
        <div ref={bodyRef} style={{ display: 'grid', gap: 16, padding: '0 18px 18px' }}>

          {/* ---- 1. Paste your script ---- */}
          <div style={SECTION}>
            <button
              type="button"
              className="sv-press"
              onClick={() => setScriptOpen((value) => !value)}
              aria-expanded={scriptOpen}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, border: 0, padding: 0, background: 'transparent', color: '#1A1000', cursor: 'pointer', textAlign: 'left' }}
            >
              <FileText size={16} color="#C8920A" style={{ flexShrink: 0 }} />
              <span style={{ ...LABEL, flex: 1, minWidth: 0 }}>Or paste your script</span>
              <Chip>Optional</Chip>
              <ChevronDown size={16} color="#7A6030" style={{ transform: scriptOpen ? 'rotate(180deg)' : 'none', transition: 'transform .3s cubic-bezier(.22,.9,.3,1)' }} />
            </button>
            <div style={{ maxHeight: scriptOpen ? scriptHeight + 24 : 0, opacity: scriptOpen ? 1 : 0, overflow: 'hidden', transition: 'max-height .34s cubic-bezier(.22,.9,.3,1), opacity .24s ease' }}>
              <div ref={scriptRef} style={{ paddingTop: 12 }}>
                <textarea
                  className="sv-field"
                  value={scriptText}
                  onChange={(event) => props.onScriptText(event.target.value)}
                  disabled={disabled}
                  rows={6}
                  aria-label="Your own video script"
                  placeholder="Paste your video script here — we'll use it instead of the auto-generated brief"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(180,120,0,0.14)', background: '#FFFAEB', color: '#1A1000', fontSize: 14.5, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <span style={HINT}>
                    {scriptText.trim()
                      ? 'Your script replaces the auto-written narration — we only split it into scenes.'
                      : 'Leave this empty and the pipeline writes the narration from the extracted brief.'}
                  </span>
                  {scriptText.trim() ? (
                    <button
                      type="button"
                      className="sv-press sv-ghost"
                      onClick={() => props.onScriptText('')}
                      disabled={disabled}
                      style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 10, border: 0, background: 'transparent', color: '#7A6030', fontSize: 13, fontWeight: 600, cursor: disabled ? 'default' : 'pointer' }}
                    >
                      <X size={13} /> Clear
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* ---- 2. Voiceover audio ---- */}
          <div style={SECTION}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Volume2 size={16} color="#C8920A" style={{ flexShrink: 0 }} />
              <span style={{ ...LABEL, flex: 1, minWidth: 0 }}>Or upload voiceover audio</span>
              <Chip>Optional</Chip>
            </div>

            {audio ? (
              <div className="sv-fade-up" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(22,101,52,.10)', border: '1px solid rgba(22,101,52,.28)' }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 10, background: 'rgba(22,101,52,.14)', flexShrink: 0 }}>
                  <Volume2 size={17} color="#166534" />
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 650, color: '#1A1000', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{audio.name}</span>
                  <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: '#166534' }}>This track narrates the video instead of the generated voice.</span>
                </span>
                <button
                  type="button"
                  className="sv-press sv-ghost"
                  aria-label="Remove the uploaded voiceover"
                  onClick={props.onAudioRemove}
                  disabled={disabled}
                  style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: 10, border: 0, background: 'rgba(180,120,0,0.08)', color: '#3D2800', cursor: disabled ? 'default' : 'pointer' }}
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <label
                className="sv-drop"
                data-over={audioOver}
                onDragOver={(event) => { event.preventDefault(); if (!disabled) setAudioOver(true); }}
                onDragLeave={() => setAudioOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setAudioOver(false);
                  if (disabled) return;
                  const file = Array.from(event.dataTransfer.files || []).find((item) => /\.(mp3|wav|m4a)$/i.test(item.name) || item.type.startsWith('audio/'));
                  if (file) props.onAudioPick(file);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, padding: '16px 14px', borderRadius: 12, border: '1px dashed rgba(180,120,0,0.14)', background: '#FFFAEB', color: '#3D2800', cursor: disabled || props.audioBusy ? 'default' : 'pointer' }}
              >
                {props.audioBusy ? <Loader2 size={17} color="#C8920A" className="animate-spin" /> : <Upload size={17} color="#C8920A" />}
                <span style={{ flex: 1, fontSize: 13.5 }}>
                  {props.audioBusy ? 'Uploading your voiceover…' : 'Drop an .mp3, .wav or .m4a here, or click to browse'}
                </span>
                <input
                  ref={audioInput}
                  type="file"
                  accept={AUDIO_TYPES}
                  disabled={disabled || props.audioBusy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) props.onAudioPick(file);
                    event.target.value = '';
                  }}
                  style={{ display: 'none' }}
                />
              </label>
            )}
            {props.audioError ? <ErrorCard message={props.audioError} /> : null}
          </div>

          {/* ---- 3. Screenshots (max 6) ---- */}
          <div style={SECTION}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <PictureIcon size={16} color="#C8920A" style={{ flexShrink: 0 }} />
              <span style={{ ...LABEL, flex: 1, minWidth: 0 }}>Add screenshots — up to {MAX_BROLL}</span>
              <Chip tone={atMax ? 'accent' : 'muted'}>
                <span
                  key={shots.length}
                  className="sv-pop"
                  style={{ display: 'inline-block' }}
                >
                  {shots.length}/{MAX_BROLL}
                </span>
              </Chip>
              <Chip>Optional</Chip>
            </div>

            <label
              className="sv-drop"
              data-over={shotsOver}
              onDragOver={(event) => { event.preventDefault(); if (!disabled && !atMax) setShotsOver(true); }}
              onDragLeave={() => setShotsOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setShotsOver(false);
                if (disabled || atMax) return;
                takeShots(event.dataTransfer.files);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, padding: '16px 14px', borderRadius: 12, border: '1px dashed rgba(180,120,0,0.14)', background: '#FFFAEB', color: atMax ? '#7A6030' : '#3D2800', cursor: disabled || atMax ? 'default' : 'pointer', opacity: atMax ? 0.65 : 1 }}
            >
              <Upload size={17} color={atMax ? '#7A6030' : '#C8920A'} />
              <span style={{ flex: 1, fontSize: 13.5 }}>
                {atMax
                  ? `That's all ${MAX_BROLL} — remove one to swap in another.`
                  : 'Drag PNG, JPG, WEBP or GIF here, or click to browse'}
              </span>
              <input
                ref={shotsInput}
                type="file"
                accept={IMAGE_TYPES}
                multiple
                disabled={disabled || atMax}
                onChange={(event) => { takeShots(event.target.files); event.target.value = ''; }}
                style={{ display: 'none' }}
              />
            </label>

            {shots.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 12 }}>
                {shots.map((shot, index) => (
                  <div
                    key={shot.id}
                    className="sv-pop sv-lift"
                    style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(180,120,0,0.14)', background: '#FFFFFF', animationDelay: `${Math.min(index, 5) * 55}ms` }}
                  >
                    <div style={{ aspectRatio: '16 / 10', background: '#FFFAEB' }}>
                      <img src={shot.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </div>
                    {shot.uploading ? (
                      <div className="sv-skeleton" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(26,16,0,0.35)' }}>
                        <Loader2 size={18} color="#C8920A" className="animate-spin" />
                      </div>
                    ) : null}
                    <div style={{ padding: '7px 9px', fontSize: 11.5, color: '#7A6030', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shot.name}</div>
                    <button
                      type="button"
                      className="sv-press"
                      aria-label={`Remove ${shot.name}`}
                      onClick={() => props.onShotRemove(shot.id)}
                      disabled={disabled}
                      style={{ position: 'absolute', top: 6, right: 6, display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 999, border: '1px solid rgba(180,120,0,0.14)', background: 'rgba(255,255,255,0.92)', color: '#1A1000', cursor: disabled ? 'default' : 'pointer' }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, padding: '14px 14px', borderRadius: 12, background: '#FFFAEB', border: '1px solid rgba(180,120,0,0.14)' }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: 10, background: 'rgba(200,146,10,.12)', flexShrink: 0 }}>
                  <PictureIcon size={16} color="#C8920A" />
                </span>
                <span style={{ ...HINT, flex: 1 }}>No screenshots yet. Anything you add here becomes B-roll the narration can be matched against, scene by scene.</span>
              </div>
            )}
            {props.shotsError ? <ErrorCard message={props.shotsError} /> : null}
          </div>

          {shots.some((shot) => shot.uploading) ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...HINT }}>
              <Loader2 size={14} color="#C8920A" className="animate-spin" />
              Publishing your screenshots so the render can reach them…
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
