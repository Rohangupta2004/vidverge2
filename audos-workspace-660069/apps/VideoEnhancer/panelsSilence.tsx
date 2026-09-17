/**
 * Video Enhancer — Silence Cutter tab. The audio track is decoded with the Web
 * Audio API, silence regions are detected against an adjustable dB threshold /
 * minimum duration, visualized on the waveform under the player, and applied as
 * a non-destructive EDL that the export render skips over.
 */
import { Scissors, Loader2, Play, AlertCircle } from 'lucide-react';
import type { SilenceRegion } from './enhancerExtras';
import { formatDuration } from './enhancerExtras';
import { Section, Slider, Toggle } from './uiControls';
import { formatTime } from './enhancerCore';

export interface SilenceUiState {
  status: 'idle' | 'analyzing' | 'ready' | 'error';
  error: string;
  thresholdDb: number;
  minDur: number;
  padMs: number;
  regions: (SilenceRegion & { included: boolean })[];
  previewCuts: boolean;
}

export default function SilencePanel({ state, onDetect, onParam, onToggleRegion, onPreviewCuts, stats, hasFile }: {
  state: SilenceUiState;
  onDetect: () => void;
  onParam: (patch: Partial<Pick<SilenceUiState, 'thresholdDb' | 'minDur' | 'padMs'>>) => void;
  onToggleRegion: (idx: number) => void;
  onPreviewCuts: (v: boolean) => void;
  stats: { original: number; after: number; savedPct: number } | null;
  hasFile: boolean;
}) {
  const busy = state.status === 'analyzing';
  const includedCount = state.regions.filter((r) => r.included).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      <div style={{ background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 12, padding: 12 }}>
        <button
          onClick={onDetect}
          disabled={!hasFile || busy}
          className="ve-btn"
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            fontSize: 13.5, fontWeight: 700, padding: '11px 14px', borderRadius: 10, border: 'none',
            cursor: hasFile && !busy ? 'pointer' : 'not-allowed',
            background: hasFile && !busy ? 'var(--space-brand-primary-600)' : 'var(--space-surface-panel-strong)',
            color: hasFile && !busy ? '#fff' : 'var(--space-text-muted)',
            boxShadow: hasFile && !busy ? '0 8px 22px -10px color-mix(in srgb, var(--space-brand-primary-600) 80%, transparent)' : 'none',
          }}
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Scissors size={15} />}
          {busy ? 'Analyzing the audio track…' : state.status === 'ready' ? 'Re-detect silences' : 'Auto Cut Silences'}
        </button>
        {!hasFile && <div style={{ fontSize: 12, color: 'var(--space-text-muted)', marginTop: 8 }}>Upload a video first, then detect and trim its dead air automatically.</div>}
        {state.status === 'error' && state.error && (
          <div style={{ fontSize: 12.5, color: 'var(--space-semantic-danger)', marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}><AlertCircle size={13} /> {state.error}</div>
        )}
        {state.status === 'ready' && (
          <div style={{ fontSize: 12.5, color: 'var(--space-text-secondary)', marginTop: 8 }}>
            {state.regions.length === 0
              ? 'No silences found at the current threshold — lower the threshold or shorten the minimum duration and it re-detects live.'
              : state.regions.length + ' silence ' + (state.regions.length === 1 ? 'region' : 'regions') + ' detected · ' + includedCount + ' set to cut. The waveform under the player highlights cuts in red.'}
          </div>
        )}
      </div>

      <Section title="Detection settings" icon={<Scissors size={14} style={{ color: 'var(--space-text-brand)' }} />} defaultOpen>
        <Slider label="Silence threshold" value={state.thresholdDb} min={-70} max={-10} unit=" dB" onChange={(v) => onParam({ thresholdDb: v })} />
        <Slider label="Minimum silence duration" value={state.minDur} min={0.1} max={2} step={0.05} onChange={(v) => onParam({ minDur: v })} format={(v) => v.toFixed(2) + ' s'} />
        <Slider label="Keep padding around cuts" value={state.padMs} min={0} max={500} step={10} unit=" ms" onChange={(v) => onParam({ padMs: v })} />
        <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginTop: 8 }}>
          Changes re-detect automatically. Padding keeps a moment of breathing room before and after every cut so edits don't feel abrupt.
        </div>
      </Section>

      {stats && state.status === 'ready' && includedCount > 0 && (
        <div style={{ background: 'color-mix(in srgb, var(--space-semantic-success-500) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--space-semantic-success-500) 40%, transparent)', borderRadius: 12, padding: '10px 12px', fontSize: 13, fontWeight: 600, color: 'var(--space-text-primary)' }}>
          Original: {formatDuration(stats.original)} → After cuts: {formatDuration(stats.after)}
          <span style={{ color: 'var(--space-semantic-success-600)' }}> (saves {stats.savedPct}%)</span>
        </div>
      )}

      {state.status === 'ready' && state.regions.length > 0 && (
        <div style={{ background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 12, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Play size={14} style={{ color: 'var(--space-text-brand)' }} />
            <span style={{ fontSize: 13, fontWeight: 700 }}>Preview cuts</span>
            <div style={{ marginLeft: 'auto' }}><Toggle on={state.previewCuts} onChange={onPreviewCuts} label="" /></div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--space-text-muted)' }}>While on, playback jumps over every included cut in real time — exactly what the export will sound like.</div>

          <div style={{ marginTop: 10, maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {state.regions.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--space-surface-card)', borderRadius: 8, padding: '6px 9px', opacity: r.included ? 1 : 0.5 }}>
                <Toggle on={r.included} onChange={() => onToggleRegion(i)} label="" />
                <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums', color: 'var(--space-text-primary)' }}>
                  {formatTime(r.start)} → {formatTime(r.end)}
                </span>
                <span style={{ fontSize: 11.5, color: r.included ? 'var(--space-semantic-danger)' : 'var(--space-text-muted)', marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
                  {r.included ? 'cut ' : 'keep '}{(r.end - r.start).toFixed(2)}s
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', padding: '0 2px' }}>
        Cuts are non-destructive: they live in an edit decision list and are only applied when the video is exported (and in Preview Cuts mode).
      </div>
    </div>
  );
}
