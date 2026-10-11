/**
 * SAVED COMPARISONS.
 *
 * Every analysis is one row of vergeye_comparisons, scoped to the visitor, so
 * this is a real history rather than a local cache: a comparison opened here
 * restores the whole four-screen flow — the edited cells, the insights, the
 * script, and any render still in flight.
 */

import React from 'react';
import { Archive, Film, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { SavedSummary } from '../store';
import { CARD_HI, LINE, MONO, TEXT, TEXT_DIM, TEXT_MUTED, normalizeHex, relativeTime, rgba } from '../theme';
import { Button, EmptyState, Panel, Pill, SectionTitle, Spinner, useAccent } from '../ui';
import type { Tone } from '../ui';

interface Props {
  saved: SavedSummary[];
  loading: boolean;
  currentId: number;
  onOpen: (id: number) => void;
  onRemove: (id: number) => void;
  onRefresh: () => void;
  onNew: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  brand: 'Brand read',
  competitors: 'Competitors found',
  compared: 'Comparison built',
  scripted: 'Script written',
  rendering: 'Rendering',
  video: 'Video ready',
  failed: 'Needs attention',
};

function statusTone(status: string): Tone {
  if (status === 'video') return 'good';
  if (status === 'failed') return 'bad';
  if (status === 'rendering') return 'warn';
  if (status === 'compared' || status === 'scripted') return 'accent';
  return 'idle';
}

export default function SavedScreen({ saved, loading, currentId, onOpen, onRemove, onRefresh, onNew }: Props) {
  const accent = useAccent();

  return (
    <div className="vergeye-rise">
      <SectionTitle
        hint="Everything you have analysed, newest first. Opening one restores the whole flow, including anything still rendering."
        right={(
          <div style={{ display: 'flex', gap: 9 }}>
            <Button busy={loading} onClick={onRefresh}><RefreshCw size={14} /> Refresh</Button>
            <Button variant="primary" onClick={onNew}><Plus size={14} /> New comparison</Button>
          </div>
        )}
      >
        Saved comparisons
      </SectionTitle>

      {saved.length === 0 ? (
        <EmptyState
          icon={loading ? <Spinner size={120} caption="Looking for your saved work" /> : <Archive size={30} />}
          title={loading ? 'One moment' : 'Nothing saved yet'}
          body={loading
            ? 'Your saved comparisons are on their way.'
            : 'Run a comparison and it is saved automatically with its own name and date, so you can come back to it, refresh the competitor data, or render the video later.'}
          action={loading ? undefined : <Button variant="primary" onClick={onNew}><Plus size={14} /> Start a comparison</Button>}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
          {saved.map((row) => {
            const rowAccent = normalizeHex(row.accentColor) || accent;
            const open = row.id === currentId;
            return (
              <Panel key={row.id} style={{
                padding: 18,
                border: `1px solid ${open ? rgba(rowAccent, 0.42) : LINE}`,
                display: 'flex', flexDirection: 'column', gap: 13,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
                  <div style={{ width: 4, alignSelf: 'stretch', minHeight: 36, borderRadius: 2, background: rowAccent }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14.6, fontWeight: 720, color: TEXT, lineHeight: 1.3 }}>{row.name}</div>
                    <div style={{ fontSize: 11.3, color: TEXT_MUTED, fontFamily: MONO, marginTop: 4 }}>
                      {(row.brandUrl || '').replace(/^https?:\/\//i, '').slice(0, 30)}
                    </div>
                  </div>
                  {open ? <Pill tone="accent">Open</Pill> : null}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Pill tone={statusTone(row.status)}>{STATUS_LABELS[row.status] || row.status}</Pill>
                  <span style={{ fontSize: 11.6, color: TEXT_MUTED }}>
                    {row.competitorCount} competitor{row.competitorCount === 1 ? '' : 's'}
                  </span>
                  {row.videoUrl ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.6, color: TEXT_DIM }}>
                      <Film size={11} /> video
                    </span>
                  ) : null}
                </div>

                <div style={{
                  display: 'flex', alignItems: 'center', gap: 9, marginTop: 'auto',
                  borderTop: `1px solid ${LINE}`, paddingTop: 13,
                }}>
                  <Button small onClick={() => onOpen(row.id)}><Play size={12} /> Open</Button>
                  <span style={{ fontSize: 11.2, color: TEXT_MUTED, fontFamily: MONO }}>{relativeTime(row.updatedAt)}</span>
                  <Button small variant="quiet" title="Delete this comparison" onClick={() => onRemove(row.id)}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {saved.length > 0 ? (
        <div style={{
          marginTop: 16, padding: '12px 15px', borderRadius: 12,
          background: CARD_HI, border: `1px solid ${LINE}`,
          fontSize: 11.8, color: TEXT_MUTED, lineHeight: 1.55,
        }}>
          Competitor data ages. Open a comparison and press Search again on the Competitors screen to re-read every site and
          rebuild the table from what they say today.
        </div>
      ) : null}
    </div>
  );
}
