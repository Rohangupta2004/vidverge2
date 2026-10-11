/**
 * MODEL LAB — the Images and Videos tabs.
 *
 * Pick a model card, write (or have ✦ AI Write) a prompt, set the options that
 * model actually supports, see the cost, generate, preview and download.
 *
 * Availability is live: vv-media-capabilities is checked on mount and any
 * provider the platform has not configured is shown greyed with the reason
 * rather than as a button that fails on submit.
 *
 * Styling matches the rest of Model Lab — same dark palette, same amber
 * accent, same card and button idiom — so the new tabs read as one app.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Capabilities, GenerationResult, ProviderStatus, errorText, fetchCapabilities, generate, writePrompt,
} from './mediaClient';
import {
  IMAGE_GROUPS, IMAGE_MODEL_CARDS, ImageModelCard, MediaTab, OptionSpec,
  VIDEO_GROUPS, VIDEO_MODEL_CARDS, VideoModelCard, estimateCost,
} from './mediaModels';

const C = {
  bg: '#FFFDF4',
  surface: '#FFFAEB',
  card: '#FFFFFF',
  border: 'rgba(180,120,0,0.14)',
  accent: '#C8920A',
  text: '#1A1000',
  text2: '#7A6030',
  success: '#166534',
  error: '#991B1B',
};
const FONT = 'system-ui, sans-serif';
const MONO = "'Fira Code', 'Courier New', monospace";

type AnyCard = ImageModelCard | VideoModelCard;

const isVideoCard = (c: AnyCard): c is VideoModelCard => 'durations' in c;

function defaultOptions(card: AnyCard): Record<string, string> {
  const out: Record<string, string> = {};
  card.options.forEach((o) => {
    if (o.defaultValue !== undefined) out[o.key] = String(o.defaultValue);
  });
  return out;
}

function Spinner({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: `2px solid ${C.border}`,
        borderTopColor: color,
        borderRadius: '50%',
        animation: 'ml-spin 0.7s linear infinite',
        flexShrink: 0,
      }}
    />
  );
}

function CostBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 800,
        color,
        background: `${color}1f`,
        border: `1px solid ${color}55`,
        borderRadius: 999,
        padding: '2px 9px',
        whiteSpace: 'nowrap',
        fontFamily: MONO,
      }}
    >
      {label}
    </span>
  );
}

function FeatureChip({ text }: { text: string }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        color: C.text2,
        background: '#FFFAEB',
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: '2px 7px',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}

function ModelCard({
  card, selected, disabled, disabledReason, onSelect,
}: {
  card: AnyCard;
  selected: boolean;
  disabled: boolean;
  disabledReason?: string;
  onSelect: () => void;
}) {
  const video = isVideoCard(card);
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      data-testid={`card-model-${card.id.replace(/[^a-z0-9]+/gi, '-')}`}
      title={disabled ? disabledReason : card.bestFor}
      className="ml-btn ml-card"
      style={{
        textAlign: 'left',
        background: selected ? `${card.accent}14` : C.card,
        border: `1px solid ${selected ? card.accent : C.border}`,
        borderTop: `3px solid ${selected ? card.accent : `${card.accent}66`}`,
        borderRadius: 10,
        padding: 13,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: 'inherit',
        font: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text, flex: 1, minWidth: 0 }}>{card.name}</span>
        <CostBadge label={card.costLabel} color={card.accent} />
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: card.accent, textTransform: 'uppercase' }}>
        {card.provider}
      </div>
      <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.5, flex: 1 }}>{card.blurb}</div>
      <div style={{ fontSize: 11.5, color: C.text, lineHeight: 1.45 }}>
        <strong style={{ color: C.text2, fontWeight: 700 }}>Best for:</strong> {card.bestFor}
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {video
          ? (card as VideoModelCard).features.slice(0, 5).map((f) => <FeatureChip key={f} text={f} />)
          : (card as ImageModelCard).sizes.slice(0, 7).map((s) => <FeatureChip key={s} text={s} />)}
      </div>
      <div style={{ fontSize: 11, color: C.text2, fontFamily: MONO }}>
        {video ? (card as VideoModelCard).durations : 'Text to image'}
      </div>
      {disabled && disabledReason ? (
        <div style={{ fontSize: 11, color: '#B45309', lineHeight: 1.45 }}>⚠️ {disabledReason}</div>
      ) : card.caveat ? (
        <div style={{ fontSize: 11, color: '#B45309', lineHeight: 1.45 }}>⚠️ {card.caveat}</div>
      ) : null}
    </button>
  );
}

function OptionControl({
  spec, value, onChange,
}: {
  spec: OptionSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  const base: CSSProperties = {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    color: C.text,
    fontSize: 12.5,
    padding: '6px 9px',
    fontFamily: FONT,
    minWidth: 96,
  };
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: C.text2, textTransform: 'uppercase' }}>
        {spec.label}
      </span>
      {spec.type === 'select' ? (
        <select className="ml-input" value={value} onChange={(e) => onChange(e.target.value)} style={base}>
          {(spec.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : spec.type === 'toggle' ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, height: 31 }}>
          <input type="checkbox" checked={value === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : 'false')} />
          <span style={{ fontSize: 12, color: C.text2 }}>{value === 'true' ? 'On' : 'Off'}</span>
        </span>
      ) : (
        <input
          className="ml-input"
          type="number"
          value={value}
          placeholder="auto"
          onChange={(e) => onChange(e.target.value)}
          style={{ ...base, fontFamily: MONO }}
        />
      )}
      {spec.hint ? <span style={{ fontSize: 10.5, color: C.text2, lineHeight: 1.4 }}>{spec.hint}</span> : null}
    </label>
  );
}

export default function MediaStudio({ tab }: { tab: MediaTab }) {
  const cards: AnyCard[] = tab === 'images' ? IMAGE_MODEL_CARDS : VIDEO_MODEL_CARDS;
  const groups = tab === 'images' ? IMAGE_GROUPS : VIDEO_GROUPS;

  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [selectedId, setSelectedId] = useState(cards[0]?.id || '');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [options, setOptions] = useState<Record<string, string>>(() => defaultOptions(cards[0]));

  const [writerOpen, setWriterOpen] = useState(false);
  const [idea, setIdea] = useState('');
  const [writerBusy, setWriterBusy] = useState(false);
  const [writerDraft, setWriterDraft] = useState('');
  const [writerModel, setWriterModel] = useState('');
  const [writerError, setWriterError] = useState('');

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const card = useMemo(() => cards.find((c) => c.id === selectedId) || cards[0], [cards, selectedId]);

  useEffect(() => {
    let alive = true;
    void fetchCapabilities().then((c) => { if (alive) setCapabilities(c); });
    return () => { alive = false; };
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Switching tabs means switching catalogues — reset to that tab's first model.
  useEffect(() => {
    const first = cards[0];
    if (!first) return;
    setSelectedId(first.id);
    setOptions(defaultOptions(first));
    setResult(null);
    setError('');
    setProgress('');
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusFor = useCallback((c: AnyCard): ProviderStatus | null => {
    if (!capabilities) return null;
    return capabilities[c.availability] || null;
  }, [capabilities]);

  const selectCard = useCallback((c: AnyCard) => {
    setSelectedId(c.id);
    setOptions(defaultOptions(c));
    setResult(null);
    setError('');
    setProgress('');
  }, []);

  const runWriter = useCallback(async () => {
    const description = idea.trim();
    if (!description || writerBusy) return;
    setWriterBusy(true);
    setWriterError('');
    setWriterDraft('');
    try {
      const { prompt: written, model } = await writePrompt(card, description);
      setWriterDraft(written);
      setWriterModel(model);
    } catch (e) {
      setWriterError(errorText(e));
    } finally {
      setWriterBusy(false);
    }
  }, [idea, writerBusy, card]);

  const run = useCallback(async () => {
    if (busy) return;
    const status = statusFor(card);
    if (status && !status.available) {
      setError(`${card.name} cannot be called right now — ${status.error || 'the provider is not configured on this platform.'}`);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError('');
    setResult(null);
    setProgress('Starting…');
    try {
      const out = await generate({
        card,
        prompt,
        options,
        imageUrl: referenceUrl.trim() || undefined,
        negativePrompt: negativePrompt.trim() || undefined,
        onProgress: setProgress,
        signal: controller.signal,
      });
      setResult(out);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setProgress('');
      abortRef.current = null;
    }
  }, [busy, card, prompt, options, referenceUrl, negativePrompt, statusFor]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setProgress('');
  }, []);

  const cost = estimateCost(card, options);
  const acceptsReference = isVideoCard(card)
    ? card.features.some((f) => /image-to-video/i.test(f))
    : false;
  const referenceRequired = /image-to-video only/i.test(card.caveat || '');

  const sectionStyle: CSSProperties = {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: 14,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: FONT }}>
      <style>{`
        .ms-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); gap: 12px; }
        .ms-options { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-start; }
        @media (max-width: 720px) {
          .ms-grid { grid-template-columns: minmax(0, 1fr); }
          .ms-actions { flex-direction: column; align-items: stretch !important; }
          .ms-actions > * { width: 100%; }
        }
      `}</style>

      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text }}>
          {tab === 'images' ? '🖼️ Image Models' : '🎬 Video Models'}
        </h2>
        <div style={{ color: C.text2, fontSize: 13, marginTop: 4, lineHeight: 1.55 }}>
          {cards.length} models the platform actually serves, each on the endpoint that serves it.{' '}
          {capabilities?.checkedAt
            ? 'Availability checked live — anything the platform has not configured is greyed out with the reason.'
            : 'Checking live availability…'}
        </div>
      </div>

      {groups.map((group) => {
        const groupCards = cards.filter((c) => c.family === group.id);
        if (!groupCards.length) return null;
        const groupStatus = statusFor(groupCards[0]);
        return (
          <div key={group.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{group.label}</span>
              <span style={{ fontSize: 11, color: C.text2, fontFamily: MONO }}>{group.note}</span>
              {groupStatus && !groupStatus.available ? (
                <span style={{ fontSize: 11, color: '#B45309', fontWeight: 700 }}>Unavailable · {groupStatus.error}</span>
              ) : null}
            </div>
            <div className="ms-grid">
              {groupCards.map((c) => {
                const s = statusFor(c);
                return (
                  <ModelCard
                    key={c.id}
                    card={c}
                    selected={c.id === card.id}
                    disabled={Boolean(s && !s.available)}
                    disabledReason={s?.error}
                    onSelect={() => selectCard(c)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>Prompt for {card.name}</span>
          <span style={{ flex: 1 }} />
          <button
            className="ml-btn"
            onClick={() => setWriterOpen((o) => !o)}
            data-testid="button-ai-write"
            title="Describe what you want in plain English and have it rewritten as a prompt tuned to this model"
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: `1px solid ${writerOpen ? C.accent : `${C.accent}88`}`,
              background: writerOpen ? `${C.accent}2a` : `${C.accent}14`,
              color: '#B4720A',
              fontSize: 12.5,
              fontWeight: 800,
            }}
          >
            ✦ AI Write
          </button>
        </div>

        {writerOpen ? (
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.accent}55`,
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.5 }}>
              Describe what you want in plain English. It gets rewritten as a prompt tuned to {card.name}&rsquo;s strengths
              — {card.bestFor.toLowerCase()}
            </div>
            <textarea
              className="ml-input"
              rows={3}
              value={idea}
              placeholder={tab === 'images' ? 'e.g. a hero shot of my analytics dashboard, dark, premium, amber accents' : 'e.g. a slow reveal of a coffee brand on a marble counter, morning light'}
              onChange={(e) => setIdea(e.target.value)}
              data-testid="input-ai-write-idea"
              style={{
                width: '100%', boxSizing: 'border-box', background: '#FFFAEB',
                border: `1px solid ${C.border}`, borderRadius: 6, color: C.text,
                fontSize: 13, lineHeight: 1.6, padding: 10, resize: 'vertical', fontFamily: FONT,
              }}
            />
            <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                className="ml-btn"
                onClick={runWriter}
                disabled={writerBusy || !idea.trim()}
                data-testid="button-ai-write-run"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '7px 16px', borderRadius: 8, border: 'none',
                  background: C.accent, color: '#ffffff', fontSize: 12.5, fontWeight: 800,
                  opacity: writerBusy || !idea.trim() ? 0.55 : 1,
                }}
              >
                {writerBusy ? <><Spinner color="#ffffff" /> Writing…</> : '✦ Write the prompt'}
              </button>
              {writerModel && writerDraft ? (
                <span style={{ fontSize: 11, color: C.text2, fontFamily: MONO }}>written by {writerModel}</span>
              ) : null}
            </div>

            {writerError ? (
              <div style={{ border: `1px solid ${C.error}66`, background: `${C.error}14`, borderRadius: 6, padding: '9px 11px', color: C.error, fontSize: 12, lineHeight: 1.5 }}>
                {writerError}
              </div>
            ) : null}

            {writerDraft ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ background: '#FFFAEB', border: `1px solid ${C.border}`, borderRadius: 6, padding: 11, color: C.text, fontSize: 12.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {writerDraft}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="ml-btn"
                    onClick={() => { setPrompt(writerDraft); setWriterOpen(false); }}
                    data-testid="button-ai-write-use"
                    style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${C.success}`, background: `${C.success}1a`, color: C.success, fontSize: 12, fontWeight: 800 }}
                  >
                    ↑ Use this prompt
                  </button>
                  <button
                    className="ml-btn"
                    onClick={runWriter}
                    disabled={writerBusy}
                    style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text2, fontSize: 12, fontWeight: 700 }}
                  >
                    ↻ Try again
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <textarea
          className="ml-input"
          rows={4}
          value={prompt}
          placeholder={`Describe the ${tab === 'images' ? 'image' : 'shot'} you want…`}
          onChange={(e) => setPrompt(e.target.value)}
          data-testid="input-media-prompt"
          style={{
            width: '100%', boxSizing: 'border-box', background: C.card,
            border: `1px solid ${C.border}`, borderRadius: 6, color: C.text,
            fontSize: 13.5, lineHeight: 1.6, padding: 12, resize: 'vertical', fontFamily: FONT,
          }}
        />

        {acceptsReference || referenceRequired ? (
          <label style={{ display: 'block', marginTop: 12 }}>
            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: C.text2, textTransform: 'uppercase', marginBottom: 5 }}>
              Reference image URL {referenceRequired ? '(required — this model is image-to-video only)' : '(optional — turns this into image-to-video)'}
            </span>
            <input
              className="ml-input"
              type="url"
              value={referenceUrl}
              placeholder="https://…/product.png"
              onChange={(e) => setReferenceUrl(e.target.value)}
              data-testid="input-reference-url"
              style={{
                width: '100%', boxSizing: 'border-box', background: C.card,
                border: `1px solid ${C.border}`, borderRadius: 6, color: C.text,
                fontSize: 12.5, padding: '9px 11px', fontFamily: MONO,
              }}
            />
          </label>
        ) : null}

        {isVideoCard(card) && card.family !== 'higgsfield' && card.family !== 'runway' ? (
          <label style={{ display: 'block', marginTop: 12 }}>
            <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: C.text2, textTransform: 'uppercase', marginBottom: 5 }}>
              Negative prompt (optional)
            </span>
            <input
              className="ml-input"
              type="text"
              value={negativePrompt}
              placeholder="what should not appear"
              onChange={(e) => setNegativePrompt(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box', background: C.card,
                border: `1px solid ${C.border}`, borderRadius: 6, color: C.text,
                fontSize: 12.5, padding: '9px 11px', fontFamily: FONT,
              }}
            />
          </label>
        ) : null}

        <div className="ms-options" style={{ marginTop: 14 }}>
          {card.options.map((spec) => (
            <OptionControl
              key={spec.key}
              spec={spec}
              value={options[spec.key] ?? ''}
              onChange={(v) => setOptions((prev) => ({ ...prev, [spec.key]: v }))}
            />
          ))}
        </div>

        <div className="ms-actions" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: C.text2, textTransform: 'uppercase' }}>
              Estimated cost
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: card.accent, fontFamily: MONO, marginTop: 3 }}>{cost}</div>
          </div>
          {busy ? (
            <button
              className="ml-btn"
              onClick={cancel}
              data-testid="button-cancel-generation"
              style={{ padding: '9px 18px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text2, fontSize: 12.5, fontWeight: 700 }}
            >
              ✕ Cancel
            </button>
          ) : null}
          <button
            className="ml-btn"
            onClick={run}
            disabled={busy || prompt.trim().length < 10}
            data-testid="button-generate-media"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '11px 26px', borderRadius: 8, border: 'none',
              background: busy ? '#B4720A' : C.accent, color: '#ffffff',
              fontSize: 13.5, fontWeight: 800,
              opacity: !busy && prompt.trim().length < 10 ? 0.5 : 1,
              cursor: busy ? 'wait' : prompt.trim().length < 10 ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? <><Spinner color="#ffffff" /> {progress || 'Generating…'}</> : <>⚡ Generate {tab === 'images' ? 'image' : 'video'}</>}
          </button>
        </div>

        {busy && progress ? (
          <div style={{ marginTop: 11, fontSize: 12, color: C.text2, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Spinner color={card.accent} /> {progress}
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            style={{
              marginTop: 12, border: `1px solid ${C.error}66`, background: `${C.error}14`,
              borderRadius: 8, padding: '11px 13px', color: C.error, fontSize: 12.5, lineHeight: 1.55,
            }}
          >
            <strong style={{ display: 'block', marginBottom: 3 }}>Generation failed</strong>
            {error}
          </div>
        ) : null}
      </div>

      {result ? (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>Result</span>
            <span style={{ fontSize: 11, color: C.text2, fontFamily: MONO }}>
              {result.modelUsed} · {(result.elapsedMs / 1000).toFixed(1)}s
            </span>
            <span style={{ flex: 1 }} />
            <a
              href={result.url}
              download
              target="_blank"
              rel="noreferrer noopener"
              className="ml-btn"
              data-testid="link-download-result"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, textDecoration: 'none',
                padding: '8px 18px', borderRadius: 8, background: C.accent,
                color: '#ffffff', fontSize: 12.5, fontWeight: 800,
              }}
            >
              ⬇ Download
            </a>
          </div>
          {result.note ? (
            <div style={{ marginBottom: 10, fontSize: 12, color: '#B45309', lineHeight: 1.5 }}>⚠️ {result.note}</div>
          ) : null}
          <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.border}`, background: '#000' }}>
            {result.kind === 'video' ? (
              <video src={result.url} controls playsInline style={{ display: 'block', width: '100%', maxHeight: '62vh' }} />
            ) : (
              <img src={result.url} alt={prompt.slice(0, 120)} style={{ display: 'block', width: '100%', maxHeight: '62vh', objectFit: 'contain' }} />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
