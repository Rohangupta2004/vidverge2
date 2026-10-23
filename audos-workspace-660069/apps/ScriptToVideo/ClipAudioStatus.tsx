import { useEffect, useRef, useState, type CSSProperties, type VideoHTMLAttributes } from 'react';
import { AlertTriangle, RefreshCw, Volume2, VolumeX } from 'lucide-react';
import { T } from './api';
import { probeClipAudio, type ClipAudioProbe } from './pipeline/capture';
import { resolveVideoModel } from './pipeline/videoModelService';

export type ClipAudioProbeState =
  | { phase: 'idle' | 'probing' }
  | { phase: 'ready'; result: ClipAudioProbe }
  | { phase: 'error'; error: string };

export default function ProbedVideo(props: {
  src: string;
  modelId?: string | null;
  audioEnabled?: boolean;
  videoProps?: Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src' | 'onLoadedMetadata'>;
  containerStyle?: CSSProperties;
  onMetadata?: (video: HTMLVideoElement) => void;
  onProbe?: (result: ClipAudioProbe) => void;
  onRetrySilent?: () => void;
  onGenerateCharacterDialogue?: () => void;
  dialogueBusy?: boolean;
  scope?: 'clip' | 'final';
  capabilityKnown?: boolean;
}) {
  const {
    src, modelId, audioEnabled = true, videoProps, containerStyle,
    onMetadata, onProbe, onRetrySilent, onGenerateCharacterDialogue, dialogueBusy,
    scope = 'clip', capabilityKnown = true,
  } = props;
  const model = resolveVideoModel(modelId);
  const [state, setState] = useState<ClipAudioProbeState>({ phase: 'idle' });
  const probeRun = useRef(0);

  useEffect(() => {
    probeRun.current += 1;
    setState({ phase: 'idle' });
  }, [src]);

  const inspect = async (video: HTMLVideoElement) => {
    onMetadata?.(video);
    const run = ++probeRun.current;
    setState({ phase: 'probing' });
    try {
      const result = await probeClipAudio(src);
      if (run !== probeRun.current) return;
      setState({ phase: 'ready', result });
      onProbe?.(result);
    } catch (error: any) {
      if (run !== probeRun.current) return;
      setState({ phase: 'error', error: String(error?.message || error) });
    }
  };

  const result = state.phase === 'ready' ? state.result : null;
  const knownSilentModel = capabilityKnown && model.audioSupported !== true;
  const measuredSilent = result ? !result.audible : false;
  const expectedButSilent = capabilityKnown && audioEnabled && model.audioSupported === true && measuredSilent;
  const silentModelClip = audioEnabled && knownSilentModel && (state.phase === 'ready' ? measuredSilent : state.phase === 'error');
  const badgeColor = result?.audible ? T.done : state.phase === 'probing' || state.phase === 'idle' ? T.live : T.fault;
  const badgeText = result?.audible
    ? `Sound on · ${result.rmsDb.toFixed(1)} dB mean`
    : !audioEnabled
      ? 'Silent clip — audio is off'
      : silentModelClip
        ? `Silent clip — ${model.label} does not generate sound`
        : expectedButSilent
          ? 'Silent clip — sound was requested but not returned'
          : measuredSilent
            ? 'Silent clip — no audible audio detected'
            : state.phase === 'error'
              ? 'Sound check unavailable'
              : 'Checking sound…';

  return (
    <div style={{ minWidth: 0, ...(scope === 'final' ? { position: 'relative' as const } : {}), ...containerStyle }}> 
      <video
        {...videoProps}
        src={src}
        onLoadedMetadata={(event) => { void inspect(event.currentTarget); }}
      />
      <div
        role="status"
        aria-live="polite"
        title={result ? `${result.channels} channel(s) · ${result.sampleRate} Hz · peak ${result.peakDb.toFixed(1)} dBFS` : state.phase === 'error' ? state.error : undefined}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: badgeColor, border: `1px solid ${badgeColor}`, borderRadius: 6, padding: '4px 8px', marginTop: scope === 'final' ? 0 : 7, fontSize: 10.5, fontWeight: 800, ...(scope === 'final' ? { position: 'absolute' as const, left: 10, bottom: 10, zIndex: 2, background: T.canvas } : {}) }}
      >
        {result?.audible ? <Volume2 size={12} /> : <VolumeX size={12} />}{badgeText}
      </div>
      {expectedButSilent ? (
        <div style={{ marginTop: 8, color: T.fault, background: 'color-mix(in srgb, var(--space-semantic-danger-500) 9%, var(--space-surface-bg))', border: `1px solid ${T.fault}`, borderRadius: 8, padding: '9px 10px', fontSize: 11.5, lineHeight: 1.5, ...(scope === 'final' ? { position: 'absolute' as const, left: 10, right: 10, bottom: 46, zIndex: 3 } : {}) }}>
          <AlertTriangle size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 5 }} />
          Sound was requested from {model.label}, but this file measured silent{result ? ` (${Number.isFinite(result.rmsDb) ? result.rmsDb.toFixed(1) : '-∞'} dB mean)` : ''}. {scope === 'final' ? 'Re-run Final Assembly; every completed scene stays untouched.' : 'Retry this scene only; every other completed scene stays untouched.'}
          {onRetrySilent ? <button type="button" disabled={dialogueBusy} onClick={onRetrySilent} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, minHeight: 38, background: T.live, color: '#1B1308', border: 'none', borderRadius: 8, padding: '7px 11px', fontSize: 11.5, fontWeight: 800, cursor: dialogueBusy ? 'default' : 'pointer' }}><RefreshCw size={12} /> {scope === 'final' ? 'Re-run Final Assembly' : 'Retry this scene only'}</button> : null}
        </div>
      ) : null}
      {silentModelClip && onGenerateCharacterDialogue ? (
        <div style={{ marginTop: 8, color: T.muted, background: T.canvas, border: `1px solid ${T.dim}`, borderRadius: 8, padding: '9px 10px', fontSize: 11.5, lineHeight: 1.5 }}>
          This dialogue scene came from a silent model. You can add only this character’s stored ElevenLabs voice during Final Assembly; no video scene will be regenerated.
          <button type="button" disabled={dialogueBusy} onClick={onGenerateCharacterDialogue} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, minHeight: 38, background: T.live, color: '#1B1308', border: 'none', borderRadius: 8, padding: '7px 11px', fontSize: 11.5, fontWeight: 800, cursor: dialogueBusy ? 'default' : 'pointer' }}><Volume2 size={12} /> {dialogueBusy ? 'Generating this voice…' : 'Add this line with ElevenLabs'}</button>
        </div>
      ) : null}
    </div>
  );
}
