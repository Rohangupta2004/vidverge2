import React from 'react';
import { Sparkles, Wand2 } from 'lucide-react';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import Textarea from '../../../components/ui/Textarea';
import { COLORS, RADIUS, alpha } from '../../../components/theme';
import {
  COLOR_THEMES,
  SPEEDS,
  STYLE_PRESETS,
  TEXT_MAX,
  TEXT_MIN,
} from '../lib/motionPlan';
import type { ColorTheme, Speed, StylePreset } from '../lib/motionPlan';

/**
 * The left column: what the director is told before it writes a plan.
 *
 * Every control is a plain chip group rather than a select — the whole point
 * of the studio is that the four creative decisions are visible at once.
 */

const PRESET_HINTS: Record<StylePreset, string> = {
  Cinematic: 'Slow reveals, wide tracking, film-title weight.',
  Energetic: 'Fast staggers, punchy scale, high contrast.',
  Minimal: 'One idea at a time. Quiet type, generous space.',
  Dramatic: 'Heavy weights, long holds, hard arrivals.',
  Glitch: 'Broken signal. Jitter, skew and colour split.',
  Elegant: 'Light weights, open tracking, soft fades.',
};

const THEME_SWATCHES: Record<ColorTheme, string> = {
  Cosmic: 'linear-gradient(135deg, #7c3aed 0%, #22d3ee 100%)',
  Monochrome: 'linear-gradient(135deg, #f5f5f5 0%, #525252 100%)',
  Fire: 'linear-gradient(135deg, #f97316 0%, #dc2626 100%)',
  Ice: 'linear-gradient(135deg, #a5f3fc 0%, #2563eb 100%)',
  Gold: 'linear-gradient(135deg, #fcd34d 0%, #b45309 100%)',
};

interface ChipProps {
  label: string;
  selected: boolean;
  onSelect: () => void;
  title?: string;
  swatch?: string;
  grow?: boolean;
}

function Chip({ label, selected, onSelect, title, swatch, grow }: ChipProps) {
  const [hover, setHover] = React.useState(false);
  const lit = selected || hover;
  return (
    <button
      type="button"
      onClick={onSelect}
      title={title}
      aria-pressed={selected}
      onMouseEnter={function enter() {
        setHover(true);
      }}
      onMouseLeave={function leave() {
        setHover(false);
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        flex: grow ? '1 1 0' : '0 0 auto',
        justifyContent: grow ? 'center' : undefined,
        padding: '7px 12px',
        borderRadius: RADIUS.sm,
        fontSize: 12.5,
        fontWeight: 600,
        fontFamily: "'Inter', system-ui, sans-serif",
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        color: selected ? COLORS.text : lit ? COLORS.text : COLORS.textMuted,
        background: selected ? alpha(COLORS.primary, 0.16) : lit ? alpha(COLORS.primary, 0.07) : 'transparent',
        border: '1px solid ' + (selected ? COLORS.borderHover : COLORS.border),
        transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease',
      }}
    >
      {swatch ? (
        <span
          aria-hidden="true"
          style={{
            width: 12,
            height: 12,
            borderRadius: 4,
            background: swatch,
            boxShadow: selected ? '0 0 10px ' + alpha(COLORS.primary, 0.5) : 'none',
            flex: '0 0 auto',
          }}
        />
      ) : null}
      {label}
    </button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'block',
        marginBottom: 8,
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        color: COLORS.textMuted,
      }}
    >
      {children}
    </span>
  );
}

export interface MotionControlsProps {
  text: string;
  onTextChange: (value: string) => void;
  style: StylePreset;
  onStyleChange: (value: StylePreset) => void;
  speed: Speed;
  onSpeedChange: (value: Speed) => void;
  colorTheme: ColorTheme;
  onColorThemeChange: (value: ColorTheme) => void;
  onGenerate: () => void;
  generating: boolean;
}

export default function MotionControls({
  text,
  onTextChange,
  style,
  onStyleChange,
  speed,
  onSpeedChange,
  colorTheme,
  onColorThemeChange,
  onGenerate,
  generating,
}: MotionControlsProps) {
  const trimmed = text.trim();
  const tooShort = trimmed.length < TEXT_MIN;
  const ready = !tooShort && trimmed.length <= TEXT_MAX && !generating;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card padding={18}>
        <Textarea
          label="Your text"
          value={text}
          maxLength={TEXT_MAX}
          showCount
          placeholder="Every frame tells a story"
          hint={tooShort ? 'Type the line you want animated.' : PRESET_HINTS[style]}
          onChange={function change(e) {
            onTextChange(e.target.value.slice(0, TEXT_MAX));
          }}
          style={{ minHeight: 96 }}
        />
      </Card>

      <Card padding={18}>
        <GroupLabel>Style preset</GroupLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {STYLE_PRESETS.map(function preset(name) {
            return (
              <Chip
                key={name}
                label={name}
                title={PRESET_HINTS[name]}
                selected={style === name}
                onSelect={function select() {
                  onStyleChange(name);
                }}
              />
            );
          })}
        </div>
      </Card>

      <Card padding={18}>
        <GroupLabel>Pace</GroupLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          {SPEEDS.map(function choice(name) {
            return (
              <Chip
                key={name}
                label={name}
                grow
                selected={speed === name}
                onSelect={function select() {
                  onSpeedChange(name);
                }}
              />
            );
          })}
        </div>
      </Card>

      <Card padding={18}>
        <GroupLabel>Colour theme</GroupLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {COLOR_THEMES.map(function theme(name) {
            return (
              <Chip
                key={name}
                label={name}
                swatch={THEME_SWATCHES[name]}
                selected={colorTheme === name}
                onSelect={function select() {
                  onColorThemeChange(name);
                }}
              />
            );
          })}
        </div>
      </Card>

      <Button
        variant="primary"
        size="lg"
        block
        loading={generating}
        disabled={!ready}
        onClick={onGenerate}
        icon={generating ? undefined : <Wand2 className="h-4 w-4" />}
      >
        {generating ? 'Directing your sequence…' : 'Generate Animation'}
      </Button>

      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11.5,
          color: COLORS.textFaint,
          lineHeight: 1.5,
        }}
      >
        <Sparkles className="h-3.5 w-3.5" style={{ color: COLORS.primary, flex: '0 0 auto' }} />
        Claude Opus 5 art-directs the timing, type and colour. Your words are never rewritten.
      </span>
    </div>
  );
}
