/**
 * Short Video Enhancer — the SOUND DESIGN and BEAT SYNC surfaces.
 *
 *   SoundPanel  the SFX library, plus the auto-alignment plan as a tick list
 *   BeatPanel   the music's measured grid, the sync switches and the snap passes
 *
 * Both follow the same contract as the pacing and insert panels: a proposal is
 * never an edit. The alignment plan sits beside the project until it is added,
 * and a snap only ever moves layers the creator has not locked. Everything
 * either one writes is an ordinary audio or motion layer afterwards — draggable
 * on the timeline, with its own volume and fades.
 */

import {
  Activity, Check, ChevronDown, Loader2, Music, RefreshCw, Volume2, Waves,
} from 'lucide-react';
import { formatTime, type BeatState, type Project } from '../lib/model';
import { SFX_LIBRARY, sfxSpec, type SfxId, type SoundPlan } from '../lib/sfx';
import { Btn, Empty, MONO, P, Panel, Pill, SectionHeader } from './controls';

const ANCHOR_COLOR: Record<string, string> = {
  transition: P.trans,
  textAnimation: P.caption,
  graphicEntry: P.gfxFg,
  hook: P.accent,
  beat: P.audio,
  manual: P.muted,
};

export function SoundPanel({
  plan, busy, note, onPlan, onToggle, onSetAll, onApply, onAddSfx, onSeek, onClose,
}: {
  plan: SoundPlan | null;
  busy: boolean;
  note: string;
  onPlan: () => void;
  onToggle: (id: string) => void;
  onSetAll: (enabled: boolean) => void;
  onApply: () => void;
  onAddSfx: (id: SfxId) => void;
  onSeek: (s: number) => void;
  onClose: () => void;
}) {
  const pending = plan ? plan.placements.filter((p) => p.enabled) : [];

  return (
    <Panel style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <SectionHeader
        icon={<Volume2 size={12} />}
        label="Sound design"
        color={P.audio}
        right={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Pill color={pending.length ? P.accent : P.muted}>{pending.length} to add</Pill>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: P.sub, cursor: 'pointer', display: 'flex' }}>
              <ChevronDown size={14} />
            </button>
          </span>
        }
      />

      <div style={{ padding: '9px 10px', borderBottom: '1px solid ' + P.border }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.9, color: P.muted, textTransform: 'uppercase', marginBottom: 7 }}>
          SFX library — click to drop one at the playhead
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SFX_LIBRARY.map((s) => (
            <Btn key={s.id} onClick={() => onAddSfx(s.id)} title={s.blurb + ' (' + s.duration.toFixed(2) + 's)'}>
              <Waves size={11} /> {s.label}
            </Btn>
          ))}
        </div>
        <div style={{ fontSize: 10.5, color: P.muted, lineHeight: 1.5, marginTop: 7 }}>
          Each effect is rendered once and stored in your workspace, so the export hears exactly what the preview does.
          Drag any clip along the AUDIO SFX track to move it, and set its volume and fades in Properties.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, padding: '9px 10px', borderBottom: '1px solid ' + P.border, flexWrap: 'wrap', alignItems: 'center' }}>
        <Btn onClick={onPlan} disabled={busy}>
          {busy ? <Loader2 size={12} /> : <RefreshCw size={12} />} {plan ? 'Re-align' : 'Auto-align SFX'}
        </Btn>
        {plan && plan.placements.length ? (
          <>
            <Btn onClick={() => onSetAll(true)}>Tick all</Btn>
            <Btn onClick={() => onSetAll(false)}>Untick all</Btn>
            <div style={{ flex: 1 }} />
            <Btn tone="primary" onClick={onApply} disabled={busy || !pending.length}>
              <Check size={12} /> Add {pending.length || ''}
            </Btn>
          </>
        ) : null}
      </div>

      {note || (plan && plan.note) ? (
        <div style={{ padding: '8px 11px', fontSize: 11, color: P.sub, lineHeight: 1.5, borderBottom: '1px solid ' + P.border }}>
          {note || (plan ? plan.note : '')}
        </div>
      ) : null}

      <div style={{ overflowY: 'auto', minHeight: 0, padding: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {plan && plan.placements.length ? plan.placements.map((item) => {
          const colour = ANCHOR_COLOR[item.anchor] || P.audio;
          return (
            <div key={item.id} style={{
              display: 'flex', gap: 9, padding: 9, borderRadius: 10,
              background: P.card, border: '1px solid ' + P.border,
              opacity: item.enabled ? 1 : 0.5,
            }}>
              <input type="checkbox" checked={item.enabled} onChange={() => onToggle(item.id)}
                style={{ marginTop: 2, accentColor: 'var(--space-brand-primary-500, #F59E0B)' }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: colour, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: P.text }}>{sfxSpec(item.sfxId).label}</span>
                  <button onClick={() => onSeek(item.at)} title="Jump the playhead here"
                    style={{ background: P.panelSoft, border: '1px solid ' + P.border, borderRadius: 6, color: P.sub, fontSize: 10, fontFamily: MONO, padding: '2px 5px', cursor: 'pointer' }}>
                    {formatTime(item.at)}
                  </button>
                  {item.onBeat ? <Pill color={P.audio}>on beat</Pill> : null}
                </div>
                <div style={{ fontSize: 11.5, color: P.sub, lineHeight: 1.5 }}>{item.note}</div>
              </div>
            </div>
          );
        }) : (
          <Empty>
            No alignment plan yet. Auto-align reads the compiled timeline and proposes a sound for every transition, every
            emphasised caption word and every graphic entry — the three moments that carry a short-form edit. You decide
            which ones land.
          </Empty>
        )}
      </div>
    </Panel>
  );
}

export function BeatPanel({
  project, busy, onDetect, onPatch, onSnap, onSeek, onClose,
}: {
  project: Project;
  busy: boolean;
  onDetect: () => void;
  onPatch: (patch: Partial<BeatState>) => void;
  onSnap: (what: 'transitions' | 'graphics' | 'captions' | 'sfx' | 'all') => void;
  onSeek: (s: number) => void;
  onClose: () => void;
}) {
  const beats = project.beats;
  const hasMusic = !!(project.audio.music && project.audio.music.url);
  const synced = project.transitions.filter((t) => t.syncToBeat).length;

  return (
    <Panel style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <SectionHeader
        icon={<Activity size={12} />}
        label="Beat sync"
        color={P.audio}
        right={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {beats.times.length ? <Pill color={P.audio}>{beats.bpm.toFixed(0)} BPM · {beats.times.length} beats</Pill> : null}
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: P.sub, cursor: 'pointer', display: 'flex' }}>
              <ChevronDown size={14} />
            </button>
          </span>
        }
      />

      <div style={{ display: 'flex', gap: 6, padding: '9px 10px', borderBottom: '1px solid ' + P.border, flexWrap: 'wrap', alignItems: 'center' }}>
        <Btn onClick={onDetect} disabled={busy || !hasMusic}>
          {busy ? <Loader2 size={12} /> : <Music size={12} />} {beats.times.length ? 'Re-analyse the music' : 'Analyse the music'}
        </Btn>
        {beats.times.length ? (
          <>
            <Btn tone={beats.syncEnabled ? 'soft' : 'ghost'} onClick={() => onPatch({ syncEnabled: !beats.syncEnabled })}
              title="Snap every unlocked layer, rather than only the transitions marked Sync to beats">
              Sync to beats: {beats.syncEnabled ? 'on' : 'off'}
            </Btn>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: P.muted }}>
              tolerance
              <input type="number" min={0.04} max={0.5} step={0.01} value={beats.tolerance}
                onChange={(e) => onPatch({ tolerance: Number(e.target.value) })}
                style={{ width: 62, background: P.card, border: '1px solid ' + P.border, borderRadius: 7, color: P.text, fontSize: 11, fontFamily: MONO, padding: '4px 6px' }} />
              s
            </span>
          </>
        ) : null}
      </div>

      <div style={{ padding: '8px 11px', fontSize: 11, color: P.sub, lineHeight: 1.5, borderBottom: '1px solid ' + P.border }}>
        {!hasMusic
          ? 'No music bed on this project, so there is no tempo to read — transitions, graphics and captions keep their own timing. Add a music track from the toolbar to measure a grid.'
          : beats.note || 'Analyse the music to measure its tempo and lay beat markers on the timeline.'}
      </div>

      {beats.times.length ? (
        <div style={{ display: 'flex', gap: 6, padding: '9px 10px', borderBottom: '1px solid ' + P.border, flexWrap: 'wrap', alignItems: 'center' }}>
          <Btn onClick={() => onSnap('transitions')} title="Re-trim the clip before each synced cut so the cut lands on a beat">Snap cuts</Btn>
          <Btn onClick={() => onSnap('graphics')} title="Move every unlocked graphic entry onto the nearest beat">Snap graphics</Btn>
          <Btn onClick={() => onSnap('captions')} title="Move every unlocked caption cue onto the nearest beat">Snap text pops</Btn>
          <Btn onClick={() => onSnap('sfx')} title="Move every unlocked sound effect onto the nearest beat">Snap SFX</Btn>
          <div style={{ flex: 1 }} />
          <Btn tone="primary" onClick={() => onSnap('all')}><Check size={12} /> Snap everything</Btn>
        </div>
      ) : null}

      <div style={{ overflowY: 'auto', minHeight: 0, padding: 9 }}>
        {beats.times.length ? (
          <>
            <div style={{ fontSize: 10.5, color: P.muted, lineHeight: 1.5, marginBottom: 8 }}>
              {synced
                ? synced + ' transition(s) are individually marked Sync to beats — Snap cuts moves those. Turning the master switch on above snaps every unlocked cut instead.'
                : 'No transition is individually marked Sync to beats yet. Mark one in Properties, or turn the master switch on above to snap every unlocked cut.'}
              {' '}Snapping a cut re-trims the clip in front of it, which is the only way a cut can move; a cut that would lose
              the spare footage its transition runs on is left alone and reported.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {beats.times.slice(0, 96).map((t, i) => (
                <button key={'b' + i} onClick={() => onSeek(t)} title="Jump the playhead to this beat"
                  style={{
                    background: P.panelSoft, border: '1px solid ' + P.border, borderRadius: 6,
                    color: i % 4 === 0 ? P.audio : P.muted, fontWeight: i % 4 === 0 ? 800 : 500,
                    fontSize: 10, fontFamily: MONO, padding: '2px 5px', cursor: 'pointer',
                  }}>{t.toFixed(2)}</button>
              ))}
              {beats.times.length > 96 ? (
                <span style={{ fontSize: 10, color: P.muted, alignSelf: 'center' }}>+{beats.times.length - 96} more</span>
              ) : null}
            </div>
          </>
        ) : (
          <Empty>
            No beat grid yet. The analysis measures the music’s energy flux, finds the tempo between 60 and 180 BPM, and lays
            a grid that follows the onsets — then transitions, graphic entries, text pops and sound effects can all be pulled
            onto it. Without music nothing changes: every layer keeps the timing it already has.
          </Empty>
        )}
      </div>
    </Panel>
  );
}
