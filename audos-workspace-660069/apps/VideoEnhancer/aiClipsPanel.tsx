/**
 * Video Enhancer — AI Clips tool: generate cutaway / B-roll clips from a text
 * prompt on any Group A engine (Veo 3.1 Fast is this app's long-standing
 * default — it was already the model behind enhancerCore.submitBroll).
 * Kling models are listed as [Coming Soon] and disabled.
 *
 * Self-contained: owns its prompt, engine, settings, polling and results, so
 * it plugs into the editor as one more tool without touching the edit state.
 * Generated clips are durable URLs — download one and drop it into your edit.
 */
import { useState } from 'react';
import { Clapperboard, Download, Loader2, Upload, Wand2, X } from 'lucide-react';
import { EnginePicker } from '../../components/EngineSelector';
import { groupAModel, validateGroupAInputs } from '../../lib/videoEngines';
import { pollGroupA, submitGroupA } from '../../lib/videoEngineClient';
import { uploadVideo } from './enhancerCore';

interface MadeClip { url: string; engine: string; prompt: string; at: number }

export default function AiClipsPanel() {
  const [engine, setEngine] = useState('veo-3.1-fast-generate-preview');
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [duration, setDuration] = useState(6);
  const [seed, setSeed] = useState('');
  const [seedBusy, setSeedBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [clips, setClips] = useState<MadeClip[]>([]);

  const model = groupAModel(engine);
  const violation = model ? validateGroupAInputs(engine, { prompt, imageData: seed || null }) : 'Pick an available engine.';
  const ready = !busy && !violation;

  async function generate() {
    if (!ready) return;
    setBusy(true); setErr(''); setNote('Submitting…');
    try {
      const kick = await submitGroupA({
        model: engine,
        prompt,
        aspectRatio: aspect,
        duration,
        generateAudio: false,
        resolution: model?.supports4k ? '1080p' : undefined,
        imageData: seed || undefined,
      });
      setNote(`Rendering on ${model?.name || engine}… polling every 5s${kick.cost ? ` · cost $${kick.cost}` : ''}`);
      const url = await pollGroupA(kick.operationId);
      setClips((all) => [{ url, engine: model?.name || engine, prompt: prompt.slice(0, 160), at: Date.now() }, ...all].slice(0, 8));
      setNote('Clip ready — download it below and drop it into your edit.');
    } catch (e: any) {
      setErr(String(e?.message || e));
      setNote('');
    } finally { setBusy(false); }
  }

  const box: React.CSSProperties = { background: 'var(--space-surface-card)', border: '1px solid var(--space-border-default)', borderRadius: 12, padding: 14 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 700, color: 'var(--space-text-primary)', marginBottom: 4 }}>
          <Clapperboard size={15} style={{ color: 'var(--space-text-brand)' }} /> Generate an AI clip
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginBottom: 10 }}>Cutaways and B-roll from a text prompt. Default engine: Veo 3.1 Fast — the same model this editor has always used for B-roll.</div>
        <EnginePicker label="Engine" value={engine} onChange={setEngine} groupAIds="all" includeKling disabled={busy} />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="Describe the cutaway shot — subject, setting, camera move, lighting… (at least 10 characters)"
          className="ve-input"
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: 12.5, lineHeight: 1.45, background: 'var(--space-surface-panel)', border: '1px solid var(--space-border-default)', borderRadius: 8, padding: '8px 10px', color: 'var(--space-text-primary)', fontFamily: 'inherit', marginTop: 12 }}
        />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 5 }}>
            {(['16:9', '9:16', '1:1'] as const).map((a) => (
              <button key={a} onClick={() => setAspect(a)} className="ve-btn" style={{ fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 7, cursor: 'pointer', border: '1px solid var(--space-border-default)', background: aspect === a ? 'var(--space-brand-primary-600)' : 'var(--space-surface-panel)', color: aspect === a ? '#fff' : 'var(--space-text-secondary)' }}>{a}</button>
            ))}
          </div>
          <label style={{ fontSize: 11.5, color: 'var(--space-text-secondary)', display: 'flex', alignItems: 'center', gap: 7 }}>
            {duration}s
            <input type="range" min={4} max={Math.max(8, model?.maxDurationS || 8)} value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={{ width: 110, accentColor: 'var(--space-brand-primary-500)', cursor: 'pointer' }} />
          </label>
          <label className="ve-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: 'var(--space-text-brand)', background: 'transparent', border: '1px dashed var(--space-border-strong)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer' }}>
            {seedBusy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} {seed ? 'Replace seed image' : 'Seed image (optional)'}
            <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setSeedBusy(true); setErr('');
              try { const up = await uploadVideo(f); setSeed(up.url); }
              catch (ex: any) { setErr(String(ex?.message || ex)); }
              finally { setSeedBusy(false); e.target.value = ''; }
            }} />
          </label>
          {seed ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <img src={seed} alt="seed" style={{ width: 46, height: 30, objectFit: 'cover', borderRadius: 5, border: '1px solid var(--space-border-default)' }} />
              <button onClick={() => setSeed('')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--space-text-muted)', padding: 2 }}><X size={13} /></button>
            </span>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <button onClick={() => void generate()} disabled={!ready} className="ve-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, padding: '8px 16px', borderRadius: 9, border: 'none', cursor: ready ? 'pointer' : 'not-allowed', background: ready ? 'var(--space-brand-primary-600)' : 'var(--space-surface-panel-strong)', color: ready ? '#fff' : 'var(--space-text-muted)' }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} Generate clip
          </button>
          {violation && prompt.trim() ? <span style={{ fontSize: 11.5, color: '#d97706' }}>{violation}</span> : null}
          {model?.costHint ? <span style={{ fontSize: 11, color: 'var(--space-text-muted)' }}>Estimated: {model.costHint}</span> : null}
        </div>
        {note ? <div style={{ fontSize: 12, color: 'var(--space-text-brand)', marginTop: 9 }}>{busy ? <Loader2 size={12} className="animate-spin" style={{ verticalAlign: -2, marginRight: 5 }} /> : null}{note}</div> : null}
        {err ? <div style={{ fontSize: 12, color: 'var(--space-semantic-danger)', marginTop: 9, lineHeight: 1.5 }}>{err}</div> : null}
      </div>

      {clips.length > 0 ? (
        <div style={box}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--space-text-secondary)', marginBottom: 9 }}>Generated clips (this session)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {clips.map((c) => (
              <div key={c.at} style={{ background: 'var(--space-surface-panel)', borderRadius: 9, padding: 9 }}>
                <video src={c.url} controls preload="metadata" style={{ width: '100%', maxHeight: 190, borderRadius: 7, background: '#000' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 6, flexWrap: 'wrap' }}>
                  <a href={c.url} target="_blank" rel="noreferrer" download style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: 'var(--space-text-brand)', textDecoration: 'none' }}><Download size={12} /> Download</a>
                  <span style={{ fontSize: 10.5, color: 'var(--space-text-muted)' }}>{c.engine}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--space-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }} title={c.prompt}>{c.prompt}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
