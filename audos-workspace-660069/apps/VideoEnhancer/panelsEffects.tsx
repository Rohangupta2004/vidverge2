/**
 * Video Enhancer — Effects tab: quick looks, colour grading, stylistic filters,
 * motion effects, blur & focus, transitions and beat sync. Collapsible sections
 * keep the panel scannable.
 */
import { useRef, useState } from 'react';
import { Palette, SlidersHorizontal, Wand2, Gauge, Focus, ArrowLeftRight, Music2, Loader2 } from 'lucide-react';
import type { ProjectState, EditorApi } from './enhancerExtras';
import { LOOK_PRESETS, defaultProject } from './enhancerExtras';
import { Section, Slider, Toggle, Chip, ColorField, SelectField } from './uiControls';

export default function EffectsPanel({ p, api, onEstimateBpm }: {
  p: ProjectState; api: EditorApi; onEstimateBpm: () => Promise<number>;
}) {
  const [bpmBusy, setBpmBusy] = useState(false);
  const tapsRef = useRef<number[]>([]);
  const [tapCount, setTapCount] = useState(0);

  // Tap tempo: the median-free average of the recent tap intervals sets the BPM.
  const tapBeat = () => {
    const now = performance.now();
    const taps = tapsRef.current.filter((t) => now - t < 4000);
    taps.push(now);
    tapsRef.current = taps;
    setTapCount(taps.length);
    if (taps.length >= 3) {
      const gaps = taps.slice(1).map((t, i) => t - taps[i]);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const bpm = Math.max(40, Math.min(220, Math.round(60000 / avg)));
      api.commit((s) => ({ ...s, beat: { ...s.beat, bpm } }));
    }
  };

  const grade = (key: keyof ProjectState['grade']) => (v: number) =>
    api.silent((s) => ({ ...s, grade: { ...s.grade, [key]: v } }));
  const styleFlag = (key: 'cinematic' | 'vintage' | 'neon' | 'bw' | 'grain' | 'punchIn') => (v: boolean) =>
    api.commit((s) => ({ ...s, style: { ...s.style, [key]: v } }));

  const estimate = async () => {
    if (bpmBusy) return;
    setBpmBusy(true);
    try {
      const bpm = await onEstimateBpm();
      if (bpm > 0) {
        api.commit((s) => ({ ...s, beat: { ...s.beat, bpm } }));
        api.toast('Estimated tempo: ' + bpm + ' BPM');
      } else {
        api.toast('Could not detect a clear tempo — set the BPM manually.');
      }
    } catch {
      api.toast('Could not analyze the audio — set the BPM manually.');
    }
    setBpmBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      <Section title="Quick looks" icon={<Wand2 size={14} style={{ color: 'var(--space-text-brand)' }} />} defaultOpen>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {LOOK_PRESETS.map((l) => (
            <Chip key={l.id} active={false} title={l.hint} onClick={() => { api.commit(l.apply); api.toast(l.label + ' look applied'); }}>
              {l.label}
            </Chip>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginTop: 8 }}>One-tap starting points — fine-tune everything below.</div>
      </Section>

      <Section title="Color grading" icon={<SlidersHorizontal size={14} style={{ color: 'var(--space-text-brand)' }} />} defaultOpen
        right={<button onClick={() => api.commit((s) => ({ ...s, grade: defaultProject().grade }))} className="ve-btn" style={{ fontSize: 11, fontWeight: 600, color: 'var(--space-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Reset</button>}
      >
        <Slider label="Brightness" value={p.grade.brightness} min={20} max={200} unit="%" onBegin={api.checkpoint} onChange={grade('brightness')} />
        <Slider label="Contrast" value={p.grade.contrast} min={20} max={200} unit="%" onBegin={api.checkpoint} onChange={grade('contrast')} />
        <Slider label="Saturation" value={p.grade.saturation} min={0} max={200} unit="%" onBegin={api.checkpoint} onChange={grade('saturation')} />
        <Slider label="Hue shift" value={p.grade.hue} min={-180} max={180} unit="°" onBegin={api.checkpoint} onChange={grade('hue')} />
        <Slider label="Temperature" value={p.grade.temperature} min={-100} max={100} onBegin={api.checkpoint} onChange={grade('temperature')} format={(v) => v > 0 ? '+' + v + ' warm' : v < 0 ? v + ' cool' : '0'} />
        <Slider label="Tint" value={p.grade.tint} min={-100} max={100} onBegin={api.checkpoint} onChange={grade('tint')} format={(v) => v > 0 ? '+' + v + ' magenta' : v < 0 ? v + ' green' : '0'} />
      </Section>

      <Section title="Stylistic filters" icon={<Palette size={14} style={{ color: 'var(--space-text-brand)' }} />}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
          <Toggle on={p.style.cinematic} onChange={styleFlag('cinematic')} label="Cinematic (letterbox + matte)" />
          <Toggle on={p.style.vintage} onChange={styleFlag('vintage')} label="Vintage film" />
          <Toggle on={p.style.neon} onChange={styleFlag('neon')} label="Neon glow" />
          <Toggle on={p.style.bw} onChange={styleFlag('bw')} label="Black & white" />
          <Toggle on={p.style.grain} onChange={styleFlag('grain')} label="Film grain" />
          <Toggle on={p.style.punchIn} onChange={styleFlag('punchIn')} label="Slow punch-in" />
        </div>
        {p.style.grain && (
          <Slider label="Grain intensity" value={p.style.grainAmount} min={0} max={100} unit="%" onBegin={api.checkpoint} onChange={(v) => api.silent((s) => ({ ...s, style: { ...s.style, grainAmount: v } }))} />
        )}
        {p.style.neon && (
          <Slider label="Neon glow intensity" value={p.style.neonAmount} min={0} max={100} unit="%" onBegin={api.checkpoint} onChange={(v) => api.silent((s) => ({ ...s, style: { ...s.style, neonAmount: v } }))} />
        )}

        <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--space-border-default)' }}>
          <Toggle on={p.style.duotone.on} onChange={(v) => api.commit((s) => ({ ...s, style: { ...s.style, duotone: { ...s.style.duotone, on: v } } }))} label="Duotone" />
          {p.style.duotone.on && (
            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              <ColorField label="Shadows" value={p.style.duotone.dark} onBegin={api.checkpoint} onChange={(v) => api.silent((s) => ({ ...s, style: { ...s.style, duotone: { ...s.style.duotone, dark: v } } }))} />
              <ColorField label="Highlights" value={p.style.duotone.light} onBegin={api.checkpoint} onChange={(v) => api.silent((s) => ({ ...s, style: { ...s.style, duotone: { ...s.style.duotone, light: v } } }))} />
            </div>
          )}
        </div>

        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--space-border-default)' }}>
          <Toggle on={p.style.vignette.on} onChange={(v) => api.commit((s) => ({ ...s, style: { ...s.style, vignette: { ...s.style.vignette, on: v } } }))} label="Vignette" />
          {p.style.vignette.on && (
            <>
              <Slider label="Intensity" value={p.style.vignette.intensity} min={5} max={100} unit="%" onBegin={api.checkpoint} onChange={(v) => api.silent((s) => ({ ...s, style: { ...s.style, vignette: { ...s.style.vignette, intensity: v } } }))} />
              <Slider label="Radius" value={p.style.vignette.radius} min={20} max={90} unit="%" onBegin={api.checkpoint} onChange={(v) => api.silent((s) => ({ ...s, style: { ...s.style, vignette: { ...s.style.vignette, radius: v } } }))} />
            </>
          )}
        </div>
      </Section>

      <Section title="Motion" icon={<Gauge size={14} style={{ color: 'var(--space-text-brand)' }} />}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--space-text-secondary)', marginTop: 6 }}>Speed</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {[0.25, 0.5, 0.75, 1].map((sp) => (
            <Chip key={sp} active={p.motion.speed === sp} onClick={() => api.commit((s) => ({ ...s, motion: { ...s.motion, speed: sp } }))}>
              {sp === 1 ? 'Normal' : sp + 'x'}
            </Chip>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <SelectField label="Speed ramp (preview)" value={p.motion.ramp} options={[{ id: 'none', label: 'None' }, { id: 'in', label: 'Ease in (slow → fast)' }, { id: 'out', label: 'Ease out (fast → slow)' }]}
            onChange={(v) => api.commit((s) => ({ ...s, motion: { ...s.motion, ramp: v as any } }))} />
          <Toggle on={p.motion.reverse} onChange={(v) => api.commit((s) => ({ ...s, motion: { ...s.motion, reverse: v } }))} label="Reverse clip (preview)" />
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginTop: 8 }}>
          Speed is baked into the export. Speed ramp and reverse are live-preview approximations — the export currently uses the constant speed.
        </div>
      </Section>

      <Section title="Blur & focus" icon={<Focus size={14} style={{ color: 'var(--space-text-brand)' }} />}>
        <Slider label="Gaussian blur" value={p.blur.gaussian} min={0} max={20} unit="px" onBegin={api.checkpoint} onChange={(v) => api.silent((s) => ({ ...s, blur: { ...s.blur, gaussian: v } }))} />
        <Slider label="Radial blur (sharp center)" value={p.blur.radial} min={0} max={24} unit="px" onBegin={api.checkpoint} onChange={(v) => api.silent((s) => ({ ...s, blur: { ...s.blur, radial: v } }))} />
        <Slider label="Background blur (portrait)" value={p.blur.background} min={0} max={24} unit="px" onBegin={api.checkpoint} onChange={(v) => api.silent((s) => ({ ...s, blur: { ...s.blur, background: v } }))} />
        <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginTop: 8 }}>Radial and background blur keep the subject area sharp and soften the edges.</div>
      </Section>

      <Section title="Transitions" icon={<ArrowLeftRight size={14} style={{ color: 'var(--space-text-brand)' }} />}>
        <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
          <SelectField label="Intro" value={p.transition.tin} options={[{ id: 'none', label: 'None' }, { id: 'fade', label: 'Fade in' }, { id: 'zoom', label: 'Zoom in' }, { id: 'slide', label: 'Slide in' }]}
            onChange={(v) => api.commit((s) => ({ ...s, transition: { ...s.transition, tin: v as any } }))} />
          <SelectField label="Outro" value={p.transition.tout} options={[{ id: 'none', label: 'None' }, { id: 'fade', label: 'Fade out' }, { id: 'zoom', label: 'Zoom out' }, { id: 'slide', label: 'Slide out' }]}
            onChange={(v) => api.commit((s) => ({ ...s, transition: { ...s.transition, tout: v as any } }))} />
        </div>
        <div style={{ marginTop: 10 }}>
          <SelectField label="Between clips (at silence cuts)" value={p.transition.cutStyle} options={[{ id: 'cut', label: 'Cut · hard' }, { id: 'fade', label: 'Fade' }, { id: 'dissolve', label: 'Dissolve' }, { id: 'slide', label: 'Slide' }]}
            onChange={(v) => api.commit((s) => ({ ...s, transition: { ...s.transition, cutStyle: v as any } }))} />
        </div>
      </Section>

      <Section title="Beat sync" icon={<Music2 size={14} style={{ color: 'var(--space-text-brand)' }} />}
        right={<Toggle on={p.beat.on} onChange={(v) => api.commit((s) => ({ ...s, beat: { ...s.beat, on: v } }))} label="" />}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--space-text-secondary)' }}>
            BPM
            <input type="number" min={40} max={220} value={p.beat.bpm}
              onChange={(e) => api.commit((s) => ({ ...s, beat: { ...s.beat, bpm: Math.max(40, Math.min(220, Number(e.target.value) || 120)) } }))}
              className="ve-input" style={{ width: 70, fontSize: 12, background: 'var(--space-surface-card)', border: '1px solid var(--space-border-default)', borderRadius: 6, padding: '4px 6px', color: 'var(--space-text-primary)' }} />
          </label>
          <button onClick={estimate} disabled={bpmBusy} className="ve-btn" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--space-text-brand)', background: 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)', border: '1px solid var(--space-border-default)', borderRadius: 8, padding: '6px 10px', cursor: bpmBusy ? 'wait' : 'pointer' }}>
            {bpmBusy ? <Loader2 size={13} className="animate-spin" /> : <Music2 size={13} />} Estimate from audio
          </button>
          <button onClick={tapBeat} className="ve-btn" title="Tap along with the music — 3+ taps set the BPM" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--space-text-brand)', background: 'color-mix(in srgb, var(--space-brand-primary-500) 12%, transparent)', border: '1px solid var(--space-border-default)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
            Tap tempo{tapCount > 0 && tapCount < 3 ? ' (' + tapCount + ')' : ''}
          </button>
        </div>
        <Slider label="Flash intensity" value={p.beat.intensity} min={5} max={100} unit="%" onBegin={api.checkpoint} onChange={(v) => api.silent((s) => ({ ...s, beat: { ...s.beat, intensity: v } }))} />
        <div style={{ marginTop: 10 }}>
          <Toggle on={p.beat.snapCuts} onChange={(v) => api.commit((s) => ({ ...s, beat: { ...s.beat, snapCuts: v } }))} label="Snap silence cuts to the beat grid" />
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--space-text-muted)', marginTop: 8 }}>Pulses a quick brightness flash on every beat while the video plays (preview effect). Snapping nudges each silence cut inward to the nearest beat so edits land on the music.</div>
      </Section>

    </div>
  );
}
