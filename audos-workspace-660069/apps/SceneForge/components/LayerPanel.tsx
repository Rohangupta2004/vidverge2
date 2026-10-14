// The editor's right-hand sidebar: the layer stack plus the inspector for
// whichever layer is selected. Every control writes straight into the edit
// manifest — there is no hidden second copy of the timeline.
import { AlignCenter, AlignLeft, AlignRight, Clapperboard, Download, Image as ImageIcon, Layers, Loader2, Music, Plus, Sparkles, Subtitles, Trash2, Type, Upload, Wand2 } from 'lucide-react';
import { MOTION_PRESETS, defaultCinematicSpec, isCinematicLayerId, presetOf, type CinematicSpec, type MotionPresetId } from '../lib/motionPresets';
import {
  ANIMATIONS,
  FONTS,
  type Anim,
  type BrandKind,
  type BrandLayer,
  type CaptionStyle,
  type CardLayer,
  type ColorGrade,
  type EditManifest,
  type ImageLayer,
  type MusicLayer,
  type Pacing,
  type TextKind,
  type TextLayer,
} from '../lib/motionEditor';
import { cardSummary, templateOf } from '../lib/hyperFrames';

function Row(props: { label: string; children: any; hint?: string }) {
  return <label className="block">
    <span className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--space-text-muted)]">{props.label}</span>
    <span className="mt-1 block">{props.children}</span>
    {props.hint ? <span className="mt-1 block text-[10px] leading-relaxed text-[var(--space-text-muted)]">{props.hint}</span> : null}
  </label>;
}

function Group(props: { title: string; icon?: any; children: any; action?: any }) {
  const Icon = props.icon;
  return <section className="rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-3">
    <div className="mb-2 flex items-center gap-2">
      {Icon ? <Icon className="h-3.5 w-3.5 text-[#C8920A]" /> : null}
      <h3 className="text-[11px] font-bold uppercase tracking-[.14em] text-[var(--space-text-muted)]">{props.title}</h3>
      <span className="ml-auto">{props.action}</span>
    </div>
    {props.children}
  </section>;
}

function AddButton(props: { label: string; icon: any; onClick: () => void; disabled?: boolean }) {
  const Icon = props.icon;
  return <button type="button" onClick={props.onClick} disabled={props.disabled}
    className="flex items-center gap-1.5 rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] px-2.5 py-2 text-[11px] font-semibold text-[var(--space-text-secondary)] transition-colors hover:border-[#C8920A] hover:text-[var(--space-text-primary)] disabled:opacity-40">
    <Icon className="h-3.5 w-3.5" />{props.label}
  </button>;
}

function StackRow(props: { label: string; meta: string; selected: boolean; hidden?: boolean; onSelect: () => void; onDelete?: () => void; tint: string }) {
  return <div className={props.selected
    ? 'flex items-center gap-2 rounded-lg border border-[#C8920A] bg-[color-mix(in_srgb,#C8920A_14%,transparent)] px-2 py-1.5'
    : 'flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 hover:bg-[color-mix(in_srgb,#B4780A_8%,transparent)]'}>
    <span className="h-5 w-1.5 shrink-0 rounded-full" style={{ background: props.tint }} />
    <button type="button" onClick={props.onSelect} className="min-w-0 flex-1 text-left">
      <span className={props.hidden ? 'block truncate text-xs text-[var(--space-text-muted)] line-through' : 'block truncate text-xs font-medium text-[var(--space-text-primary)]'}>{props.label}</span>
      <span className="block truncate text-[10px] text-[var(--space-text-muted)]">{props.meta}</span>
    </button>
    {props.onDelete ? <button type="button" onClick={props.onDelete} aria-label={`Delete ${props.label}`} className="shrink-0 rounded p-1 text-[var(--space-text-muted)] hover:bg-[color-mix(in_srgb,#991B1B_12%,transparent)] hover:text-[var(--space-semantic-danger)]"><Trash2 className="h-3 w-3" /></button> : null}
  </div>;
}

export const TRACK_TINTS = {
  base: '#7A6030',
  text: '#C8920A',
  brand: '#B4720A',
  image: '#1D4ED8',
  card: '#8A5A00',
  caption: '#166534',
  music: '#BE185D',
};

export default function LayerPanel(props: {
  manifest: EditManifest;
  duration: number;
  captionCount: number;
  selectedId: string;
  playhead: number;
  busy: { copy: boolean; music: boolean; captions: boolean };
  notes: { copy: string; music: string; captions: string };
  onSelect: (id: string) => void;
  onAddText: (kind: TextKind) => void;
  onAddBrand: (kind: BrandKind) => void;
  onAddImage: () => void;
  onAddCard: () => void;
  onEditCard: (id: string) => void;
  onPatchText: (id: string, patch: Partial<TextLayer>) => void;
  onPatchBrand: (id: string, patch: Partial<BrandLayer>) => void;
  onPatchImage: (id: string, patch: Partial<ImageLayer>) => void;
  onPatchCard: (id: string, patch: Partial<CardLayer>) => void;
  onPatchMusic: (patch: Partial<MusicLayer>) => void;
  onPatchCaptions: (patch: Partial<CaptionStyle>) => void;
  onPatchDirectives: (patch: { colorGrade?: ColorGrade; pacing?: Pacing }) => void;
  onRemove: (id: string) => void;
  onSuggestCopy: () => void;
  onGenerateMusic: () => void;
  onUploadMusic: (file: File) => void;
  onGenerateCaptions: () => void;
  onOpenCaptions: () => void;
  onUploadLogo: (id: string, file: File) => void;
  cinematic: CinematicSpec;
  onPatchCinematic: (patch: Partial<CinematicSpec>) => void;
  onChoosePreset: (id: MotionPresetId) => void;
  onDownloadSpec: () => void;
}) {
  const { manifest, duration, captionCount, selectedId, playhead, busy, notes } = props;
  const text = manifest.text.find((layer) => layer.id === selectedId);
  const brand = manifest.brand.find((layer) => layer.id === selectedId);
  const image = manifest.images.find((layer) => layer.id === selectedId);
  const card = manifest.cards.find((layer) => layer.id === selectedId);

  const timing = (start: number, dur: number, patch: (value: { start?: number; duration?: number }) => void) => <div className="grid grid-cols-2 gap-2">
    <Row label="Start (s)">
      <input type="number" min={0} max={Math.max(0, duration)} step={0.1} value={Math.round(start * 100) / 100}
        onChange={(event) => patch({ start: Math.max(0, Math.min(duration, Number(event.target.value) || 0)) })} className="sf-input" />
    </Row>
    <Row label="Duration (s)">
      <input type="number" min={0.2} max={Math.max(0.2, duration)} step={0.1} value={Math.round(dur * 100) / 100}
        onChange={(event) => patch({ duration: Math.max(0.2, Number(event.target.value) || 0.2) })} className="sf-input" />
    </Row>
  </div>;

  // A manifest written before the cinematic block existed has no spec; the
  // panel still has to render, so it falls back to the defaults rather than
  // throwing the whole sidebar away.
  const cine = props.cinematic || defaultCinematicSpec();
  const activePreset = presetOf(cine.preset);
  // The schedule is read back off the TIMELINE rather than recomputed, so
  // this list is the layers that actually exist — including any the customer
  // has since dragged — not a second prediction of them.
  const scheduled = [
    ...manifest.text.filter((layer) => isCinematicLayerId(layer.id)).map((layer) => ({ id: layer.id, start: layer.start, duration: layer.duration, label: layer.text })),
    ...manifest.brand.filter((layer) => isCinematicLayerId(layer.id)).map((layer) => ({ id: layer.id, start: layer.start, duration: layer.duration, label: `${layer.name} \u2014 lower third` })),
  ].sort((a, b) => a.start - b.start);

  const storyField = (label: string, value: string, key: keyof CinematicSpec, placeholder: string) => <Row label={label}>
    <input value={value} placeholder={placeholder} onChange={(event) => props.onPatchCinematic({ [key]: event.target.value } as Partial<CinematicSpec>)} className="sf-input" />
  </Row>;

  return <aside className="flex h-full w-full flex-col gap-3 overflow-y-auto border-l border-[var(--space-border-strong)] bg-[color-mix(in_srgb,#FFFFFF_92%,transparent)] p-3">
    <Group title="Cinematic story" icon={Clapperboard} action={<label className="flex items-center gap-1 text-[10px] text-[var(--space-text-secondary)]">
      <input type="checkbox" checked={cine.enabled} onChange={(event) => props.onPatchCinematic({ enabled: event.target.checked })} />On
    </label>}>
      <p className="text-[10px] leading-relaxed text-[var(--space-text-muted)]">Five fields, one look, one timing. They compile straight into the timed layers below, so you can still drag or restyle any of them by hand afterwards.</p>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {MOTION_PRESETS.map((preset) => {
          const active = cine.preset === preset.id;
          return <button key={preset.id} type="button" title={preset.blurb} onClick={() => props.onChoosePreset(preset.id)}
            className={active ? 'rounded-lg border px-2 py-2 text-left' : 'rounded-lg border border-[var(--space-border-default)] px-2 py-2 text-left hover:border-[#C8920A]'}
            style={active ? { borderColor: preset.accent, background: `color-mix(in srgb, ${preset.accent} 14%, transparent)` } : undefined}>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: preset.accent }} />
              <span className="truncate text-[11px] font-bold text-[var(--space-text-primary)]" style={{ fontFamily: `${preset.displayFont}, Inter, system-ui, sans-serif` }}>{preset.name}</span>
            </span>
            <span className="mt-0.5 block truncate text-[9px] text-[var(--space-text-muted)]">{preset.displayFont} / {preset.bodyFont}</span>
          </button>;
        })}
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--space-text-secondary)]">{activePreset.blurb}</p>

      <div className="mt-2 grid gap-2">
        {storyField('Title', cine.title, 'title', 'The one line that opens the film')}
        {storyField('Subtitle', cine.subtitle, 'subtitle', 'A supporting line under it')}
        <div className="grid grid-cols-2 gap-2">
          {storyField('Lower third \u2014 name', cine.lowerThirdName, 'lowerThirdName', 'Who is speaking')}
          {storyField('Lower third \u2014 role', cine.lowerThirdRole, 'lowerThirdRole', 'Founder')}
        </div>
        {storyField('Call to action', cine.cta, 'cta', 'What they should do next')}
        {storyField('Outro', cine.outro, 'outro', 'The closing card')}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input type="color" aria-label="Accent colour" value={cine.accent} onChange={(event) => props.onPatchCinematic({ accent: event.target.value })}
          className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-[var(--space-border-default)] bg-transparent" />
        <div className="flex flex-wrap gap-1.5">
          {['#F97316', '#FBBF24', '#22D3EE', '#F0B429', '#34D399', '#F43F5E'].map((swatch) => <button key={swatch} type="button" aria-label={`Use ${swatch}`} onClick={() => props.onPatchCinematic({ accent: swatch })}
            className={cine.accent.toLowerCase() === swatch.toLowerCase() ? 'h-7 w-7 rounded-lg border-2 border-[#1A1000]' : 'h-7 w-7 rounded-lg border border-[var(--space-border-strong)]'} style={{ background: swatch }} />)}
        </div>
        <span className="text-[10px] uppercase tracking-wide text-[var(--space-text-muted)]">{cine.accent}</span>
      </div>

      <div className="mt-2 grid gap-2">
        <Row label={`Entry delay ${cine.entryDelaySec.toFixed(1)}s`}>
          <input type="range" min={0} max={5} step={0.1} value={cine.entryDelaySec} onChange={(event) => props.onPatchCinematic({ entryDelaySec: Number(event.target.value) })} className="w-full" />
        </Row>
        <Row label={`Each element holds ${cine.durationSec.toFixed(1)}s`}>
          <input type="range" min={1} max={10} step={0.1} value={cine.durationSec} onChange={(event) => props.onPatchCinematic({ durationSec: Number(event.target.value) })} className="w-full" />
        </Row>
        <Row label={`Exit delay ${cine.exitDelaySec.toFixed(1)}s`} hint="Air left after the outro clears, before the last frame.">
          <input type="range" min={0} max={5} step={0.1} value={cine.exitDelaySec} onChange={(event) => props.onPatchCinematic({ exitDelaySec: Number(event.target.value) })} className="w-full" />
        </Row>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px] text-[var(--space-text-secondary)]">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={cine.intro} onChange={(event) => props.onPatchCinematic({ intro: event.target.checked })} />Intro fade</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={cine.grain} onChange={(event) => props.onPatchCinematic({ grain: event.target.checked })} />Film grain</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={cine.lightLeak} onChange={(event) => props.onPatchCinematic({ lightLeak: event.target.checked })} />Light leak</label>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-[var(--space-text-muted)]">
        Grain and the light leak are burned into the exported MP4 as full-frame plates. The black intro fade is a preview treatment only — the compositor lays assets over the master, it cannot dim it.
      </p>

      {cine.enabled && scheduled.length ? <div className="mt-2 rounded-lg border border-[var(--space-border-default)] bg-[var(--space-surface-panel)] p-2">
        <p className="text-[9px] font-bold uppercase tracking-[.14em] text-[var(--space-text-muted)]">On screen</p>
        <ul className="mt-1 space-y-0.5">
          {scheduled.map((row) => <li key={row.id} className="truncate text-[10px] text-[var(--space-text-secondary)]">
            <span className="tabular-nums text-[var(--space-text-muted)]">{row.start.toFixed(1)}–{(row.start + row.duration).toFixed(1)}s</span> · {row.label}
          </li>)}
        </ul>
      </div> : null}

      <button type="button" onClick={props.onDownloadSpec}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--space-border-default)] px-3 py-2 text-[11px] font-semibold text-[var(--space-text-secondary)] hover:border-[#C8920A]">
        <Download className="h-3.5 w-3.5" />Download the overlay spec (JSON)
      </button>
    </Group>

    <Group title="Add a layer" icon={Plus}>
      <div className="flex flex-wrap gap-1.5">
        <AddButton label="Headline" icon={Type} onClick={() => props.onAddText('headline')} />
        <AddButton label="Subhead" icon={Type} onClick={() => props.onAddText('subheadline')} />
        <AddButton label="Caption box" icon={Type} onClick={() => props.onAddText('caption-box')} />
        <AddButton label="Logo" icon={Sparkles} onClick={() => props.onAddBrand('logo')} />
        <AddButton label="Lower third" icon={Layers} onClick={() => props.onAddBrand('lower-third')} />
        <AddButton label="Accent bar" icon={Layers} onClick={() => props.onAddBrand('accent-bar')} />
        <AddButton label="Image / B-roll" icon={ImageIcon} onClick={props.onAddImage} />
        <AddButton label="Card" icon={Plus} onClick={props.onAddCard} />
      </div>
      <button type="button" onClick={props.onSuggestCopy} disabled={busy.copy}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,#C8920A_45%,transparent)] bg-[color-mix(in_srgb,#C8920A_14%,transparent)] px-3 py-2 text-[11px] font-semibold text-[#C8920A] disabled:opacity-40">
        {busy.copy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}Suggest text from the script
      </button>
      {notes.copy ? <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--space-text-secondary)]">{notes.copy}</p> : null}
    </Group>

    <Group title="Layer stack" icon={Layers}>
      <div className="space-y-0.5">
        <StackRow label="Base video (HeyGen master)" meta={'Never regenerated \u00b7 audio kept'} selected={selectedId === 'base'} tint={TRACK_TINTS.base} onSelect={() => props.onSelect('base')} />
        {manifest.text.map((layer) => <StackRow key={layer.id} label={layer.text || 'Empty text'} meta={`${layer.kind} \u00b7 ${layer.start.toFixed(1)}s for ${layer.duration.toFixed(1)}s`} selected={layer.id === selectedId} hidden={layer.hidden} tint={TRACK_TINTS.text} onSelect={() => props.onSelect(layer.id)} onDelete={() => props.onRemove(layer.id)} />)}
        {manifest.brand.map((layer) => <StackRow key={layer.id} label={layer.kind === 'logo' ? 'Logo' : layer.kind === 'lower-third' ? `Lower third \u2014 ${layer.name}` : 'Accent bar'} meta={`${layer.start.toFixed(1)}s for ${layer.duration.toFixed(1)}s`} selected={layer.id === selectedId} hidden={layer.hidden} tint={TRACK_TINTS.brand} onSelect={() => props.onSelect(layer.id)} onDelete={() => props.onRemove(layer.id)} />)}
        {manifest.images.map((layer) => <StackRow key={layer.id} label={layer.label || 'Image overlay'} meta={`${layer.transition} \u00b7 ${layer.start.toFixed(1)}s for ${layer.duration.toFixed(1)}s`} selected={layer.id === selectedId} hidden={layer.hidden} tint={TRACK_TINTS.image} onSelect={() => props.onSelect(layer.id)} onDelete={() => props.onRemove(layer.id)} />)}
        {manifest.cards.map((layer) => <StackRow key={layer.id} label={cardSummary(layer.template, layer.variables)} meta={`${templateOf(layer.template).name} \u00b7 ${layer.renderedBy === 'hyperframes' ? 'HyperFrames clip' : layer.renderedBy === 'plate' ? 'styled still' : 'not rendered yet'}`} selected={layer.id === selectedId} hidden={layer.hidden} tint={TRACK_TINTS.card} onSelect={() => props.onSelect(layer.id)} onDelete={() => props.onRemove(layer.id)} />)}
        {manifest.captionStyle.enabled ? <StackRow label="Captions" meta={`${captionCount} segment${captionCount === 1 ? '' : 's'} \u00b7 ${manifest.captionStyle.burnIn ? 'burned into the MP4' : 'saved, not burned'}`} selected={selectedId === 'captions'} tint={TRACK_TINTS.caption} onSelect={() => props.onSelect('captions')} /> : null}
        {manifest.music.enabled ? <StackRow label="Background music" meta={manifest.music.url ? `volume ${Math.round(manifest.music.volume * 100)}%` : 'no track yet'} selected={selectedId === 'music'} tint={TRACK_TINTS.music} onSelect={() => props.onSelect('music')} /> : null}
      </div>
    </Group>

    {text ? <Group title="Text layer" icon={Type}>
      <Row label="Copy">
        <textarea value={text.text} rows={3} onChange={(event) => props.onPatchText(text.id, { text: event.target.value })} className="sf-input resize-y" />
      </Row>
      <div className="mt-2">{timing(text.start, text.duration, (patch) => props.onPatchText(text.id, patch))}</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Row label="Font"><select value={text.font} onChange={(event) => props.onPatchText(text.id, { font: event.target.value })} className="sf-input">{FONTS.map((font) => <option key={font} value={font}>{font}</option>)}</select></Row>
        <Row label={`Size ${text.sizePx}px`}><input type="range" min={24} max={180} step={2} value={text.sizePx} onChange={(event) => props.onPatchText(text.id, { sizePx: Number(event.target.value) })} className="w-full" /></Row>
        <Row label="Colour"><input type="color" value={text.color} onChange={(event) => props.onPatchText(text.id, { color: event.target.value })} className="h-9 w-full cursor-pointer rounded-lg border border-[var(--space-border-default)] bg-transparent" /></Row>
        <Row label="Entrance" hint={text.anim === 'typewriter' ? 'Typed on in the preview and burned as a six-step reveal in the export.' : undefined}>
          <select value={text.anim} onChange={(event) => props.onPatchText(text.id, { anim: event.target.value as Anim })} className="sf-input">{ANIMATIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        </Row>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([value, Icon]) => <button key={value} type="button" aria-label={`Align ${value}`} onClick={() => props.onPatchText(text.id, { align: value })}
          className={text.align === value ? 'rounded-lg bg-[#C8920A] p-2 text-white' : 'rounded-lg border border-[var(--space-border-default)] p-2 text-[var(--space-text-secondary)]'}><Icon className="h-3.5 w-3.5" /></button>)}
        <select value={text.plate} onChange={(event) => props.onPatchText(text.id, { plate: event.target.value as TextLayer['plate'] })} className="sf-input ml-auto max-w-[9rem]">
          <option value="none">No backdrop</option>
          <option value="pill">Pill backdrop</option>
          <option value="bar">Bar backdrop</option>
        </select>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Row label={`Across ${Math.round(text.x * 100)}%`}><input type="range" min={0} max={1} step={0.01} value={text.x} onChange={(event) => props.onPatchText(text.id, { x: Number(event.target.value) })} className="w-full" /></Row>
        <Row label={`Down ${Math.round(text.y * 100)}%`}><input type="range" min={0} max={1} step={0.01} value={text.y} onChange={(event) => props.onPatchText(text.id, { y: Number(event.target.value) })} className="w-full" /></Row>
      </div>
    </Group> : null}

    {brand ? <Group title="Brand layer" icon={Sparkles}>
      {timing(brand.start, brand.duration, (patch) => props.onPatchBrand(brand.id, patch))}
      {brand.kind === 'lower-third' ? <div className="mt-2 grid gap-2">
        <Row label="Name"><input value={brand.name} onChange={(event) => props.onPatchBrand(brand.id, { name: event.target.value })} className="sf-input" /></Row>
        <Row label="Title / role"><input value={brand.role} onChange={(event) => props.onPatchBrand(brand.id, { role: event.target.value })} className="sf-input" /></Row>
      </div> : null}
      {brand.kind === 'logo' ? <div className="mt-2 grid gap-2">
        <Row label="Logo URL" hint="A logo linked from another site may not be readable for compositing — upload the file if the export complains.">
          <input value={brand.logoUrl} onChange={(event) => props.onPatchBrand(brand.id, { logoUrl: event.target.value })} className="sf-input" />
        </Row>
        <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--space-border-strong)] px-3 py-2 text-[11px] font-semibold text-[var(--space-text-secondary)] hover:border-[#C8920A]">
          <Upload className="h-3.5 w-3.5" />Upload a logo
          <input type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onUploadLogo(brand.id, file); }} />
        </label>
        <Row label={`Size ${Math.round(brand.scale * 100)}% of width`}><input type="range" min={0.05} max={0.5} step={0.01} value={brand.scale} onChange={(event) => props.onPatchBrand(brand.id, { scale: Number(event.target.value) })} className="w-full" /></Row>
      </div> : null}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Row label="Placement">
          <select value={brand.corner} onChange={(event) => props.onPatchBrand(brand.id, { corner: event.target.value as BrandLayer['corner'] })} className="sf-input">
            <option value="top-left">Top left</option>
            <option value="top-right">Top right</option>
            <option value="bottom-left">Bottom left</option>
            <option value="bottom-right">Bottom right</option>
          </select>
        </Row>
        <Row label={`Opacity ${Math.round(brand.opacity * 100)}%`}><input type="range" min={0.1} max={1} step={0.05} value={brand.opacity} onChange={(event) => props.onPatchBrand(brand.id, { opacity: Number(event.target.value) })} className="w-full" /></Row>
        <Row label="Accent"><input type="color" value={brand.accentColor} onChange={(event) => props.onPatchBrand(brand.id, { accentColor: event.target.value })} className="h-9 w-full cursor-pointer rounded-lg border border-[var(--space-border-default)] bg-transparent" /></Row>
        {/* Clip reveals are offered only where both the preview and the
            exported plate really implement them — a lower third. A logo or an
            accent bar would silently fall back to a fade, which is worse than
            not offering the option. */}
        <Row label="Entrance"><select value={brand.anim} onChange={(event) => props.onPatchBrand(brand.id, { anim: event.target.value as Anim })} className="sf-input">{ANIMATIONS.filter((option) => option.value !== 'typewriter' && (brand.kind === 'lower-third' || (option.value !== 'clip-reveal' && option.value !== 'mask-wipe'))).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Row>
      </div>
    </Group> : null}

    {image ? <Group title="Image / B-roll overlay" icon={ImageIcon}>
      <Row label="Label"><input value={image.label} onChange={(event) => props.onPatchImage(image.id, { label: event.target.value })} className="sf-input" /></Row>
      <div className="mt-2">{timing(image.start, image.duration, (patch) => props.onPatchImage(image.id, patch))}</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Row label="Transition">
          <select value={image.transition} onChange={(event) => props.onPatchImage(image.id, { transition: event.target.value as ImageLayer['transition'] })} className="sf-input">
            <option value="fade">Fade</option>
            <option value="zoom-in">Zoom in (Ken Burns)</option>
            <option value="slide">Slide (whip pan)</option>
          </select>
        </Row>
        <Row label="Fit">
          <select value={image.fit} onChange={(event) => props.onPatchImage(image.id, { fit: event.target.value as ImageLayer['fit'] })} className="sf-input">
            <option value="cover">Fill the frame</option>
            <option value="contain">Fit inside</option>
          </select>
        </Row>
      </div>
      <img src={image.url} alt="" className="mt-2 max-h-28 w-full rounded-lg object-cover" />
    </Group> : null}

    {card ? <Group title="Card layer" icon={Layers} action={<button type="button" onClick={() => props.onEditCard(card.id)} className="rounded-lg border border-[var(--space-border-default)] px-2 py-1 text-[10px] font-semibold text-[var(--space-text-secondary)]">Edit content</button>}>
      <p className="text-xs text-[var(--space-text-secondary)]">{templateOf(card.template).name} — {cardSummary(card.template, card.variables)}</p>
      <div className="mt-2">{timing(card.start, card.duration, (patch) => props.onPatchCard(card.id, patch))}</div>
      <Row label="How it lands in the film" hint={card.placement === 'insert'
        ? 'Insert cuts the card INTO the film and makes it longer. The platform stitcher normalises a stitched export to 1280×720, so portrait films keep their shape only on the overlay setting.'
        : 'Overlay holds the card over the presenter for its time window and never moves anything else.'}>
        <select value={card.placement} onChange={(event) => props.onPatchCard(card.id, { placement: event.target.value as CardLayer['placement'] })} className="sf-input">
          <option value="overlay">Overlay on the presenter</option>
          <option value="insert">Cut into the film</option>
        </select>
      </Row>
      {card.clipUrl ? <p className="mt-2 text-[10px] text-[var(--space-text-muted)]">Rendered as {card.renderedBy === 'hyperframes' ? 'an animated HyperFrames clip' : 'a styled still'}.</p> : null}
      {card.renderError ? <p className="mt-1 text-[10px] text-[var(--space-semantic-danger)]">{card.renderError}</p> : null}
    </Group> : null}

    <Group title="Captions" icon={Subtitles} action={<label className="flex items-center gap-1 text-[10px] text-[var(--space-text-secondary)]"><input type="checkbox" checked={manifest.captionStyle.enabled} onChange={(event) => props.onPatchCaptions({ enabled: event.target.checked })} />On</label>}>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={props.onGenerateCaptions} disabled={busy.captions}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[linear-gradient(135deg,#E8B737,#C8920A)] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-40">
          {busy.captions ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Subtitles className="h-3.5 w-3.5" />}Auto-generate from the audio
        </button>
        <button type="button" onClick={props.onOpenCaptions} disabled={!captionCount} className="rounded-lg border border-[var(--space-border-default)] px-3 py-2 text-[11px] font-semibold text-[var(--space-text-secondary)] disabled:opacity-40">Edit {captionCount || ''}</button>
      </div>
      {notes.captions ? <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--space-text-secondary)]">{notes.captions}</p> : null}
      {manifest.captionStyle.enabled ? <div className="mt-2 grid grid-cols-2 gap-2">
        <Row label={`Size ${manifest.captionStyle.sizePx}px`}><input type="range" min={24} max={110} step={2} value={manifest.captionStyle.sizePx} onChange={(event) => props.onPatchCaptions({ sizePx: Number(event.target.value) })} className="w-full" /></Row>
        <Row label="Position">
          <select value={manifest.captionStyle.position} onChange={(event) => props.onPatchCaptions({ position: event.target.value as CaptionStyle['position'] })} className="sf-input">
            <option value="bottom">Lower third</option>
            <option value="middle">Centre</option>
            <option value="top">Upper third</option>
          </select>
        </Row>
        <Row label="Colour"><input type="color" value={manifest.captionStyle.color} onChange={(event) => props.onPatchCaptions({ color: event.target.value })} className="h-9 w-full cursor-pointer rounded-lg border border-[var(--space-border-default)] bg-transparent" /></Row>
        <Row label="Backdrop">
          <select value={manifest.captionStyle.plate} onChange={(event) => props.onPatchCaptions({ plate: event.target.value as CaptionStyle['plate'] })} className="sf-input">
            <option value="pill">Pill</option>
            <option value="none">Outline only</option>
          </select>
        </Row>
        <label className="col-span-2 flex items-center gap-2 text-[11px] text-[var(--space-text-secondary)]">
          <input type="checkbox" checked={manifest.captionStyle.burnIn} onChange={(event) => props.onPatchCaptions({ burnIn: event.target.checked })} />Burn the captions into the exported MP4
        </label>
      </div> : null}
    </Group>

    <Group title="Background music" icon={Music} action={<label className="flex items-center gap-1 text-[10px] text-[var(--space-text-secondary)]"><input type="checkbox" checked={manifest.music.enabled} onChange={(event) => props.onPatchMusic({ enabled: event.target.checked })} />On</label>}>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={props.onGenerateMusic} disabled={busy.music}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,#BE185D_45%,transparent)] bg-[color-mix(in_srgb,#BE185D_12%,transparent)] px-3 py-2 text-[11px] font-semibold text-[#BE185D] disabled:opacity-40">
          {busy.music ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Music className="h-3.5 w-3.5" />}Generate a bed
        </button>
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--space-border-default)] px-3 py-2 text-[11px] font-semibold text-[var(--space-text-secondary)]">
          <Upload className="h-3.5 w-3.5" />Upload
          <input type="file" accept="audio/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onUploadMusic(file); }} />
        </label>
      </div>
      {notes.music ? <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--space-text-secondary)]">{notes.music}</p> : null}
      {manifest.music.url ? <audio src={manifest.music.url} controls className="mt-2 w-full" /> : null}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Row label={`Volume ${Math.round(manifest.music.volume * 100)}%`}><input type="range" min={0} max={1} step={0.02} value={manifest.music.volume} onChange={(event) => props.onPatchMusic({ volume: Number(event.target.value) })} className="w-full" /></Row>
        <Row label={`Fade in ${manifest.music.fadeInSec.toFixed(1)}s`}><input type="range" min={0} max={6} step={0.2} value={manifest.music.fadeInSec} onChange={(event) => props.onPatchMusic({ fadeInSec: Number(event.target.value) })} className="w-full" /></Row>
        <Row label={`Fade out ${manifest.music.fadeOutSec.toFixed(1)}s`}><input type="range" min={0} max={6} step={0.2} value={manifest.music.fadeOutSec} onChange={(event) => props.onPatchMusic({ fadeOutSec: Number(event.target.value) })} className="w-full" /></Row>
        <label className="flex items-end gap-2 pb-1 text-[11px] text-[var(--space-text-secondary)]">
          <input type="checkbox" checked={manifest.music.replaceOriginalAudio} onChange={(event) => props.onPatchMusic({ replaceOriginalAudio: event.target.checked })} />Drop the avatar audio
        </label>
      </div>
    </Group>

    <Group title="Look of the export" icon={Wand2}>
      <div className="grid grid-cols-2 gap-2">
        <Row label="Colour grade">
          <select value={manifest.directives.colorGrade} onChange={(event) => props.onPatchDirectives({ colorGrade: event.target.value as ColorGrade })} className="sf-input">
            <option value="neutral">Neutral</option>
            <option value="warm">Warm</option>
            <option value="cool">Cool</option>
            <option value="cinematic">Cinematic</option>
            <option value="brand">Brand</option>
          </select>
        </Row>
        <Row label="Pacing">
          <select value={manifest.directives.pacing} onChange={(event) => props.onPatchDirectives({ pacing: event.target.value as Pacing })} className="sf-input">
            <option value="fast_cut">Fast cuts</option>
            <option value="slow_reveal">Slow reveals</option>
          </select>
        </Row>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-[var(--space-text-muted)]">Playhead at {playhead.toFixed(1)}s. New layers land there.</p>
    </Group>
  </aside>;
}
