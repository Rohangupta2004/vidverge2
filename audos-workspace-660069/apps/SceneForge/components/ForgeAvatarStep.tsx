/**
 * SceneForge step 2 — Select avatar.
 * HeyGen avatars BUNDLED BY NAME: one sideways-scrolling row of looks per
 * presenter, rows stacked vertically, with search/gender filters, "See more"
 * paging and a per-avatar Preview. Touch scrolling works on mobile.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Play, RotateCcw, Search, X } from 'lucide-react';
import { COLORS, FONT, RADIUS } from '../../../components/theme';
import { bundleAvatars, loadAvatars } from '../lib/forgeClient';
import type { ForgeAvatar, ForgeAvatarBundle } from '../lib/forgeTypes';

export default function ForgeAvatarStep({
  avatarId,
  onPick,
}: {
  avatarId: string;
  onPick: (avatar: ForgeAvatar) => void;
}) {
  const [avatars, setAvatars] = useState<ForgeAvatar[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [region, setRegion] = useState('');
  const [style, setStyle] = useState('');
  const [hovered, setHovered] = useState('');
  const [preview, setPreview] = useState<ForgeAvatar | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [visibleCount, setVisibleCount] = useState(12);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    loadAvatars(reloadKey > 0)
      .then((list) => { if (!cancelled) setAvatars(list); })
      .catch((e) => { if (!cancelled) setError(String(e?.message || e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  // New search terms or filters restart progressive paging from the top.
  useEffect(() => { setVisibleCount(12); }, [query, gender, age, region, style]);

  const facets = useMemo(() => {
    const values = (field: keyof ForgeAvatar) => {
      const counts = new Map<string, number>();
      avatars.forEach((avatar) => {
        const value = String(avatar[field] || '').trim().toLowerCase();
        if (!value || value === 'unspecified' || value === 'other' || value === 'standard') return;
        counts.set(value, (counts.get(value) || 0) + 1);
      });
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    };
    return { genders: values('gender'), ages: values('age'), regions: values('region'), styles: values('style') };
  }, [avatars]);

  const filteredAvatars = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return avatars.filter((avatar) => {
      const haystack = [avatar.name, avatar.gender, avatar.age, avatar.region, avatar.ethnicity, avatar.style, avatar.category, avatar.description, ...avatar.tags].join(' ').toLowerCase();
      if (gender && avatar.gender !== gender) return false;
      if (age && avatar.age.indexOf(age) < 0) return false;
      if (region === 'indian-south-asian' && avatar.region !== region && !/\b(india|indian|south[ -]?asian|desi)\b/.test(haystack)) return false;
      if (region && region !== 'indian-south-asian' && avatar.region.indexOf(region) < 0) return false;
      if (style && avatar.style.indexOf(style) < 0) return false;
      return terms.every((term) => haystack.indexOf(term) >= 0);
    });
  }, [avatars, query, gender, age, region, style]);

  const bundles: ForgeAvatarBundle[] = useMemo(() => bundleAvatars(filteredAvatars), [filteredAvatars]);
  const visible = bundles.slice(0, visibleCount);

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1100 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 220, position: 'relative' }}>
          <Search size={15} color={COLORS.muted} style={{ left: 12, position: 'absolute', top: 14 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, ethnicity, region, style or tag…"
            style={{ background: COLORS.input, border: `1px solid ${COLORS.controlBorder}`, borderRadius: RADIUS.sm, color: COLORS.text, fontFamily: FONT.body, fontSize: 14, minHeight: 44, padding: '0 12px 0 34px', width: '100%' }}
            data-testid="input-avatar-search"
          />
        </div>
        {facets.genders.length ? [['', avatars.length] as [string, number], ...facets.genders].map(([g, count]) => (
          <button
            key={g || 'all'}
            type="button"
            onClick={() => setGender(g)}
            style={{ background: gender === g ? COLORS.accentSoft : COLORS.raised, border: `1px solid ${gender === g ? COLORS.accent : COLORS.border}`, borderRadius: 999, color: gender === g ? COLORS.accent : COLORS.secondary, cursor: 'pointer', fontFamily: FONT.heading, fontSize: 13, fontWeight: 600, minHeight: 44, padding: '0 16px' }}
            data-testid={`button-avatar-filter-${g || 'all'}`}
          >
            {g === '' ? `All (${count})` : `${g.replace(/\b\w/g, (letter) => letter.toUpperCase())} (${count})`}
          </button>
        )) : null}
        {facets.ages.length ? <select value={age} onChange={(e) => setAge(e.target.value)} aria-label="Filter avatars by age" style={{ background: COLORS.raised, border: `1px solid ${age ? COLORS.accent : COLORS.border}`, borderRadius: RADIUS.sm, color: age ? COLORS.accent : COLORS.secondary, minHeight: 44, padding: '0 12px' }}>
          <option value="">All ages ({avatars.length})</option>{facets.ages.map(([value, count]) => <option key={value} value={value}>{value} ({count})</option>)}
        </select> : null}
        {facets.regions.length ? <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Filter avatars by ethnicity or region" style={{ background: COLORS.raised, border: `1px solid ${region ? COLORS.accent : COLORS.border}`, borderRadius: RADIUS.sm, color: region ? COLORS.accent : COLORS.secondary, minHeight: 44, padding: '0 12px' }}>
          <option value="">All regions / ethnicities ({avatars.length})</option>{facets.regions.map(([value, count]) => <option key={value} value={value}>{value === 'indian-south-asian' ? 'Indian / South Asian' : value} ({count})</option>)}
        </select> : null}
        {facets.styles.length ? <select value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Filter avatars by style" style={{ background: COLORS.raised, border: `1px solid ${style ? COLORS.accent : COLORS.border}`, borderRadius: RADIUS.sm, color: style ? COLORS.accent : COLORS.secondary, minHeight: 44, padding: '0 12px' }}>
          <option value="">All styles ({avatars.length})</option>{facets.styles.map(([value, count]) => <option key={value} value={value}>{value} ({count})</option>)}
        </select> : null}
      </div>
      {!loading && !error ? <div style={{ color: COLORS.muted, fontSize: 12.5 }}>Showing {filteredAvatars.length} of {avatars.length} avatars</div> : null}

      {loading ? (
        <div style={{ alignItems: 'center', color: COLORS.muted, display: 'flex', fontSize: 13.5, gap: 8, padding: '18px 0' }}>
          <Loader2 size={15} className="animate-spin" /> Loading the HeyGen avatar gallery…
        </div>
      ) : null}
      {error ? (
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.danger}`, borderRadius: RADIUS.card, display: 'grid', gap: 10, padding: 14 }}>
          <div style={{ color: COLORS.danger, fontSize: 13.5 }}>The avatar gallery could not load: {error}</div>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            style={{ alignItems: 'center', background: 'linear-gradient(115deg, #C79232 0%, #D9A441 58%, #E5B75A 100%)', border: 'none', borderRadius: RADIUS.sm, color: COLORS.onAccent, cursor: 'pointer', display: 'flex', fontFamily: FONT.heading, fontSize: 13.5, fontWeight: 700, gap: 7, justifyContent: 'center', justifySelf: 'start', minHeight: 44, padding: '0 18px' }}
            data-testid="button-avatar-retry"
          >
            <RotateCcw size={15} /> Retry loading avatars
          </button>
        </div>
      ) : null}
      {!loading && !error && !bundles.length ? (
        <div style={{ color: COLORS.muted, fontSize: 13.5, padding: '12px 0' }}>{region === 'indian-south-asian' ? 'No Indian / South Asian avatars were tagged in the current HeyGen catalog. Try searching a presenter name or clear this filter.' : 'No avatars match those filters.'}</div>
      ) : null}

      {visible.map((bundle) => (
        <section key={bundle.key}>
          <h3 style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>
            {bundle.name}
            <span style={{ color: COLORS.muted, fontSize: 12.5, fontWeight: 500, marginLeft: 8 }}>{bundle.looks.length} look{bundle.looks.length === 1 ? '' : 's'}</span>
          </h3>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6, WebkitOverflowScrolling: 'touch' }}>
            {bundle.looks.map((look) => {
              const selected = look.id === avatarId;
              return (
                <div key={look.id} style={{ flex: '0 0 auto', width: 150 }}>
                  <button
                    type="button"
                    onClick={() => onPick(look)}
                    aria-label={`Choose avatar ${look.name}`}
                    onMouseEnter={() => setHovered(look.id)}
                    onMouseLeave={() => setHovered('')}
                    style={{ background: COLORS.surface, border: `2px solid ${selected ? COLORS.accent : COLORS.border}`, borderRadius: RADIUS.card, cursor: 'pointer', display: 'block', overflow: 'hidden', padding: 0, width: '100%' }}
                    data-testid={`button-avatar-${look.id}`}
                  >
                    {hovered === look.id && look.previewVideo ? (
                      <video src={look.previewVideo} autoPlay muted loop playsInline preload="metadata" style={{ aspectRatio: '3 / 4', display: 'block', objectFit: 'cover', width: '100%' }} />
                    ) : look.previewImage ? (
                      <img src={look.previewImage} alt={look.name} loading="lazy" style={{ aspectRatio: '3 / 4', display: 'block', objectFit: 'cover', width: '100%' }} />
                    ) : (
                      <div style={{ alignItems: 'center', aspectRatio: '3 / 4', color: COLORS.muted, display: 'flex', fontSize: 12, justifyContent: 'center' }}>No preview</div>
                    )}
                    <div style={{ color: selected ? COLORS.accent : COLORS.secondary, fontFamily: FONT.body, fontSize: 12, overflow: 'hidden', padding: '8px 8px', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {look.name}
                    </div>
                  </button>
                  {look.previewVideo ? (
                    <button
                      type="button"
                      onClick={() => setPreview(look)}
                      style={{ alignItems: 'center', background: 'transparent', border: 'none', color: COLORS.muted, cursor: 'pointer', display: 'flex', fontFamily: FONT.body, fontSize: 12, gap: 5, minHeight: 32, padding: '0 8px' }}
                      data-testid={`button-avatar-previewvid-${look.id}`}
                    >
                      <Play size={12} /> Preview
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {!loading && !error && bundles.length > visible.length ? (
        <button
          type="button"
          onClick={() => setVisibleCount((count) => count + 12)}
          style={{ background: COLORS.raised, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.sm, color: COLORS.secondary, cursor: 'pointer', fontFamily: FONT.heading, fontSize: 13.5, fontWeight: 600, justifySelf: 'start', minHeight: 44, padding: '0 18px' }}
          data-testid="button-avatar-load-more"
        >
          Load more presenters ({visible.length} of {bundles.length} shown)
        </button>
      ) : null}

      {preview ? (
        <div
          role="dialog"
          aria-label={`Preview of ${preview.name}`}
          style={{ alignItems: 'center', background: 'rgba(0,0,0,0.78)', display: 'flex', inset: 0, justifyContent: 'center', padding: 16, position: 'fixed', zIndex: 60 }}
          onClick={() => setPreview(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.dialog, maxWidth: 420, padding: 14, width: '100%' }}>
            <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <strong style={{ color: COLORS.text, fontFamily: FONT.heading, fontSize: 15 }}>{preview.name}</strong>
              <button type="button" onClick={() => setPreview(null)} aria-label="Close preview" style={{ alignItems: 'center', background: COLORS.raised, border: `1px solid ${COLORS.border}`, borderRadius: 999, color: COLORS.secondary, cursor: 'pointer', display: 'flex', height: 36, justifyContent: 'center', width: 36 }}>
                <X size={15} />
              </button>
            </div>
            <video src={preview.previewVideo} controls autoPlay playsInline style={{ background: '#000', borderRadius: RADIUS.sm, width: '100%' }} />
            <button
              type="button"
              onClick={() => { onPick(preview); setPreview(null); }}
              style={{ background: 'linear-gradient(115deg, #C79232 0%, #D9A441 58%, #E5B75A 100%)', border: 'none', borderRadius: RADIUS.sm, color: COLORS.onAccent, cursor: 'pointer', fontFamily: FONT.heading, fontSize: 14, fontWeight: 700, marginTop: 12, minHeight: 44, width: '100%' }}
              data-testid="button-avatar-pick-from-preview"
            >
              Use this avatar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
