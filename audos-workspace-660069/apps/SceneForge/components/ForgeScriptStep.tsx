/**
 * SceneForge step 1 — Script & voice.
 * Script textarea on the left; an idea-to-script bar that expands into
 * generation; below it the ElevenLabs voice list with play-preview.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Loader2, Pause, Play, Search, Sparkles, Wand2 } from 'lucide-react';
import { COLORS, FONT, RADIUS } from '../../../components/theme';
import {
  filterVoices,
  loadAllVoices,
  previewCosts,
  sampleFor,
  voiceTags,
  type Voice,
} from '../../../lib/elevenLabsVoices';
import { ideaToScript } from '../lib/forgeClient';

export interface ScriptStepValue {
  topic: string;
  script: string;
  niche: string;
  voiceId: string;
  voiceName: string;
}

export default function ForgeScriptStep({
  value,
  targetSeconds,
  onChange,
}: {
  value: ScriptStepValue;
  targetSeconds: number;
  onChange: (next: ScriptStepValue) => void;
}) {
  const [idea, setIdea] = useState('');
  const [ideaOpen, setIdeaOpen] = useState(false);
  const [ideaBusy, setIdeaBusy] = useState(false);
  const [ideaError, setIdeaError] = useState('');

  const [voices, setVoices] = useState<Voice[]>([]);
  const [voicesError, setVoicesError] = useState('');
  const [voiceQuery, setVoiceQuery] = useState('');
  const [indiaOnly, setIndiaOnly] = useState(false);
  const [playingId, setPlayingId] = useState('');
  const [loadingVoiceId, setLoadingVoiceId] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadAllVoices()
      .then((list) => { if (!cancelled) setVoices(list); })
      .catch((e) => { if (!cancelled) setVoicesError(String(e?.message || e)); });
    return () => {
      cancelled = true;
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    };
  }, []);

  const shownVoices = useMemo(() => {
    const isIndian = (voice: Voice) => /\b(india|indian|south[ -]?asian|desi|hindi|punjabi|bengali|tamil|telugu|malayalam|marathi)\b/i.test([
      voice.name, voice.accent, voice.language, voice.description, ...voiceTags(voice),
    ].filter(Boolean).join(' '));
    return filterVoices(voices, voiceQuery)
      .filter((voice) => !indiaOnly || isIndian(voice))
      .sort((a, b) => Number(isIndian(b)) - Number(isIndian(a)) || Number(b.category === 'cloned') - Number(a.category === 'cloned') || a.name.localeCompare(b.name));
  }, [voices, voiceQuery, indiaOnly]);

  const generate = async () => {
    if (!idea.trim() || ideaBusy) return;
    setIdeaBusy(true);
    setIdeaError('');
    try {
      const script = await ideaToScript(idea.trim(), value.niche, targetSeconds);
      onChange({ ...value, script, topic: value.topic || idea.trim().slice(0, 80) });
      setIdeaOpen(false);
    } catch (e: any) {
      setIdeaError(String(e?.message || e));
    } finally {
      setIdeaBusy(false);
    }
  };

  const togglePreview = async (voice: Voice) => {
    if (playingId === voice.id) {
      audioRef.current?.pause();
      setPlayingId('');
      return;
    }
    try {
      setLoadingVoiceId(voice.id);
      const url = await sampleFor(voice);
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlayingId('');
      await audio.play();
      setPlayingId(voice.id);
    } catch (e) {
      console.warn('[SceneForge] voice preview failed:', e);
    } finally {
      setLoadingVoiceId('');
    }
  };

  const inputStyle: CSSProperties = {
    background: COLORS.input,
    border: `1px solid ${COLORS.controlBorder}`,
    borderRadius: RADIUS.sm,
    color: COLORS.text,
    fontFamily: FONT.body,
    fontSize: 14,
    padding: '10px 12px',
    width: '100%',
  };

  return (
    <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 960 }}>
      {/* Idea-to-script bar — expands into generation */}
      <div
        style={{
          background: ideaOpen ? COLORS.surface : COLORS.raised,
          border: `1px solid ${ideaOpen ? COLORS.accent : COLORS.border}`,
          borderRadius: RADIUS.card,
          padding: ideaOpen ? 16 : 6,
          transition: 'all 180ms cubic-bezier(.2,0,0,1)',
        }}
      >
        {!ideaOpen ? (
          <button
            type="button"
            onClick={() => setIdeaOpen(true)}
            style={{ alignItems: 'center', background: 'transparent', border: 'none', color: COLORS.secondary, cursor: 'pointer', display: 'flex', fontFamily: FONT.body, fontSize: 14, gap: 10, minHeight: 44, padding: '0 10px', width: '100%' }}
            data-testid="button-idea-open"
          >
            <Sparkles size={16} color={COLORS.accent} />
            Have only an idea? Turn it into a script…
          </button>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <label style={{ color: COLORS.secondary, fontFamily: FONT.heading, fontSize: 13, fontWeight: 600 }}>Idea → script</label>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="e.g. Why most golf apps lose players in week one — and the 3 retention loops that fix it"
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
              data-testid="input-idea"
            />
            {ideaError ? <div style={{ color: COLORS.danger, fontSize: 13 }}>{ideaError}</div> : null}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={generate}
                disabled={ideaBusy || !idea.trim()}
                style={{ alignItems: 'center', background: ideaBusy ? COLORS.raised : 'linear-gradient(115deg, #C79232 0%, #D9A441 58%, #E5B75A 100%)', border: 'none', borderRadius: RADIUS.sm, color: ideaBusy ? COLORS.muted : COLORS.onAccent, cursor: ideaBusy ? 'wait' : 'pointer', display: 'flex', fontFamily: FONT.heading, fontSize: 14, fontWeight: 600, gap: 8, minHeight: 44, padding: '0 18px' }}
                data-testid="button-idea-generate"
              >
                {ideaBusy ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                {ideaBusy ? 'Writing…' : 'Write the script'}
              </button>
              <button type="button" onClick={() => setIdeaOpen(false)} style={{ background: 'transparent', border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.sm, color: COLORS.secondary, cursor: 'pointer', fontFamily: FONT.body, fontSize: 14, minHeight: 44, padding: '0 14px' }}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Script + niche */}
      <div style={{ display: 'grid', gap: 10 }}>
        <label style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 15, fontWeight: 600 }}>Your script</label>
        <textarea
          value={value.script}
          onChange={(e) => onChange({ ...value, script: e.target.value })}
          placeholder="Paste or write the exact words your presenter will say…"
          rows={10}
          style={{ ...inputStyle, fontSize: 15, lineHeight: '24px', minHeight: 220, resize: 'vertical' }}
          data-testid="input-script"
        />
        <div style={{ color: COLORS.muted, fontSize: 12.5 }}>
          {value.script.trim() ? `${value.script.trim().split(/\s+/).length} words ≈ ${Math.round(value.script.trim().split(/\s+/).length / 2.4)}s spoken` : 'The avatar speaks these words exactly — an agent only adds delivery emotion.'}
        </div>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div>
            <label style={{ color: COLORS.secondary, display: 'block', fontFamily: FONT.body, fontSize: 13, marginBottom: 6 }}>Working title</label>
            <input value={value.topic} onChange={(e) => onChange({ ...value, topic: e.target.value })} placeholder="e.g. Golf app retention explainer" style={inputStyle} data-testid="input-topic" />
          </div>
          <div>
            <label style={{ color: COLORS.secondary, display: 'block', fontFamily: FONT.body, fontSize: 13, marginBottom: 6 }}>Your niche / industry</label>
            <input value={value.niche} onChange={(e) => onChange({ ...value, niche: e.target.value })} placeholder="e.g. golf coaching apps" style={inputStyle} data-testid="input-niche" />
          </div>
        </div>
      </div>

      {/* Voice picker */}
      <div style={{ display: 'grid', gap: 10 }}>
        <label style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 15, fontWeight: 600 }}>Voice (ElevenLabs)</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 220, position: 'relative' }}>
            <Search size={15} color={COLORS.muted} style={{ left: 12, position: 'absolute', top: 14 }} />
            <input value={voiceQuery} onChange={(e) => setVoiceQuery(e.target.value)} placeholder="Search voices — accent, gender, tone…" style={{ ...inputStyle, paddingLeft: 34 }} data-testid="input-voice-search" />
          </div>
          <button type="button" onClick={() => setIndiaOnly((value) => !value)} style={{ background: indiaOnly ? COLORS.accentSoft : COLORS.raised, border: `1px solid ${indiaOnly ? COLORS.accent : COLORS.border}`, borderRadius: RADIUS.sm, color: indiaOnly ? COLORS.accent : COLORS.secondary, cursor: 'pointer', fontFamily: FONT.heading, fontSize: 13, fontWeight: 600, minHeight: 44, padding: '0 14px' }} data-testid="button-voice-indian-filter">
            Indian accent / language
          </button>
        </div>
        {voices.length ? <div style={{ color: COLORS.muted, fontSize: 12.5 }}>Showing {shownVoices.length} of {voices.length} voices · Indian matches are listed first</div> : null}
        {indiaOnly && voices.length > 0 && shownVoices.length === 0 ? <div style={{ color: COLORS.muted, fontSize: 13 }}>No Indian accent or language metadata was returned by ElevenLabs. Clear the filter to browse all voices.</div> : null}
        {voicesError ? <div style={{ color: COLORS.danger, fontSize: 13 }}>{voicesError}</div> : null}
        {!voices.length && !voicesError ? (
          <div style={{ alignItems: 'center', color: COLORS.muted, display: 'flex', fontSize: 13.5, gap: 8, padding: '12px 0' }}>
            <Loader2 size={15} className="animate-spin" /> Loading the voice catalog…
          </div>
        ) : null}
        <div style={{ display: 'grid', gap: 8, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
          {shownVoices.map((voice) => {
            const selected = voice.id === value.voiceId;
            return (
              <div
                key={voice.id}
                style={{
                  alignItems: 'center',
                  background: selected ? 'linear-gradient(100deg, #2B2418 0%, #202126 100%)' : COLORS.surface,
                  border: `1px solid ${selected ? COLORS.accent : COLORS.border}`,
                  borderRadius: RADIUS.card,
                  display: 'flex',
                  gap: 10,
                  padding: '10px 12px',
                }}
              >
                <button
                  type="button"
                  onClick={() => togglePreview(voice)}
                  title={previewCosts(voice) ? 'Preview (first play generates a short billed sample)' : 'Preview'}
                  aria-label={`Preview ${voice.name}`}
                  style={{ alignItems: 'center', background: COLORS.raised, border: `1px solid ${COLORS.controlBorder}`, borderRadius: 999, color: COLORS.accent, cursor: 'pointer', display: 'flex', height: 40, justifyContent: 'center', minWidth: 40 }}
                  data-testid={`button-voice-preview-${voice.id}`}
                >
                  {loadingVoiceId === voice.id ? <Loader2 size={15} className="animate-spin" /> : playingId === voice.id ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ ...value, voiceId: voice.id, voiceName: voice.name })}
                  style={{ background: 'transparent', border: 'none', color: COLORS.text, cursor: 'pointer', flex: 1, minWidth: 0, textAlign: 'left' }}
                  data-testid={`button-voice-pick-${voice.id}`}
                >
                  <span style={{ display: 'block', fontFamily: FONT.heading, fontSize: 14.5, fontWeight: 600 }}>{voice.name}</span>
                  <span style={{ color: COLORS.muted, display: 'block', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {voiceTags(voice).join(' · ')}
                  </span>
                </button>
                {selected ? <span style={{ color: COLORS.accent, fontFamily: FONT.heading, fontSize: 12.5, fontWeight: 700 }}>Selected</span> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
