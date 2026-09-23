import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Loader2, Play, Search, Upload } from 'lucide-react';
import { uploadFile } from '../lib/proxy';
import { sortAvatars, sortVoices, suggestedVoices } from '../lib/heygenCatalog';
import type { HeyGenOptions } from '../hooks/useHeyGen';

const DEFAULTS: HeyGenOptions = {
  avatar_id: '', voice_id: '', resolution: '1080p', aspect_ratio: '9:16', fit: 'cover',
  background: { type: 'color', value: '#0A0F1E' }, voice_settings: { speed: 1 },
  captions: false, gestures: false, output_format: 'mp4', advanced: {},
};

type CatalogChip = 'all' | 'indian' | 'female' | 'male';

function Field(props: { label: string; children: any }) {
  return <label className="text-xs font-medium text-[var(--space-text-secondary)]">{props.label}<div className="mt-1">{props.children}</div></label>;
}
function Section(props: { title: string; children: any }) {
  return <section className="my-6 rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-5"><h2 className="mb-4 font-semibold text-[var(--space-text-primary)]">{props.title}</h2>{props.children}</section>;
}
function Badge(props: { children: any }) {
  return <span className="rounded-full bg-[color-mix(in_srgb,var(--space-text-primary)_7%,transparent)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--space-text-muted)]">{props.children}</span>;
}
function Chip(props: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" onClick={props.onClick} className={props.active ? 'rounded-full bg-[var(--space-brand-primary-600)] px-3 py-1 text-xs font-semibold text-white' : 'rounded-full border border-[var(--space-border-default)] px-3 py-1 text-xs text-[var(--space-text-secondary)] transition-colors hover:border-[var(--space-border-strong)]'}>{props.label}</button>;
}
function chipMatch(chip: CatalogChip, view: { indian: boolean; gender: string }) {
  if (chip === 'indian') return view.indian;
  if (chip === 'female') return view.gender.toLowerCase().startsWith('f');
  if (chip === 'male') return view.gender.toLowerCase().startsWith('m');
  return true;
}
function LibraryTools(props: { query: string; onQuery: (value: string) => void; chip: CatalogChip; onChip: (value: CatalogChip) => void; placeholder: string; hasIndian: boolean; hasGender: boolean }) {
  const { query, onQuery, chip, onChip, placeholder, hasIndian, hasGender } = props;
  return <div className="mb-3 flex flex-wrap items-center gap-2">
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--space-text-muted)]" />
      <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} className="input pl-9" />
    </div>
    <Chip active={chip === 'all'} label="All" onClick={() => onChip('all')} />
    {hasIndian ? <Chip active={chip === 'indian'} label="Indian" onClick={() => onChip('indian')} /> : null}
    {hasGender ? <Chip active={chip === 'female'} label="Female" onClick={() => onChip('female')} /> : null}
    {hasGender ? <Chip active={chip === 'male'} label="Male" onClick={() => onChip('male')} /> : null}
  </div>;
}
function CatalogNotice(props: { tone: 'error' | 'empty'; text: string }) {
  return props.tone === 'error'
    ? <div className="flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--space-semantic-danger-500)_35%,transparent)] bg-[color-mix(in_srgb,var(--space-semantic-danger-500)_12%,transparent)] p-4 text-sm text-[var(--space-semantic-danger)]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{props.text}</span></div>
    : <div className="rounded-xl border border-dashed border-[var(--space-border-default)] p-4 text-sm text-[var(--space-text-secondary)]">{props.text}</div>;
}
function LoadingGrid(props: { text: string; shape: 'portrait' | 'row' }) {
  return <div>
    <p className="mb-3 flex items-center gap-2 text-sm text-[var(--space-text-secondary)]"><Loader2 className="h-4 w-4 animate-spin" />{props.text}</p>
    <div className={props.shape === 'portrait' ? 'grid grid-cols-2 gap-3 md:grid-cols-4' : 'grid gap-2 sm:grid-cols-2'}>
      {Array.from({ length: props.shape === 'portrait' ? 8 : 6 }).map((_, i) => props.shape === 'portrait'
        ? <div key={i} className="animate-pulse rounded-xl border border-[var(--space-border-default)] p-2"><div className="aspect-video rounded-lg bg-[var(--space-surface-muted)]" /><div className="mt-2 h-3 w-2/3 rounded bg-[var(--space-surface-muted)]" /></div>
        : <div key={i} className="h-16 animate-pulse rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-muted)]" />)}
    </div>
  </div>;
}

export default function HeyGenModule(props: { avatars: any[]; voices: any[]; catalogLoading: boolean; catalogError: string; aspectRatio: '16:9' | '9:16'; progress: string; busy: boolean; videoUrl?: string; onGenerate: (options: HeyGenOptions) => void }) {
  const { avatars, voices, catalogLoading, catalogError, aspectRatio, progress, busy, videoUrl, onGenerate } = props;
  const [options, setOptions] = useState<HeyGenOptions>({ ...DEFAULTS, aspect_ratio: aspectRatio });
  const [advancedText, setAdvancedText] = useState('{}');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatarQuery, setAvatarQuery] = useState('');
  const [avatarChip, setAvatarChip] = useState<CatalogChip>('all');
  const [avatarLimit, setAvatarLimit] = useState(48);
  const [voiceQuery, setVoiceQuery] = useState('');
  const [voiceChip, setVoiceChip] = useState<CatalogChip>('all');
  const [voiceLimit, setVoiceLimit] = useState(30);
  const [voiceScope, setVoiceScope] = useState<'suggested' | 'all'>('suggested');
  useEffect(() => setOptions((old) => ({ ...old, aspect_ratio: aspectRatio })), [aspectRatio]);
  const patch = (value: Partial<HeyGenOptions>) => setOptions((old) => ({ ...old, ...value }));

  // Everything shown comes straight off the live catalog the hook fetched —
  // ordering puts Indian avatars and Indian-language/accent voices first.
  const avatarLibrary = useMemo(() => sortAvatars(avatars), [avatars]);
  const voiceLibrary = useMemo(() => sortVoices(voices), [voices]);
  const selectedAvatar = useMemo(() => avatarLibrary.find((view) => view.id === options.avatar_id), [avatarLibrary, options.avatar_id]);
  const suggestion = useMemo(() => suggestedVoices(selectedAvatar?.raw, voiceLibrary), [selectedAvatar, voiceLibrary]);
  const suggestedList = useMemo(() => (suggestion ? voiceLibrary.filter((view) => suggestion.ids.has(view.id)) : []), [suggestion, voiceLibrary]);

  const filteredAvatars = useMemo(() => {
    const query = avatarQuery.trim().toLowerCase();
    return avatarLibrary.filter((view) => chipMatch(avatarChip, view) && (!query || `${view.name} ${view.gender} ${view.styleLabel}`.toLowerCase().includes(query)));
  }, [avatarLibrary, avatarChip, avatarQuery]);
  const filteredVoices = useMemo(() => {
    const query = voiceQuery.trim().toLowerCase();
    const scoped = voiceScope === 'suggested' && suggestedList.length ? suggestedList : voiceLibrary;
    return scoped.filter((view) => chipMatch(voiceChip, view) && (!query || `${view.name} ${view.language} ${view.gender}`.toLowerCase().includes(query)));
  }, [voiceLibrary, suggestedList, voiceScope, voiceChip, voiceQuery]);

  useEffect(() => setAvatarLimit(48), [avatarQuery, avatarChip]);
  useEffect(() => setVoiceLimit(30), [voiceQuery, voiceChip, voiceScope]);
  // A fresh avatar pick re-opens the suggested-voices lens and, when HeyGen
  // names a compatible voice and none is chosen yet, preselects the first —
  // it never overrides a voice the user already picked.
  useEffect(() => {
    setVoiceScope('suggested');
    if (!options.avatar_id || !suggestedList.length) return;
    setOptions((old) => (old.voice_id ? old : { ...old, voice_id: suggestedList[0].id }));
  }, [options.avatar_id, suggestedList]);

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
      {catalogLoading && !avatarLibrary.length ? <LoadingGrid text="Loading the full avatar library live from HeyGen…" shape="portrait" />
        : catalogError && !avatarLibrary.length ? <CatalogNotice tone="error" text={`The HeyGen avatar list could not be loaded: ${catalogError} — reopen this step to retry, or paste an avatar look ID below.`} />
          : !avatarLibrary.length ? <CatalogNotice tone="empty" text="HeyGen returned no avatars for this account. Add avatars in HeyGen, or paste a specific avatar look ID below." />
            : <>
              <LibraryTools query={avatarQuery} onQuery={setAvatarQuery} chip={avatarChip} onChip={setAvatarChip} placeholder="Search avatars" hasIndian={avatarLibrary.some((view) => view.indian)} hasGender={avatarLibrary.some((view) => view.gender)} />
              <p className="mb-2 text-xs text-[var(--space-text-muted)]">{filteredAvatars.length} of {avatarLibrary.length} avatars · live from HeyGen · Indian avatars are listed first{catalogLoading ? ' · loading the rest…' : ''}</p>
              {filteredAvatars.length
                ? <div className="grid max-h-96 grid-cols-2 gap-3 overflow-y-auto pr-1 md:grid-cols-4">
                  {filteredAvatars.slice(0, avatarLimit).map((view, index) => {
                    const selected = options.avatar_id === view.id;
                    return <button key={view.id} type="button" onClick={() => patch({ avatar_id: view.id })} className={selected ? 'rounded-xl border-2 border-[var(--space-brand-primary-500)] bg-[color-mix(in_srgb,var(--space-brand-primary-500)_8%,transparent)] p-2 text-left' : 'rounded-xl border border-[var(--space-border-default)] p-2 text-left transition-colors hover:border-[var(--space-border-strong)]'}>
                      <div className="relative">
                        {view.image ? <img src={view.image} alt={view.name} loading={index < 8 ? 'eager' : 'lazy'} decoding="async" className="aspect-video w-full rounded-lg object-cover" /> : <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-[var(--space-surface-muted)] text-[10px] text-[var(--space-text-muted)]">No preview</div>}
                        {selected ? <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--space-brand-primary-600)] shadow"><Check className="h-3 w-3 text-white" /></span> : null}
                      </div>
                      <span className="mt-2 block truncate text-xs font-medium text-[var(--space-text-primary)]">{view.name}</span>
                      <span className="mt-1 flex flex-wrap gap-1">{view.gender ? <Badge>{view.gender}</Badge> : null}{view.styleLabel ? <Badge>{view.styleLabel}</Badge> : null}</span>
                    </button>;
                  })}
                  {filteredAvatars.length > avatarLimit ? <button type="button" onClick={() => setAvatarLimit((old) => old + 96)} className="col-span-full rounded-xl border border-dashed border-[var(--space-border-default)] py-3 text-sm text-[var(--space-text-secondary)] transition-colors hover:border-[var(--space-border-strong)]">Show more ({filteredAvatars.length - avatarLimit} remaining)</button> : null}
                </div>
                : <CatalogNotice tone="empty" text="No avatars match this search or filter." />}
            </>}
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
      {catalogLoading && !voiceLibrary.length ? <LoadingGrid text="Loading the live HeyGen voice catalog…" shape="row" />
        : catalogError && !voiceLibrary.length ? <CatalogNotice tone="error" text={`The HeyGen voice list could not be loaded: ${catalogError} — reopen this step to retry.`} />
          : !voiceLibrary.length ? <CatalogNotice tone="empty" text="HeyGen returned no voices for this account, so there is nothing to choose from yet." />
            : <>
              {suggestion && suggestedList.length ? <div className="mb-3 flex flex-wrap items-center gap-2">
                <Chip active={voiceScope === 'suggested'} label={`Suggested for ${selectedAvatar?.name || 'this avatar'} (${suggestedList.length})`} onClick={() => setVoiceScope('suggested')} />
                <Chip active={voiceScope === 'all'} label={`All voices (${voiceLibrary.length})`} onClick={() => setVoiceScope('all')} />
                <span className="text-xs text-[var(--space-text-muted)]">{suggestion.reason} You can still pick any voice.</span>
              </div> : null}
              <LibraryTools query={voiceQuery} onQuery={setVoiceQuery} chip={voiceChip} onChip={setVoiceChip} placeholder="Search voices" hasIndian={voiceLibrary.some((view) => view.indian)} hasGender={voiceLibrary.some((view) => view.gender)} />
              <p className="mb-2 text-xs text-[var(--space-text-muted)]">{filteredVoices.length} voices · live from HeyGen · Indian-accent and Indian-language voices are listed first{catalogLoading ? ' · loading the rest…' : ''}</p>
              {filteredVoices.length
                ? <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {filteredVoices.slice(0, voiceLimit).map((view) => {
                    const selected = options.voice_id === view.id;
                    return <button key={view.id} type="button" onClick={() => patch({ voice_id: view.id })} className={selected ? 'rounded-xl border-2 border-[var(--space-brand-primary-500)] bg-[color-mix(in_srgb,var(--space-brand-primary-500)_8%,transparent)] p-3 text-left' : 'rounded-xl border border-[var(--space-border-default)] p-3 text-left transition-colors hover:border-[var(--space-border-strong)]'}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-[var(--space-text-primary)]">{view.name}</span>
                        {selected ? <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--space-brand-primary-600)]"><Check className="h-3 w-3 text-white" /></span> : null}
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-1"><Badge>{view.language}</Badge>{view.gender ? <Badge>{view.gender}</Badge> : null}</span>
                    </button>;
                  })}
                  {filteredVoices.length > voiceLimit ? <button type="button" onClick={() => setVoiceLimit((old) => old + 60)} className="col-span-full rounded-xl border border-dashed border-[var(--space-border-default)] py-3 text-sm text-[var(--space-text-secondary)] transition-colors hover:border-[var(--space-border-strong)]">Show more ({filteredVoices.length - voiceLimit} remaining)</button> : null}
                </div>
                : <CatalogNotice tone="empty" text={voiceScope === 'suggested' ? 'No suggested voice matches this search — switch to All voices.' : 'No voices match this search or filter.'} />}
            </>}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
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
