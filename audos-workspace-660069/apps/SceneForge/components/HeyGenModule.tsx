import { useEffect, useState } from 'react';
import { ChevronDown, Loader2, Play, Upload } from 'lucide-react';
import { uploadFile } from '../lib/proxy';
import type { HeyGenOptions } from '../hooks/useHeyGen';

const DEFAULTS: HeyGenOptions = {
  avatar_id: '', voice_id: '', resolution: '1080p', aspect_ratio: '16:9', fit: 'cover',
  background: { type: 'color', value: '#0A0F1E' }, voice_settings: { speed: 1 },
  captions: false, gestures: false, output_format: 'mp4', advanced: {},
};

function Field(props: { label: string; children: any }) {
  return <label className="text-xs font-medium text-[var(--space-text-secondary)]">{props.label}<div className="mt-1">{props.children}</div></label>;
}
function Section(props: { title: string; children: any }) {
  return <section className="my-6 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-5"><h2 className="mb-4 font-semibold text-[var(--space-text-primary)]">{props.title}</h2>{props.children}</section>;
}

export default function HeyGenModule(props: { avatars: any[]; voices: any[]; aspectRatio: '16:9' | '9:16'; progress: string; busy: boolean; videoUrl?: string; onGenerate: (options: HeyGenOptions) => void }) {
  const { avatars, voices, aspectRatio, progress, busy, videoUrl, onGenerate } = props;
  const [options, setOptions] = useState<HeyGenOptions>({ ...DEFAULTS, aspect_ratio: aspectRatio });
  const [advancedText, setAdvancedText] = useState('{}');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [uploading, setUploading] = useState(false);
  useEffect(() => setOptions((old) => ({ ...old, aspect_ratio: aspectRatio })), [aspectRatio]);
  const patch = (value: Partial<HeyGenOptions>) => setOptions((old) => ({ ...old, ...value }));

  async function uploadBackground(file?: File) {
    if (!file) return;
    setUploading(true);
    try {
      const stored = await uploadFile(file, 'sceneforge-v2/heygen-backgrounds');
      patch({ background: { type: 'image', url: stored.url }, output_format: 'mp4' });
    } finally { setUploading(false); }
  }
  function submit() {
    try { onGenerate({ ...options, advanced: JSON.parse(advancedText || '{}') }); }
    catch { window.alert('Advanced controls must be valid JSON.'); }
  }

  return <div className="mx-auto max-w-6xl px-6 py-9">
    <p className="text-xs font-bold uppercase tracking-[.2em] text-[var(--space-text-brand)]">Step 3 · Avatar and voice</p>
    <h1 className="mt-2 text-3xl font-bold text-[var(--space-text-primary)]">Direct the presenter</h1>
    <p className="mt-2 text-[var(--space-text-secondary)]">Catalog choices come live from HeyGen v3. Additional future controls can be passed through in Advanced.</p>

    <Section title="Avatar">
      <div className="grid max-h-72 grid-cols-2 gap-3 overflow-y-auto md:grid-cols-4">
        {avatars.map((avatar) => <button key={avatar.id} onClick={() => patch({ avatar_id: avatar.id })} className={options.avatar_id === avatar.id ? 'rounded-xl border border-[var(--space-brand-primary-500)] p-2 text-left' : 'rounded-xl border border-[var(--space-border-default)] p-2 text-left'}>
          {avatar.preview_image_url || avatar.image_url ? <img src={avatar.preview_image_url || avatar.image_url} className="aspect-video w-full rounded-lg object-cover" /> : <div className="aspect-video rounded-lg bg-[var(--space-surface-muted)]" />}
          <span className="mt-2 block truncate text-xs text-[var(--space-text-secondary)]">{avatar.name || avatar.id}</span>
        </button>)}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Avatar look ID"><input value={options.avatar_id} onChange={(e) => patch({ avatar_id: e.target.value })} className="input" /></Field>
        <Field label="Pose or style"><input value={options.pose || ''} onChange={(e) => patch({ pose: e.target.value })} placeholder="normal, standing" className="input" /></Field>
        <Field label="Expression"><input value={options.expression || ''} onChange={(e) => patch({ expression: e.target.value })} placeholder="friendly, serious" className="input" /></Field>
      </div>
      <p className="mt-3 text-xs text-[var(--space-text-muted)]">For a custom photo avatar, create the look in HeyGen and paste its v3 look ID. The workspace proxy transports JSON and does not expose a multipart photo-avatar upload contract.</p>
    </Section>

    <Section title="Background">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Solid colour"><input type="color" value={options.background.value || '#0A0F1E'} onChange={(e) => patch({ background: { type: 'color', value: e.target.value }, output_format: 'mp4' })} className="h-10 w-20 rounded" /></Field>
        <label className="rounded-xl border border-[var(--space-border-default)] px-4 py-2.5 text-sm text-[var(--space-text-primary)]"><Upload className="mr-2 inline h-4 w-4" />{uploading ? 'Uploading' : 'Upload image'}<input type="file" accept="image/*" className="hidden" onChange={(e) => void uploadBackground(e.target.files?.[0])} /></label>
        <label className="flex items-center gap-2 text-sm text-[var(--space-text-secondary)]"><input type="checkbox" checked={options.output_format === 'webm'} onChange={(e) => patch({ output_format: e.target.checked ? 'webm' : 'mp4' })} /> Transparent WebM when supported</label>
      </div>
    </Section>

    <Section title="Voice">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="HeyGen or integrated voice"><select value={options.voice_id} onChange={(e) => patch({ voice_id: e.target.value })} className="input"><option value="">Choose live voice</option>{voices.map((voice) => <option key={voice.voice_id || voice.id} value={voice.voice_id || voice.id}>{voice.name || voice.display_name || voice.voice_id}</option>)}</select></Field>
        <Field label={'Speed ' + options.voice_settings.speed.toFixed(2) + 'x'}><input type="range" min={0.5} max={1.5} step={0.05} value={options.voice_settings.speed} onChange={(e) => patch({ voice_settings: { ...options.voice_settings, speed: Number(e.target.value) } })} /></Field>
        <Field label="Pitch pass-through"><input type="number" value={options.voice_settings.pitch || 0} onChange={(e) => patch({ voice_settings: { ...options.voice_settings, pitch: Number(e.target.value) } })} className="input" /></Field>
        <Field label="Emotion pass-through"><input value={options.voice_settings.emotion || ''} onChange={(e) => patch({ voice_settings: { ...options.voice_settings, emotion: e.target.value } })} className="input" /></Field>
      </div>
      <p className="mt-2 text-xs text-[var(--space-text-muted)]">ElevenLabs-linked voices appear in the live HeyGen voice catalog when configured there. SceneForge uses the selected voice ID without inventing an unsupported voice type.</p>
    </Section>

    <Section title="Output">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Resolution"><select value={options.resolution} onChange={(e) => patch({ resolution: e.target.value as any })} className="input"><option value="720p">720p</option><option value="1080p">1080p</option><option value="4k">4K eligible looks only</option></select></Field>
        <Field label="Aspect ratio"><select value={options.aspect_ratio} onChange={(e) => patch({ aspect_ratio: e.target.value as any })} className="input"><option value="16:9">16:9</option><option value="9:16">9:16</option></select></Field>
        <Field label="Framing"><select value={options.fit} onChange={(e) => patch({ fit: e.target.value as any })} className="input"><option value="cover">Fill frame</option><option value="contain">Contain</option></select></Field>
        <Field label="Camera angle"><input value={options.camera || ''} onChange={(e) => patch({ camera: e.target.value })} placeholder="Pass-through" className="input" /></Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-5 text-sm text-[var(--space-text-secondary)]">
        <label><input type="checkbox" checked={options.captions} onChange={(e) => patch({ captions: e.target.checked })} /> Captions</label>
        <label><input type="checkbox" checked={options.gestures} onChange={(e) => patch({ gestures: e.target.checked })} /> Gestures</label>
        <input value={options.gesture_style || ''} onChange={(e) => patch({ gesture_style: e.target.value })} placeholder="Gesture style" className="input max-w-44" />
      </div>
    </Section>

    <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-2 text-sm text-[var(--space-text-secondary)]"><ChevronDown className={showAdvanced ? 'h-4 w-4 rotate-180' : 'h-4 w-4'} /> Advanced pass-through JSON</button>
    {showAdvanced ? <textarea value={advancedText} onChange={(e) => setAdvancedText(e.target.value)} rows={6} className="mt-2 w-full rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-3 font-mono text-sm text-[var(--space-text-primary)]" /> : null}
    <button disabled={busy || !options.avatar_id || !options.voice_id} onClick={submit} className="mt-6 flex items-center gap-2 rounded-xl bg-[var(--space-brand-primary-600)] px-5 py-3 font-semibold text-white disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{videoUrl ? 'Regenerate avatar video' : 'Generate Avatar Video'}</button>
    {progress ? <p className="mt-2 text-sm text-[var(--space-text-brand)]">{progress}</p> : null}
    {videoUrl
      ? <video src={videoUrl} controls playsInline className={aspectRatio === '9:16' ? 'mt-5 max-h-[520px] max-w-xs rounded-2xl bg-black' : 'mt-5 w-full max-w-3xl rounded-2xl bg-black'} />
      : busy ? <div className={aspectRatio === '9:16' ? 'mt-5 flex max-h-[520px] min-h-72 max-w-xs animate-pulse items-center justify-center rounded-2xl bg-[var(--space-surface-muted)]' : 'mt-5 flex min-h-64 w-full max-w-3xl animate-pulse items-center justify-center rounded-2xl bg-[var(--space-surface-muted)]'}><span className="text-sm text-[var(--space-text-secondary)]">Avatar video rendering…</span></div>
        : null}
  </div>;
}
