// FilmSpecViewer — the creative decision, in plain English.
//
// The FilmSpec is the one artefact in the pipeline a non-engineer can read and
// disagree with, so it is shown as prose and a scene list rather than as JSON.
// Everything the critic will later judge the film against is visible here
// before a single frame is rendered.

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { filmSeconds, type FilmSpec, type SceneSpec } from '../types/film-spec.types';
import { ACCENT, BORDER, CARD_BG, MUTED, PANEL, TEXT } from './LaunchUi';

const ROLE_TINT: Record<string, string> = {
  hook: '#C8920A',
  problem: '#991B1B',
  product: '#1D4ED8',
  proof: '#166534',
  outcome: '#B4720A',
  cta: '#B45309',
};

function tintFor(role: string): string {
  return ROLE_TINT[role] || '#7A6030';
}

function Chip(props: { children: React.ReactNode; color?: string; title?: string }) {
  const color = props.color || MUTED;
  return (
    <span
      title={props.title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 9px',
        borderRadius: 999,
        border: '1px solid color-mix(in srgb, ' + color + ' 42%, transparent)',
        background: 'color-mix(in srgb, ' + color + ' 12%, transparent)',
        color,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {props.children}
    </span>
  );
}

function Swatches(props: { colors: string[] }) {
  const colors = props.colors.filter(Boolean).slice(0, 6);
  if (!colors.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {colors.map((color, index) => (
        <span
          key={'c' + String(index)}
          title={color}
          style={{
            width: 14,
            height: 14,
            borderRadius: 4,
            background: color,
            border: '1px solid ' + BORDER,
            display: 'inline-block',
          }}
        />
      ))}
    </span>
  );
}

function SceneRow(props: { scene: SceneSpec; startFrame: number; fps: number }) {
  const { scene } = props;
  const seconds = (scene.duration_frames / props.fps).toFixed(1);
  const tint = tintFor(scene.role);

  return (
    <li
      style={{
        display: 'flex',
        gap: 14,
        padding: '14px 0',
        borderTop: '1px solid ' + BORDER,
      }}
    >
      <div style={{ width: 86, flexShrink: 0 }}>
        <Chip color={tint}>{scene.role}</Chip>
        <div style={{ marginTop: 7, fontSize: 11, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
          {String(props.startFrame) + 'f · ' + seconds + 's'}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: TEXT }}>
          {scene.visual_treatment}
        </p>
        {scene.narration_beat ? (
          <p style={{ margin: '7px 0 0', fontSize: 12.5, lineHeight: 1.5, color: MUTED }}>
            {'Beat: ' + scene.narration_beat}
          </p>
        ) : null}
        {scene.narration_text ? (
          <p style={{ margin: '5px 0 0', fontSize: 12.5, lineHeight: 1.5, color: MUTED, fontStyle: 'italic' }}>
            {'“' + scene.narration_text + '”'}
          </p>
        ) : null}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {scene.components.map((component) => (
            <Chip key={component} color={ACCENT}>{component}</Chip>
          ))}
          {scene.assets_needed.map((handle) => (
            <Chip key={handle} title="asset handle">{handle}</Chip>
          ))}
          <Chip title="motion intensity">{scene.motion_intensity}</Chip>
        </div>
      </div>
    </li>
  );
}

export default function FilmSpecViewer(props: {
  spec: FilmSpec;
  fps?: number;
  /** Collapsed by default when the spec is a detail rather than the subject. */
  defaultOpen?: boolean;
  compact?: boolean;
}) {
  const fps = props.fps || 30;
  const [open, setOpen] = useState(props.defaultOpen !== false);
  const { spec } = props;

  let cursor = 0;
  const rows = spec.scenes.map((scene) => {
    const startFrame = cursor;
    cursor += scene.duration_frames;
    return <SceneRow key={scene.id} scene={scene} startFrame={startFrame} fps={fps} />;
  });

  return (
    <section style={{ ...PANEL, padding: props.compact ? '16px 18px' : '22px 24px' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: 0,
          border: 'none',
          background: 'transparent',
          color: TEXT,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {open ? <ChevronDown size={16} style={{ color: MUTED }} /> : <ChevronRight size={16} style={{ color: MUTED }} />}
        <span style={{ flex: 1, fontSize: 15, fontWeight: 750, letterSpacing: '-0.02em' }}>
          {spec.narrative_arc}
        </span>
        <span style={{ fontSize: 12, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
          {String(spec.scenes.length) + ' scenes · ' + filmSeconds(spec, fps).toFixed(1) + 's'}
        </span>
      </button>

      {open ? (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 10,
              padding: '12px 14px',
              borderRadius: 12,
              background: CARD_BG,
              border: '1px solid ' + BORDER,
            }}
          >
            <Chip color={ACCENT}>{spec.typography_system.scale + ' / ' + spec.typography_system.weight}</Chip>
            {spec.music_style && spec.music_style !== 'none' ? <Chip>{spec.music_style}</Chip> : null}
            {spec.narration_enabled ? <Chip>narrated</Chip> : <Chip>no narration</Chip>}
            <Swatches colors={spec.brand_colors} />
          </div>

          {spec.visual_language ? (
            <p style={{ margin: '14px 0 0', fontSize: 13.5, lineHeight: 1.6, color: TEXT }}>
              {spec.visual_language}
            </p>
          ) : null}
          {spec.color_story ? (
            <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.6, color: MUTED }}>
              {spec.color_story}
            </p>
          ) : null}

          <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0 }}>{rows}</ul>

          {spec.risks.length ? (
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: MUTED,
                  marginBottom: 8,
                }}
              >
                Risks the director named
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {spec.risks.map((risk, index) => (
                  <li key={'r' + String(index)} style={{ fontSize: 12.5, lineHeight: 1.5, color: MUTED }}>
                    {risk}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
