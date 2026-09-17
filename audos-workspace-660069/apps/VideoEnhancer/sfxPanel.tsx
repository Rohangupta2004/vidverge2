/**
 * Video Enhancer — Sound Effects panel.
 *
 * A small library of preset ambient/SFX prompts (or a custom description),
 * generated through ElevenLabs and dropped onto the timeline at the current
 * playhead. Each cue gets its own volume control and preview player; cues
 * mix into both the live preview (one-shot playback) and the export's audio
 * graph, alongside the original audio and any music bed.
 */
import { useState } from 'react';
import { Zap, Loader2, Wand2, Trash2, Play, AlertCircle } from 'lucide-react';
import { formatTime } from './enhancerCore';
import { P } from './editSuite';
import { panelCard, PanelHeader, PrimaryButton, ErrLine, Chip } from './editorPanels';
import { SFX_PRESETS } from './sfxSuite';
import type { SfxCue } from './sfxSuite';

const ACCENT = '#FF6B4A'; // VidVerge brand coral

function CueRow({ cue, onVolume, onRemove, onSeek }: {
  cue: SfxCue; onVolume: (v: number) => void; onRemove: () => void; onSeek: () => void;
}) {
  return (
    <div style={{ padding: '9px 10px', borderRadius: 10, background: P.panelSoft, border: '1px solid ' + P.borderSoft }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onSeek} title="Seek to this moment" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', cursor: 'pointer', color: P.sub, padding: 0, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: P.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cue.label}</span>
          <span style={{ fontSize: 10.5, color: P.muted, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>@ {formatTime(cue.at)}</span>
        </button>
        {cue.status === 'generating' && <Loader2 size={13} className="animate-spin" style={{ color: ACCENT, flexShrink: 0 }} />}
        {cue.status === 'ready' && cue.url && (
          <button
            type="button"
            onClick={() => { try { const a = new Audio(cue.url); a.volume = cue.volume; void a.play().catch(() => undefined); } catch { /* no-op */ } }}
            title="Preview"
            className="ve-btn"
            style={{ display: 'flex', color: P.mint, background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0 }}
          >
            <Play size={13} />
          </button>
        )}
        <button onClick={onRemove} title="Remove" className="ve-btn" style={{ display: 'flex', color: P.coral, background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, flexShrink: 0 }}>
          <Trash2 size={13} />
        </button>
      </div>
      {cue.status === 'ready' && (
        <input
          type="range" min={0} max={100} step={1} value={Math.round(cue.volume * 100)}
          onChange={(e) => onVolume(Number(e.target.value) / 100)}
          style={{ width: '100%', marginTop: 8, accentColor: ACCENT, cursor: 'pointer', height: 16 }}
        />
      )}
      {cue.status === 'error' && (
        <div style={{ display: 'flex', gap: 5, alignItems: 'flex-start', fontSize: 11, color: P.coral, marginTop: 6 }}>
          <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} /> {cue.error || 'Generation failed.'}
        </div>
      )}
    </div>
  );
}

export function SfxPanel({
  cues, busy, note, err, playheadT, duration, disabled,
  onAdd, onUpdate, onRemove, onSeek,
}: {
  cues: SfxCue[]; busy: boolean; note: string; err: string; playheadT: number; duration: number; disabled: boolean;
  onAdd: (label: string, prompt: string, seconds: number) => void;
  onUpdate: (id: string, patch: Partial<SfxCue>) => void; onRemove: (id: string) => void; onSeek: (t: number) => void;
}) {
  const [customPrompt, setCustomPrompt] = useState('');
  const [customSecs, setCustomSecs] = useState(3);
  return (
    <div className="ve-panel">
      <div style={panelCard}>
        <PanelHeader
          icon={<Zap size={15} />}
          color={ACCENT}
          title="Sound effects"
          right={<span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: ACCENT, background: 'color-mix(in srgb, ' + ACCENT + ' 14%, transparent)', border: '1px solid ' + ACCENT + '55', borderRadius: 999, padding: '3px 9px' }}>AI audio</span>}
        />
        <div style={{ fontSize: 12.5, color: P.muted, lineHeight: 1.55, marginBottom: 10 }}>
          Pick a preset or describe your own effect — it drops in at the playhead ({formatTime(playheadT)}) and mixes with your original audio and music on export.
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {SFX_PRESETS.map((p) => (
            <Chip key={p.id} disabled={busy || disabled} onClick={() => onAdd(p.label, p.prompt, 2.5)} color={ACCENT} title={p.hint}>
              {p.label}
            </Chip>
          ))}
        </div>
        <textarea
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          rows={2}
          maxLength={300}
          placeholder="Describe a custom sound effect, e.g. a glass bottle popping open…"
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: 12.5, color: P.text, background: 'rgba(7,10,18,0.6)', border: '1px solid ' + P.border, borderRadius: 10, padding: '10px 12px', outline: 'none', marginBottom: 10, fontFamily: 'inherit', lineHeight: 1.5 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 11.5, color: P.sub, fontWeight: 700 }}>Length</span>
          <input type="range" min={0.5} max={8} step={0.5} value={customSecs} onChange={(e) => setCustomSecs(Number(e.target.value))} style={{ flex: 1, accentColor: ACCENT, cursor: 'pointer', height: 16 }} />
          <span style={{ fontSize: 11.5, color: P.muted, fontVariantNumeric: 'tabular-nums', width: 32 }}>{customSecs}s</span>
        </div>
        <PrimaryButton
          onClick={() => {
            const p = customPrompt.trim();
            if (!p) return;
            onAdd(p.slice(0, 40), p, customSecs);
            setCustomPrompt('');
          }}
          disabled={disabled || busy || !customPrompt.trim()}
          busy={busy}
          gradient={'linear-gradient(100deg, ' + ACCENT + ', ' + P.amber + ')'}
          shadow="0 12px 30px -14px rgba(255,107,74,0.55)"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
          {busy ? 'Generating…' : 'Add custom effect at playhead'}
        </PrimaryButton>
        {note && !err && <div style={{ fontSize: 12, color: P.sub, marginTop: 8, lineHeight: 1.5 }}>{note}</div>}
        {err && <ErrLine>{err}</ErrLine>}
        {duration <= 0 && <div style={{ fontSize: 11.5, color: P.muted, marginTop: 8 }}>Effects are placed at the current playhead position on your timeline.</div>}
      </div>

      {cues.length > 0 && (
        <div className="ve-fade" style={{ ...panelCard, marginTop: 12 }}>
          <PanelHeader icon={<Zap size={15} />} color={P.violet} title="Cues on the timeline" right={<span style={{ fontSize: 11, color: P.muted }}>{cues.length}</span>} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
            {cues.map((c) => (
              <CueRow key={c.id} cue={c} onVolume={(v) => onUpdate(c.id, { volume: v })} onRemove={() => onRemove(c.id)} onSeek={() => onSeek(c.at)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
