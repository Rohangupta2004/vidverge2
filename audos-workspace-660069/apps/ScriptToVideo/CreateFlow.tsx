/**
 * Create screen — the two ways a film starts.
 *
 * AI MODE (the default): paste the script (source of truth, never rewritten),
 * pick the aspect, optionally attach a reference image and a director note.
 * Submitting hands the WHOLE script to the creative planner, which reads the
 * complete story before choosing each shot's intent, workflow and engine.
 * Shared duration guardrails split over-long beats without dropping words.
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
import {
  AlertTriangle, AtSign, Check, Clapperboard, FileUp, Image as ImageIcon, Lock, Plus,
  RefreshCw, Trash2, UserRound, Wand2, X,
} from 'lucide-react';
import { Aspect, AssetRow, ParsedScript, StoredReference, T, db, referenceSlug, uploadBlob } from './api';
import { aiFormatScript, parseManualScript, serializeManualScript, suggestScriptConcepts } from './manualScript';
import type { ScriptConcept } from './manualScript';
import {
  KLING_3_0, KLING_3_0_OMNI, SEEDANCE_2_0, SEEDANCE_2_5, VIDEO_MODEL, VideoModelConfig, VideoModelService, costConfirmMessage,
} from './pipeline/videoModelService';
import {
  AUDIO_POLICIES, VIDEO_STYLE_PRESETS, audioPolicyFlags, capabilityFor, formatDuration, parseDurationInput, styleDirection,
} from './v2Contracts';
import type { AudioPolicy, ControlMode, ExecutionMode, VideoStyleId } from './v2Contracts';
import ModelGrid, { ModelGridOption } from './ModelGrid';
import { pickerModelById, pickerModels } from './modelPicker';
import { recommendationExplanation, scoreVideoModels } from './modelRecommendation';
import { planBigScenes } from './pipeline/bigScenePlanner';
import {
  rosterInputLabel, rosterModel,
  subscribeRunwayRoster, syncRunwayRoster,
} from './runwayRoster';
import VergeLoader from '../../components/VergeLoader';
import VideoGeneratingState from '../../components/video/VideoGeneratingState';
import {
  formatSceneDurationHint, sceneDurationLimitsFrom, validateSceneDurations,
  type SceneDurationLimits,
} from '../../lib/videoEngines';
import type { ScriptToVideoHandoff } from '../../lib/vidvergeHandoff';
import { brandToContextText, fetchBrandFromWebsite, matchSavedBrand, type BrandRecord, useBrandKit } from '../../components/brandKitStore';

/**
 * SCENE LENGTH IS A CONSTRAINT, NOT A PREFERENCE.
 *
 * Every generation model has a hard per-clip ceiling, and a manual script is
 * free to ask for any length it likes — "Scene 4 — The reveal | 14 sec" on an
 * 8-second model is not a 14-second clip, it is a provider rejection, or worse
 * a clip that silently drops the end of the dialogue. So the pasted durations
 * are checked against the chosen model's REAL limits here, before anything is
 * paid for, by the same shared contract Vidverge Multi-Shot validates against
 * (lib/videoEngines.ts).
 *
 * The scene ceiling is deliberately generous rather than the contract's
 * default of 12: that default exists to stop a planning AGENT returning sixty
 * scenes for a thirty-second ad. A person who has written out forty scenes
 * means it, and capping them would be the tool arguing with its own input.
 */
const MAX_SCRIPT_SCENES = 60;

/** Greedy legal block packing from the current proxy contracts. Seedance 2.5
 * accepts every integer 4–30s; Kling Omni 3.0 accepts only 5s or 10s. Always
 * fill the provider maximum first, then rebalance only when a final remainder
 * would be below the provider floor. */
function legalFilmBlocks(totalSeconds: number, model: VideoModelConfig): number[] {
  try {
    return planBigScenes({ modelId: model.apiModel, totalDurationSec: totalSeconds, script: 'Production timing placeholder.' }).map((scene) => scene.duration);
  } catch {
    return [];
  }
}

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
    { id: '1:1', label: 'Square', hint: '1:1' },
  ];
  const index = Math.max(0, options.findIndex((option) => option.id === value));
  return (
    <div
      role="radiogroup"
      aria-label="Video orientation"
      style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 0, padding: 4, borderRadius: 999, background: T.raised, border: `1px solid ${T.dim}`, maxWidth: 520 }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute', top: 4, bottom: 4, left: 4, width: 'calc(33.333% - 2.7px)',
          borderRadius: 999, background: T.live,
          transform: `translateX(${index * 100}%)`,
          transition: 'transform .28s cubic-bezier(.22,.9,.3,1)',
          boxShadow: '0 2px 12px rgba(212,146,10,0.28)',
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
              color: active ? '#17120A' : T.muted, fontSize: 13.5, fontWeight: 700,
              cursor: disabled ? 'default' : 'pointer', transition: 'color .22s ease', opacity: disabled ? 0.6 : 1,
            }}
          >
            <span
              aria-hidden
              style={{
                width: option.id === '16:9' ? 18 : option.id === '9:16' ? 11 : 15, height: option.id === '16:9' ? 11 : option.id === '9:16' ? 18 : 15,
                borderRadius: 3, border: `2px solid ${active ? '#ffffff' : T.muted}`, transition: 'border-color .22s ease',
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
    { id: 'ai', label: 'Start with an idea', hint: 'The prompt-maker turns your idea into an editable production script before anything is generated.' },
    { id: 'manual', label: 'Use my own script', hint: 'Keep your wording, or ask AI to propose improvements and accept only the changes you want.' },
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
              color: active ? '#17120A' : T.muted,
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
        Cast reference <span style={{ color: T.dim, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional — identity lock)</span>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="s2v-ghost"
          disabled={props.busy || props.disabled}
          onClick={() => inputRef.current?.click()}
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: T.raised, border: `1px solid ${T.dim}`, color: T.bone, fontSize: 13, cursor: 'pointer', padding: '9px 14px', borderRadius: 8 }}
        >
          {props.busy ? <VergeLoader size={32} label="Uploading your character" /> : <UserRound size={14} />}
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

/**
 * STORED REFERENCES — pictures the customer saves ONCE and then summons from
 * any script by typing @name. The list lives in WorkspaceDB, so a reference
 * added here is available to every future film, and the pipeline injects
 * every resolved mention into every scene of the film it was used in.
 */
function StoredReferencesField({ disabled, onInsert }: { disabled: boolean; onInsert: (name: string) => void }) {
  const [refs, setRefs] = useState<StoredReference[]>([]);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<StoredReference['type']>('character');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  // The first read happens while the workspace session may still be loading,
  // so it stays quiet — an empty list is the honest answer then, and the add
  // button reports for itself if the session really is not ready.
  async function refresh(quiet = false) {
    try { setRefs(await db.listReferences()); }
    catch (ex: any) { if (!quiet) setErr(String(ex?.message || ex)); }
  }

  const slug = referenceSlug(label);

  async function add(file: File) {
    if (!slug) { setErr('Name the reference first — that name is what you type as @name in a script.'); return; }
    setBusy(true); setErr('');
    try {
      const url = await VideoModelService.uploadReference(file, file.name);
      await db.addReference({
        name: slug,
        display_name: label.trim() || slug,
        url,
        type: kind,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setLabel(''); setDescription(''); setKind('character'); setAdding(false);
      await refresh();
    } catch (ex: any) {
      setErr(String(ex?.message || ex));
    } finally {
      setBusy(false);
    }
  }

  async function remove(ref: StoredReference) {
    setBusy(true); setErr('');
    try {
      await db.deleteReference(ref.id);
      setRefs((list) => list.filter((r) => r.id !== ref.id));
    } catch (ex: any) {
      setErr(String(ex?.message || ex));
    } finally {
      setBusy(false);
    }
  }

  const chip = (text: string) => (
    <span style={{ color: T.muted, fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', border: `1px solid ${T.dim}`, borderRadius: 999, padding: '1px 7px' }}>{text}</span>
  );

  return (
    <details onToggle={(event) => { if (event.currentTarget.open && !loaded.current) { loaded.current = true; void refresh(true); } }} style={{ marginTop: 18, background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 12, padding: '11px 14px' }}>
      <summary style={{ cursor: 'pointer', color: T.bone, fontSize: 13, fontWeight: 700, listStylePosition: 'inside' }}>
        Cast & look library <span style={{ color: T.muted, fontWeight: 500 }}>— {refs.length ? `${refs.length} saved` : 'none yet'}</span>
      </summary>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, color: T.dim, fontSize: 12, lineHeight: 1.55, marginTop: 10 }}>
        <AtSign size={13} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>Type <span style={{ fontFamily: T.mono, color: T.bone }}>@name</span> anywhere in your script to inject this reference into every scene</span>
      </div>

      {refs.length ? (
        <>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search saved references"
          placeholder="Search characters, styles or locations…"
          style={{ width: '100%', marginTop: 12, background: T.canvas, border: `1px solid ${T.dim}`, borderRadius: 9, color: T.bone, fontSize: 12.5, padding: '9px 11px', outline: 'none' }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {refs.filter((ref) => `${ref.name} ${ref.display_name || ''} ${ref.description || ''}`.toLowerCase().includes(search.trim().toLowerCase())).map((ref) => (
            <div key={ref.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: T.canvas, border: `1px solid ${T.dim}`, borderRadius: 10, padding: '7px 10px' }}>
              <img src={ref.url} alt="" style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 7, border: `1px solid ${T.dim}`, flexShrink: 0 }} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: T.mono, color: T.live, fontSize: 12.5, fontWeight: 700 }}>@{ref.name}</span>
                  {chip(ref.type || 'character')}
                </span>
                <span style={{ display: 'block', color: T.muted, fontSize: 11.5, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ref.description || ref.display_name || ''}
                </span>
              </span>
              <button
                className="s2v-ghost"
                disabled={disabled}
                title={`Insert @${ref.name} into the script`}
                onClick={() => onInsert(ref.name)}
                style={{ flexShrink: 0, background: 'transparent', border: `1px solid ${T.dim}`, color: T.live, cursor: disabled ? 'default' : 'pointer', padding: '5px 9px', borderRadius: 8, fontSize: 11.5, fontWeight: 700 }}
              >
                Use @{ref.name}
              </button>
              <button
                className="s2v-ghost"
                disabled={busy || disabled}
                title={`Remove @${ref.name}`}
                onClick={() => remove(ref)}
                style={{ flexShrink: 0, background: 'none', border: 'none', color: T.muted, cursor: busy || disabled ? 'default' : 'pointer', padding: 4 }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        </>
      ) : null}

      {adding ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12, background: T.canvas, border: `1px solid ${T.dim}`, borderRadius: 10, padding: '11px 12px' }}>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Display name — e.g. Maya"
            style={{ background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 8, color: T.bone, fontSize: 13, padding: '9px 12px', outline: 'none' }}
          />
          <div style={{ color: T.dim, fontSize: 11.5 }}>
            {slug ? <>Called with <span style={{ fontFamily: T.mono, color: T.live }}>@{slug}</span></> : 'The @name is made from the display name.'}
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {(['character', 'style', 'location'] as StoredReference['type'][]).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                onClick={() => setKind(option)}
                style={{ background: kind === option ? T.live : T.raised, color: kind === option ? '#17120A' : T.muted, border: `1px solid ${kind === option ? T.live : T.dim}`, borderRadius: 999, padding: '6px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                {option[0].toUpperCase()}{option.slice(1)}
              </button>
            ))}
          </div>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Appearance note (optional) — injected into every scene's prompt"
            style={{ background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 8, color: T.bone, fontSize: 13, padding: '9px 12px', outline: 'none' }}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="s2v-lift"
              disabled={busy || disabled || !slug}
              onClick={() => fileRef.current?.click()}
              style={{ display: 'flex', alignItems: 'center', gap: 7, background: busy || !slug ? T.raised : T.live, color: busy || !slug ? T.dim : '#17120A', border: 'none', borderRadius: 9, padding: '9px 15px', fontSize: 12.5, fontWeight: 700, cursor: busy || !slug ? 'default' : 'pointer' }}
            >
              {busy ? <VergeLoader size={30} label="Saving your reference" /> : <ImageIcon size={13} />}
              {busy ? 'Saving…' : 'Choose image & save'}
            </button>
            <button
              className="s2v-ghost"
              disabled={busy}
              onClick={() => { setAdding(false); setErr(''); }}
              style={{ background: 'none', border: 'none', color: T.muted, fontSize: 12.5, cursor: 'pointer', padding: '6px 4px' }}
            >
              Cancel
            </button>
          </div>
          <input
            ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }}
            onChange={(e) => { const file = e.target.files?.[0]; if (file) void add(file); e.target.value = ''; }}
          />
        </div>
      ) : (
        <button
          className="s2v-ghost"
          disabled={disabled}
          onClick={() => { setAdding(true); setErr(''); }}
          style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 12, background: 'transparent', border: `1px solid ${T.dim}`, color: T.bone, borderRadius: 9, padding: '8px 14px', fontSize: 12.5, cursor: disabled ? 'default' : 'pointer' }}
        >
          <Plus size={13} /> Add reference
        </button>
      )}

      {err ? <div style={{ color: T.fault, fontSize: 12, marginTop: 9 }}>{err}</div> : null}
    </details>
  );
}

function CrossProjectAssetPicker({ disabled, onSelect }: { disabled: boolean; onSelect: (asset: AssetRow) => void }) {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    if (open) { setOpen(false); return; }
    setOpen(true); setError('');
    try { setAssets((await db.listAssets()).filter((asset) => asset.film_id != null)); }
    catch (caught: any) { setError(String(caught?.message || caught)); }
  }
  return <div style={{ marginTop: 10 }}>
    <button type="button" disabled={disabled} onClick={() => void load()} style={{ minHeight: 44, background: 'transparent', color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 9, padding: '8px 13px', fontSize: 12, cursor: disabled ? 'default' : 'pointer' }}>Use assets from another project</button>
    {open ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 8, background: T.raised, border: `1px solid ${T.line}`, borderRadius: 10, padding: 10 }}>
      {assets.length ? assets.map((asset) => <button key={asset.id} type="button" onClick={() => { onSelect(asset); setOpen(false); }} style={{ minHeight: 74, textAlign: 'left', background: T.canvas, color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 8, padding: 8, cursor: 'pointer' }}>{/^https:\/\//.test(asset.url) ? <img src={asset.url} alt="" style={{ width: 46, height: 40, objectFit: 'cover', borderRadius: 5, float: 'left', marginRight: 8 }} /> : null}<span style={{ display: 'block', fontSize: 11.5, fontWeight: 750 }}>{asset.name || `Asset ${asset.id}`}</span><span style={{ display: 'block', color: T.dim, fontSize: 9.5, marginTop: 3 }}>Project {asset.film_id} · {asset.kind}</span></button>) : <div style={{ color: T.dim, fontSize: 11.5 }}>No owned project assets are available to import.</div>}
      {error ? <div style={{ color: T.fault, fontSize: 11.5 }}>{error}</div> : null}
    </div> : null}
    <div style={{ color: T.dim, fontSize: 10.5, lineHeight: 1.45, marginTop: 5 }}>Closed by default. Nothing is preselected, and only assets owned by this signed-in session appear.</div>
  </div>;
}

/**
 * STYLE LOCK — freeze the film's look after scene 1. On by default: a film
 * produced clip by clip drifts in palette and light unless the first clip's
 * look is carried forward deliberately.
 */
function StyleLockToggle({ value, onChange, disabled }: { value: boolean; onChange: (next: boolean) => void; disabled: boolean }) {
  return (
    <div style={{ marginTop: 20 }}>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={() => onChange(!value)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', padding: 0, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}
      >
        <span
          aria-hidden
          style={{ position: 'relative', width: 38, height: 22, borderRadius: 999, background: value ? T.live : T.raised, border: `1px solid ${value ? T.live : T.dim}`, flexShrink: 0, transition: 'background-color .22s ease' }}
        >
          <span style={{ position: 'absolute', top: 3, left: 3, width: 14, height: 14, borderRadius: '50%', background: value ? '#ffffff' : T.muted, transform: `translateX(${value ? 16 : 0}px)`, transition: 'transform .22s cubic-bezier(.22,.9,.3,1)' }} />
        </span>
        <Lock size={14} color={value ? T.live : T.dim} />
        <span style={{ color: value ? T.bone : T.muted, fontSize: 13.5, fontWeight: 700 }}>Style Lock</span>
      </button>
      <div style={{ color: T.dim, fontSize: 12, marginTop: 8, lineHeight: 1.55, maxWidth: 480 }}>
        Locks the visual style after the first scene so every clip matches the same look, palette and lighting.
      </div>
    </div>
  );
}

/** What the parser actually found, shown before anything is generated so a
 * mis-formatted script is caught here rather than three clips in. */
function ParsePreview({
  parsed,
  hasText,
  limits,
  problems,
}: {
  parsed: ParsedScript;
  hasText: boolean;
  limits: SceneDurationLimits;
  problems: string[];
}) {
  if (!hasText) return null;
  if (!parsed.scenes.length) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 16, background: 'rgba(153,27,27,0.08)', border: '1px solid rgba(153,27,27,0.25)', borderRadius: 10, padding: '11px 14px' }}>
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

      <div style={{ color: T.dim, fontSize: 11.5, lineHeight: 1.55, marginBottom: 10 }}>
        {formatSceneDurationHint(limits)}
      </div>

      {problems.length ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10, background: 'rgba(153,27,27,0.08)', border: '1px solid rgba(153,27,27,0.25)', borderRadius: 10, padding: '11px 14px' }}>
          <AlertTriangle size={14} color={T.fault} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ color: T.fault, fontSize: 12.5, lineHeight: 1.6 }}>
            {problems.map((problem, i) => (
              <span key={i} style={{ display: 'block' }}>{problem}</span>
            ))}
          </span>
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {parsed.scenes.map((scene) => (
          <details key={scene.index} style={{ background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 10, padding: '9px 12px' }}>
            <summary style={{ cursor: 'pointer', listStylePosition: 'inside', color: T.bone, fontSize: 12.5, fontWeight: 600 }}>
              <span style={{ fontFamily: T.mono, color: T.muted, marginRight: 8 }}>{String(scene.index).padStart(2, '0')}</span>
              {scene.title}
              <span
                title={
                  scene.durationSec > limits.maxS || scene.durationSec < limits.minS
                    ? `This model films ${limits.minS}–${limits.maxS}s per scene.`
                    : undefined
                }
                style={{
                  color: scene.durationSec > limits.maxS || scene.durationSec < limits.minS ? T.fault : T.live,
                  fontWeight: 800, fontFamily: T.mono, marginLeft: 8,
                }}
              >
                {scene.durationSec}s
              </span>
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
  initialIntake?: ScriptToVideoHandoff;
  initialShotUrl?: string;
  initialShotName?: string;
  busy: boolean;
  onSubmit: (params: { mode: CreateMode; script: string; aspect: Aspect; targetDuration: number; screenshotUrl: string | null; characterRefUrl: string | null; note: string; videoModel: string; styleLock: boolean; audioEnabled: boolean; narrationEnabled: boolean; charactersSpeak: boolean; entryType: 'idea' | 'script'; controlMode: ControlMode; executionMode: ExecutionMode; videoStyle: VideoStyleId; customVisualDirection: string; audioPolicy: AudioPolicy; maxAuthorizedCredits: number; storyboardRequested: boolean }) => void;
}) {
  const { initialText, initialIntake, initialShotUrl, initialShotName, busy, onSubmit } = props;
  const { document: brandKit } = useBrandKit();
  const intakeStyle = (initialIntake?.styleConfiguration || {}) as Record<string, any>;
  const intakePresenterLed = Boolean(initialIntake && ['ugc-ad', 'talking-head'].includes(initialIntake.styleId));
  const [text, setText] = useState(initialIntake?.generatedScript || initialText || '');
  const [fetchedBrand, setFetchedBrand] = useState<BrandRecord | null>(null);
  const [brandStatus, setBrandStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [brandError, setBrandError] = useState('');
  const [ignoredBrandKey, setIgnoredBrandKey] = useState('');
  const lastBrandUrl = useRef('');
  const briefUrlCandidate = text.match(/https?:\/\/[^\s)]+/i)?.[0] || '';
  const briefUrl = /^https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(briefUrlCandidate) ? briefUrlCandidate : '';
  const savedBrandMatch = text.trim() ? matchSavedBrand(brandKit, briefUrl || text) : null;
  const savedBrand = savedBrandMatch && savedBrandMatch.id !== ignoredBrandKey && (!savedBrandMatch.websiteUrl || normalizeBrandKey(savedBrandMatch.websiteUrl) !== ignoredBrandKey) ? savedBrandMatch : null;
  const brandInUse = fetchedBrand || savedBrand;
  const [mode, setMode] = useState<CreateMode>(initialIntake ? 'manual' : 'ai');
  const [aspect, setAspect] = useState<Aspect>(initialIntake?.aspectRatio || '16:9');
  const [targetDuration, setTargetDuration] = useState(Math.min(1800, initialIntake?.durationSeconds || 30));
  const [customMinutes, setCustomMinutes] = useState(Math.floor((initialIntake?.durationSeconds || 30) / 60));
  const [customSeconds, setCustomSeconds] = useState((initialIntake?.durationSeconds || 30) % 60);
  const [durationCustom, setDurationCustom] = useState(false);
  const [controlMode, setControlMode] = useState<ControlMode>('agentic');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('review');
  const [maxAuthorizedCredits, setMaxAuthorizedCredits] = useState(initialIntake?.durationSeconds || 30);
  // Audio policy is explicit: No narration still keeps native dialogue/effects;
  // Fully silent is the only choice that removes every audio layer.
  const [audioPolicy, setAudioPolicy] = useState<AudioPolicy>(intakePresenterLed ? 'native-dialogue-effects' : 'no-narration');
  const { audioEnabled, narrationEnabled, charactersSpeak } = audioPolicyFlags(audioPolicy);
  // Style Lock defaults ON: matching clips are what a film needs, and a
  // customer who wants every scene re-imagined can switch it off here.
  const [styleLock, setStyleLock] = useState(true);
  // The model choice survives this screen unmounting for the rest of the
  // browser session, so the last-used engine stays selected between films.
  const [videoModel, setVideoModel] = useState<string>(() => {
    const fallbackId = pickerModels(audioEnabled)[0].id;
    const requested = String(initialIntake?.recommendedModel || '');
    if (pickerModelById(requested)) return requested;
    try {
      const stored = String(window.sessionStorage.getItem('s2v:videoModel'));
      return pickerModelById(stored) ? stored : fallbackId;
    } catch { return fallbackId; }
  });
  const [modelMode, setModelMode] = useState<'auto' | 'manual'>(() => {
    if (initialIntake) return initialIntake.routerMode === 'automatic' ? 'auto' : 'manual';
    try { return window.sessionStorage.getItem('s2v:modelMode') === 'manual' ? 'manual' : 'auto'; } catch { return 'auto'; }
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem('s2v:videoModel', videoModel);
      window.sessionStorage.setItem('s2v:modelMode', modelMode);
    } catch { /* preference only */ }
  }, [videoModel, modelMode]);
  // Keep Runway availability live without putting its catalog request on the
  // create screen's first-paint path.
  const [rwRev, setRwRev] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribeRunwayRoster(() => setRwRev((r) => r + 1));
    const sync = () => { void syncRunwayRoster(); };
    const idle = (window as any).requestIdleCallback;
    if (typeof idle === 'function') {
      const id = idle(sync, { timeout: 1800 });
      return () => { (window as any).cancelIdleCallback?.(id); unsubscribe(); };
    }
    const id = window.setTimeout(sync, 500);
    return () => { window.clearTimeout(id); unsubscribe(); };
  }, []);

  const liveOf = (m: VideoModelConfig) => (m.provider === 'runway' ? rosterModel(m.apiModel) : null);
  // Recommended mode and manual mode both resolve ONE primary model before
  // planning. Auto scores modern models against script dialogue, recurring
  // characters, motion and requested duration; Omni Flash remains last unless
  // its specific capability outweighs the preferred Seedance/Kling routes.
  const plannerModels = useMemo(() => pickerModels(audioEnabled), [audioEnabled]);
  const rankedModels = useMemo(
    () => scoreVideoModels(plannerModels, { script: text, duration: targetDuration, charactersSpeak }),
    [plannerModels, text, targetDuration, charactersSpeak],
  );
  const autoRecommendation = rankedModels[0];
  const autoPick = autoRecommendation.model;
  const autoPickReason = recommendationExplanation(autoRecommendation);

  const chosenModel = plannerModels.find((m) => m.id === videoModel) || autoPick;
  const chosenLive = liveOf(chosenModel);
  const chosenCapability = capabilityFor(chosenModel.apiModel);
  const unattendedNote = chosenCapability
    ? `${chosenCapability.label}: ${chosenCapability.supportedDurations?.join('s / ') || `${chosenCapability.minDurationSec}–${chosenCapability.maxDurationSec}s`} per big scene · ${chosenCapability.nativeAudio ? 'native sound' : 'silent adapter'} · ${chosenCapability.maxReferences} reference input${chosenCapability.maxReferences === 1 ? '' : 's'} · continuity by ${chosenCapability.continuityMode.replace('-', ' ')}.`
    : `${chosenModel.label}: capability details unavailable.`;
  const modelNote = modelMode === 'auto'
    ? autoPickReason
    : chosenLive
      ? `${rosterInputLabel(chosenLive)} · ${chosenLive.blurb} ${chosenLive.available ? chosenLive.priceNote : chosenLive.unavailableReason} ${unattendedNote}`
      : `${chosenModel.availabilityNote || 'Every block of this film renders on this model.'} ${unattendedNote}`;
  const durationContract = (m: VideoModelConfig) => {
    const capability = capabilityFor(m.apiModel);
    return capability?.supportedDurations?.length ? capability.supportedDurations.map((value) => `${value}s`).join(' or ') : capability ? `${capability.minDurationSec}–${capability.maxDurationSec}s` : `${m.minDuration || 1}–${m.safeMaxDuration}s`;
  };
  const catalogLine = `${audioEnabled ? 'Only models with native audio are shown while audio is on. ' : ''}Connected contracts: ${plannerModels.map((m) => `${m.label} = ${durationContract(m)}`).join('; ')}.`;

  const modelOptions: ModelGridOption[] = useMemo(() => plannerModels.map((m) => {
    const live = liveOf(m);
    const fallbackFamily = m.provider === 'google' ? 'Google' : m.provider === 'kling' ? 'Kling' : 'OpenRouter';
    return {
      id: m.id,
      label: m.label,
      family: live ? live.family : fallbackFamily,
      blurb: m.id === KLING_3_0_OMNI.id
        ? 'Recurring cast · 5s/10s only · silent · 2–4 references.'
        : m.provider === 'kling'
          ? 'Natural scenes · 5s/10s only · silent · first/last frames.'
          : m.provider === 'google'
            ? 'Character consistency · 2–8s · native sound · seed plus references.'
            : m.id === SEEDANCE_2_5.id
              ? 'Cinematic long takes · 4–30s · native sound · frames or up to 3 assets.'
              : 'Fast drafts · 4–10s · silent · one start frame.',
      meta: live
        ? `${rosterInputLabel(live)} · ${live.minDurationS}–${live.maxDurationS}s`
        : `Clips up to ${m.safeMaxDuration}s · ${m.maxReferenceImages} reference image${m.maxReferenceImages === 1 ? '' : 's'}`,
      badge: m.id === autoPick.id ? 'Preferred' : '',
      available: live ? live.available : !m.availabilityNote,
      unavailableReason: live ? live.unavailableReason : m.availabilityNote,
    };
  }), [plannerModels, autoPick.id, rwRev]);

  // If the audio setting hides the selected model, move to the highest-priority
  // model that remains and say so, instead of silently changing the plan.
  const [switchNote, setSwitchNote] = useState('');
  const lastModelRef = useRef<string>(modelMode === 'manual' ? videoModel : autoPick.id);
  useEffect(() => {
    const nextModel = modelMode === 'auto' ? autoPick : chosenModel;
    if (modelMode === 'manual' && videoModel !== chosenModel.id) setVideoModel(chosenModel.id);
    const prevId = lastModelRef.current;
    if (prevId !== nextModel.id && !plannerModels.some((m) => m.id === prevId)) {
      const prev = pickerModelById(prevId);
      const policy = AUDIO_POLICIES.find((option) => option.id === audioPolicy);
      setSwitchNote(`${prev ? prev.label : 'The previous model'} can’t generate native audio, which “${policy ? policy.label : 'this audio setting'}” needs, so the picker switched to ${nextModel.label}.`);
    }
    lastModelRef.current = nextModel.id;
  }, [audioPolicy, modelMode, videoModel, autoPick.id, chosenModel.id]);
  const [note, setNote] = useState(initialIntake?.productionNotes.join(' ') || '');
  const [filmType, setFilmType] = useState(initialIntake ? (initialIntake.styleId === 'explainer' ? 'explainer' : initialIntake.styleId === 'cinematic' ? 'story' : 'ad') : '');
  const [videoStyle, setVideoStyle] = useState<VideoStyleId>('cinematic-live-action');
  const [visualStyle, setVisualStyle] = useState(String(intakeStyle.visualPreset || styleDirection('cinematic-live-action')));
  const [storyboard, setStoryboard] = useState<'yes' | 'no' | ''>(initialIntake?.storyboardRequired ? 'yes' : '');
  const [ideaScriptReady, setIdeaScriptReady] = useState(false);
  const [ownScriptChoice, setOwnScriptChoice] = useState<'skip' | 'improve' | ''>(initialIntake ? 'skip' : '');
  // Legacy card state remains only until the old branch below is removed in a
  // future cleanup; the branch is permanently disabled by the new workflow.
  const [briefQuestionDone, setBriefQuestionDone] = useState(false);
  const [customDirection, setCustomDirection] = useState('');
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

  function normalizeBrandKey(value: string): string {
    return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  }
  async function loadBriefBrand(target: string) {
    if (!target) return;
    const requestKey = target;
    lastBrandUrl.current = target;
    setFetchedBrand(null); setBrandStatus('loading'); setBrandError('');
    try {
      const found = await fetchBrandFromWebsite(target);
      if (lastBrandUrl.current !== requestKey) return;
      setFetchedBrand(found); setBrandStatus('ready');
    } catch {
      if (lastBrandUrl.current !== requestKey) return;
      setFetchedBrand(null); setBrandStatus('error');
      setBrandError('The website could not be read after retrying once.');
    }
  }
  useEffect(() => {
    if (!briefUrl) { setFetchedBrand(null); setBrandStatus('idle'); lastBrandUrl.current = ''; return; }
    if (savedBrand) { setFetchedBrand(null); setBrandStatus('ready'); lastBrandUrl.current = briefUrl; return; }
    if (normalizeBrandKey(briefUrl) === ignoredBrandKey || lastBrandUrl.current === briefUrl) return;
    lastBrandUrl.current = briefUrl;
    void loadBriefBrand(briefUrl);
  }, [briefUrl, savedBrand?.id, ignoredBrandKey]);

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

  // AI FORMAT — the on-ramp for ANY rough script. One proxy call structures the
  // pasted text into the manual-mode scene format and writes it back into the
  // textarea, so the parse preview below shows exactly what will be filmed and
  // the customer can still hand-edit every line before generating.
  const [aiFormatBusy, setAiFormatBusy] = useState(false);
  const [aiFormatErr, setAiFormatErr] = useState('');
  const [aiFormatProposal, setAiFormatProposal] = useState('');
  const [ideaConcepts, setIdeaConcepts] = useState<ScriptConcept[]>([]);
  const [selectedConcept, setSelectedConcept] = useState<ScriptConcept | null>(null);

  async function handleAiFormat() {
    if (aiFormatBusy || busy || !text.trim()) return;
    setAiFormatBusy(true); setAiFormatErr('');
    try {
      if (mode === 'ai' && !selectedConcept) {
        setIdeaConcepts(await suggestScriptConcepts(text));
        return;
      }
      const brief = selectedConcept
        ? `${text}\n\nSELECTED STORY APPROACH — preserve this intent:\n${selectedConcept.title}\n${selectedConcept.premise}\n${selectedConcept.visual_arc}`
        : text;
      const formatted = await aiFormatScript(brief, {
        audioEnabled, narrationEnabled, charactersSpeak,
        modelLabel: effectiveModel.label,
        modelDurationRule: durationContract(effectiveModel),
        modelMinDuration: effectiveModel.minDuration,
        modelMaxDuration: effectiveModel.safeMaxDuration,
        modelSupportedDurations: effectiveModel.discreteDurations ? effectiveModel.supportedDurations : undefined,
        targetDuration,
        targetSceneDurations: filmBlocks,
      });
      setAiFormatProposal(serializeManualScript(formatted));
    } catch (ex: any) {
      setAiFormatErr(String(ex?.message || ex));
    } finally {
      setAiFormatBusy(false);
    }
  }

  // The model every clip of this film will actually render on, resolved ONCE
  // so the duration limits shown to the customer and the id sent to the
  // pipeline can never disagree.
  const effectiveModel = modelMode === 'auto' ? autoPick : chosenModel;
  const effectiveApiModel = effectiveModel.apiModel;
  const effectiveLive = liveOf(effectiveModel);
  const filmBlocks = useMemo(() => legalFilmBlocks(targetDuration, effectiveModel), [targetDuration, effectiveModel.id]);
  const sceneLimits = sceneDurationLimitsFrom({
    modelId: effectiveApiModel,
    modelName: effectiveModel.label,
    maxS: effectiveLive?.maxDurationS ?? effectiveModel.safeMaxDuration,
    minS: effectiveLive?.minDurationS ?? effectiveModel.minDuration ?? 2,
  });

  // The pre-submit check. A pasted script that cannot be filmed as written is
  // reported HERE, naming the scene and the fix, instead of being discovered
  // as a provider 400 after the first clip has been paid for.
  const durationProblems = useMemo(
    () => (mode === 'manual' && parsed.scenes.length
      ? validateSceneDurations(
        effectiveApiModel,
        parsed.scenes.map((scene) => scene.durationSec),
        { limits: sceneLimits, maxScenes: MAX_SCRIPT_SCENES },
      )
      : []),
    [mode, parsed, effectiveApiModel, sceneLimits.minS, sceneLimits.maxS, sceneLimits.source],
  );

  // PREMIUM-ENGINE COST CONFIRMATION. Seedance 2.5 is long-form only and the
  // most expensive engine on the roster, so it never starts on one click: the
  // estimate is shown and agreed to first. Changing the model withdraws the
  // agreement, because it was an agreement about a specific price.
  const [costConfirmed, setCostConfirmed] = useState(false);
  const plannedClips = mode === 'manual'
    ? Math.max(1, parsed.scenes.length)
    : Math.max(1, Math.ceil(targetDuration / Math.max(1, sceneLimits.maxS)));
  const estimatedBlockSeconds = mode === 'manual'
    ? sceneLimits.defaultS
    : Math.min(sceneLimits.maxS, Math.max(sceneLimits.minS, targetDuration / plannedClips));
  const costPrompt = costConfirmMessage(effectiveModel, estimatedBlockSeconds, plannedClips);
  useEffect(() => { setCostConfirmed(false); }, [effectiveModel.id, costPrompt]);
  const needsCostConfirm = Boolean(costPrompt) && !costConfirmed;

  const allQuestionsAnswered = Boolean(filmType && visualStyle && storyboard);
  const scriptReady = mode === 'ai'
    ? ideaScriptReady && text.trim().split(/\s+/).filter(Boolean).length >= 3
    : ownScriptChoice === 'skip'
      ? text.trim().split(/\s+/).filter(Boolean).length >= 3 && (!parsed.scenes.length || durationProblems.length === 0)
      : ownScriptChoice === 'improve' && parsed.scenes.length > 0 && durationProblems.length === 0;
  const selectedSupportsAudio = !(charactersSpeak && !effectiveModel.audioSupported);
  const plannedTargetDuration = mode === 'manual' && parsed.scenes.length ? parsed.scenes.reduce((sum, scene) => sum + scene.durationSec, 0) : targetDuration;
  const budgetReady = executionMode !== 'automatic' || maxAuthorizedCredits >= Math.max(1, plannedTargetDuration);
  const durationCompatible = filmBlocks.length > 0;
  const canGo = scriptReady && allQuestionsAnswered && !needsCostConfirm && selectedSupportsAudio && durationCompatible && budgetReady;

  return (
    <div className="s2v-create-scroll" style={{ flex: 1, overflowY: 'auto', padding: '32px 24px 144px' }}>
      <div className="s2v-create-inner" style={{ maxWidth: 760, margin: '0 auto' }}>
        <div className="s2v-stage-grid" aria-label="Creation stages" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(116px, 1fr))', gap: 8, marginBottom: 24, overflowX: 'auto', paddingBottom: 2 }}>
          {['1 Brief', '2 Cast & look', '3 Plan', '4 Produce', '5 Finish'].map((label, index) => (
            <div key={label} style={{ borderRadius: 9, padding: '8px 7px', textAlign: 'center', fontSize: 10.5, fontWeight: 750, color: index < 3 ? (index === 0 ? '#1B1308' : T.bone) : T.dim, background: index === 0 ? 'var(--vg-gradient-action)' : T.raised, border: `1px solid ${index < 3 ? T.live : T.dim}` }}>{label}</div>
          ))}
        </div>
        <section className="s2v-create-section" style={{ background: T.raised, border: `1px solid ${T.live}`, borderRadius: 14, padding: 18 }}>
          <div style={{ color: T.live, fontSize: 10.5, fontWeight: 850, letterSpacing: 1.2, textTransform: 'uppercase' }}>Step 1 · production target</div>
          <div style={{ color: T.bone, fontSize: 17, fontWeight: 850, marginTop: 4 }}>Choose duration and model first</div>
          <div style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.5, marginTop: 4 }}>The writer targets this exact runtime. Auto updates its score after you add the idea or script; your manual model choice always wins.</div>
          <div role="radiogroup" aria-label="Target duration before script" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {[5, 8, 10, 15, 30, 45, 60, 90, 120].map((seconds) => <button key={seconds} type="button" role="radio" aria-checked={!durationCustom && targetDuration === seconds} onClick={() => { setDurationCustom(false); setTargetDuration(seconds); setMaxAuthorizedCredits((current) => Math.max(current, seconds)); }} disabled={busy} style={{ minWidth: 52, minHeight: 44, background: !durationCustom && targetDuration === seconds ? T.live : T.canvas, color: !durationCustom && targetDuration === seconds ? '#1B1308' : T.bone, border: `1px solid ${!durationCustom && targetDuration === seconds ? T.live : T.dim}`, borderRadius: 9, padding: '8px 12px', fontSize: 12.5, fontWeight: 800 }}>{seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}</button>)}
            <button type="button" role="radio" aria-checked={durationCustom} onClick={() => setDurationCustom(true)} disabled={busy} style={{ minHeight: 44, background: durationCustom ? T.live : T.canvas, color: durationCustom ? '#1B1308' : T.bone, border: `1px solid ${durationCustom ? T.live : T.dim}`, borderRadius: 9, padding: '8px 14px', fontSize: 12.5, fontWeight: 800 }}>Custom</button>
          </div>
          {durationCustom ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}><label style={{ color: T.muted, fontSize: 11.5 }}>Minutes <input type="number" min={0} max={30} value={customMinutes} onChange={(event) => { const minutes = Math.min(30, Math.max(0, Number(event.target.value) || 0)); const seconds = minutes === 30 ? 0 : customSeconds; setCustomMinutes(minutes); if (minutes === 30) setCustomSeconds(0); try { const total = parseDurationInput(minutes, seconds); setTargetDuration(total); setMaxAuthorizedCredits((current) => Math.max(current, total)); } catch { /* below minimum */ } }} style={{ width: 72, marginLeft: 5, background: T.canvas, color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 8, padding: 8 }} /></label><span style={{ color: T.dim }}>:</span><label style={{ color: T.muted, fontSize: 11.5 }}>Seconds <input type="number" min={0} max={59} value={customSeconds} onChange={(event) => { const seconds = customMinutes === 30 ? 0 : Math.min(59, Math.max(0, Number(event.target.value) || 0)); setCustomSeconds(seconds); try { const total = parseDurationInput(customMinutes, seconds); setTargetDuration(total); setMaxAuthorizedCredits((current) => Math.max(current, total)); } catch { /* below minimum */ } }} style={{ width: 72, marginLeft: 5, background: T.canvas, color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 8, padding: 8 }} /></label><span style={{ color: T.live, fontFamily: T.mono, fontSize: 12 }}>{formatDuration(targetDuration)} / 30:00 max</span></div> : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 13, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setModelMode('auto')} style={{ minHeight: 44, background: modelMode === 'auto' ? T.live : T.canvas, color: modelMode === 'auto' ? '#1B1308' : T.bone, border: `1px solid ${modelMode === 'auto' ? T.live : T.dim}`, borderRadius: 999, padding: '9px 14px', fontSize: 12, fontWeight: 800 }}>Auto / best for this script</button>
            <span style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.45, flex: '1 1 260px' }}>{autoPickReason}</span>
          </div>
          <div style={{ marginTop: 10 }}><ModelGrid compact options={modelOptions} value={modelMode === 'manual' ? videoModel : autoPick.id} onChange={(id) => { setSwitchNote(''); setModelMode('manual'); setVideoModel(id); }} disabled={busy} /></div>
        </section>
        <div style={{ color: T.live, fontSize: 10.5, fontWeight: 850, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>Step 2 · source</div>
        <ModeToggle value={mode} onChange={setMode} disabled={busy} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 20 }}>
          <div style={{ background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 12, padding: 12 }}>
            <div style={{ color: T.bone, fontSize: 12.5, fontWeight: 800 }}>Control</div>
            <div role="radiogroup" aria-label="Planning control" style={{ display: 'flex', gap: 7, marginTop: 8 }}>
              {([['agentic', 'Agentic'], ['manual', 'Manual locks']] as const).map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={controlMode === id} onClick={() => setControlMode(id)} style={{ minHeight: 44, flex: 1, background: controlMode === id ? T.live : T.canvas, color: controlMode === id ? '#17120A' : T.bone, border: `1px solid ${controlMode === id ? T.live : T.dim}`, borderRadius: 9, fontSize: 12, fontWeight: 750, cursor: 'pointer' }}>{label}</button>)}
            </div>
            <div style={{ color: T.dim, fontSize: 10.5, lineHeight: 1.45, marginTop: 7 }}>{controlMode === 'manual' ? 'Per-shot model, script, prompt and reference choices stay locked until you change them.' : 'The director recommends compatible models and timing; you can still edit every block before approval.'}</div>
          </div>
          <div style={{ background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 12, padding: 12 }}>
            <div style={{ color: T.bone, fontSize: 12.5, fontWeight: 800 }}>Execution</div>
            <div role="radiogroup" aria-label="Execution mode" style={{ display: 'flex', gap: 7, marginTop: 8 }}>
              {([['review', 'Review plan'], ['automatic', 'Run automatically']] as const).map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={executionMode === id} onClick={() => setExecutionMode(id)} style={{ minHeight: 44, flex: 1, background: executionMode === id ? T.live : T.canvas, color: executionMode === id ? '#17120A' : T.bone, border: `1px solid ${executionMode === id ? T.live : T.dim}`, borderRadius: 9, fontSize: 12, fontWeight: 750, cursor: 'pointer' }}>{label}</button>)}
            </div>
            <div style={{ color: T.dim, fontSize: 10.5, lineHeight: 1.45, marginTop: 7 }}>{executionMode === 'automatic' ? 'Approve one maximum now. The durable runner continues inside it and pauses only for a real blocker or ceiling change.' : 'Storyboard and blocks remain editable until one approval starts paid generation.'}</div>
          </div>
        </div>

        <div style={{ color: T.bone, fontSize: 25, fontWeight: 700, letterSpacing: -0.5, marginBottom: 6 }}>
          {mode === 'manual' ? 'Bring your own script' : 'Start with the idea'}
        </div>
        <div style={{ color: T.muted, fontSize: 13.5, lineHeight: 1.5, marginBottom: 22 }}>
          {mode === 'manual'
            ? 'Paste any script. Choose Skip to preserve it as the source of truth, or Ask AI to improve / fill gaps. AI changes stay in a proposal until you accept them.'
            : 'Describe the film in your own words. The prompt-maker writes an editable production script first; nothing is generated until you accept that script and answer the planning cards below.'}
        </div>

        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); if (mode === 'ai') { setIdeaConcepts([]); setSelectedConcept(null); setAiFormatProposal(''); setIdeaScriptReady(false); } }}
          aria-label={mode === 'manual' ? 'Paste your script' : 'Your script'}
          placeholder={mode === 'manual' ? 'Paste your script, voiceover, scene list or rough draft…' : 'Example: A warm 30-second launch film for a budgeting app. A young founder checks her phone on a rainy commute and realizes she finally understands where her money goes.'}
          rows={mode === 'manual'
            ? Math.min(24, Math.max(14, text.split('\n').length + 2))
            : Math.min(16, Math.max(5, text.split('\n').length + 2))}
          style={{ width: '100%', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 10, color: T.bone, fontSize: mode === 'manual' ? 13 : 15, lineHeight: 1.55, padding: '16px 18px', outline: 'none', resize: 'vertical', fontFamily: mode === 'manual' ? T.mono : T.sans }}
        />

        {briefUrl || brandInUse || brandStatus === 'error' ? <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', background: T.raised, border: `1px solid ${brandStatus === 'error' ? T.fault : T.live}`, borderRadius: 10, padding: '10px 12px' }}>
          {brandStatus === 'loading' ? <><VergeLoader size={28} label="Reading the website" /><span style={{ color: T.muted, fontSize: 12.5 }}>Reading website details automatically…</span></> : brandStatus === 'error' ? <><AlertTriangle size={14} color={T.fault} /><span style={{ color: T.fault, fontSize: 12.5 }}>{brandError}</span><button type="button" onClick={() => { lastBrandUrl.current = ''; void loadBriefBrand(briefUrl); }} style={{ marginLeft: 'auto', minHeight: 36, background: T.canvas, color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 8, padding: '7px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}><RefreshCw size={12} style={{ display: 'inline', marginRight: 5 }} />Retry</button></> : brandInUse ? <><Check size={14} color={T.done} /><strong style={{ color: T.bone, fontSize: 12.5 }}>{savedBrand ? `Using saved brand: ${brandInUse.identity.businessName}` : `Website context ready: ${brandInUse.identity.businessName}`}</strong>{brandInUse.limited ? <span style={{ color: 'var(--vg-warning, #E0B96B)', fontSize: 10.5 }}>Limited pages; gaps stay explicit</span> : null}<span style={{ marginLeft: 'auto', display: 'flex', gap: 7 }}><button type="button" disabled={!brandInUse.websiteUrl} onClick={() => void loadBriefBrand(brandInUse.websiteUrl)} style={{ minHeight: 36, background: T.canvas, color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 8, padding: '7px 11px', fontSize: 12, cursor: 'pointer' }}><RefreshCw size={12} style={{ display: 'inline', marginRight: 5 }} />Refresh</button><button type="button" onClick={() => { setIgnoredBrandKey(savedBrand ? savedBrand.id : normalizeBrandKey(brandInUse.websiteUrl)); setFetchedBrand(null); setBrandStatus('idle'); }} style={{ minHeight: 36, background: 'transparent', color: T.muted, border: `1px solid ${T.dim}`, borderRadius: 8, padding: '7px 11px', fontSize: 12, cursor: 'pointer' }}>Use different</button></span>{!savedBrand ? <span style={{ flexBasis: '100%', color: T.dim, fontSize: 10.5 }}>This brief uses the fetched context now. Confirm it in Brand Kit if you want it saved for future briefs.</span> : null}</> : null}
        </div> : null}

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

        {false && !briefQuestionDone ? (
          <div style={{ marginTop: 16, background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 12, padding: '14px 15px' }}>
            <div style={{ color: T.bone, fontSize: 13.5, fontWeight: 750 }}>One creative question: what should this film feel like?</div>
            <div style={{ color: T.dim, fontSize: 11.5, marginTop: 4 }}>Pick a card, add your own direction, or skip. Your script wording is never changed.</div>
            <div role="radiogroup" aria-label="Film feeling" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 8, marginTop: 11 }}>
              {[
                ['Cinematic & grounded', 'Recommended', 'cinematic, grounded, natural light, motivated camera movement'],
                ['Fast & energetic', '', 'fast, energetic, punchy camera language and decisive transitions'],
                ['Warm & human', '', 'warm, intimate, human, tactile detail and gentle camera movement'],
              ].map(([label, badge, value]) => (
                <button key={label} type="button" onClick={() => { setNote(value); setBriefQuestionDone(true); }} style={{ minHeight: 58, textAlign: 'left', background: badge ? 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)' : T.canvas, color: T.bone, border: `1px solid ${badge ? T.live : T.dim}`, borderRadius: 10, padding: '10px 11px', cursor: 'pointer' }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 750 }}>{label}</span>
                  {badge ? <span style={{ display: 'block', color: T.live, fontSize: 10, marginTop: 3, fontWeight: 700 }}>{badge}</span> : null}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 9, flexWrap: 'wrap' }}>
              <input value={customDirection} onChange={(e) => setCustomDirection(e.target.value)} placeholder="Custom direction…" style={{ flex: '1 1 240px', minHeight: 42, background: T.canvas, border: `1px solid ${T.dim}`, borderRadius: 9, color: T.bone, padding: '9px 11px', fontSize: 12.5 }} />
              <button type="button" disabled={!customDirection.trim()} onClick={() => { setNote(customDirection.trim()); setBriefQuestionDone(true); }} style={{ minHeight: 42, background: customDirection.trim() ? T.live : T.canvas, color: customDirection.trim() ? '#1B1308' : T.dim, border: `1px solid ${customDirection.trim() ? T.live : T.dim}`, borderRadius: 9, padding: '8px 13px', fontSize: 12, fontWeight: 700 }}>Use custom</button>
              <button type="button" onClick={() => setBriefQuestionDone(true)} style={{ minHeight: 42, background: 'transparent', color: T.muted, border: 'none', padding: '8px 10px', fontSize: 12, cursor: 'pointer' }}>Skip</button>
            </div>
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
          <div style={{ background: T.raised, border: `1px solid ${T.live}`, borderRadius: 12, padding: 14 }}>
            <div style={{ color: T.bone, fontSize: 13.5, fontWeight: 750 }}>Audio policy</div>
            <div style={{ color: T.dim, fontSize: 11.5, marginTop: 3 }}>One explicit policy flows through writing, provider prompts, assembly and edits.</div>
            <div role="radiogroup" aria-label="Audio policy" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8, marginTop: 11 }}>
              {AUDIO_POLICIES.map((option) => <button key={option.id} type="button" role="radio" aria-checked={audioPolicy === option.id} onClick={() => setAudioPolicy(option.id)} style={{ minHeight: 62, textAlign: 'left', background: audioPolicy === option.id ? 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)' : T.canvas, color: T.bone, border: `1px solid ${audioPolicy === option.id ? T.live : T.dim}`, borderRadius: 10, padding: '9px 11px', cursor: 'pointer' }}><span style={{ display: 'block', fontSize: 12, fontWeight: 800 }}>{option.label}</span><span style={{ display: 'block', color: T.muted, fontSize: 10.5, lineHeight: 1.4, marginTop: 3 }}>{option.description}</span></button>)}
            </div>
          </div>
          <div style={{ background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 12, padding: 14 }}> 
            <div style={{ color: T.bone, fontSize: 13.5, fontWeight: 750 }}>1. What kind of video is this?</div>
            <div role="radiogroup" aria-label="Video type" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 10 }}>
              {[
                ['Story film', 'Recommended', 'story'],
                ['Product / ad', '', 'ad'],
                ['Explainer', '', 'explainer'],
              ].map(([label, badge, value]) => (
                <button key={value} type="button" onClick={() => setFilmType(value)} style={{ minHeight: 64, textAlign: 'left', background: filmType === value ? 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)' : T.canvas, color: T.bone, border: `1px solid ${filmType === value ? T.live : T.dim}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 750 }}>{label}</span>
                  <span style={{ display: 'block', color: badge ? T.live : T.dim, fontSize: 10.5, marginTop: 4 }}>{badge || 'Choose if it fits'}</span>
                </button>
              ))}
            </div>
          </div>
          <div style={{ background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 12, padding: 14 }}>
            <div style={{ color: T.bone, fontSize: 13.5, fontWeight: 750 }}>2. Visual style</div>
            <div style={{ color: T.dim, fontSize: 11.5, marginTop: 3 }}>Agent recommendation is marked; you can override it.</div>
            <div role="radiogroup" aria-label="Visual style" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 10 }}>
              {VIDEO_STYLE_PRESETS.map(([id, label, direction], index) => (
                <button key={id} type="button" onClick={() => { setVideoStyle(id); setVisualStyle(direction); setNote(direction); }} style={{ minHeight: 64, textAlign: 'left', background: videoStyle === id ? 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)' : T.canvas, color: T.bone, border: `1px solid ${videoStyle === id ? T.live : T.dim}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 750 }}>{label}</span>
                  <span style={{ display: 'block', color: index === 0 ? T.live : T.dim, fontSize: 10.5, marginTop: 4 }}>{index === 0 ? 'Recommended' : 'Style direction'}</span>
                </button>
              ))}
              <button type="button" onClick={() => setVideoStyle('custom')} style={{ minHeight: 64, textAlign: 'left', background: videoStyle === 'custom' ? 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)' : T.canvas, color: T.bone, border: `1px solid ${videoStyle === 'custom' ? T.live : T.dim}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }}><span style={{ display: 'block', fontSize: 12.5, fontWeight: 750 }}>Custom Visual Direction</span><span style={{ display: 'block', color: T.dim, fontSize: 10.5, marginTop: 4 }}>Write your own</span></button>
            </div>
            {videoStyle === 'custom' ? <textarea value={visualStyle} onChange={(event) => setVisualStyle(event.target.value)} rows={3} placeholder="Describe the exact visual language, materials, camera, colour and mood…" style={{ width: '100%', marginTop: 9, background: T.canvas, color: T.bone, border: `1px solid ${T.live}`, borderRadius: 9, padding: '9px 11px', fontSize: 12, resize: 'vertical' }} /> : null}
          </div>
          <div style={{ background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 12, padding: 14 }}>
            <div style={{ color: T.bone, fontSize: 13.5, fontWeight: 750 }}>3. Storyboard before production? <span style={{ color: T.dim, fontWeight: 500 }}>(optional)</span></div>
            <div role="radiogroup" aria-label="Storyboard preference" style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {[['Yes — show a storyboard', 'yes'], ['No — plan only', 'no']].map(([label, value]) => (
                <button key={value} type="button" onClick={() => setStoryboard(value as 'yes' | 'no')} style={{ minHeight: 44, background: storyboard === value ? T.live : T.canvas, color: storyboard === value ? '#17120A' : T.bone, border: `1px solid ${storyboard === value ? T.live : T.dim}`, borderRadius: 10, padding: '9px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{label}</button>
              ))}
            </div>
          </div>
        </div>

        {true ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                className="s2v-lift"
                disabled={busy || aiFormatBusy || !text.trim()}
                title={mode === 'ai' ? 'Turn this idea into an editable production script.' : 'Propose a complete scene-formatted script without replacing your original.'}
                onClick={() => void handleAiFormat()}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: busy || aiFormatBusy || !text.trim() ? T.raised : T.live, color: busy || aiFormatBusy || !text.trim() ? T.dim : '#17120A', border: 'none', borderRadius: 9, padding: '10px 18px', fontSize: 13, fontWeight: 700, cursor: busy || aiFormatBusy || !text.trim() ? 'default' : 'pointer' }}
              >
                {aiFormatBusy ? <VergeLoader size={30} label="Formatting your script" /> : <Wand2 size={14} />}
                {aiFormatBusy ? (mode === 'ai' && !selectedConcept ? 'Developing story approaches…' : 'Writing the proposal…') : mode === 'ai' ? (selectedConcept ? 'Write this production script' : 'Show story approaches') : 'Ask AI to improve / fill gaps'}
              </button>
              {mode === 'manual' ? (
                <button type="button" onClick={() => { setOwnScriptChoice('skip'); setAiFormatProposal(''); }} style={{ minHeight: 42, background: ownScriptChoice === 'skip' ? T.done : 'transparent', color: ownScriptChoice === 'skip' ? '#101214' : T.bone, border: `1px solid ${ownScriptChoice === 'skip' ? T.done : T.dim}`, borderRadius: 9, padding: '9px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                  Skip — keep my wording
                </button>
              ) : null}
              <span style={{ color: T.dim, fontSize: 12, lineHeight: 1.5, maxWidth: 400 }}>
                {mode === 'ai' ? 'Review the complete script below. Your idea stays untouched until you accept it.' : 'Your original stays untouched. Compare the proposal, then Accept changes or keep your wording.'}
              </span>
            </div>
            {mode === 'ai' && ideaConcepts.length ? (
              <div style={{ marginTop: 11, display: 'grid', gap: 8 }}>
                <div style={{ color: T.bone, fontSize: 12.5, fontWeight: 750 }}>Choose the story approach before the writer creates scenes</div>
                {ideaConcepts.map((concept) => {
                  const active = selectedConcept?.title === concept.title;
                  return <button key={concept.title} type="button" onClick={() => { setSelectedConcept(concept); setAiFormatProposal(''); }} style={{ minHeight: 72, textAlign: 'left', background: active ? 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)' : T.canvas, color: T.bone, border: `1px solid ${active ? T.live : T.dim}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }}><span style={{ display: 'block', fontSize: 12.5, fontWeight: 800 }}>{concept.title}</span><span style={{ display: 'block', color: T.muted, fontSize: 11.5, lineHeight: 1.45, marginTop: 4 }}>{concept.premise}</span><span style={{ display: 'block', color: T.dim, fontSize: 10.8, lineHeight: 1.4, marginTop: 4 }}>{concept.visual_arc}</span></button>;
                })}
              </div>
            ) : null}
            {aiFormatProposal ? (
              <div style={{ marginTop: 11, background: T.canvas, border: `1px solid ${T.live}`, borderRadius: 10, padding: '11px 12px' }}>
                <div style={{ color: T.bone, fontSize: 12.5, fontWeight: 750 }}>{mode === 'ai' ? 'Prompt-maker script — review before accepting' : 'Proposed improvements — your original is unchanged'}</div>
                <pre style={{ maxHeight: 230, overflow: 'auto', whiteSpace: 'pre-wrap', color: T.muted, fontFamily: T.mono, fontSize: 11, lineHeight: 1.55, margin: '8px 0 0' }}>{aiFormatProposal}</pre>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button type="button" onClick={() => { setText(aiFormatProposal); setAiFormatProposal(''); if (mode === 'ai') { setIdeaScriptReady(true); setMode('manual'); setOwnScriptChoice('skip'); } else setOwnScriptChoice('improve'); }} style={{ background: T.live, color: '#17120A', border: 'none', borderRadius: 8, padding: '8px 13px', fontSize: 12, fontWeight: 750, cursor: 'pointer' }}><Check size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 5 }} />Accept script</button>
                  <button type="button" onClick={() => { setAiFormatProposal(''); if (mode === 'manual') setOwnScriptChoice('skip'); }} style={{ background: 'transparent', color: T.muted, border: `1px solid ${T.dim}`, borderRadius: 8, padding: '8px 13px', fontSize: 12, cursor: 'pointer' }}>{mode === 'ai' ? 'Revise my idea' : 'Keep original'}</button>
                </div>
              </div>
            ) : null}
            {aiFormatErr ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, background: 'rgba(153,27,27,0.08)', border: '1px solid rgba(153,27,27,0.25)', borderRadius: 10, padding: '11px 14px' }}>
                <AlertTriangle size={14} color={T.fault} style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ color: T.fault, fontSize: 12.5, lineHeight: 1.6 }}>{aiFormatErr}</span>
              </div>
            ) : null}
            {mode === 'manual' ? <ParsePreview
              parsed={parsed}
              hasText={text.trim().length > 0}
              limits={sceneLimits}
              problems={durationProblems}
            /> : null}
          </div>
        ) : null}

        {mode === 'manual' ? (
          <div style={{ marginTop: 26 }}>
            <CharacterRefField previewUrl={charPreview} busy={charBusy} disabled={busy} error={charErr} onPick={pickCharacterRef} onClear={clearCharacterRef} />
            <StoredReferencesField disabled={busy} onInsert={(name) => setText((value) => `${value}${value && !/\s$/.test(value) ? ' ' : ''}@${name} `)} />
          </div>
        ) : null}

        <div style={{ marginTop: 26 }}>
          <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>Orientation</div>
          <OrientationToggle value={aspect} onChange={setAspect} disabled={busy} />
          <div style={{ color: T.dim, fontSize: 12, marginTop: 9, lineHeight: 1.55 }}>
            Every clip renders at {aspect}, and the final assembly inherits it — a portrait film stitches to a portrait MP4.
          </div>

          <div style={{ color: T.dim, fontSize: 12, marginTop: 7, lineHeight: 1.55 }}>
            {formatSceneDurationHint(sceneLimits)}
            {mode === 'ai'
              ? ' The director covers the whole script and splits only at legal boundaries — no padding and no dropped words.'
              : ''}
          </div>
          {!durationCompatible ? <div role="alert" style={{ color: T.fault, fontSize: 11.5, marginTop: 9 }}>The selected model cannot represent exactly {targetDuration}s with its legal clip lengths. Pick a compatible duration or switch to Auto.</div> : null}
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: T.muted, fontSize: 12, fontWeight: 700 }}>Big-scene plan</span>
            {filmBlocks.map((seconds, index) => (
              <span key={`${seconds}-${index}`} style={{ minWidth: 48, textAlign: 'center', background: T.canvas, color: T.bone, border: `1px solid ${T.dim}`, borderRadius: 8, padding: '6px 9px', fontFamily: T.mono, fontSize: 12 }}>
                {seconds}s
              </span>
            ))}
            <span style={{ color: T.dim, fontSize: 11.5 }}>{effectiveModel.provider === 'kling' ? `10s blocks for Kling${filmBlocks[filmBlocks.length - 1] === 5 ? ' · final 5s block' : ''}` : `${effectiveModel.label} · maximum-duration blocks first`}</span>
          </div>
          <StyleLockToggle value={styleLock} onChange={setStyleLock} disabled={busy} />
          {executionMode === 'automatic' ? <div style={{ marginTop: 14, background: T.raised, border: `1px solid ${budgetReady ? T.done : T.fault}`, borderRadius: 11, padding: 12 }}><label style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.bone, fontSize: 12.5, fontWeight: 750 }}>Maximum authorized credits <input type="number" min={plannedTargetDuration} max={100000} value={maxAuthorizedCredits} onChange={(event) => setMaxAuthorizedCredits(Math.max(0, Math.round(Number(event.target.value) || 0)))} style={{ width: 110, marginLeft: 'auto', background: T.canvas, color: T.bone, border: `1px solid ${budgetReady ? T.dim : T.fault}`, borderRadius: 8, padding: '8px 9px' }} /></label><div style={{ color: budgetReady ? T.muted : T.fault, fontSize: 10.8, lineHeight: 1.5, marginTop: 6 }}>{budgetReady ? `One ceiling for this ${formatDuration(targetDuration)} project. The runner pauses before any action that would exceed it.` : `Authorize at least ${plannedTargetDuration} credits for the planned video duration, or switch to Review Plan.`}</div></div> : null}
        </div>

        <details style={{ marginTop: 22, background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 12, padding: '12px 14px' }}>
          <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer', color: T.bone, fontSize: 13, fontWeight: 700, listStylePosition: 'inside' }}>
            Advanced model and reference details <span style={{ color: T.muted, fontWeight: 500, marginLeft: 6 }}>({modelMode === 'auto' ? `${autoPick.label} recommended` : chosenModel.label})</span>
          </summary>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginTop: 22, marginBottom: 10 }}>
          <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase' }}>Video model (registry)</div>
          <div style={{ color: T.dim, fontSize: 11 }}>{catalogLine}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <button onClick={() => setModelMode('auto')} style={{ background: modelMode === 'auto' ? T.live : T.raised, color: modelMode === 'auto' ? '#17120A' : T.muted, border: `1px solid ${modelMode === 'auto' ? T.live : T.dim}`, borderRadius: 999, padding: '8px 15px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            Recommended — {autoPick.label}
          </button>

        </div>
        <ModelGrid
          options={modelOptions}
          value={modelMode === 'manual' ? videoModel : autoPick.id}
          onChange={(id) => { setSwitchNote(''); setModelMode('manual'); setVideoModel(id); }}
          disabled={busy}
        />
        {switchNote ? (
          <div role="status" aria-live="polite" style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 8, color: T.bone, fontSize: 12, lineHeight: 1.5, background: 'color-mix(in srgb, var(--space-brand-primary-500) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--space-brand-primary-500) 40%, transparent)', borderRadius: 10, padding: '9px 12px' }}>
            <AlertTriangle size={13} color={T.live} style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ flex: 1 }}>{switchNote}</span>
            <button type="button" aria-label="Dismiss model note" onClick={() => setSwitchNote('')} style={{ background: 'transparent', border: 'none', color: T.muted, cursor: 'pointer', padding: 2, display: 'flex' }}><X size={12} /></button>
          </div>
        ) : null}
        <div style={{ marginTop: 10, background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 10, padding: '11px 14px' }}>
          <div style={{ color: T.bone, fontSize: 12.5, fontWeight: 700, marginBottom: 3 }}>
            {modelMode === 'auto' ? `Stable primary model · ${autoPick.label}` : `Every block renders on ${chosenModel.label}`}
          </div>
          <div style={{ color: T.muted, fontSize: 12, lineHeight: 1.55 }}>{modelNote}</div>
        </div>

        {mode === 'ai' ? (
          <div style={{ marginTop: 30 }}>
            <CharacterRefField previewUrl={charPreview} busy={charBusy} disabled={busy} error={charErr} onPick={pickCharacterRef} onClear={clearCharacterRef} />
            <StoredReferencesField disabled={busy} onInsert={(name) => setText((value) => `${value}${value && !/\s$/.test(value) ? ' ' : ''}@${name} `)} />
          </div>
        ) : null}

        <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 30, marginBottom: 10 }}>
          Product or look reference <span style={{ color: T.dim, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="s2v-ghost" disabled={shotBusy} onClick={() => fileRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 7, background: T.raised, border: `1px solid ${T.dim}`, color: T.bone, fontSize: 13, cursor: 'pointer', padding: '9px 14px', borderRadius: 8 }}>
            {shotBusy ? <VergeLoader size={32} label="Uploading your image" /> : <ImageIcon size={14} />} {shotUrl ? 'Replace image' : 'Attach image'}
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
        <CrossProjectAssetPicker disabled={busy} onSelect={(asset) => { setShotUrl(asset.url); setNote((value) => [value, `Explicitly imported ${asset.name || `asset ${asset.id}`} from project ${asset.film_id}.`].filter(Boolean).join(' ')); }} />

        <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 30, marginBottom: 10 }}>
          Additional creative direction <span style={{ color: T.dim, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
        </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder='e.g. "documentary feel, warm palette, handheld camera"'
            style={{ width: '100%', background: T.canvas, border: `1px solid ${T.dim}`, borderRadius: 8, color: T.bone, fontSize: 13.5, padding: '11px 14px', outline: 'none' }}
          />
        </details>

        {!selectedSupportsAudio ? <div style={{ color: T.fault, fontSize: 12.5, lineHeight: 1.5, marginTop: 14, background: 'rgba(153,27,27,0.08)', border: '1px solid rgba(153,27,27,0.25)', borderRadius: 9, padding: '9px 13px' }}>{effectiveModel.label} is silent on the connected adapter, but this script asks visible characters to speak. Choose Seedance 2.5 or use post-production dialogue; the model remains manually selectable and nothing is filtered before a provider attempt.</div> : null}
        {err ? <div style={{ color: T.fault, fontSize: 12.5, lineHeight: 1.5, marginTop: 14, background: 'rgba(153,27,27,0.08)', border: '1px solid rgba(153,27,27,0.25)', borderRadius: 9, padding: '9px 13px' }}>{err}</div> : null}

        {costPrompt ? (
          <div
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 18,
              background: 'color-mix(in srgb, var(--space-brand-primary-500) 10%, transparent)',
              border: `1px solid color-mix(in srgb, ${T.live} 45%, transparent)`,
              borderRadius: 11, padding: '13px 15px',
            }}
          >
            <AlertTriangle size={15} color={T.live} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: T.bone, fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Confirm the cost first</div>
              <div style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.6 }}>{costPrompt}</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 11 }}>
                <button
                  className="s2v-lift"
                  disabled={busy || costConfirmed}
                  onClick={() => setCostConfirmed(true)}
                  style={{ background: costConfirmed ? T.raised : T.live, color: costConfirmed ? T.done : '#17120A', border: 'none', borderRadius: 9, padding: '9px 16px', fontSize: 12.5, fontWeight: 700, cursor: costConfirmed || busy ? 'default' : 'pointer' }}
                >
                  {costConfirmed ? 'Cost confirmed' : `Yes — render on ${effectiveModel.label}`}
                </button>
                <span style={{ color: T.dim, fontSize: 11.5, lineHeight: 1.5 }}>
                  Or pick a cheaper engine under Advanced.
                </span>
              </div>
            </div>
          </div>
        ) : null}

        <div className="s2v-create-actions">
        <button
          className="s2v-lift s2v-create-primary"
          disabled={!canGo || busy || shotBusy || charBusy}
          onClick={() => onSubmit({
            mode: mode === 'manual' && parsed.scenes.length > 0 ? 'manual' : 'ai',
            script: text.trim(), aspect, targetDuration: mode === 'manual' && parsed.scenes.length ? parsed.scenes.reduce((sum, scene) => sum + scene.durationSec, 0) : targetDuration, screenshotUrl: shotUrl || null, characterRefUrl: charUrl || null,
            note: [`Type: ${filmType}.`, `Style: ${visualStyle}.`, `Storyboard: ${storyboard === 'yes' ? 'requested before production' : 'not requested'}.`, brandInUse ? `WEBSITE BRAND CONTEXT:\n${brandToContextText(brandInUse)}` : '', note.trim()].filter(Boolean).join(' '),
            styleLock, videoModel: effectiveApiModel,
            audioEnabled, narrationEnabled, charactersSpeak,
            entryType: mode === 'manual' ? 'script' : 'idea', controlMode, executionMode,
            videoStyle, customVisualDirection: videoStyle === 'custom' ? visualStyle : '', audioPolicy,
            maxAuthorizedCredits,
            storyboardRequested: storyboard === 'yes',
          })}
          style={{ display: 'flex', alignItems: 'center', gap: 10, background: canGo && !busy ? T.live : T.raised, color: canGo && !busy ? '#17120A' : T.dim, border: `1px solid ${canGo && !busy ? T.live : T.dim}`, borderRadius: 11, padding: '14px 28px', fontSize: 15, fontWeight: 800, cursor: canGo && !busy ? 'pointer' : 'default', boxShadow: canGo && !busy ? '0 8px 28px rgba(212,146,10,0.28)' : 'none' }}
        >
          {busy ? <VergeLoader size={38} label="Planning your film" /> : <Clapperboard size={17} />}
          {busy ? 'Building the production plan…' : executionMode === 'automatic' ? 'Review & start production' : 'Continue to plan review'}
        </button>
        </div>
        {busy ? (
          <VideoGeneratingState
            label="Building your production plan"
            detail="Checking every answer, preserving the accepted wording, packing legal model blocks and preparing the first detailed prompt"
            style={{ marginTop: 24 }}
          />
        ) : null}
      </div>
    </div>
  );
}
