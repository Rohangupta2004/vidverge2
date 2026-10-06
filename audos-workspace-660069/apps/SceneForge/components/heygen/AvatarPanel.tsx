// The character consistency engine's front end.
//
// Everything here exists to make ONE decision stick: which presenter this
// session uses. The grid picks a stock look (grouped the way HeyGen groups
// them), AvatarMakers builds a custom one, and whichever wins is written to
// the session lock so every later generation call carries the same
// `avatar_id`. Moving it afterwards has to pass the warning modal, because
// scenes already rendered keep the old face.
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Film, Search, Sparkles, Upload } from 'lucide-react';
import { sortAvatars, type AvatarView } from '../../lib/heygenCatalog';
import { HeyGenError, fetchAvatarLooks } from '../../lib/heygenStudio';
import { describeError } from '../../lib/heygenApi';
import { fetchAvatarGroups, groupLooks, type AvatarGroup, type CreatedAvatar } from '../../lib/heygenAvatars';
import { lockAvatar, replaceAvatar, useHeyGenSession } from '../../lib/heygenSession';
import AvatarMakers, { type Maker, type MakerOrigin } from './AvatarMakers';
import { Button, ChangeLockModal, LockBadge, Notice, Panel, Segmented } from './ui';

const MADE_BY_YOU = 'Made by you';

function AvatarTile({ view, selected, onPick }: { view: AvatarView; selected: boolean; onPick: () => void }) {
  return <button
    type="button"
    onClick={onPick}
    aria-pressed={selected}
    className={`group overflow-hidden rounded-xl border p-2 text-left ${selected
      ? 'border-[#8b5cf6] bg-[color-mix(in_srgb,#8b5cf6_14%,transparent)] shadow-[0_0_0_3px_color-mix(in_srgb,#8b5cf6_28%,transparent)]'
      : 'border-[var(--space-border-default)] hover:border-[var(--space-border-strong)]'}`}
  >
    <div className="aspect-[3/4] overflow-hidden rounded-lg bg-[var(--space-surface-muted)]">
      {view.image
        ? <img src={view.image} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        : <span className="flex h-full w-full items-center justify-center text-xs text-[var(--space-text-muted)]">No preview</span>}
    </div>
    <div className="mt-2 truncate text-xs font-medium text-[var(--space-text-primary)]">{view.name}</div>
    <div className="truncate text-[11px] text-[var(--space-text-muted)]">{view.styleLabel || view.gender || 'Avatar'}</div>
  </button>;
}

function Skeletons() {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
    {Array.from({ length: 8 }).map((_, index) => <div key={index} className="rounded-xl border border-[var(--space-border-default)] p-2">
      <div className="st-shimmer aspect-[3/4] rounded-lg bg-[var(--space-surface-muted)]" />
      <div className="st-shimmer mt-2 h-3 w-2/3 rounded bg-[var(--space-surface-muted)]" />
    </div>)}
  </div>;
}

interface Pending {
  avatarId: string;
  lookId: string;
  name: string;
  preview: string;
  origin: 'stock' | MakerOrigin;
  defaultVoiceId: string;
}

export default function AvatarPanel({ step }: { step: number }) {
  const session = useHeyGenSession();
  const [looks, setLooks] = useState<any[]>([]);
  const [groups, setGroups] = useState<AvatarGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsKey, setNeedsKey] = useState(false);
  const [query, setQuery] = useState('');
  const [maker, setMaker] = useState<Maker>('library');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [limit, setLimit] = useState(16);
  // Characters built in this session, shown first so a new one is immediately
  // visible and re-selectable.
  const [custom, setCustom] = useState<CreatedAvatar[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAvatarLooks((items) => { if (!cancelled) setLooks(items); })
      .then((result) => { if (!cancelled) setLooks(result.items); })
      .catch((e: any) => {
        if (cancelled) return;
        if (e instanceof HeyGenError && e.missingCredential) setNeedsKey(true);
        else setError(describeError(e));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Groups are organisation, not a requirement: an account without them falls
  // back to one flat section, so a failure here is never surfaced.
  useEffect(() => {
    let cancelled = false;
    fetchAvatarGroups()
      .then((result) => { if (!cancelled) setGroups(result); })
      .catch(() => { /* no groups on this plan */ });
    return () => { cancelled = true; };
  }, []);

  const library = useMemo<AvatarView[]>(() => {
    const made: AvatarView[] = custom.map((entry) => ({
      id: entry.lookId || entry.avatarId,
      name: entry.name,
      image: entry.previewUrl,
      gender: '',
      styleLabel: MADE_BY_YOU,
      indian: false,
      raw: { group_id: 'custom', default_voice_id: entry.defaultVoiceId },
    }));
    return [...made, ...sortAvatars(looks)];
  }, [looks, custom]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return library;
    return library.filter((view) => `${view.name} ${view.gender} ${view.styleLabel}`.toLowerCase().includes(needle));
  }, [library, query]);

  const sections = useMemo(() => {
    const made = filtered.filter((view) => view.styleLabel === MADE_BY_YOU);
    const rest = filtered.filter((view) => view.styleLabel !== MADE_BY_YOU);
    const grouped = groupLooks(rest, groups);
    return made.length ? [{ id: 'custom', name: 'Your characters', looks: made }, ...grouped] : grouped;
  }, [filtered, groups]);

  useEffect(() => setLimit(16), [query]);

  function choose(view: AvatarView) {
    const lock = {
      avatarId: view.id,
      avatarLookId: view.id,
      avatarName: view.name,
      avatarPreviewUrl: view.image,
      origin: (view.styleLabel === MADE_BY_YOU ? 'photo' : 'stock') as 'stock' | 'photo',
      defaultVoiceId: String(view.raw?.default_voice_id || ''),
    };
    // lockAvatar refuses to move an already-locked avatar, which is exactly
    // when the customer needs to be warned rather than quietly obeyed.
    if (lockAvatar(lock)) return;
    if (session.avatarId === view.id) return;
    setPending({ avatarId: view.id, lookId: view.id, name: view.name, preview: view.image, origin: lock.origin, defaultVoiceId: lock.defaultVoiceId });
  }

  function adopt(created: CreatedAvatar, origin: MakerOrigin) {
    setCustom((current) => [created, ...current.filter((entry) => entry.avatarId !== created.avatarId)]);
    const lock = {
      avatarId: created.avatarId,
      avatarLookId: created.lookId,
      avatarName: created.name,
      avatarPreviewUrl: created.previewUrl,
      origin,
      defaultVoiceId: created.defaultVoiceId,
    };
    // A character the customer just built is selected automatically — but a
    // locked session still gets the warning rather than a silent swap.
    if (!lockAvatar(lock)) {
      setPending({ avatarId: created.avatarId, lookId: created.lookId, name: created.name, preview: created.previewUrl, origin, defaultVoiceId: created.defaultVoiceId });
    }
  }

  const makerOptions: { value: Maker; label: string; icon?: any }[] = [
    { value: 'library', label: 'Pick a look', icon: Search },
    { value: 'photo', label: 'Use my photo', icon: Upload },
    { value: 'prompt', label: 'Describe one', icon: Sparkles },
    { value: 'cinematic', label: 'Cinematic', icon: Film },
  ];

  return <Panel
    step={step}
    done={Boolean(session.avatarId)}
    title="Choose your presenter"
    hint={session.avatarId
      ? 'This character is pinned to every scene you generate in this session.'
      : `${filtered.length ? `${filtered.length} looks` : 'Loading looks'} from your HeyGen account — or build your own character.`}
    action={session.avatarId ? <LockBadge text={`Character locked \u{1F512} ${session.avatarName}`} onChange={() => setMaker('library')} /> : undefined}
  >
    {needsKey ? <Notice tone="info" title="Connect your HeyGen API key in Settings to load avatars">
      Once the key is saved, reopen this studio and your live avatar catalog appears here automatically.
    </Notice> : <div className="space-y-4">
      <Segmented value={maker} options={makerOptions} onChange={(value) => setMaker(value)} />

      {maker === 'library' ? <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--space-text-muted)]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or style" className="st-field pl-9" />
        </div>

        {loading && !filtered.length ? <Skeletons />
          : error && !library.length ? <Notice tone="error" title="The avatar catalog did not load">{error}</Notice>
            : !filtered.length ? <Notice tone="info" title="No avatars match that search">Clear the search to see your whole catalog.</Notice>
              : <div className="space-y-4">
                {sections.map((section, index) => {
                  // The first section is expanded; the rest collapse so a big
                  // catalog does not bury the rest of the suite far below.
                  const expanded = open[section.id] ?? index === 0;
                  const shown = expanded ? section.looks.slice(0, limit) : [];
                  return <div key={section.id}>
                    <button
                      type="button"
                      onClick={() => setOpen((current) => ({ ...current, [section.id]: !expanded }))}
                      className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--space-text-muted)] hover:text-[var(--space-text-secondary)]"
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                      {section.name}
                      <span className="font-normal normal-case">({section.looks.length})</span>
                    </button>
                    {expanded ? <>
                      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                        {shown.map((view) => <AvatarTile key={view.id} view={view} selected={session.avatarId === view.id} onPick={() => choose(view)} />)}
                      </div>
                      {section.looks.length > shown.length
                        ? <div className="mt-3"><Button tone="ghost" onClick={() => setLimit((current) => current + 24)}>Show more looks</Button></div>
                        : null}
                    </> : null}
                  </div>;
                })}
              </div>}
      </div> : <AvatarMakers maker={maker} onCreated={adopt} />}
    </div>}

    <ChangeLockModal
      open={Boolean(pending)}
      currentName={session.avatarName || 'your presenter'}
      nextName={pending?.name || ''}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        if (pending) {
          replaceAvatar({
            avatarId: pending.avatarId,
            avatarLookId: pending.lookId,
            avatarName: pending.name,
            avatarPreviewUrl: pending.preview,
            origin: pending.origin,
            defaultVoiceId: pending.defaultVoiceId,
          });
        }
        setPending(null);
      }}
    />
  </Panel>;
}
