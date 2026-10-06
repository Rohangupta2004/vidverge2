/**
 * Create screen — the two ways a film starts.
 *
 * AI MODE (the default): paste the script (source of truth, never rewritten),
 * pick the aspect, optionally attach a reference image and a director note.
 * Submitting hands the WHOLE script to Opus 5, which reads the complete story
 * before segmenting it into sequential 4/6/8/10-second clips.
 *
 * MANUAL SCRIPT MODE: paste a script that is ALREADY broken into scenes. No
 * model reads it — the parser in ../manualScript.ts pulls the scenes straight
 * out of the text, the preview below the textarea shows exactly what it
 * found, and those scenes enter the same generation pipeline.
 *
 * Either way the plan review happens on the sequential board — one prompt at
 * a time — and the character reference image, when one is attached, is sent
 * with every clip alongside the previous clip's final frame.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clapperboard, FileUp, Image as ImageIcon, Loader2, UserRound, X } from 'lucide-react';
import { Aspect, ParsedScript, T, uploadBlob } from './api';
import { parseManualScript } from './manualScript';
import { DEFAULT_FILM_MODEL, VIDEO_MODELS, VideoModelConfig } from './pipeline/videoModelService';
import ModelGrid, { ModelGridOption } from './ModelGrid';
import {
  rosterInputLabel, rosterModel, rosterNote, rosterState,
  subscribeRunwayRoster, syncRunwayRoster,
} from './runwayRoster';
import VideoIntegrationPicker from '../../components/VideoIntegrationPicker';
import {
  loadVideoSelection, saveVideoSelection, type VideoIntegrationId,
} from '../../lib/videoIntegrations';

/**
 * ORIENTATION — a first-class choice, not an Advanced one. Every generation
 * call downstream already carries the film's aspect (videoModelService passes
 * `params.aspect` to Veo, Kling and Runway alike); burying the control was the
 * reason so many films came back landscape when the customer wanted vertical.
 * The highlight slides between the two halves rather than hard-swapping.
 */
function OrientationToggle({ value, onChange, disabled }: { value: Aspect; onChange: (next: Aspect) => void; disabled: boolean }) {
  const options: { id: Aspect; label: string; hint: string }[] = [
    { id: '16:9', label: 'Landscape', hint: '16:9' },
    { id: '9:16', label: 'Portrait', hint: '9:16' },
  ];
  const index = Math.max(0, options.findIndex((option) => option.id === value));
  return (
    <div
      role="radiogroup"
      aria-label="Video orientation"
      style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, padding: 4, borderRadius: 999, background: T.raised, border: `1px solid ${T.dim}`, maxWidth: 360 }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute', top: 4, bottom: 4, left: 4, width: 'calc(50% - 4px)',
          borderRadius: 999, background: T.live,
          transform: `translateX(${index * 100}%)`,
          transition: 'transform .28s cubic-bezier(.22,.9,.3,1)',
          boxShadow: '0 2px 12px rgba(245,158,11,0.28)',
        }}
      />
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            style={{
              position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              background: 'transparent', border: 'none', borderRadius: 999, padding: '10px 14px',
              color: active ? '#1A1205' : T.muted, fontSize: 13.5, fontWeight: 700,
              cursor: disabled ? 'default' : 'pointer', transition: 'color .22s ease', opacity: disabled ? 0.6 : 1,
            }}
          >
            <span
              aria-hidden
              style={{
                width: option.id === '16:9' ? 18 : 11, height: option.id === '16:9' ? 11 : 18,
                borderRadius: 3, border: `2px solid ${active ? '#1A1205' : T.muted}`, transition: 'border-color .22s ease',
              }}
            />
            {option.label} <span style={{ fontWeight: 600, opacity: .75 }}>{option.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

export type CreateMode = 'ai' | 'manual';

const EMPTY_PARSE: ParsedScript = { scenes: [], globalStyle: '' };

const MANUAL_PLACEHOLDER = `Scene 1 — Cold open in the workshop | 8 sec

Visual:
A cluttered garage at dawn, dust hanging in a shaft of light. Maya, 30s, in a worn denim jacket, wipes grease off a brass gear.

Dialogue — Maya:
> "Everyone said this was impossible."

Camera: slow push in from wide to medium

---

Scene 2 — The first spark | 6 sec

Visual:
She flicks a switch. The machine shudders, then hums to life.

Camera: handheld, tight on her face

---

Overall style: warm 35mm grain, amber and teal palette, documentary lighting.`;

/**
 * INPUT MODE — who decides the scenes. AI Mode hands the brief to the
 * director, which reads the whole story and segments it. Manual Script Mode
 * takes a script that is already broken into scenes and films exactly that,
 * with no model reading the text at any point.
 */
function ModeToggle({ value, onChange, disabled }: { value: CreateMode; onChange: (next: CreateMode) => void; disabled: boolean }) {
  const options: { id: CreateMode; label: string; hint: string }[] = [
    { id: 'ai', label: 'AI Mode', hint: 'The director reads your brief and plans the scenes for you.' },
    { id: 'manual', label: 'Manual Script Mode', hint: 'Your pre-formatted script is the plan — scene for scene, exactly as written.' },
  ];
  return (
    <div role="radiogroup" aria-label="Input mode" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={option.hint}
            onClick={() => onChange(option.id)}
            style={{
              background: active ? T.live : T.raised,
              color: active ? '#1A1205' : T.muted,
              border: `1px solid ${active ? T.live : T.dim}`,
              borderRadius: 999, padding: '9px 18px', fontSize: 13, fontWeight: 700,
              cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** The character reference image: ONE picture, reused on every clip of the
 * film. It is half of the dual reference each scene is generated from — the
 * other half is the previous clip's extracted final frame. */
function CharacterRefField(props: {
  previewUrl: string;
  busy: boolean;
  disabled: boolean;
  error: string;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>
        Character reference image <span style={{ color: T.dim, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(for consistency)</span>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="s2v-ghost"
          disabled={props.busy || props.disabled}
          onClick={() => inputRef.current?.click()}
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: T.raised, border: `1px solid ${T.dim}`, color: T.bone, fontSize: 13, cursor: 'pointer', padding: '9px 14px', borderRadius: 8 }}
        >
          {props.busy ? <Loader2 size={14} className="animate-spin" /> : <UserRound size={14} />}
          {props.previewUrl ? 'Replace character' : 'Upload character'}
        </button>
        {props.previewUrl ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={props.previewUrl} alt="Character reference" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: `1px solid ${T.dim}` }} />
            <button onClick={props.onClear} title="Remove the character reference" style={{ background: 'none', border: 'none', color: T.muted, cursor: 'pointer', padding: 2 }}><X size={14} /></button>
          </span>
        ) : (
          <span style={{ color: T.dim, fontSize: 12, lineHeight: 1.5, maxWidth: 380 }}>
            JPG, PNG or WEBP. Every clip is generated from this image AND the previous clip’s final frame, so one character carries through the whole film.
          </span>
        )}
        <input
          ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }}
          onChange={(e) => { const file = e.target.files?.[0]; if (file) props.onPick(file); e.target.value = ''; }}
        />
      </div>
      {props.error ? <div style={{ color: T.fault, fontSize: 12, marginTop: 8 }}>{props.error}</div> : null}
    </div>
  );
}

/** What the parser actually found, shown before anything is generated so a
 * mis-formatted script is caught here rather than three clips in. */
function ParsePreview({ parsed, hasText }: { parsed: ParsedScript; hasText: boolean }) {
  if (!hasText) return null;
  if (!parsed.scenes.length) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 16, background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.25)', borderRadius: 10, padding: '11px 14px' }}>
        <AlertTriangle size={14} color={T.fault} style={{ flexShrink: 0, marginTop: 2 }} />
        <span style={{ color: T.fault, fontSize: 12.5, lineHeight: 1.6 }}>
          No scenes detected. Each scene needs its own opening line in the form{' '}
          <span style={{ fontFamily: T.mono, color: T.bone }}>Scene 1 — Title | 8 sec</span>, followed by a{' '}
          <span style={{ fontFamily: T.mono, color: T.bone }}>Visual:</span> block.
        </span>
      </div>
    );
  }
  const total = parsed.scenes.reduce((n, s) => n + s.durationSec, 0);
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ color: T.done, fontSize: 12.5, fontWeight: 700 }}>
          {parsed.scenes.length} scene{parsed.scenes.length === 1 ? '' : 's'} detected
        </span>
        <span style={{ color: T.dim, fontSize: 12 }}>
          ~{total}s total{parsed.globalStyle ? ' · overall style block found' : ''}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {parsed.scenes.map((scene) => (
          <details key={scene.index} style={{ background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 10, padding: '9px 12px' }}>
            <summary style={{ cursor: 'pointer', listStylePosition: 'inside', color: T.bone, fontSize: 12.5, fontWeight: 600 }}>
              <span style={{ fontFamily: T.mono, color: T.muted, marginRight: 8 }}>{String(scene.index).padStart(2, '0')}</span>
              {scene.title}
              <span style={{ color: T.live, fontWeight: 700, marginLeft: 8 }}>{scene.durationSec}s</span>
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 9, color: T.muted, fontSize: 12, lineHeight: 1.55 }}>
              {scene.visual
                ? <div><span style={{ color: T.dim, fontWeight: 700 }}>Visual</span> — {scene.visual}</div>
                : <div style={{ color: T.fault }}>No Visual: block found for this scene.</div>}
              {scene.dialogue.map((line, i) => (
                <div key={i}><span style={{ color: T.dim, fontWeight: 700 }}>{line.speaker}</span> — “{line.line}”</div>
              ))}
              {scene.camera ? <div><span style={{ color: T.dim, fontWeight: 700 }}>Camera</span> — {scene.camera}</div> : null}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

export function CreateScreen(props: {
  initialText?: string;
  initialShotUrl?: string;
  initialShotName?: string;
  busy: boolean;
  onSubmit: (params: { mode: CreateMode; script: string; aspect: Aspect; screenshotUrl: string | null; characterRefUrl: string | null; note: string; videoModel: string }) => void;
}) {
  const { initialText, initialShotUrl, initialShotName, busy, onSubmit } = props;
  const [text, setText] = useState(initialText || '');
  const [mode, setMode] = useState<CreateMode>('ai');
  const [aspect, setAspect] = useState<Aspect>('16:9');
  // The model choice survives this screen unmounting for the rest of the
  // browser session, so the last-used engine stays selected between films.
  const [videoModel, setVideoModel] = useState<string>(() => {
    try { return window.sessionStorage.getItem('s2v:videoModel') || DEFAULT_FILM_MODEL.id; } catch { return DEFAULT_FILM_MODEL.id; }
  });
  const [nativeIntegration, setNativeIntegration] = useState<VideoIntegrationId>(() => loadVideoSelection().integration);
  const [nativeModel, setNativeModel] = useState<string>(() => loadVideoSelection().model);
  const [modelMode, setModelMode] = useState<'auto' | 'manual'>(() => {
    try { return window.sessionStorage.getItem('s2v:modelMode') === 'manual' ? 'manual' : 'auto'; } catch { return 'auto'; }
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem('s2v:videoModel', videoModel);
      window.sessionStorage.setItem('s2v:modelMode', modelMode);
    } catch { /* preference only */ }
  }, [videoModel, modelMode]);
  // Keep Runway availability live — a model the platform enables becomes
  // selectable here without a code change.
  const [, setRwRev] = useState(0);
  useEffect(() => {
    void syncRunwayRoster();
    return subscribeRunwayRoster(() => setRwRev((r) => r + 1));
  }, []);

  const liveOf = (m: VideoModelConfig) => (m.provider === 'runway' ? rosterModel(m.apiModel) : null);
  /** An opening scene has no seed frame, so an image-only model can never
   * start a film — those are offered but never auto-picked. */
  const canOpenAFilm = (m: VideoModelConfig) => {
    const live = liveOf(m);
    if (live) return live.available && live.inputType !== 'image';
    return !m.availabilityNote;
  };

  // "Auto — Director picks" resolves to a concrete model at submit time so the
  // pipeline always receives a real, accepted id. Gen 4.5 is this app's
  // default engine; anything else only wins when the platform has Gen 4.5
  // switched off.
  const autoPick = (canOpenAFilm(DEFAULT_FILM_MODEL) ? DEFAULT_FILM_MODEL : VIDEO_MODELS.find(canOpenAFilm)) || DEFAULT_FILM_MODEL;
  const autoPickReason = autoPick.id === DEFAULT_FILM_MODEL.id
    ? 'Runway Gen 4.5 is the default engine: the most dependable text-to-video model on the platform, and it animates each continuation scene from the previous clip’s final frame. Pick any other model below to override it for this film.'
    : `Runway Gen 4.5 is not enabled on the platform right now, so the director falls back to ${autoPick.label} — the strongest engine that can open a film today.`;

  const chosenModel = VIDEO_MODELS.find((m) => m.id === videoModel) || autoPick;
  const chosenLive = liveOf(chosenModel);
  const modelNote = modelMode === 'auto'
    ? autoPickReason
    : chosenLive
      ? `${rosterInputLabel(chosenLive)} · ${chosenLive.blurb} ${chosenLive.available ? chosenLive.priceNote : chosenLive.unavailableReason}`
      : (chosenModel.availabilityNote || 'Every clip of this film renders on this model.');
  const catalogLine = rosterState() === 'loading' ? 'Checking the live Runway catalog…' : rosterNote();

  const modelOptions: ModelGridOption[] = VIDEO_MODELS.map((m) => {
    const live = liveOf(m);
    const fallbackFamily = m.provider === 'google' ? 'Google' : m.provider === 'kling' ? 'Kling' : 'OpenRouter';
    return {
      id: m.id,
      label: m.label,
      family: live ? live.family : fallbackFamily,
      blurb: live ? live.blurb : 'Runs every clip of this film.',
      meta: live
        ? `${rosterInputLabel(live)} · ${live.minDurationS}–${live.maxDurationS}s`
        : `Clips up to ${m.safeMaxDuration}s · ${m.maxReferenceImages} reference images`,
      badge: m.id === DEFAULT_FILM_MODEL.id ? 'Default' : live?.speed === 'fast' ? 'Fast' : live?.speed === 'cinematic' ? 'Cinematic' : '',
      available: live ? live.available : !m.availabilityNote,
      unavailableReason: live ? live.unavailableReason : m.availabilityNote,
    };
  });
  const [note, setNote] = useState('');
  const [shotUrl, setShotUrl] = useState(initialShotUrl || '');
  const [shotBusy, setShotBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const scriptRef = useRef<HTMLInputElement>(null);

  // CHARACTER REFERENCE — two forms of the same picture: the data URL draws
  // the thumbnail the instant it is picked, and the uploaded https URL is the
  // one the generation proxies can actually fetch.
  const [charPreview, setCharPreview] = useState('');
  const [charUrl, setCharUrl] = useState('');
  const [charBusy, setCharBusy] = useState(false);
  const [charErr, setCharErr] = useState('');

  async function pickCharacterRef(file: File) {
    setCharBusy(true); setCharErr('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('That image could not be read.'));
        reader.readAsDataURL(file);
      });
      setCharPreview(dataUrl);
      setCharUrl(await uploadBlob(file, file.name));
    } catch (ex: any) {
      setCharPreview(''); setCharUrl('');
      setCharErr(String(ex?.message || ex));
    } finally {
      setCharBusy(false);
    }
  }

  function clearCharacterRef() {
    setCharPreview(''); setCharUrl(''); setCharErr('');
  }

  const parsed = useMemo(() => (mode === 'manual' ? parseManualScript(text) : EMPTY_PARSE), [mode, text]);

  const canGo = mode === 'manual'
    ? parsed.scenes.length > 0
    : text.trim().split(/\s+/).filter(Boolean).length >= 3;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '28px 24px 140px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <ModeToggle value={mode} onChange={setMode} disabled={busy} />

        <div style={{ color: T.bone, fontSize: 25, fontWeight: 700, letterSpacing: -0.5, marginBottom: 6 }}>
          {mode === 'manual' ? 'Paste your script' : 'What are we filming?'}
        </div>
        <div style={{ color: T.muted, fontSize: 13.5, lineHeight: 1.5, marginBottom: 22 }}>
          {mode === 'manual'
            ? 'Your script is already broken into scenes, so nothing re-reads or re-plans it. Every scene is filmed exactly as written — visual, camera, dialogue — in order, carrying the previous clip’s final frame into the next one.'
            : 'Paste your script. The director reads the whole story, breaks it into sequential AI video clips, and prepares one detailed prompt at a time — you trigger each generation, and FFmpeg carries the final frame of every clip into the next one.'}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={mode === 'manual' ? 'Paste your script' : 'Your script'}
          placeholder={mode === 'manual' ? MANUAL_PLACEHOLDER : 'Your script — we never rewrite it.'}
          rows={mode === 'manual'
            ? Math.min(24, Math.max(14, text.split('\n').length + 2))
            : Math.min(16, Math.max(5, text.split('\n').length + 2))}
          style={{ width: '100%', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 10, color: T.bone, fontSize: mode === 'manual' ? 13 : 15, lineHeight: 1.55, padding: '16px 18px', outline: 'none', resize: 'vertical', fontFamily: mode === 'manual' ? T.mono : T.sans }}
        />

        <div style={{ display: 'flex', gap: 14, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="s2v-ghost" onClick={() => scriptRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: 'none', color: T.muted, fontSize: 13, cursor: 'pointer', padding: '5px 8px', margin: '-5px -8px', borderRadius: 7 }}>
            <FileUp size={14} /> Upload script file
          </button>
          <span style={{ color: T.dim, fontSize: 12 }}>.txt · .md</span>
          <input
            ref={scriptRef} type="file" accept=".txt,.md" style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try { setText(await f.text()); setErr(''); } catch (ex: any) { setErr(String(ex?.message || ex)); }
              e.target.value = '';
            }}
          />
        </div>

        {mode === 'manual' ? <ParsePreview parsed={parsed} hasText={text.trim().length > 0} /> : null}

        {mode === 'manual' ? (
          <div style={{ marginTop: 26 }}>
            <CharacterRefField previewUrl={charPreview} busy={charBusy} disabled={busy} error={charErr} onPick={pickCharacterRef} onClear={clearCharacterRef} />
          </div>
        ) : null}

        <div style={{ marginTop: 26 }}>
          <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>Orientation</div>
          <OrientationToggle value={aspect} onChange={setAspect} disabled={busy} />
          <div style={{ color: T.dim, fontSize: 12, marginTop: 9, lineHeight: 1.55 }}>
            Every clip renders at {aspect}, and the final assembly inherits it — a portrait film stitches to a portrait MP4.
          </div>
        </div>

        <details style={{ marginTop: 22, background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 12, padding: '12px 14px' }}>
          <summary style={{ cursor: 'pointer', color: T.bone, fontSize: 13, fontWeight: 700, listStylePosition: 'inside' }}>
            Advanced <span style={{ color: T.muted, fontWeight: 500 }}>— {modelMode === 'auto' ? `Director picks (${autoPick.label})` : chosenModel.label}</span>
          </summary>

        <div style={{ marginTop: 22, marginBottom: 14 }}>
          <VideoIntegrationPicker
            label="Native video provider (all six Audos integrations)"
            integration={nativeIntegration}
            model={nativeModel}
            sceneOnly
            onChange={(integration, model) => {
              setNativeIntegration(integration);
              setNativeModel(model);
              saveVideoSelection(integration, model);
              setModelMode('manual');
            }}
            note="When you pick here, every clip of this film uses that provider and model (stored as the platform model id on the film row)."
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginTop: 22, marginBottom: 10 }}>
          <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' }}>Video model (registry)</div>
          <div style={{ color: T.dim, fontSize: 11 }}>{catalogLine}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button onClick={() => setModelMode('auto')} style={{ background: modelMode === 'auto' ? T.live : T.raised, color: modelMode === 'auto' ? '#1A1205' : T.muted, border: `1px solid ${modelMode === 'auto' ? T.live : T.dim}`, borderRadius: 999, padding: '8px 15px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            Auto — Director picks ({autoPick.label})
          </button>
          {modelMode === 'manual' && videoModel !== DEFAULT_FILM_MODEL.id ? (
            <button className="s2v-ghost" onClick={() => setVideoModel(DEFAULT_FILM_MODEL.id)} style={{ background: 'transparent', border: `1px solid ${T.dim}`, color: T.muted, borderRadius: 999, padding: '8px 15px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              Back to {DEFAULT_FILM_MODEL.label}
            </button>
          ) : null}
        </div>
        <ModelGrid
          options={modelOptions}
          value={modelMode === 'manual' ? videoModel : autoPick.id}
          onChange={(id) => { setModelMode('manual'); setVideoModel(id); }}
          disabled={busy}
        />
        <div style={{ marginTop: 10, background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 10, padding: '11px 14px' }}>
          <div style={{ color: T.bone, fontSize: 12.5, fontWeight: 700, marginBottom: 3 }}>
            {modelMode === 'auto' ? `Director's pick: ${autoPick.label}` : `Every clip renders on ${chosenModel.label}`}
          </div>
          <div style={{ color: T.muted, fontSize: 12, lineHeight: 1.55 }}>{modelNote}</div>
        </div>

        {mode === 'ai' ? (
          <div style={{ marginTop: 30 }}>
            <CharacterRefField previewUrl={charPreview} busy={charBusy} disabled={busy} error={charErr} onPick={pickCharacterRef} onClear={clearCharacterRef} />
          </div>
        ) : null}

        <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 30, marginBottom: 10 }}>
          Reference image <span style={{ color: T.dim, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional — a product or scene visual the director can reference)</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="s2v-ghost" disabled={shotBusy} onClick={() => fileRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 7, background: T.raised, border: `1px solid ${T.dim}`, color: T.bone, fontSize: 13, cursor: 'pointer', padding: '9px 14px', borderRadius: 8 }}>
            {shotBusy ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />} {shotUrl ? 'Replace image' : 'Attach image'}
          </button>
          {shotUrl ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img src={shotUrl} alt={initialShotName || 'Reference'} title={initialShotName || 'Reference image'} style={{ width: 64, height: 40, objectFit: 'cover', borderRadius: 6, border: `1px solid ${T.dim}` }} />
              <button onClick={() => setShotUrl('')} style={{ background: 'none', border: 'none', color: T.muted, cursor: 'pointer', padding: 2 }}><X size={14} /></button>
            </span>
          ) : (
            <span style={{ color: T.dim, fontSize: 12 }}>Scenes that fit it can use it as a visual reference.</span>
          )}
          <input
            ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setShotBusy(true); setErr('');
              try { setShotUrl(await uploadBlob(f, f.name)); }
              catch (ex: any) { setErr(String(ex?.message || ex)); }
              finally { setShotBusy(false); e.target.value = ''; }
            }}
          />
        </div>

        <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 30, marginBottom: 10 }}>
          Director note <span style={{ color: T.dim, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
        </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder='e.g. "documentary feel, warm palette, handheld camera"'
            style={{ width: '100%', background: T.canvas, border: `1px solid ${T.dim}`, borderRadius: 8, color: T.bone, fontSize: 13.5, padding: '11px 14px', outline: 'none' }}
          />
        </details>

        {err ? <div style={{ color: T.fault, fontSize: 12.5, lineHeight: 1.5, marginTop: 14, background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.25)', borderRadius: 9, padding: '9px 13px' }}>{err}</div> : null}

        <button
          className="s2v-lift"
          disabled={!canGo || busy || shotBusy || charBusy}
          onClick={() => onSubmit({
            mode, script: text.trim(), aspect, screenshotUrl: shotUrl || null, characterRefUrl: charUrl || null, note: note.trim(),
            videoModel: modelMode === 'auto' ? autoPick.apiModel : (nativeModel || VIDEO_MODELS.find((m) => m.id === videoModel)?.apiModel || videoModel),
          })}
          style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 26, background: canGo && !busy ? T.live : T.raised, color: canGo && !busy ? '#1A1205' : T.dim, border: 'none', borderRadius: 11, padding: '14px 28px', fontSize: 15, fontWeight: 700, cursor: canGo && !busy ? 'pointer' : 'default', boxShadow: canGo && !busy ? '0 2px 12px rgba(245,158,11,0.25)' : 'none' }}
        >
          {busy ? <Loader2 size={17} className="animate-spin" /> : <Clapperboard size={17} />}
          {busy
            ? (mode === 'manual' ? 'Reading your scenes…' : 'The director is reading your story…')
            : (mode === 'manual' ? 'Generate All Scenes' : 'Plan my film')}
        </button>
        {busy ? (
          <div style={{ color: T.muted, fontSize: 12.5, marginTop: 12 }}>
            {mode === 'manual'
              ? 'Your scenes are being created and the first prompt built straight from your script — there is no AI planning step in this mode, so it is quick.'
              : 'Your director is reading the entire script, understanding the story, splitting it into sequential clips and preparing the first prompt — about a minute.'}
          </div>
        ) : null}
      </div>
    </div>
  );
}
