/**
 * ADS STUDIO — the consistency surface.
 *
 * Everything that decides whether the ad comes back as ONE person in ONE
 * visual world, gathered in one place instead of scattered through the eight
 * workflow steps:
 *
 *   🎭 Character   the locked presenter (uploaded photo or HeyGen avatar look)
 *                 plus the editable character description injected into every
 *                 generation prompt.
 *   🔑 Seed        the integer shared with Script-to-Video / SceneForge, with
 *                 the re-roll that starts a deliberately different look.
 *   🖥 Product screen  the uploaded UI still that becomes the zoom-in scene.
 *   🟢 HeyGen      the live reachability dot.
 *
 * These are presentation components only — every piece of state lives in the
 * Ads Studio session and every side effect is a callback.
 */

import { useRef } from 'react';
import type { CSSProperties } from 'react';
import { Loader2, Upload, X } from 'lucide-react';
import { T, UploadedAsset } from './api';

type AdDuration = 15 | 30 | 45 | 60;
type AdPlatform = 'TikTok' | 'Instagram Reels' | 'YouTube Shorts';
const AD_DURATIONS: AdDuration[] = [15, 30, 45, 60];
const AD_PLATFORMS: AdPlatform[] = ['TikTok', 'Instagram Reels', 'YouTube Shorts'];
import { HEYGEN_OFFLINE_TOOLTIP, HeygenHealth } from './heygen';

const card: CSSProperties = {
  background: T.card,
  border: `1px solid ${T.line}`,
  borderRadius: 14,
  padding: 16,
};

const label: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: T.muted,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 6,
  display: 'block',
};

const input: CSSProperties = {
  width: '100%',
  background: T.panel,
  border: `1px solid ${T.line}`,
  borderRadius: 10,
  padding: '10px 12px',
  color: T.ink,
  fontSize: 13.5,
  fontFamily: T.sans,
  outline: 'none',
  boxSizing: 'border-box',
};

const pill = (active: boolean): CSSProperties => ({
  background: active ? T.accent : 'transparent',
  color: active ? '#0A0A0A' : T.soft,
  border: `1px solid ${active ? T.accent : T.line}`,
  borderRadius: 999,
  padding: '5px 13px',
  fontSize: 12.5,
  fontWeight: 700,
  cursor: 'pointer',
});

// ---------------------------------------------------------------------------
// 🟢 HeyGen reachability dot
// ---------------------------------------------------------------------------

export function HeygenDot(props: { state: HeygenHealth; detail: string }) {
  const online = props.state === 'online';
  const checking = props.state === 'checking';
  return (
    <span
      title={checking ? 'Checking whether HeyGen is reachable…' : (props.detail || (online ? 'HeyGen is reachable.' : HEYGEN_OFFLINE_TOOLTIP))}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
        color: checking ? T.muted : online ? T.good : T.bad,
        border: `1px solid ${checking ? T.line : online ? T.good : T.bad}`,
        borderRadius: 999, padding: '3px 10px', cursor: 'help',
      }}
    >
      {checking ? '⚪' : online ? '🟢' : '🔴'}
      {checking ? 'HeyGen…' : online ? 'HeyGen' : 'HeyGen offline'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 🔑 Seed badge — sits directly under the generation button
// ---------------------------------------------------------------------------

export function SeedBadge(props: {
  seed: number;
  fromScriptToVideo: boolean;
  disabled?: boolean;
  onReroll: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
      <span
        title="Kling receives this as a real seed parameter. The Veo and Omni Flash routes expose no seed field, so it travels as a `Seed: n` line in the prompt — that nudges consistency rather than guaranteeing it."
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontFamily: T.mono, fontSize: 11.5, fontWeight: 700, color: T.accent,
          border: `1px solid ${T.lineStrong}`, borderRadius: 999, padding: '4px 11px', cursor: 'help',
        }}
      >
        🔑 Seed: {props.seed}
      </span>
      <button className="ads-btn"
        type="button"
        title="Re-roll the seed — a brand-new character and look, shared with Script-to-Video"
        disabled={props.disabled}
        onClick={props.onReroll}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: 'transparent', border: `1px solid ${T.line}`, borderRadius: 999,
          padding: '4px 11px', color: T.soft, fontSize: 11.5, fontWeight: 700,
          cursor: props.disabled ? 'default' : 'pointer', opacity: props.disabled ? 0.5 : 1,
        }}
      >
        🔄 Re-roll
      </button>
      {props.fromScriptToVideo ? (
        <span
          title="This ad inherited the seed your Script-to-Video film was generated on, so the character and style should match it."
          style={{
            fontSize: 11, fontWeight: 700, color: T.good,
            border: `1px solid ${T.good}`, borderRadius: 999, padding: '3px 10px', cursor: 'help',
          }}
        >
          Using seed from Script-to-Video
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 🎭 Character card
// ---------------------------------------------------------------------------

function Thumb(props: { url: string; alt: string; size?: number }) {
  const size = props.size || 72;
  return (
    <img
      src={props.url}
      alt={props.alt}
      style={{ width: size, height: size, objectFit: 'cover', borderRadius: 12, border: `1px solid ${T.lineStrong}`, flexShrink: 0 }}
    />
  );
}

export function CharacterCard(props: {
  /** The locked character reference — an upload, or a frame from a past clip. */
  characterImageUrl: string | null;
  /** The uploaded avatar/presenter reference from Step 1, used as a fallback. */
  avatarUrl: string | null;
  /** Persisted HeyGen avatar look, when one has been chosen. */
  avatarName: string;
  avatarThumbnailUrl: string;
  /** The style reference lifted from scene 1, once one exists. */
  styleImageUrl: string | null;
  characterDesc: string;
  disabled?: boolean;
  onCharacterDesc: (value: string) => void;
  onUploadCharacter: (file: File) => void;
  onClearCharacter: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const portrait = props.characterImageUrl || props.avatarThumbnailUrl || props.avatarUrl || '';
  return (
    <div className="ads-card ads-rise" style={{ ...card, borderColor: T.lineStrong }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>🎭 Character</span>
        <span style={{ fontSize: 12, color: T.muted }}>
          Locked for every scene of this ad — and reloaded next time you open Ads Studio.
        </span>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
          {portrait
            ? <Thumb url={portrait} alt="character reference" />
            : (
              <div style={{ width: 72, height: 72, borderRadius: 12, border: `1px dashed ${T.lineStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.muted, fontSize: 22 }}>
                🎭
              </div>
            )}
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="ads-btn"
              type="button"
              disabled={props.disabled}
              onClick={() => ref.current?.click()}
              style={{ background: 'transparent', border: `1px solid ${T.line}`, borderRadius: 8, padding: '3px 8px', color: T.soft, fontSize: 11, fontWeight: 700, cursor: props.disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Upload size={11} /> {props.characterImageUrl ? 'Replace' : 'Upload'}
            </button>
            {props.characterImageUrl ? (
              <button className="ads-btn"
                type="button"
                title="Stop using this character reference"
                disabled={props.disabled}
                onClick={props.onClearCharacter}
                style={{ background: 'transparent', border: `1px solid ${T.line}`, borderRadius: 8, padding: '3px 6px', color: T.muted, cursor: props.disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center' }}
              >
                <X size={11} />
              </button>
            ) : null}
          </div>
          <input
            ref={ref} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onUploadCharacter(f); e.target.value = ''; }}
          />
        </div>

        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <span style={label}>Character description (auto-filled)</span>
          <textarea
            style={{ ...input, minHeight: 74, resize: 'vertical', fontSize: 13 }}
            value={props.characterDesc}
            disabled={props.disabled}
            onChange={(e) => props.onCharacterDesc(e.target.value)}
            placeholder="Who the viewer sees — age, hair, wardrobe, energy. This exact text is repeated in every scene's prompt."
          />
          <div style={{ fontSize: 11.5, color: T.muted, marginTop: 6, lineHeight: 1.5 }}>
            {props.avatarName ? <>HeyGen avatar <b style={{ color: T.soft }}>{props.avatarName}</b> is saved for avatar renders. </> : null}
            {props.styleImageUrl
              ? 'A style frame was lifted from scene 1 and is being sent as the style reference on every later scene.'
              : 'Once scene 1 renders, a still is lifted from it and reused as the style reference for the rest of the ad.'}
          </div>
        </div>

        {props.styleImageUrl ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center' }}>
            <Thumb url={props.styleImageUrl} alt="style reference" size={56} />
            <span style={{ fontSize: 10, color: T.muted }}>style ref</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 🖥 Product Screen Segment
// ---------------------------------------------------------------------------

export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

export function ProductScreenZone(props: {
  screenshot: UploadedAsset | null;
  include: boolean;
  clipUrl: string | null;
  busy?: boolean;
  disabled?: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
  onToggleInclude: (include: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="ads-card ads-rise" style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>Product Screen Segment</span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: T.soft, cursor: props.screenshot ? 'pointer' : 'default', opacity: props.screenshot ? 1 : 0.5 }}>
          <input
            type="checkbox"
            checked={props.include}
            disabled={props.disabled || !props.screenshot}
            onChange={(e) => props.onToggleInclude(e.target.checked)}
          />
          Include in ad
        </label>
        {props.clipUrl ? <span style={{ fontSize: 11, fontWeight: 700, color: T.good, border: `1px solid ${T.good}`, borderRadius: 999, padding: '2px 9px' }}>clip ready</span> : null}
      </div>

      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: T.muted, lineHeight: 1.55 }}>
        Upload a still of your product screen and it becomes a cinematic zoom-in scene, inserted as the
        last shot before the CTA. This platform has no server-side page capture, so the screenshot is
        yours to supply rather than something an agent grabs from a URL.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {props.screenshot ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center' }}>
            <img
              src={props.screenshot.url}
              alt="product screen"
              style={{ width: 132, height: 76, objectFit: 'cover', borderRadius: 8, border: `1px solid ${T.lineStrong}` }}
            />
            <button className="ads-btn"
              type="button"
              disabled={props.disabled}
              onClick={props.onRemove}
              style={{ background: 'transparent', border: 'none', color: T.muted, fontSize: 11, cursor: props.disabled ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <X size={11} /> Remove
            </button>
          </div>
        ) : null}

        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <button className="ads-btn"
            type="button"
            disabled={props.disabled || props.busy}
            onClick={() => ref.current?.click()}
            style={{ ...input, cursor: props.disabled || props.busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: T.muted, border: `1px dashed ${T.lineStrong}` }}
          >
            {props.busy ? <Loader2 size={15} style={{ animation: 'adsspin 1s linear infinite' }} /> : <Upload size={15} />}
            {props.busy ? 'Uploading your screenshot…' : props.screenshot ? `Replace ${props.screenshot.name.slice(0, 28)}` : 'Add Product Screenshot'}
          </button>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 6 }}>PNG, JPG or WEBP · up to 10MB</div>
          <input
            ref={ref} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onUpload(f); e.target.value = ''; }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ad brief — length + platform (what the script regen writes to)
// ---------------------------------------------------------------------------

export function AdBriefControls(props: {
  targetDurationS: AdDuration;
  adPlatform: AdPlatform;
  disabled?: boolean;
  onDuration: (value: AdDuration) => void;
  onPlatform: (value: AdPlatform) => void;
}) {
  return (
    <div className="ads-card ads-rise" style={card}>
      <span style={label}>Ad length</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {AD_DURATIONS.map((d) => (
          <button className="ads-btn" key={d} type="button" disabled={props.disabled} onClick={() => props.onDuration(d)} style={pill(props.targetDurationS === d)}>
            {d}s
          </button>
        ))}
      </div>
      <div style={{ height: 14 }} />
      <span style={label}>Platform</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {AD_PLATFORMS.map((p) => (
          <button className="ads-btn" key={p} type="button" disabled={props.disabled} onClick={() => props.onPlatform(p)} style={pill(props.adPlatform === p)}>
            {p}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: T.muted, marginTop: 10, lineHeight: 1.5 }}>
        Both feed the script regen and every generation prompt — the platform decides the framing
        instruction the video engine receives.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generation timing footer
// ---------------------------------------------------------------------------

export function GeneratedInFooter(props: { seconds: number | null; note?: string }) {
  if (props.seconds === null) return null;
  return (
    <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, color: T.muted }}>
      <span style={{ fontFamily: T.mono, color: T.accent, fontWeight: 700 }}>Generated in {props.seconds}s</span>
      {props.note ? <span>{props.note}</span> : null}
      <span>— first API call to final MP4.</span>
    </div>
  );
}
