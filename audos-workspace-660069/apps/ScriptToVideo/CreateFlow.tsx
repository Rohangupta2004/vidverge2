/**
 * Screens 2–4 — Create, Brief, and Blueprint. Claude turns the user's source
 * scenes into a dynamic shot plan: each shot is <=8s (Omni Flash's clip cap),
 * one source scene may become several shots, and bridge shots may be
 * inserted for continuity. Every shot renders on Gemini Omni Flash —
 * HyperFrames + Omni Flash policy, no model picker.
 */
import { useRef, useState } from 'react';
import { Clapperboard, FileUp, Loader2, Pencil, Play } from 'lucide-react';
import { api, parseUpload, CharacterRow, Project, Question, T } from './api';

const CHIP_PRESETS = ['Precise', 'Realistic', 'Cinematic', 'Fast-cut', 'Dialogue-heavy', 'Narration-only', 'Product-focused'];

const FORMATS = [
  { key: 'short-916', label: 'Short 9:16', mode: 'short', aspect: '9:16' },
  { key: 'square-11', label: 'Square 1:1', mode: 'short', aspect: '1:1' },
  { key: 'long-169', label: 'Long 16:9', mode: 'long', aspect: '16:9' },
] as const;

// The planner may use more shots than the user's scene list. These choices set
// the STARTING film length; every generated shot is independently capped at 8s.
// A script that reads longer than the pick expands the film to fit it (up to
// 120s) instead of being rejected, so this is a floor, never a hard cap.
const LENGTHS = [15, 30, 45, 60, 90, 120] as const;

// ---------------------------------------------------------------------------
// Screen 2 — Create
// ---------------------------------------------------------------------------

export function CreateScreen(props: {
  initialText?: string;
  busy: boolean;
  onSubmit: (params: { input_text: string; upload_text?: string; mode: string; aspect_ratio: string; chips: string[]; focus: string; target_length_s: number }) => void;
}) {
  const { initialText, busy, onSubmit } = props;
  const [text, setText] = useState(initialText || '');
  const [uploadText, setUploadText] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [fmt, setFmt] = useState<(typeof FORMATS)[number]>(FORMATS[0]);
  const [lenS, setLenS] = useState<number>(30);
  const [chips, setChips] = useState<string[]>([]);
  const [customChip, setCustomChip] = useState('');
  const [focus, setFocus] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const isScript = uploadText || words > 40 || /\n/.test(text.trim());
  const canGo = !!(text.trim() || uploadText);
  // Before planning, show the minimum number of <=8s generations. Claude may
  // add split or bridge shots, so this is explicitly a floor rather than a cap.
  const minimumShots = Math.ceil(lenS / 8);
  const estCredits = minimumShots * 4;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '28px 24px 140px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ color: T.bone, fontSize: 25, fontWeight: 700, letterSpacing: -0.5, marginBottom: 6 }}>What are we making?</div>
        <div style={{ color: T.muted, fontSize: 13.5, lineHeight: 1.5, marginBottom: 22 }}>Describe it in a word or paste a whole script — the pipeline handles everything after.</div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="A word, a line, or your whole script."
          rows={Math.min(14, Math.max(3, text.split('\n').length + 1))}
          style={{
            width: '100%', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 10,
            color: T.bone, fontSize: 15, lineHeight: 1.5, padding: '16px 18px', outline: 'none',
            resize: 'vertical', fontFamily: T.sans,
          }}
        />
        {isScript ? (
          <div style={{ color: T.muted, fontSize: 12.5, marginTop: 8 }}>
            Reading this as a full script — we won’t rewrite it.
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 14, marginTop: 12, alignItems: 'center' }}>
          <button
            className="s2v-ghost"
            onClick={() => fileRef.current?.click()}
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: 'none', color: T.muted, fontSize: 13, cursor: 'pointer', padding: '5px 8px', margin: '-5px -8px', borderRadius: 7 }}
          >
            <FileUp size={14} /> Upload script
          </button>
          {uploadName ? (
            <span style={{ color: T.done, fontSize: 12.5 }}>
              {uploadName} attached · <button onClick={() => { setUploadText(''); setUploadName(''); }} style={{ background: 'none', border: 'none', color: T.muted, cursor: 'pointer', fontSize: 12.5, padding: 0 }}>remove</button>
            </span>
          ) : (
            <span style={{ color: T.dim, fontSize: 12 }}>.txt · .md · .rtf · .fdx — or paste a link for an instant ad</span>
          )}
          <input
            ref={fileRef} type="file" accept=".txt,.md,.rtf,.fdx" style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try { setUploadText(await parseUpload(f)); setUploadName(f.name); setErr(''); }
              catch (ex: any) { setErr(String(ex?.message || ex)); }
              e.target.value = '';
            }}
          />
        </div>

        <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 32, marginBottom: 10 }}>Format</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {FORMATS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFmt(f)}
              style={{
                background: fmt.key === f.key ? T.bone : T.raised, color: fmt.key === f.key ? T.canvas : T.muted,
                border: `1px solid ${fmt.key === f.key ? T.bone : T.dim}`, borderRadius: 8,
                padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 32, marginBottom: 10 }}>Length</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {LENGTHS.map((seconds) => (
            <button
              key={seconds}
              onClick={() => setLenS(seconds)}
              style={{
                background: lenS === seconds ? T.bone : T.raised, color: lenS === seconds ? T.canvas : T.muted,
                border: `1px solid ${lenS === seconds ? T.bone : T.dim}`, borderRadius: 8,
                padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
              }}
            >
              {seconds}s
              <span style={{ display: 'block', fontSize: 10.5, fontWeight: 400, opacity: 0.75 }}>dynamic shots · max 8s each</span>
              {seconds >= 90 ? <span style={{ display: 'block', fontSize: 10, fontWeight: 400, opacity: 0.6 }}>long form</span> : null}
            </button>
          ))}
        </div>
        <div style={{ color: T.dim, fontSize: 11.5, marginTop: 8 }}>Claude may split scenes or add bridge shots. If your script reads longer than the length you pick, the film is stretched to fit it rather than cut — up to a 120s ceiling. Every shot renders on Gemini Omni Flash.</div>

        <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 32, marginBottom: 10 }}>
          Direction <span style={{ color: T.dim, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CHIP_PRESETS.map((c) => {
            const on = chips.includes(c);
            return (
              <button
                key={c}
                onClick={() => setChips(on ? chips.filter((x) => x !== c) : [...chips, c])}
                style={{
                  background: on ? 'rgba(232,163,60,0.14)' : 'transparent', color: on ? T.live : T.muted,
                  border: `1px solid ${on ? T.live : T.dim}`, borderRadius: 999, padding: '6px 14px',
                  fontSize: 12.5, cursor: 'pointer',
                }}
              >
                {c}
              </button>
            );
          })}
          <input
            value={customChip}
            onChange={(e) => setCustomChip(e.target.value)}
            onKeyDown={(e) => {
              const v = customChip.trim();
              if (e.key === 'Enter' && v) { setChips([...chips, v]); setCustomChip(''); }
            }}
            placeholder="+ Add your own"
            style={{ background: 'transparent', border: `1px dashed ${T.dim}`, borderRadius: 999, padding: '6px 14px', fontSize: 12.5, color: T.bone, outline: 'none', width: 130 }}
          />
        </div>

        <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 32, marginBottom: 10 }}>
          Focus on… <span style={{ color: T.dim, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
        </div>
        <input
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder="the one thing a viewer must remember"
          style={{ width: '100%', background: T.raised, border: `1px solid ${T.dim}`, borderRadius: 8, color: T.bone, fontSize: 13.5, padding: '11px 14px', outline: 'none' }}
        />

        {err ? <div style={{ color: T.fault, fontSize: 12.5, lineHeight: 1.5, marginTop: 14, background: 'rgba(226,114,111,0.08)', border: '1px solid rgba(226,114,111,0.25)', borderRadius: 9, padding: '9px 13px' }}>{err}</div> : null}

        <div style={{ color: T.muted, fontSize: 12.5, marginTop: 24, fontFamily: T.mono }}>
          From {estCredits} credits · ~{lenS}s video · at least {minimumShots} shots
        </div>

        <button
          className="s2v-lift"
          disabled={!canGo || busy}
          onClick={() => onSubmit({ input_text: text.trim(), upload_text: uploadText || undefined, mode: fmt.mode, aspect_ratio: fmt.aspect, chips, focus: focus.trim(), target_length_s: lenS })}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, marginTop: 12,
            background: canGo && !busy ? T.live : T.raised, color: canGo && !busy ? '#1A1205' : T.dim,
            border: 'none', borderRadius: 11, padding: '14px 28px', fontSize: 15, fontWeight: 700,
            cursor: canGo && !busy ? 'pointer' : 'default',
            boxShadow: canGo && !busy ? '0 2px 12px rgba(232,163,60,0.25)' : 'none',
          }}
        >
          {busy ? <Loader2 size={17} className="animate-spin" /> : <Clapperboard size={17} />}
          {busy ? 'Reading your brief…' : 'Make the video'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 3 — Brief (conditional, skippable)
// ---------------------------------------------------------------------------

export function BriefScreen(props: {
  questions: Question[];
  busy: boolean;
  onContinue: (answers: Record<string, string>) => void;
}) {
  const { questions, busy, onContinue } = props;
  const [answers, setAnswers] = useState<Record<string, string>>({});

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '28px 24px 140px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24 }}>
          <div style={{ color: T.bone, fontSize: 22, fontWeight: 700 }}>
            {questions.length > 1 ? 'Two quick things.' : 'One quick thing.'}
          </div>
          <button
            className="s2v-ghost"
            disabled={busy}
            onClick={() => onContinue({})}
            style={{ background: 'none', border: 'none', color: T.muted, fontSize: 13.5, cursor: 'pointer', textDecoration: 'underline', padding: '5px 9px', borderRadius: 7 }}
          >
            Skip all →
          </button>
        </div>

        {questions.map((q, qi) => (
          <div key={q.id} style={{ marginBottom: 26 }}>
            <div style={{ color: T.bone, fontSize: 14.5, fontWeight: 600, marginBottom: 10 }}>
              <span style={{ color: T.dim, fontFamily: T.mono, marginRight: 8 }}>{qi + 1}</span>{q.text}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {q.options.map((o) => {
                const on = answers[q.id] === o;
                return (
                  <button
                    key={o}
                    onClick={() => setAnswers({ ...answers, [q.id]: on ? '' : o })}
                    style={{
                      background: on ? 'rgba(232,163,60,0.14)' : T.raised, color: on ? T.live : T.bone,
                      border: `1px solid ${on ? T.live : T.dim}`, borderRadius: 8, padding: '9px 15px',
                      fontSize: 13, cursor: 'pointer', textAlign: 'left', maxWidth: 520,
                    }}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
            <input
              value={answers[q.id + '_free'] || ''}
              onChange={(e) => setAnswers({ ...answers, [q.id + '_free']: e.target.value, [q.id]: e.target.value || answers[q.id] || '' })}
              placeholder="or type your own…"
              style={{ marginTop: 8, width: '100%', maxWidth: 420, background: 'transparent', border: `1px solid ${T.raised}`, borderRadius: 8, color: T.bone, fontSize: 12.5, padding: '8px 12px', outline: 'none' }}
            />
          </div>
        ))}

        <button
          className="s2v-lift"
          disabled={busy}
          onClick={() => onContinue(answers)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, background: T.live, color: '#1A1205',
            border: 'none', borderRadius: 11, padding: '13px 26px', fontSize: 14.5, fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 2px 12px rgba(232,163,60,0.25)',
          }}
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : null}
          {busy ? 'Writing the script…' : 'Continue'}
        </button>
        {busy ? (
          <div style={{ color: T.muted, fontSize: 12.5, marginTop: 12 }}>
            Writing the script, planning every scene, and locking the cast list — about half a minute.
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen 4 — Blueprint (shown for a beat, auto-advances; Hold on to edit)
// ---------------------------------------------------------------------------

export function BlueprintScreen(props: {
  project: Project;
  scenes: any[];
  characters: CharacterRow[] | { name: string; token: string; appearance?: string; ref_image_url?: string | null }[];
  assumptions: string[];
  onStart: () => void;
  onCancel: () => void;
  onEditScene: (idx: number, patch: Record<string, unknown>) => Promise<void>;
}) {
  const { project, scenes, characters, assumptions, onStart, onCancel, onEditScene } = props;
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const started = useRef(false);

  // The blueprint shows Claude's dynamic shot plan. Shot count is independent
  // of the source-scene count, and the user confirms before any model spend.
  const estSeconds = scenes.reduce((n: number, s: any) => n + Math.min(8, Number(((s && s.spec) || s || {}).duration_s) || 8), 0);
  const estCredits = Math.ceil(scenes.length * 4);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 24px 140px' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 6 }}>
          <div style={{ color: T.bone, fontSize: 20, fontWeight: 700 }}>{project.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={onCancel}
              style={{ background: 'none', border: `1px solid ${T.dim}`, color: T.muted, borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              className="s2v-lift"
              onClick={() => { if (!started.current) { started.current = true; onStart(); } }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.live, color: '#1A1205', border: 'none', borderRadius: 9, padding: '10px 20px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 12px rgba(232,163,60,0.25)' }}
            >
              <Play size={14} /> Confirm & render
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '6px 0 18px', color: T.bone, fontSize: 13 }}>
          <span style={{ color: T.live, fontWeight: 700 }}>Planning {scenes.length} shot{scenes.length === 1 ? '' : 's'}</span>
          <span style={{ color: T.dim }}>·</span>
          <span>estimated {Math.round(estSeconds)}s video</span>
          <span style={{ color: T.dim }}>·</span>
          <span>est. {estCredits} credits</span>
        </div>

        {assumptions.length ? (
          <div style={{ color: T.muted, fontSize: 12.5, marginBottom: 18 }}>
            {assumptions.map((a, i) => <div key={i}>· {a}</div>)}
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 22 }}>
          <div>
            <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>Script</div>
            <div style={{ color: T.bone, fontSize: 12.5, lineHeight: 1.65, whiteSpace: 'pre-wrap', background: T.raised, border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12, padding: 16, maxHeight: 420, overflowY: 'auto' }}>
              {project.script_text || project.input_text}
            </div>
          </div>
          <div>
            <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>Shots · {scenes.length}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
              {scenes.map((s: any, i: number) => {
                const idx = Number(s.index || s.idx || i + 1);
                const spec = s.spec || s;
                const editing = editIdx === idx;
                return (
                  <div key={idx} style={{ background: T.raised, border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: '11px 13px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: T.dim, fontFamily: T.mono, fontSize: 11 }}>Shot {idx} · {Math.min(8, Number(spec.duration_s) || 8)}s · source {String(s.source_scene_id || spec.source_scene_id || spec.source_scene || idx)}</span>
                      {!editing ? (
                        <button onClick={() => { setEditIdx(idx); setEditText(String(spec.action || '')); }} style={{ background: 'none', border: 'none', color: T.muted, cursor: 'pointer', padding: 0 }}>
                          <Pencil size={12} />
                        </button>
                      ) : null}
                    </div>
                    {editing ? (
                      <div>
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={3}
                          style={{ width: '100%', marginTop: 6, background: T.canvas, border: `1px solid ${T.dim}`, borderRadius: 6, color: T.bone, fontSize: 12.5, padding: 8, outline: 'none' }}
                        />
                        <button
                          onClick={async () => { await onEditScene(idx, { action: editText }); setEditIdx(null); }}
                          style={{ marginTop: 6, background: T.bone, color: T.canvas, border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <div style={{ color: T.bone, fontSize: 12.5, lineHeight: 1.5, marginTop: 4 }}>{spec.action}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>Cast</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(characters as any[]).length ? (characters as any[]).map((c: any) => (
                <div key={c.token || c.name} style={{ display: 'flex', gap: 12, alignItems: 'center', background: T.raised, border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, padding: 11 }}>
                  <div style={{ width: 44, height: 58, borderRadius: 6, background: T.canvas, overflow: 'hidden', flexShrink: 0 }}>
                    {c.ref_image_url ? <img src={c.ref_image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                  </div>
                  <div>
                    <div style={{ color: T.bone, fontSize: 13, fontWeight: 600 }}>{c.name} <span style={{ color: T.dim, fontFamily: T.mono, fontSize: 11 }}>{c.token}</span></div>
                    <div style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.4, marginTop: 2 }}>{String(c.appearance || '').slice(0, 90)}</div>
                  </div>
                </div>
              )) : <div style={{ color: T.dim, fontSize: 12.5 }}>No recurring characters — this film doesn’t need a cast.</div>}
              <div style={{ color: T.dim, fontSize: 11.5 }}>Reference images resolve in during casting.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
