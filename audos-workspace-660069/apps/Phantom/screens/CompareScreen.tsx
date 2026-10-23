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
  ArrowRight, CheckCircle2, Download, ExternalLink, Lightbulb, MessageSquare, Pencil, RefreshCw, Search, Sparkles, Target, TrendingUp,
} from 'lucide-react';
import { Competitor, Insights, MATRIX_ROWS, Matrix, Profile, buildDeterministicResearch, buildInsights, buildMatrix } from '../store';
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
  Positioning: 'The slot each one publicly occupies',
  Audience: 'Who each company says it serves',
  Offering: 'Published products and key features',
  Pricing: 'Public pricing only',
  Strengths: 'Evidence-backed advantages to review',
  Weaknesses: 'Not self-published; always requires review',
  Content: 'Official site plus available public content sources',
  'Advertising hooks': 'Only authorised ad-library evidence',
  CTA: 'Observed public call to action',
  Opportunities: 'Clearly labelled strategic hypotheses',
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
  const [findingQuery, setFindingQuery] = useState('');
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
    setLog([
      'Starting independent Ads, Social, Product and Opportunity agents in parallel…',
      'Each finding will keep its source URL, observation date, evidence status and confidence…',
    ]);
    try {
      const [rawMatrix, research] = await Promise.all([
        buildMatrix(brand, competitors),
        Promise.resolve(buildDeterministicResearch(brand, competitors)),
      ]);
      const profiles: Record<string, Partial<Profile>> = { you: brand };
      competitors.forEach((item) => { profiles[item.id] = item; });
      const oldRows = rawMatrix.rows || [];
      const cells: Record<string, string> = {};
      const valueFor = (row: string, profile: Partial<Profile>, own: boolean): string => {
        if (row === 'Positioning') return String(profile.positioning || profile.usp || 'Not published');
        if (row === 'Audience') return String(profile.audience || 'Not published');
        if (row === 'Offering') return (profile.features || []).slice(0, 5).join(', ') || 'Not published';
        if (row === 'Pricing') return String(profile.pricing || 'Not published');
        if (row === 'Strengths') return String(profile.usp || profile.tagline || 'Review needed');
        if (row === 'Weaknesses') return 'Not stated by the company; requires human review.';
        if (row === 'Content') return 'Official website reviewed; social feeds unavailable in this run.';
        if (row === 'Advertising hooks') return 'Ad-library source unavailable; no hook fabricated.';
        if (row === 'CTA') return String(profile.tagline || 'No public CTA captured');
        return own ? 'Hypothesis: test a clearer, evidence-backed contrast against the selected competitors.' : 'Reference point for differentiated creative; validate before use.';
      };
      MATRIX_ROWS.forEach((row, rowIndex) => {
        rawMatrix.columns.forEach((columnId) => {
          const previousIndex = oldRows.findIndex((item) => item.toLowerCase() === row.toLowerCase());
          const previous = previousIndex >= 0 ? rawMatrix.cells[`${previousIndex}:${columnId}`] : '';
          cells[`${rowIndex}:${columnId}`] = String(previous || valueFor(row, profiles[columnId] || {}, columnId === 'you'));
        });
      });
      const nextMatrix: Matrix = { ...rawMatrix, rows: [...MATRIX_ROWS], cells };
      onMatrix(nextMatrix);
      setLog((lines) => lines.concat('Parallel source passes complete. Agent E is deduplicating and removing unsupported claims…'));
      const nextInsights = await buildInsights(brand, competitors, nextMatrix);
      onInsights({ ...nextInsights, research });
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
    if (started.current || (matrix && insights?.research)) return;
    started.current = true;
    build();
  }, [matrix, insights?.research, build]);

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
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><Spinner size={120} caption="Building your comparison" /></div>
            <div style={{ fontSize: 13.3, color: TEXT_DIM, maxWidth: 460, margin: '0 auto 18px', lineHeight: 1.6 }}>
              {competitors.filter((c) => c.included && c.fetched).length + 1} columns, ten evidence-aware rows, then the positioning read-out.
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
        hint="Click any cell to correct it. Review evidence and approve the report before it feeds creative work. Cached results are reused until Refresh research is pressed."
        right={(
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <Button busy={busy} onClick={build}><RefreshCw size={14} /> Refresh research</Button>
            <Button busy={exporting} onClick={exportPng}><Download size={14} /> Export PNG</Button>
            {insights?.research?.approvedAt ? <Button variant="primary" onClick={onContinue}>Continue to Strategize <ArrowRight size={15} /></Button> : null}
          </div>
        )}
      >
        Competitive Intelligence Report
      </SectionTitle>

      {error ? <Notice tone="bad">{error}</Notice> : null}
      {exportNote ? <Notice tone={exportNote.startsWith('Saved') ? 'good' : 'bad'}>{exportNote}</Notice> : null}
      {log.length > 0 ? <div style={{ marginBottom: 15 }}><LogStream lines={log} busy={busy} /></div> : null}

      {insights?.research ? (
        <Panel style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {insights.research.agents.map((agent) => (
              <span key={agent.id} title={agent.note} style={{ padding: '7px 10px', border: `1px solid ${LINE}`, borderRadius: 9, fontSize: 11.5, color: agent.status === 'done' ? TEXT : TEXT_MUTED }}>
                {agent.label} · {agent.status}
              </span>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 11.3, color: TEXT_MUTED, fontFamily: MONO }}>cached {new Date(insights.research.refreshedAt).toLocaleString()}</span>
          </div>
        </Panel>
      ) : null}

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
          </div>

          {!insights ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, fontSize: 12.5, color: TEXT_MUTED, lineHeight: 1.6, textAlign: 'center' }}>
              <Spinner size={110} caption="Reading your table" />
              Reading the finished table for what rivals do better, what you own, and where the market is unclaimed.
            </div>
          ) : (
            <>
              <InsightBlock
                icon={<TrendingUp size={14} />}
                title="What competitors do better"
                lines={insights.competitorsBetter}
                tone="#991B1B"
              />
              <InsightBlock
                icon={<Sparkles size={14} />}
                title="Your unique advantages"
                lines={insights.yourAdvantages}
                tone="#166534"
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
                tone="#1D4ED8"
              />
              <div style={{
                borderTop: `1px solid ${LINE}`, paddingTop: 15, marginTop: 4,
                display: 'flex', alignItems: 'flex-start', gap: 9,
                fontSize: 11.8, color: TEXT_MUTED, lineHeight: 1.55,
              }}>
                <Lightbulb size={14} style={{ color: accent, flexShrink: 0, marginTop: 1 }} />
                Approved advantages and gaps become context for the existing Create engine.
              </div>
            </>
          )}
        </Panel>
      </div>

      {insights?.research ? (
        <Panel style={{ padding: 20, marginTop: 18 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>Evidence &amp; findings</div>
            <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
              <Search size={13} style={{ position: 'absolute', left: 10, top: 10, color: TEXT_MUTED }} />
              <input value={findingQuery} onChange={(event) => setFindingQuery(event.target.value)} placeholder="Filter findings" style={{ width: '100%', padding: '8px 10px 8px 30px', borderRadius: 9, border: `1px solid ${LINE}`, background: INK_DEEP, color: TEXT }} />
            </div>
            <Button variant={insights.research.approvedAt ? 'ghost' : 'primary'} onClick={() => onInsights({ ...insights, research: { ...insights.research!, approvedAt: new Date().toISOString() } })}>
              <CheckCircle2 size={14} /> {insights.research.approvedAt ? 'Approved' : 'Approve findings'}
            </Button>
          </div>
          <div style={{ display: 'grid', gap: 9, maxHeight: 360, overflowY: 'auto' }}>
            {insights.research.findings.filter((item) => `${item.category} ${item.claim} ${item.evidence}`.toLowerCase().includes(findingQuery.toLowerCase())).map((item) => (
              <div key={item.id} style={{ padding: 12, border: `1px solid ${LINE}`, borderRadius: 10, background: CARD }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6, fontSize: 10.8, fontFamily: MONO }}>
                  <span style={{ color: item.evidenceType === 'verified' ? '#166534' : item.evidenceType === 'hypothesis' ? accent : TEXT_MUTED }}>{item.evidenceType.toUpperCase()}</span>
                  <span style={{ color: TEXT_MUTED }}>{item.confidence} confidence · {new Date(item.observedAt).toLocaleDateString()}</span>
                  {item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', color: accent, display: 'inline-flex', gap: 4, alignItems: 'center' }}>Source <ExternalLink size={11} /></a> : null}
                </div>
                <div style={{ fontSize: 12.6, color: TEXT_DIM, lineHeight: 1.5 }}>{item.claim}</div>
                <div style={{ marginTop: 5, fontSize: 11.4, color: TEXT_MUTED }}>{item.evidence}</div>
              </div>
            ))}
          </div>
          {insights.research.unavailableSources.length ? <div style={{ marginTop: 12, fontSize: 11.5, color: TEXT_MUTED }}>Unavailable in this run: {insights.research.unavailableSources.join(', ')}. No data was invented.</div> : null}
        </Panel>
      ) : null}

      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.6, color: TEXT_MUTED }}>
        <Pencil size={12} /> Edits, evidence and approval are kept with the saved report.
        <span style={{ marginLeft: 'auto', fontFamily: MONO, border: `1px solid ${LINE_HI}`, borderRadius: 7, padding: '3px 8px' }}>
          {columns.length} columns · {matrix.rows.length} rows
        </span>
      </div>
    </div>
  );
}
