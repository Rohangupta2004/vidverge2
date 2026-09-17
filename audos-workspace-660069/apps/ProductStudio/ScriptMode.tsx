/**
 * Script Mode — segment-based narration studio for the Product Video app.
 *
 * The customer writes narration in ordered segments (spoken line + on-screen
 * callout + timing), can auto-fill the script with AI from a product
 * description, picks an ElevenLabs model + voice, generates a voiceover via
 * the platform audio endpoint, and previews the callouts synced to audio
 * playback on a dark 16:9 stage. Self-contained — no Track B project state.
 */
import { useEffect, useState } from 'react';
import { Download, Loader2, Mic, Plus, Sparkles, Trash2 } from 'lucide-react';

const S = {
  text: 'var(--space-text-primary)',
  sub: 'var(--space-text-secondary)',
  muted: 'var(--space-text-muted)',
  border: 'var(--space-border-default)',
  borderStrong: 'var(--space-border-strong)',
  panel: 'var(--space-surface-panel)',
  panelStrong: 'var(--space-surface-panel-strong)',
  card: 'var(--space-surface-card)',
  danger: 'var(--space-semantic-danger-500)',
};

const WORKSPACE_ID = (window as any).__WORKSPACE_ID__ || (window as any).__workspaceDb?.workspaceId || '';
function wsToken() { return (window as any).__workspaceDb?.token || ''; }

/** Sarah — the platform's default premade voice, used until /api/voices answers. */
const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';

const ELEVEN_MODELS = [
  { value: 'eleven_flash_v2_5', label: 'Flash v2.5 (Ultra-fast)' },
  { value: 'eleven_turbo_v2_5', label: 'Turbo v2.5 (Fast · Best balance)' },
  { value: 'eleven_turbo_v2', label: 'Turbo v2 (Fast · English only)' },
  { value: 'eleven_multilingual_v2', label: 'Multilingual v2 (High quality)' },
  { value: 'eleven_monolingual_v1', label: 'Monolingual v1 (Legacy)' },
];

type Segment = { id: number; text: string; element: string; startTime: number; duration: number };
type Voice = { id: string; name: string; gender: string };

let nextSegmentId = 1;
function blankSegment(startTime: number): Segment {
  return { id: nextSegmentId++, text: '', element: '', startTime, duration: 3 };
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: S.muted, marginBottom: 6 };
const inputStyle: React.CSSProperties = { boxSizing: 'border-box', padding: '9px 11px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.text, fontSize: 13 };
const panelStyle: React.CSSProperties = { borderRadius: 16, border: `1px solid ${S.border}`, background: S.panel, padding: 18, marginBottom: 18 };
const primaryBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 10, border: 'none', background: 'var(--space-brand-primary-600)', color: 'var(--space-text-on-primary)', cursor: 'pointer', fontSize: 13, fontWeight: 700 };
const ghostBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, color: S.sub, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' };

function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" style={{ marginTop: 12, padding: '9px 13px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: S.danger, background: `color-mix(in srgb, ${S.danger} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${S.danger} 30%, transparent)` }}>
      {message}
    </div>
  );
}

export default function ScriptMode() {
  const [productDesc, setProductDesc] = useState('');
  const [segments, setSegments] = useState<Segment[]>(() => [blankSegment(0), blankSegment(3), blankSegment(6)]);
  const [model, setModel] = useState('eleven_turbo_v2_5');
  const [voices, setVoices] = useState<Voice[]>([{ id: DEFAULT_VOICE_ID, name: 'Sarah', gender: 'female' }]);
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID);
  const [generatingScript, setGeneratingScript] = useState(false);
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/voices');
        const data = await res.json().catch(() => null);
        const list: Voice[] = Array.isArray(data?.voices)
          ? data.voices.map((v: any) => ({ id: String(v.id ?? ''), name: String(v.name ?? 'Voice'), gender: String(v.labels?.gender ?? '') })).filter((v: Voice) => v.id)
          : [];
        if (!cancelled && list.length) {
          setVoices(list);
          setVoiceId((cur) => (list.some((v) => v.id === cur) ? cur : (list.some((v) => v.id === DEFAULT_VOICE_ID) ? DEFAULT_VOICE_ID : list[0].id)));
        }
      } catch { /* keep the Sarah fallback */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const updateSegment = (id: number, patch: Partial<Segment>) => {
    setSegments((cur) => cur.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const addSegment = () => {
    setSegments((cur) => {
      const last = cur[cur.length - 1];
      return [...cur, blankSegment(last ? Math.round((last.startTime + last.duration) * 10) / 10 : 0)];
    });
  };

  const generateScript = async () => {
    setScriptError(null);
    const desc = productDesc.trim();
    if (!desc) { setScriptError('Describe your product in the field above, then generate.'); return; }
    if (!segments.length) { setScriptError('Add at least one segment first.'); return; }
    setGeneratingScript(true);
    try {
      const n = segments.length;
      const res = await fetch('/proxy/anthropic/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': wsToken() },
        body: JSON.stringify({
          model: 'claude-opus-5',
          max_tokens: 1600,
          messages: [{
            role: 'user',
            content: `Write the narration for a short product video about this product:\n\n${desc}\n\nProduce exactly ${n} narration segments in order. Each segment needs "text" (one short spoken voiceover line, at most 20 words) and "element" (a 2-5 word on-screen callout label, e.g. "Feature: Consistent Characters"). Respond with ONLY a JSON array and no other prose: [{"text": "...", "element": "..."}]`,
          }],
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (data && (data.error?.message || (typeof data.error === 'string' ? data.error : ''))) || `AI request failed (${res.status})`;
        throw new Error(msg);
      }
      const raw = Array.isArray(data?.content) ? data.content.map((b: any) => (typeof b?.text === 'string' ? b.text : '')).join('') : '';
      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      if (start < 0 || end <= start) throw new Error('The AI reply did not contain a JSON array — please try again.');
      const lines = JSON.parse(raw.slice(start, end + 1));
      if (!Array.isArray(lines) || !lines.length) throw new Error('The AI reply did not contain any segments — please try again.');
      setSegments((cur) => cur.map((seg, i) => (lines[i] ? { ...seg, text: String(lines[i].text ?? ''), element: String(lines[i].element ?? '') } : seg)));
    } catch (e) {
      setScriptError(e instanceof Error ? e.message : 'Script generation failed — please try again.');
    } finally {
      setGeneratingScript(false);
    }
  };

  const generateVoiceover = async () => {
    setAudioError(null);
    const combined = segments.map((s) => s.text.trim()).filter(Boolean).join(' ');
    if (!combined) { setAudioError('Write (or AI-generate) some narration text first.'); return; }
    setGeneratingAudio(true);
    try {
      const res = await fetch(`/api/workspaces/${WORKSPACE_ID}/audio/voiceover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-DB-Token': wsToken() },
        body: JSON.stringify({ script: combined, voiceId, model }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.audioUrl) {
        const msg = (data && (typeof data.error === 'string' ? data.error : data.error?.message)) || `Voiceover generation failed (${res.status})`;
        throw new Error(msg);
      }
      setAudioUrl(String(data.audioUrl));
      setCurrentTime(0);
    } catch (e) {
      setAudioError(e instanceof Error ? e.message : 'Voiceover generation failed — please try again.');
    } finally {
      setGeneratingAudio(false);
    }
  };

  const activeSegment = segments.find((s) => s.element.trim() && currentTime >= s.startTime && currentTime < s.startTime + s.duration);

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: 'clamp(16px, 3vw, 30px)', color: S.text, boxSizing: 'border-box' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 'clamp(20px, 3vw, 26px)', fontWeight: 800 }}>
          <Mic size={22} color="var(--space-text-brand)" /> Script Mode
        </h1>
        <p style={{ margin: '5px 0 0', fontSize: 13, color: S.sub }}>
          Write narration in segments, generate an ElevenLabs voiceover, and preview your on-screen callouts in sync with the audio.
        </p>
      </header>

      {/* 1 — Product description + AI script generation */}
      <section style={panelStyle} data-testid="panel-script">
        <label style={labelStyle} htmlFor="sm-product-desc">Product description</label>
        <textarea
          id="sm-product-desc"
          value={productDesc}
          onChange={(e) => setProductDesc(e.currentTarget.value)}
          rows={3}
          placeholder="What is the product, who is it for, and what makes it great? The AI uses this to write one narration line per segment."
          className="ps-input"
          style={{ ...inputStyle, width: '100%', resize: 'vertical', lineHeight: 1.55 }}
          data-testid="input-product-desc"
        />
        <div style={{ marginTop: 10 }}>
          <button type="button" onClick={() => void generateScript()} disabled={generatingScript} className="ps-btn" style={{ ...primaryBtn, opacity: generatingScript ? 0.6 : 1 }} data-testid="button-generate-script">
            {generatingScript ? <Loader2 size={14} className="rc-spin" /> : <Sparkles size={14} />}
            {generatingScript ? 'Writing script…' : 'Generate Script with AI'}
          </button>
        </div>
        <ErrorBanner message={scriptError} />

        {/* Segment editor */}
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
            <span style={{ ...labelStyle, marginBottom: 0 }}>Script segments</span>
            <span style={{ fontSize: 11.5, color: S.muted }}>Narration is spoken in order · each callout appears at its start time</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {segments.map((seg, i) => (
              <div key={seg.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', padding: 10, borderRadius: 12, border: `1px solid ${S.border}`, background: S.panelStrong }} data-testid={`segment-row-${i}`}>
                <span aria-hidden="true" style={{ width: 22, height: 22, marginTop: 6, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: S.sub, border: `1px solid ${S.border}`, background: S.card, flex: 'none' }}>{i + 1}</span>
                <textarea
                  value={seg.text}
                  onChange={(e) => updateSegment(seg.id, { text: e.currentTarget.value })}
                  rows={2}
                  placeholder="Narration line spoken by the voiceover…"
                  aria-label={`Segment ${i + 1} narration`}
                  className="ps-input"
                  style={{ ...inputStyle, flex: '2 1 220px', resize: 'vertical', lineHeight: 1.5 }}
                  data-testid={`input-seg-text-${i}`}
                />
                <input
                  value={seg.element}
                  onChange={(e) => updateSegment(seg.id, { element: e.currentTarget.value })}
                  placeholder="On-screen callout, e.g. Feature: Consistent Characters"
                  aria-label={`Segment ${i + 1} on-screen element`}
                  className="ps-input"
                  style={{ ...inputStyle, flex: '1 1 170px' }}
                  data-testid={`input-seg-element-${i}`}
                />
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, fontWeight: 700, color: S.muted }}>
                  START (s)
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={seg.startTime}
                    onChange={(e) => updateSegment(seg.id, { startTime: Math.max(0, Number(e.currentTarget.value) || 0) })}
                    aria-label={`Segment ${i + 1} start time in seconds`}
                    className="ps-input"
                    style={{ ...inputStyle, width: 76 }}
                    data-testid={`input-seg-start-${i}`}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10.5, fontWeight: 700, color: S.muted }}>
                  DURATION (s)
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={seg.duration}
                    onChange={(e) => updateSegment(seg.id, { duration: Math.max(0.5, Number(e.currentTarget.value) || 3) })}
                    aria-label={`Segment ${i + 1} duration in seconds`}
                    className="ps-input"
                    style={{ ...inputStyle, width: 76 }}
                    data-testid={`input-seg-duration-${i}`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setSegments((cur) => cur.filter((s) => s.id !== seg.id))}
                  aria-label={`Remove segment ${i + 1}`}
                  className="ps-btn"
                  style={{ marginTop: 6, padding: 8, borderRadius: 9, border: `1px solid color-mix(in srgb, ${S.danger} 35%, transparent)`, background: S.card, color: S.danger, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                  data-testid={`button-remove-seg-${i}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addSegment} className="ps-btn" style={{ ...ghostBtn, marginTop: 10 }} data-testid="button-add-segment">
            <Plus size={13} /> Add Segment
          </button>
        </div>
      </section>

      {/* 2 — Voice + model + generate */}
      <section style={panelStyle} data-testid="panel-voiceover">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 220px' }}>
            <label style={labelStyle} htmlFor="sm-model">Model</label>
            <select id="sm-model" value={model} onChange={(e) => setModel(e.currentTarget.value)} className="ps-input" style={{ ...inputStyle, width: '100%' }} data-testid="select-model">
              {ELEVEN_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <label style={labelStyle} htmlFor="sm-voice">Voice</label>
            <select id="sm-voice" value={voiceId} onChange={(e) => setVoiceId(e.currentTarget.value)} className="ps-input" style={{ ...inputStyle, width: '100%' }} data-testid="select-voice">
              {voices.map((v) => <option key={v.id} value={v.id}>{v.name}{v.gender ? ` · ${v.gender}` : ''}</option>)}
            </select>
          </div>
          <button type="button" onClick={() => void generateVoiceover()} disabled={generatingAudio} className="ps-btn" style={{ ...primaryBtn, opacity: generatingAudio ? 0.6 : 1 }} data-testid="button-generate-voiceover">
            {generatingAudio ? <Loader2 size={14} className="rc-spin" /> : <Mic size={14} />}
            {generatingAudio ? 'Generating voiceover…' : 'Generate Voiceover'}
          </button>
        </div>
        <ErrorBanner message={audioError} />
      </section>

      {/* 3 — Synced preview */}
      {audioUrl ? (
        <section className="ps-fade-up" style={panelStyle} data-testid="panel-preview">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ ...labelStyle, marginBottom: 0 }}>Synced preview</span>
            <a href={audioUrl} download className="ps-btn" style={ghostBtn} data-testid="link-download-audio">
              <Download size={13} /> Download Audio
            </a>
          </div>

          <div style={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: 14, overflow: 'hidden', background: 'linear-gradient(160deg, #05070f, #0b1020)', border: `1px solid ${S.borderStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }} data-testid="preview-stage">
            {activeSegment ? (
              <span style={{ maxWidth: '86%', padding: '14px 26px', borderRadius: 999, background: 'rgba(4, 8, 18, 0.62)', border: '1px solid rgba(255, 255, 255, 0.14)', color: '#fff', fontSize: 'clamp(17px, 2.6vw, 28px)', fontWeight: 800, textAlign: 'center', textShadow: '0 2px 12px rgba(0,0,0,0.5)' }} data-testid="stage-element">
                {activeSegment.element}
              </span>
            ) : (
              <span aria-hidden="true" style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.16)' }}>VidVerge</span>
            )}
          </div>

          <audio
            key={audioUrl}
            src={audioUrl}
            controls
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            style={{ display: 'block', width: '100%', marginTop: 12 }}
            data-testid="audio-player"
          />

          <div className="ps-scroll-x" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingTop: 12 }} data-testid="timeline-bar">
            {[...segments].sort((a, b) => a.startTime - b.startTime).map((seg, i) => {
              const isActive = activeSegment?.id === seg.id;
              return (
                <span key={seg.id} style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, color: isActive ? 'var(--space-text-on-primary)' : S.sub, background: isActive ? 'var(--space-brand-primary-600)' : S.card, border: `1px solid ${isActive ? 'var(--space-brand-primary-600)' : S.border}`, transition: 'background .16s ease, color .16s ease' }} data-testid={`timeline-chip-${i}`}>
                  {seg.element.trim() || `Segment ${i + 1}`}
                  <span style={{ fontWeight: 600, opacity: 0.75 }}>{seg.startTime}s</span>
                </span>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
