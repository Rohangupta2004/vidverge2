/**
 * Short Video Enhancer — export.
 *
 * One button composes the final file server-side: Remotion draws the graphics
 * layer over the base clip, mixes the music under the original audio, and the
 * render hook finishes it as a true 1080x1920 MP4. Nothing is captured from a
 * browser canvas and nothing is simulated.
 *
 * Both download options show their REAL measured byte size, taken server-side
 * after the files exist. When the share-size pass does not actually come out
 * smaller, this card says so and offers the master alone — it never advertises
 * a saving it did not make.
 */

import { Download, HardDrive, Loader2, Share2 } from 'lucide-react';
import { formatBytes } from '../lib/sveTypes';
import type { ExportSizes } from '../lib/sveApi';
import { Card, Note, ProgressBar, StageList, type StageState } from './SveControls';

export type ExportPhase = 'idle' | 'uploading' | 'submitting' | 'rendering' | 'sizing' | 'ready' | 'failed';

export interface ExportPanelProps {
  phase: ExportPhase;
  elapsedS: number;
  variants: ExportSizes | null;
  error: string;
  geometry: string;
  canExport: boolean;
  blockedReason: string;
  downloading: string;
  onExport: () => void;
  onDownload: (which: 'master' | 'compressed') => void;
}

const ORDER: ExportPhase[] = ['uploading', 'submitting', 'rendering', 'sizing', 'ready'];

function stateFor(phase: ExportPhase, step: ExportPhase): StageState {
  if (phase === 'failed') return 'failed';
  const current = ORDER.indexOf(phase);
  const index = ORDER.indexOf(step);
  if (current < 0) return 'pending';
  if (index < current) return 'done';
  if (index === current) return phase === 'ready' ? 'done' : 'active';
  return 'pending';
}

export function SveExportPanel(props: ExportPanelProps) {
  const { phase, variants } = props;
  const busy = phase !== 'idle' && phase !== 'ready' && phase !== 'failed';

  return (
    <Card title="Export" icon={<Download size={14} />}>
      {!props.canExport && props.blockedReason && <Note tone="warn">{props.blockedReason}</Note>}

      {busy && (
        <>
          <StageList
            stages={[
              { label: 'Uploading the source clip', state: stateFor(phase, 'uploading') },
              { label: 'Submitting the composition', state: stateFor(phase, 'submitting') },
              { label: 'Rendering graphics + audio mix', state: stateFor(phase, 'rendering') },
              { label: 'Measuring download sizes', state: stateFor(phase, 'sizing') },
            ]}
          />
          {/* The render service reports no percentage, only pending /
              rendering / complete, so the bar sweeps rather than lying about
              progress. The elapsed counter below is the real signal. */}
          <ProgressBar />
          <p className="sve-muted" style={{ marginBottom: 10 }}>
            {phase === 'rendering'
              ? 'Rendering runs on the server, so you can keep editing — just don’t close this tab. ' + props.elapsedS + 's elapsed.'
              : 'This takes a few seconds.'}
          </p>
        </>
      )}

      {phase === 'failed' && props.error && <Note tone="bad">{props.error}</Note>}

      {phase === 'ready' && variants && (
        <>
          <div className="sve-variant">
            <div>
              <strong>Full Quality (MP4)</strong>
              <small>{props.geometry || '1080×1920 · H.264'} · {formatBytes(variants.master.bytes)}</small>
            </div>
            <button disabled={props.downloading === 'master'} onClick={() => props.onDownload('master')}>
              {props.downloading === 'master' ? <Loader2 size={13} className="spin" /> : <HardDrive size={13} />}
              Download
            </button>
          </div>

          {variants.compressed && variants.smaller ? (
            <div className="sve-variant">
              <div>
                <strong>Compressed for Sharing</strong>
                <small>
                  {formatBytes(variants.compressed.bytes)}
                  {variants.master.bytes > 0 && variants.compressed.bytes > 0
                    ? ' · ' + Math.round((1 - variants.compressed.bytes / variants.master.bytes) * 100) + '% smaller'
                    : ''}
                </small>
              </div>
              <button disabled={props.downloading === 'compressed'} onClick={() => props.onDownload('compressed')}>
                {props.downloading === 'compressed' ? <Loader2 size={13} className="spin" /> : <Share2 size={13} />}
                Download
              </button>
            </div>
          ) : (
            <Note tone="warn">
              {variants.note || 'The share-size pass did not come out smaller than the master, so only the full-quality file is offered.'}
            </Note>
          )}

          <p className="sve-muted">
            Sizes are measured on the finished files, not estimated. If a download opens in a new tab instead of saving,
            your browser blocked the cross-origin save — use the tab’s own download control.
          </p>
        </>
      )}

      <button className="sve-export" disabled={busy || !props.canExport} onClick={props.onExport}>
        {busy ? <Loader2 size={17} className="spin" /> : <Download size={17} />}
        {busy ? 'Composing…' : phase === 'ready' ? 'Re-export with changes' : 'Export Video'}
      </button>
    </Card>
  );
}
