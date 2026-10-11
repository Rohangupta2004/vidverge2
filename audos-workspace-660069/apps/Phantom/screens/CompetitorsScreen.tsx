/**
 * SCREEN 2 — COMPETITOR DISCOVERY.
 *
 * Discovery is two stages and the UI shows both, because they fail differently:
 * three Google searches name the candidates, then each candidate's own site is
 * read one at a time. A site that blocks automated readers (plenty do, with a
 * 403) is not a bug and not a dead end — the card says so, keeps the row, and
 * excludes it from the comparison so the table never carries an empty column.
 *
 * Reading happens SEQUENTIALLY rather than in parallel on purpose: each read is
 * a page fetch plus a model call, and eight at once is how a run gets itself
 * rate-limited halfway through and leaves the customer with four good columns
 * and four mysterious blanks.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Plus, RefreshCw, Search, Trash2, Users } from 'lucide-react';
import { Competitor, Profile, analyzeCompetitor, discoverCompetitors } from '../store';
import { INK_DEEP, LINE, MONO, TEXT, TEXT_DIM, TEXT_MUTED, rgba } from '../theme';
import { BrandMark, Button, EmptyState, Field, LogStream, Notice, Panel, Pill, SectionTitle, Spinner, useAccent } from '../ui';

interface Props {
  brand: Profile;
  competitors: Competitor[];
  onCompetitors: (next: Competitor[]) => void;
  onContinue: () => void;
}

function Card({
  competitor, onToggle, onRemove, onRetry, busy,
}: {
  competitor: Competitor;
  onToggle: () => void;
  onRemove: () => void;
  onRetry: () => void;
  busy: boolean;
}) {
  const accent = useAccent();
  const on = !!(competitor.included && competitor.fetched);
  return (
    <Panel style={{
      padding: 17,
      border: `1px solid ${on ? rgba(accent, 0.32) : LINE}`,
      background: on ? rgba(accent, 0.05) : undefined,
      opacity: competitor.fetched ? 1 : 0.84,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <BrandMark name={competitor.name} logoUrl={competitor.logoUrl} size={42} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {competitor.name}
          </div>
          <a
            href={competitor.url}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 11.4, color: TEXT_MUTED, fontFamily: MONO, textDecoration: 'none' }}
          >
            {competitor.url.replace(/^https?:\/\//i, '')}
          </a>
        </div>
        <Button small variant="quiet" title="Remove from this comparison" onClick={onRemove}>
          <Trash2 size={13} />
        </Button>
      </div>

      <div style={{ fontSize: 12.6, color: TEXT_DIM, lineHeight: 1.55, minHeight: 38 }}>
        {competitor.fetched
          ? (competitor.tagline || competitor.why || 'No tagline on their site.')
          : competitor.error
            ? competitor.error
            : busy
              ? 'Reading their site\u2026'
              : (competitor.why || 'Not read yet.')}
      </div>

      {competitor.fetched && competitor.pricing ? (
        <div style={{ fontSize: 11.8, color: TEXT_MUTED, fontFamily: MONO, lineHeight: 1.5 }}>
          {competitor.pricing.slice(0, 90)}
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 4 }}>
        {competitor.fetched ? (
          <button
            type="button"
            onClick={onToggle}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '7px 13px', borderRadius: 999, cursor: 'pointer',
              fontSize: 12, fontWeight: 650, fontFamily: 'inherit',
              color: on ? accent : TEXT_MUTED,
              background: on ? rgba(accent, 0.14) : 'transparent',
              border: `1px solid ${on ? rgba(accent, 0.38) : LINE}`,
            }}
          >
            {on ? <Check size={12} /> : null}
            {on ? 'Included' : 'Excluded'}
          </button>
        ) : (
          <>
            <Pill tone="bad">Not read</Pill>
            <Button small busy={busy} onClick={onRetry}><RefreshCw size={12} /> Retry</Button>
          </>
        )}
      </div>
    </Panel>
  );
}

export default function CompetitorsScreen({ brand, competitors, onCompetitors, onContinue }: Props) {
  const accent = useAccent();
  const [phase, setPhase] = useState<'idle' | 'searching' | 'reading'>('idle');
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [readingId, setReadingId] = useState('');
  const live = useRef(competitors);

  useEffect(() => { live.current = competitors; }, [competitors]);

  const readEach = useCallback(async (seeds: Competitor[]) => {
    setPhase('reading');
    for (let i = 0; i < seeds.length; i += 1) {
      const seed = seeds[i];
      setReadingId(seed.id);
      setLog((lines) => lines.concat(`Reading ${seed.name} (${i + 1} of ${seeds.length})\u2026`));
      let resolved: Competitor;
      try {
        resolved = await analyzeCompetitor(seed);
      } catch (e: any) {
        resolved = { ...seed, fetched: false, included: false, error: String(e?.message || e) };
      }
      const merged = live.current.map((c) => (c.id === seed.id || c.url === seed.url ? { ...c, ...resolved } : c));
      live.current = merged;
      onCompetitors(merged);
    }
    setReadingId('');
    setPhase('idle');
    const good = live.current.filter((c) => c.fetched).length;
    setLog((lines) => lines.concat(`Read ${good} of ${live.current.length} sites. Ready to compare.`));
  }, [onCompetitors]);

  const discover = useCallback(async () => {
    setPhase('searching');
    setError('');
    setNote('');
    setLog([
      `Searching "${brand.name} alternatives 2026"\u2026`,
      `Searching "best ${brand.category || 'tools'} compared"\u2026`,
      `Searching "${brand.name} vs competitors"\u2026`,
    ]);
    try {
      const result = await discoverCompetitors(brand);
      if (result.competitors.length === 0) {
        setPhase('idle');
        setNote(result.note || 'No competitors could be identified from the search results. Add one by hand below.');
        setLog([]);
        return;
      }
      setNote(result.note);
      setLog((lines) => lines.concat(`Found ${result.competitors.length} candidates. Reading each site now\u2026`));
      live.current = result.competitors;
      onCompetitors(result.competitors);
      await readEach(result.competitors);
    } catch (e: any) {
      setError(String(e?.message || e));
      setLog([]);
      setPhase('idle');
    }
  }, [brand, onCompetitors, readEach]);

  // Discovery runs by itself the first time this screen is reached — the brief is
  // AUTO-discovery, so making the customer press a button first would be wrong.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || competitors.length > 0) return;
    started.current = true;
    discover();
  }, [competitors.length, discover]);

  const addManual = async () => {
    const url = manualUrl.trim();
    if (!url) return;
    const seed: Competitor = {
      id: `manual-${Date.now()}`,
      url: /^https?:\/\//i.test(url) ? url : `https://${url}`,
      name: url.replace(/^https?:\/\//i, '').replace(/^www\./, '').split('/')[0],
      included: true,
      source: 'manual',
      fetched: false,
    };
    setManualUrl('');
    const next = live.current.concat(seed);
    live.current = next;
    onCompetitors(next);
    await readEach([seed]);
  };

  const retry = async (competitor: Competitor) => {
    await readEach([{ ...competitor, included: true, error: undefined }]);
  };

  const includedCount = competitors.filter((c) => c.included && c.fetched).length;
  const unreadCount = competitors.filter((c) => !c.fetched).length;
  const busyAll = phase !== 'idle';

  return (
    <div className="vergeye-rise">
      <SectionTitle
        hint={`Vergeye searched for who buyers weigh against ${brand.name || 'you'}, then read each site for its tagline, features and pricing. Exclude anyone who is not really a rival — only included brands become columns.`}
        right={(
          <div style={{ display: 'flex', gap: 9 }}>
            <Button busy={phase === 'searching'} disabled={busyAll} onClick={discover}>
              <Search size={14} /> Search again
            </Button>
            <Button variant="primary" disabled={includedCount === 0 || busyAll} onClick={onContinue}>
              Compare now <ArrowRight size={15} />
            </Button>
          </div>
        )}
      >
        Your competitors
      </SectionTitle>

      {error ? <Notice tone="bad">{error}</Notice> : null}
      {note ? <Notice tone="warn">{note}</Notice> : null}

      {phase === 'reading' ? <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'center' }}><Spinner size={120} caption="Reading competitor sites" /></div> : null}

      {log.length > 0 ? <div style={{ marginBottom: 16 }}><LogStream lines={log} busy={busyAll} /></div> : null}

      {phase === 'searching' && competitors.length === 0 ? (
        <Panel style={{ padding: '52px 32px', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><Spinner size={120} caption="Finding your competitors" /></div>
          <div style={{ fontSize: 13.3, color: TEXT_DIM, maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>
            Three searches, then a read of every site that comes back. This usually takes under a minute.
          </div>
        </Panel>
      ) : competitors.length === 0 ? (
        <EmptyState
          icon={<Users size={30} />}
          title="No competitors found yet"
          body="The searches did not surface a clean set of rival products. Search again, or add the competitors you already know by their website address."
          action={<Button variant="primary" onClick={discover}><Search size={14} /> Search again</Button>}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(268px, 1fr))', gap: 14, marginBottom: 20 }}>
          {competitors.map((competitor) => (
            <Card
              key={competitor.id + competitor.url}
              competitor={competitor}
              busy={readingId === competitor.id}
              onToggle={() => onCompetitors(competitors.map((c) => (c.id === competitor.id ? { ...c, included: !c.included } : c)))}
              onRemove={() => onCompetitors(competitors.filter((c) => c.id !== competitor.id))}
              onRetry={() => retry(competitor)}
            />
          ))}
        </div>
      )}

      <Panel style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Field
              label="Know someone the search missed?"
              value={manualUrl}
              onChange={setManualUrl}
              placeholder="competitor.com"
              onEnter={addManual}
              hint="Vergeye reads their site the same way and adds them as a column."
            />
          </div>
          <div style={{ paddingBottom: 14 }}>
            <Button disabled={!manualUrl.trim() || busyAll} onClick={addManual}><Plus size={14} /> Add competitor</Button>
          </div>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          borderTop: `1px solid ${LINE}`, paddingTop: 16, marginTop: 4,
          fontSize: 12.3, color: TEXT_MUTED,
        }}>
          <span style={{ color: includedCount > 0 ? accent : TEXT_MUTED, fontWeight: 650 }}>
            {includedCount} included
          </span>
          {unreadCount > 0 ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={12} /> {unreadCount} could not be read
            </span>
          ) : null}
          <span style={{ fontFamily: MONO, background: INK_DEEP, padding: '4px 9px', borderRadius: 7 }}>
            {brand.category || 'category not set'}
          </span>
        </div>
      </Panel>
    </div>
  );
}
