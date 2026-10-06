/**
 * SCREEN 3 — THE COMPARISON.
 *
 * Two things here are load-bearing and easy to get wrong.
 *
 * EDITABLE CELLS ARE DIVS, NOT INPUTS. A cell renders as text and only becomes
 * a textarea while it is being edited. That is what makes Export PNG a true
 * screenshot of what the customer is looking at: html2canvas draws form
 * controls as empty boxes, so a table built from <input> elements exports blank.
 * Edit mode is also cleared before a capture for the same reason.
 *
 * EVERY COLOUR IN THE CAPTURED SUBTREE IS A LITERAL. html2canvas cannot parse
 * color-mix() or a CSS variable and drops the declaration without complaining,
 * so the exported PNG of a token-styled table comes out grey. theme.rgba()
 * computes rgba from the accent hex for exactly this reason.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Download, Lightbulb, MessageSquare, Pencil, RefreshCw, Sparkles, Target, TrendingUp,
} from 'lucide-react';
import { Competitor, Insights, Matrix, Profile, buildInsights, buildMatrix } from '../store';
import { CARD, CARD_HI, INK, INK_DEEP, LINE, LINE_HI, MONO, TEXT, TEXT_DIM, TEXT_MUTED, readableOn, rgba } from '../theme';
import { BrandMark, Button, LogStream, Notice, Panel, SectionTitle, Spinner, useAccent } from '../ui';

interface Props {
  brand: Profile;
  competitors: Competitor[];
  matrix: Matrix | null;
  insights: Insights | null;
  onMatrix: (matrix: Matrix) => void;
  onInsights: (insights: Insights) => void;
  onContinue: () => void;
}

const HTML2CANVAS_SRC = 'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js';

/**
 * html2canvas arrives as a pinned script tag rather than an import because it is
 * needed only the moment somebody presses Export: the bundle stays the size it
 * was, and a CDN having a bad day costs one button instead of the whole app.
 */
function loadHtml2Canvas(): Promise<any> {
  const existing = (window as any).html2canvas;
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = HTML2CANVAS_SRC;
    tag.async = true;
    tag.onload = () => {
      const loaded = (window as any).html2canvas;
      if (loaded) resolve(loaded);
      else reject(new Error('The image library loaded but did not register itself.'));
    };
    tag.onerror = () => reject(new Error('The image library could not be downloaded. Check the connection and try again.'));
    document.head.appendChild(tag);
  });
}

const ROW_HINTS: Record<string, string> = {
  Pricing: 'Quoted from each pricing page',
  'Key features': 'What each site puts first',
  'Target audience': 'Who each one says it is for',
  USP: 'The one claim each one leads with',
  Strengths: 'Judged across this set',
  Weaknesses: 'Including what is simply not published',
  Positioning: 'The slot each one occupies',
};

function Cell({
  value, onChange, highlight,
}: {
  value: string;
  onChange: (next: string) => void;
  highlight: boolean;
}) {
  const accent = useAccent();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== value) onChange(next);
  };

  if (editing) {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
        }}
        style={{
          width: '100%', minHeight: 92, resize: 'vertical',
          background: INK_DEEP, border: `1px solid ${accent}`, borderRadius: 10,
          padding: '10px 12px', color: TEXT, fontSize: 12.7, lineHeight: 1.55, fontFamily: 'inherit',
        }}
      />
    );
  }

  return (
    <div
      title="Click to edit"
      onClick={() => setEditing(true)}
      style={{
        fontSize: 12.7, lineHeight: 1.58, cursor: 'text',
        color: highlight ? TEXT : TEXT_DIM,
        fontWeight: highlight ? 600 : 400,
        padding: '2px 0',
        minHeight: 20,
      }}
    >
      {value || <span style={{ color: TEXT_MUTED }}>Not published</span>}
    </div>
  );
}

function InsightBlock({
  icon, title, lines, tone,
}: {
  icon: React.ReactNode;
  title: string;
  lines: string[];
  tone: string;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ color: tone, display: 'flex' }}>{icon}</span>
        <span style={{ fontSize: 11.4, letterSpacing: 1.5, textTransform: 'uppercase', color: tone, fontFamily: MONO, fontWeight: 650 }}>
          {title}
        </span>
      </div>
      {lines.length === 0 ? (
        <div style={{ fontSize: 12.3, color: TEXT_MUTED }}>Nothing to report here.</div>
      ) : (
        <div style={{ display: 'grid', gap: 9 }}>
          {lines.map((line, i) => (
            <div key={`${i}-${line.slice(0, 12)}`} style={{
              fontSize: 12.5, color: TEXT_DIM, lineHeight: 1.55,
              paddingLeft: 11, borderLeft: `2px solid ${rgba(tone, 0.45)}`,
            }}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CompareScreen({
  brand, competitors, matrix, insights, onMatrix, onInsights, onContinue,
}: Props) {
  const accent = useAccent();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState('');
  const tableRef = useRef<HTMLDivElement>(null);

  const columnProfiles = useMemo(() => {
    const map: Record<string, { name: string; logoUrl?: string; url?: string }> = {
      you: { name: brand.name || 'Your brand', logoUrl: brand.logoUrl, url: brand.url },
    };
    competitors.forEach((c) => { map[c.id] = { name: c.name, logoUrl: c.logoUrl, url: c.url }; });
    return map;
  }, [brand, competitors]);

  const build = useCallback(async () => {
    setBusy(true);
    setError('');
    setLog(['Lining the columns up\u2026', 'Filling every cell from what each site actually says\u2026']);
    try {
      const nextMatrix = await buildMatrix(brand, competitors);
      onMatrix(nextMatrix);
      setLog((lines) => lines.concat('Table built. Reading it back for the positioning analysis\u2026'));
      const nextInsights = await buildInsights(brand, competitors, nextMatrix);
      onInsights(nextInsights);
      setLog([]);
    } catch (e: any) {
      setError(String(e?.message || e));
      setLog([]);
    } finally {
      setBusy(false);
    }
  }, [brand, competitors, onMatrix, onInsights]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current || matrix) return;
    started.current = true;
    build();
  }, [matrix, build]);

  const setCell = (key: string, value: string) => {
    if (!matrix) return;
    onMatrix({ ...matrix, cells: { ...matrix.cells, [key]: value } });
  };

  const exportPng = async () => {
    if (!tableRef.current) return;
    setExporting(true);
    setExportNote('');
    try {
      const html2canvas = await loadHtml2Canvas();
      const canvas = await html2canvas(tableRef.current, {
        backgroundColor: INK,
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const link = document.createElement('a');
      link.download = `${(brand.name || 'comparison').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-comparison.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      setExportNote('Saved to your downloads.');
    } catch (e: any) {
      setExportNote(`The image could not be produced: ${String(e?.message || e)}`);
    } finally {
      setExporting(false);
    }
  };

  if (!matrix) {
    return (
      <div className="vergeye-rise">
        <SectionTitle hint="Every cell is filled from the pages Vergeye already read, so nothing here is invented.">The comparison</SectionTitle>
        {error ? (
          <>
            <Notice tone="bad">{error}</Notice>
            <Button variant="primary" onClick={build}><RefreshCw size={14} /> Try again</Button>
          </>
        ) : (
          <Panel style={{ padding: '54px 32px', textAlign: 'center' }}>
            <div style={{ color: accent, display: 'flex', justifyContent: 'center', marginBottom: 14 }}><Spinner size={26} /></div>
            <div style={{ fontSize: 17, fontWeight: 700, color: TEXT, marginBottom: 8 }}>Building your comparison</div>
            <div style={{ fontSize: 13.3, color: TEXT_DIM, maxWidth: 460, margin: '0 auto 18px', lineHeight: 1.6 }}>
              {competitors.filter((c) => c.included && c.fetched).length + 1} columns, seven rows, then the positioning read-out.
            </div>
            <LogStream lines={log} busy />
          </Panel>
        )}
      </div>
    );
  }

  const columns = matrix.columns.filter((id) => !!columnProfiles[id]);

  return (
    <div className="vergeye-rise">
      <SectionTitle
        hint="Click any cell to correct it. Your column is highlighted. Export PNG saves exactly what you see."
        right={(
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <Button busy={busy} onClick={build}><RefreshCw size={14} /> Rebuild</Button>
            <Button busy={exporting} onClick={exportPng}><Download size={14} /> Export PNG</Button>
            <Button variant="primary" onClick={onContinue}>Make the video <ArrowRight size={15} /></Button>
          </div>
        )}
      >
        The comparison
      </SectionTitle>

      {error ? <Notice tone="bad">{error}</Notice> : null}
      {exportNote ? <Notice tone={exportNote.startsWith('Saved') ? 'good' : 'bad'}>{exportNote}</Notice> : null}
      {log.length > 0 ? <div style={{ marginBottom: 15 }}><LogStream lines={log} busy={busy} /></div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 316px', gap: 18, alignItems: 'start' }} className="vergeye-two-col">
        <div className="vergeye-scroll" style={{ overflowX: 'auto', borderRadius: 18, border: `1px solid ${LINE}` }}>
          <div ref={tableRef} style={{ minWidth: 220 + columns.length * 210, background: INK, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 4, height: 26, borderRadius: 2, background: accent }} />
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 750, color: TEXT, letterSpacing: -0.2 }}>
                  {brand.name || 'Your brand'} vs the market
                </div>
                <div style={{ fontSize: 10.6, color: TEXT_MUTED, fontFamily: MONO, letterSpacing: 0.5, marginTop: 2 }}>
                  {new Date().toLocaleDateString()} · researched from each product&apos;s own site
                </div>
              </div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: `180px repeat(${columns.length}, minmax(190px, 1fr))`,
              gap: 1,
              background: LINE,
              borderRadius: 14,
              overflow: 'hidden',
            }}>
              <div style={{ background: CARD_HI, padding: '14px 14px' }} />
              {columns.map((id) => {
                const own = id === 'you';
                const profile = columnProfiles[id];
                return (
                  <div key={`head-${id}`} style={{
                    background: own ? accent : CARD_HI,
                    padding: '14px 14px',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <BrandMark name={profile.name} logoUrl={own ? brand.logoUrl : profile.logoUrl} size={28} radius={9} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: 13.2, fontWeight: 750,
                        color: own ? readableOn(accent) : TEXT,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {profile.name}
                      </div>
                      <div style={{
                        fontSize: 9.8, fontFamily: MONO, letterSpacing: 0.4,
                        color: own ? rgba(readableOn(accent), 0.72) : TEXT_MUTED,
                      }}>
                        {own ? 'YOU' : (profile.url || '').replace(/^https?:\/\//i, '').slice(0, 22)}
                      </div>
                    </div>
                  </div>
                );
              })}

              {matrix.rows.map((row, rowIndex) => (
                <React.Fragment key={`row-${rowIndex}`}>
                  <div style={{ background: CARD_HI, padding: '15px 14px' }}>
                    <div style={{ fontSize: 12.4, fontWeight: 700, color: TEXT }}>{row}</div>
                    <div style={{ fontSize: 10.4, color: TEXT_MUTED, marginTop: 4, lineHeight: 1.45 }}>{ROW_HINTS[row] || ''}</div>
                  </div>
                  {columns.map((id) => {
                    const own = id === 'you';
                    const key = `${rowIndex}:${id}`;
                    return (
                      <div key={key} style={{
                        background: own ? rgba(accent, 0.09) : CARD,
                        borderLeft: own ? `2px solid ${accent}` : '2px solid transparent',
                        padding: '15px 14px',
                      }}>
                        <Cell value={String(matrix.cells[key] || '')} onChange={(next) => setCell(key, next)} highlight={own} />
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>

            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.4, color: TEXT_MUTED, fontFamily: MONO, letterSpacing: 0.5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: accent }} />
              VERGEYE · {brand.url.replace(/^https?:\/\//i, '')}
            </div>
          </div>
        </div>

        <Panel style={{ padding: 20, position: 'sticky', top: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 18 }}>
            <div style={{ fontSize: 11.4, letterSpacing: 2, textTransform: 'uppercase', color: TEXT_MUTED, fontFamily: MONO }}>
              Positioning read-out
            </div>
            {!insights ? <Spinner size={14} /> : null}
          </div>

          {!insights ? (
            <div style={{ fontSize: 12.5, color: TEXT_MUTED, lineHeight: 1.6 }}>
              Reading the finished table for what rivals do better, what you own, and where the market is unclaimed.
            </div>
          ) : (
            <>
              <InsightBlock
                icon={<TrendingUp size={14} />}
                title="What competitors do better"
                lines={insights.competitorsBetter}
                tone="#f87171"
              />
              <InsightBlock
                icon={<Sparkles size={14} />}
                title="Your unique advantages"
                lines={insights.yourAdvantages}
                tone="#4ade80"
              />
              <InsightBlock
                icon={<Target size={14} />}
                title="Positioning gaps"
                lines={insights.positioningGaps}
                tone={accent}
              />
              <InsightBlock
                icon={<MessageSquare size={14} />}
                title="Messaging improvements"
                lines={insights.messagingImprovements}
                tone="#60a5fa"
              />
              <div style={{
                borderTop: `1px solid ${LINE}`, paddingTop: 15, marginTop: 4,
                display: 'flex', alignItems: 'flex-start', gap: 9,
                fontSize: 11.8, color: TEXT_MUTED, lineHeight: 1.55,
              }}>
                <Lightbulb size={14} style={{ color: accent, flexShrink: 0, marginTop: 1 }} />
                The video script on the next screen is written from your advantages and these gaps.
              </div>
            </>
          )}
        </Panel>
      </div>

      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.6, color: TEXT_MUTED }}>
        <Pencil size={12} /> Edits are kept with the saved comparison, and the exported PNG matches them.
        <span style={{ marginLeft: 'auto', fontFamily: MONO, border: `1px solid ${LINE_HI}`, borderRadius: 7, padding: '3px 8px' }}>
          {columns.length} columns · {matrix.rows.length} rows
        </span>
      </div>
    </div>
  );
}
