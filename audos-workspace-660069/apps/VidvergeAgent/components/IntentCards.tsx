import type { ComponentType } from 'react';
import { Check, Film, TrendingUp, Video } from 'lucide-react';

export interface IntentCard {
  /** Registered app id the brief routes to — must match config.json's registry. */
  id: string;
  /** Product name of the studio, used in helper copy and the AI-suggest prompt. */
  studio: string;
  title: string;
  benefit: string;
}

/** The three creation paths the hub routes a brief to. */
export const INTENT_CARDS: IntentCard[] = [
  {
    id: 'sceneforge',
    studio: 'SceneForge',
    title: 'Consistent character video',
    benefit: 'Keep the same presenter on camera across every scene.',
  },
  {
    id: 'script-to-video',
    studio: 'Script-to-Video',
    title: 'Script-to-video film',
    benefit: 'Turn your finished script into a film, shot by shot.',
  },
  {
    id: 'faceless-content',
    studio: 'Faceless Content',
    title: 'Faceless short',
    benefit: 'Trend-ready short videos with no face on camera.',
  },
];

type IconComponent = ComponentType<{ size?: number | string; className?: string }>;

const CARD_ICONS: Record<string, IconComponent> = {
  sceneforge: Video,
  'script-to-video': Film,
  'faceless-content': TrendingUp,
};

interface IntentCardsProps {
  selectedId: string;
  onSelect: (id: string) => void;
}

/**
 * Three large visual intent cards that replace the old studio dropdown.
 * Selecting one highlights it and sets where the brief is routed on submit.
 */
export default function IntentCards({ selectedId, onSelect }: IntentCardsProps) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9E8B55]">
        Step 2 · Choose your path
      </p>
      <div role="radiogroup" aria-label="What kind of video do you want?" className="grid gap-2.5 sm:grid-cols-3">
        {INTENT_CARDS.map((card) => {
          const Icon = CARD_ICONS[card.id] || Video;
          const active = card.id === selectedId;
          return (
            <button
              key={card.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(card.id)}
              className="rounded-2xl border p-4 text-left transition-colors hover:border-[var(--vv-border-hover)]"
              style={{
                borderColor: active ? 'var(--vv-gold)' : 'var(--vv-border)',
                background: active
                  ? 'color-mix(in srgb, var(--vv-gold) 8%, var(--vv-surface))'
                  : 'var(--vv-surface)',
                boxShadow: active ? '0 0 0 1px var(--vv-gold), 0 0 26px -14px var(--vv-gold-glow)' : 'none',
              }}
            >
              <span className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--vv-gold)_14%,transparent)] text-[var(--vv-gold)]">
                  <Icon size={15} />
                </span>
                {active && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--vv-gold)_45%,transparent)] px-2 py-[2px] text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--vv-gold)]">
                    <Check size={10} />
                    Selected
                  </span>
                )}
              </span>
              <span className="mt-3 block text-[13.5px] font-semibold text-[#F5E9C8]">{card.title}</span>
              <span className="mt-1 block text-[11.5px] leading-relaxed text-[var(--vv-text-dim)]">{card.benefit}</span>
              <span className="mt-2 block text-[10px] uppercase tracking-[0.14em] text-[#9E8B55]">→ {card.studio}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
