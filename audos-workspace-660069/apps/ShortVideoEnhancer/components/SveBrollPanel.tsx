/**
 * Short Video Enhancer — B-roll.
 *
 * B-roll OVERLAYS the main clip; it never cuts into it and it never carries
 * audio, so the original sound runs uninterrupted underneath. Three layouts:
 * corner picture-in-picture, a 50/50 split, and a full-frame opacity blend.
 *
 * Sources: the creator's own upload, or Pexels stock through the platform
 * secrets proxy. The Pexels key is OPTIONAL by design — when it is missing the
 * panel says so once and falls back to upload, rather than looking broken.
 */

import { useRef, useState } from 'react';
import { Film, Loader2, Search, Trash2, Upload } from 'lucide-react';
import { BROLL_LAYOUTS, clamp, formatClock, type BrollClip, type BrollLayout, type EditDoc } from '../lib/sveTypes';
import type { PexelsClip } from '../lib/sveApi';
import { Field, Note, Section, Slider } from './SveControls';

export interface BrollPanelProps {
  doc: EditDoc;
  open: boolean;
  onToggleOpen: () => void;
  hasSource: boolean;
  currentTime: number;
  searching: boolean;
  uploading: boolean;
  stock: PexelsClip[];
  stockNote: string;
  suggestedTerms: string[];
  keywordMoments: { word: string; at: number }[];
  onUpdate: (patch: (doc: EditDoc) => EditDoc, label?: string) => void;
  onSearch: (term: string) => void;
  onAddStock: (clip: PexelsClip) => void;
  onUploadBroll: (file: File) => void;
  onPinToKeyword: (word: string, at: number) => void;
}

export function SveBrollPanel(props: BrollPanelProps) {
  const { doc } = props;
  const [term, setTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const duration = Math.max(0.1, doc.durationS);
  const selected = doc.broll.find((c) => c.id === selectedId) || null;

  const patchClip = (id: string, patch: Partial<BrollClip>, label?: string) => {
    props.onUpdate((d) => ({ ...d, broll: d.broll.map((c) => (c.id === id ? { ...c, ...patch } : c)) }), label);
  };

  const removeClip = (id: string) => {
    props.onUpdate((d) => ({ ...d, broll: d.broll.filter((c) => c.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  };

  const runSearch = () => {
    const query = term.trim();
    if (query) props.onSearch(query);
  };

  return (
    <Section id="broll" title="B-Roll Overlay" open={props.open} onToggle={props.onToggleOpen}>
      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = '';
          if (file) props.onUploadBroll(file);
        }}
      />

      {!props.hasSource && <Note>Upload your main clip first so B-roll has a timeline to sit on.</Note>}

      {/* --- timeline ------------------------------------------------------ */}
      {doc.broll.length > 0 && (
        <div className="sve-broll-bar" title="B-roll placement across the clip">
          {doc.broll.map((clip) => (
            <span
              key={clip.id}
              className={selectedId === clip.id ? 'selected' : ''}
              style={{
                left: (clip.start / duration) * 100 + '%',
                width: Math.max(1.5, ((clip.end - clip.start) / duration) * 100) + '%',
              }}
              onClick={() => setSelectedId(clip.id)}
              title={clip.name + ' · ' + formatClock(clip.start) + '–' + formatClock(clip.end)}
            />
          ))}
          <em style={{ left: (clamp(props.currentTime, 0, duration) / duration) * 100 + '%' }} />
        </div>
      )}

      <div className="sve-broll-list">
        {doc.broll.map((clip) => (
          <div
            key={clip.id}
            className={'sve-broll-row ' + (selectedId === clip.id ? 'selected' : '')}
            onClick={() => setSelectedId(clip.id === selectedId ? null : clip.id)}
          >
            <span className="sve-broll-thumb" style={clip.posterUrl ? { backgroundImage: 'url(' + clip.posterUrl + ')' } : undefined}>
              {clip.posterUrl ? null : <Film size={14} style={{ margin: '9px auto', display: 'block', color: '#9C86C6' }} />}
            </span>
            <span className="sve-broll-meta">
              <strong>{clip.name}</strong>
              <small>
                {formatClock(clip.start)}–{formatClock(clip.end)} · {BROLL_LAYOUTS.find((l) => l.id === clip.layout)?.label}
                {clip.keyword ? ' · “' + clip.keyword + '”' : ''}
              </small>
            </span>
            <span
              role="button"
              tabIndex={0}
              title="Remove this B-roll clip"
              style={{ color: '#F87171', display: 'grid', placeItems: 'center', width: 26, height: 26 }}
              onClick={(event) => { event.stopPropagation(); removeClip(clip.id); }}
            >
              <Trash2 size={14} />
            </span>
          </div>
        ))}
      </div>

      {/* --- selected clip settings ---------------------------------------- */}
      {selected && (
        <>
          <Field label="Layout">
            <div className="sve-segmented">
              {BROLL_LAYOUTS.map((layout) => (
                <button
                  key={layout.id}
                  className={selected.layout === layout.id ? 'active' : ''}
                  title={layout.hint}
                  onClick={() => patchClip(selected.id, { layout: layout.id as BrollLayout })}
                >
                  {layout.label}
                </button>
              ))}
            </div>
          </Field>
          <Slider
            label="Start" value={Number(selected.start.toFixed(1))} min={0} max={Number((duration - 0.5).toFixed(1))} step={0.1} suffix="s"
            onChange={(start) => patchClip(selected.id, { start, end: Math.max(start + 0.5, selected.end) }, 'broll-start')}
          />
          <Slider
            label="End" value={Number(selected.end.toFixed(1))} min={0.5} max={Number(duration.toFixed(1))} step={0.1} suffix="s"
            onChange={(end) => patchClip(selected.id, { end, start: Math.min(selected.start, end - 0.5) }, 'broll-end')}
          />
          {selected.layout === 'blend' && (
            <Slider
              label="Blend opacity" value={Math.round(selected.opacity * 100)} min={10} max={100} suffix="%"
              onChange={(v) => patchClip(selected.id, { opacity: v / 100 }, 'broll-opacity')}
            />
          )}
          <p className="sve-muted">This overlay is silent — your original audio keeps playing underneath it.</p>
        </>
      )}

      {/* --- pin to a caption keyword --------------------------------------- */}
      {props.keywordMoments.length > 0 && (
        <Field label="Pin to a caption keyword">
          <div className="sve-chiprow">
            {props.keywordMoments.map((hit) => (
              <button key={hit.word} className="sve-chip" onClick={() => props.onPinToKeyword(hit.word, hit.at)}>
                {hit.word} · {formatClock(hit.at)}
              </button>
            ))}
          </div>
        </Field>
      )}

      {/* --- sources -------------------------------------------------------- */}
      <button className="sve-button add" style={{ marginBottom: 10 }} disabled={props.uploading} onClick={() => fileRef.current?.click()}>
        {props.uploading ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
        {props.uploading ? 'Uploading B-roll…' : 'Upload your own B-roll'}
      </button>

      {props.suggestedTerms.length > 0 && (
        <Field label="AI-suggested search terms">
          <div className="sve-chiprow">
            {props.suggestedTerms.map((suggestion) => (
              <button key={suggestion} className="sve-chip" onClick={() => { setTerm(suggestion); props.onSearch(suggestion); }}>
                {suggestion}
              </button>
            ))}
          </div>
        </Field>
      )}

      <div className="sve-search">
        <input
          value={term}
          placeholder="Search stock B-roll…"
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }}
        />
        <button className="sve-icon-button" title="Search Pexels" disabled={props.searching} onClick={runSearch}>
          {props.searching ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
        </button>
      </div>

      {props.stockNote && <Note tone="warn">{props.stockNote}</Note>}

      {props.stock.length > 0 && (
        <div className="sve-stock">
          {props.stock.map((clip) => (
            <button
              key={clip.id}
              style={clip.posterUrl ? { backgroundImage: 'url(' + clip.posterUrl + ')' } : undefined}
              title={'Add “' + clip.name + '” as an overlay'}
              onClick={() => props.onAddStock(clip)}
            >
              <b>{clip.durationS ? clip.durationS + 's' : 'ADD'}</b>
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}
