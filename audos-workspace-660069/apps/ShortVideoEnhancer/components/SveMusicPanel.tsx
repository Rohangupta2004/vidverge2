/**
 * Short Video Enhancer — the music studio.
 *
 * There is no preset dropdown. The agent reads the footage (visual mood from
 * the vision pass, measured tempo and energy from the audio track), writes a
 * descriptive ElevenLabs prompt, and generates a bed. The creator can rewrite
 * that prompt and regenerate.
 *
 * The bed is mixed UNDER the original audio — two independent levels, with the
 * original at 100% and the music at 25% by default. Music never replaces the
 * clip's own sound.
 */

import { useRef, useState } from 'react';
import { Loader2, Music, Pause, Play, RefreshCw } from 'lucide-react';
import type { EditDoc } from '../lib/sveTypes';
import { Field, Note, Section, Slider } from './SveControls';

export interface MusicPanelProps {
  doc: EditDoc;
  open: boolean;
  onToggleOpen: () => void;
  hasSource: boolean;
  phase: 'idle' | 'briefing' | 'generating';
  note: string;
  onUpdate: (patch: (doc: EditDoc) => EditDoc, label?: string) => void;
  onGenerate: (prompt?: string) => void;
  onClear: () => void;
}

function Waveform({ peaks, loading, hasTrack }: { peaks: number[]; loading: boolean; hasTrack: boolean }) {
  if (loading) {
    return (
      <div className="sve-wave sve-wave-skeleton">
        {Array.from({ length: 56 }).map((_, i) => (
          <i key={i} style={{ height: (18 + ((i * 37) % 60)) + '%', animationDelay: (i * 22) + 'ms' }} />
        ))}
      </div>
    );
  }
  if (!peaks.length) {
    // A track with no peaks is a track whose bytes this browser could not
    // read back for analysis — not a missing track. Saying "no music" there
    // would send the creator off to regenerate something that already exists.
    return (
      <div className="sve-wave empty">
        {hasTrack ? 'WAVEFORM UNAVAILABLE — PRESS PREVIEW TO HEAR IT' : 'NO MUSIC GENERATED YET'}
      </div>
    );
  }
  return (
    <div className="sve-wave">
      {peaks.map((p, i) => <i key={i} style={{ height: Math.max(6, p * 100) + '%' }} />)}
    </div>
  );
}

export function SveMusicPanel(props: MusicPanelProps) {
  const { doc, phase } = props;
  const music = doc.music;
  const busy = phase !== 'idle';
  const audioRef = useRef<HTMLAudioElement>(null);
  const [auditioning, setAuditioning] = useState(false);

  const toggleAudition = () => {
    const node = audioRef.current;
    if (!node) return;
    if (node.paused) { void node.play(); setAuditioning(true); }
    else { node.pause(); setAuditioning(false); }
  };

  const busyLabel = phase === 'briefing' ? 'Reading the footage…' : 'Composing the bed…';

  return (
    <Section id="music" title="Music" open={props.open} onToggle={props.onToggleOpen}>
      <button className="sve-action" disabled={busy || !props.hasSource} onClick={() => props.onGenerate()}>
        {busy ? <Loader2 size={14} className="spin" /> : <Music size={14} />}
        {busy ? busyLabel : music.url ? 'Rewrite brief & regenerate' : 'Add music'}
      </button>

      {!props.hasSource && <Note>Upload a clip first — the brief is written from what the footage looks and sounds like.</Note>}

      {music.brief && !busy && <Note tone="good">{music.brief}</Note>}
      {props.note && <Note tone="warn">{props.note}</Note>}

      <Waveform peaks={music.peaks} loading={phase === 'generating'} hasTrack={!!music.url} />

      {music.url && (
        <>
          <audio ref={audioRef} src={music.url} onEnded={() => setAuditioning(false)} preload="none" />
          <div className="sve-btn-row" style={{ marginBottom: 11 }}>
            <button className="sve-save" style={{ margin: 0 }} onClick={toggleAudition}>
              {auditioning ? <Pause size={14} /> : <Play size={14} />}
              {auditioning ? 'Stop preview' : 'Preview music'}
            </button>
            <button className="sve-icon-button" title="Remove this music bed" onClick={props.onClear}>
              <RefreshCw size={15} />
            </button>
          </div>
        </>
      )}

      <Field label="Music prompt">
        <textarea
          className="sve-prompt"
          value={music.prompt}
          rows={3}
          placeholder="e.g. upbeat electronic 120bpm, punchy bass, no vocals, 30 seconds"
          onChange={(e) => props.onUpdate((d) => ({ ...d, music: { ...d.music, prompt: e.target.value } }), 'music-prompt')}
        />
      </Field>
      <button
        className="sve-save"
        style={{ marginTop: 0, marginBottom: 12 }}
        disabled={busy || music.prompt.trim().length < 10}
        onClick={() => props.onGenerate(music.prompt)}
      >
        {busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
        Regenerate from this prompt
      </button>

      <Slider
        label="Original Audio" value={doc.audio.original} min={0} max={100} suffix="%"
        onChange={(original) => props.onUpdate((d) => ({ ...d, audio: { ...d.audio, original } }), 'mix-original')}
      />
      <Slider
        label="Music" value={doc.audio.music} min={0} max={100} suffix="%"
        onChange={(level) => props.onUpdate((d) => ({ ...d, audio: { ...d.audio, music: level } }), 'mix-music')}
      />
      <p className="sve-muted">
        The bed sits under the original audio in the export. Above about 40% it starts competing with speech.
      </p>
    </Section>
  );
}
