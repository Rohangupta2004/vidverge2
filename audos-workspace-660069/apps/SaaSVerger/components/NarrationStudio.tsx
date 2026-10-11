import { AlertTriangle, Check, Image as PictureIcon, Loader2, Mic, RefreshCw, Sparkles, Trash2, Upload, Video as VideoIcon, Volume2, Wand2, X } from 'lucide-react';
import type { NarrationAnalysis } from '../lib/narration';
import { MISSING_VISUAL_WARNING_EN, MISSING_VISUAL_WARNING_HI, SCREEN_LABELS, extractKeywords, sceneCountLabel } from '../lib/narration';
import type { Script, VisualAsset, VisualMatch } from '../types';

type NarrationStudioProps = {
  script: Script;
  assets: VisualAsset[];
  analysis: NarrationAnalysis;
  running: boolean;
  sceneBusy: number | null;
  libraryLoading: boolean;
  ttsAvailable: boolean;
  notice: string;
  scenePreviews: Record<number, string>;
  onNarrationChange: (index: number, value: string) => void;
  onRegenerate: (index: number) => void;
  onPreviewVoice: (index: number) => void;
  onAttach: (index: number, asset: VisualAsset) => void;
  onDetach: (index: number) => void;
  onAssetTagsChange: (assetId: string, tags: string) => void;
  onUpload: (index: number, files: FileList | null) => void;
  onReloadLibrary: () => void;
  onDiscard: () => void;
  onContinue: () => void;
};

const cardStyle = { padding: 18, borderRadius: 20, border: '1px solid rgba(180,120,0,0.14)', background: '#FFFFFF' } as const;
const chipStyle = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, background: 'rgba(180,120,0,0.08)', color: '#7A6030', fontSize: 12, fontWeight: 650 } as const;
const ghostButton = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 999, border: '1px solid rgba(180,120,0,0.14)', background: 'rgba(180,120,0,0.06)', color: '#1A1000', fontSize: 13, fontWeight: 700, cursor: 'pointer' } as const;

function Thumb({ kind, previewUrl, size = 58 }: { kind: VisualAsset['kind']; previewUrl: string; size?: number }) {
  const frame = { width: size, height: size, flex: `0 0 ${size}px`, borderRadius: 12, overflow: 'hidden', background: '#FFFAEB', display: 'grid', placeItems: 'center' } as const;
  if (!previewUrl) return <div style={frame}><PictureIcon size={18} color="#7A6030" /></div>;
  return (
    <div style={frame}>
      {kind === 'video'
        ? <video src={previewUrl} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <img src={previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
    </div>
  );
}

function Suggestion({ match, disabled, onUse, onTagsChange }: { match: VisualMatch; disabled: boolean; onUse: () => void; onTagsChange: (value: string) => void }) {
  const derivedKeywords = match.asset.source === 'upload' ? extractKeywords(match.asset.description, 10) : [];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: 9, borderRadius: 14, background: 'rgba(180,120,0,0.06)', border: '1px solid rgba(180,120,0,0.14)' }}>
      <Thumb kind={match.asset.kind} previewUrl={match.asset.previewUrl} size={46} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{match.asset.name}</div>
        <div style={{ marginTop: 3, color: '#7A6030', fontSize: 11.5 }}>{Math.round(match.score * 100)}% keyword match · {match.matched.slice(0, 4).join(', ')}</div>
        {derivedKeywords.length ? (
          <div aria-label="Detected screenshot keywords" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 7 }}>
            {derivedKeywords.map((keyword) => <span key={keyword} style={{ padding: '3px 7px', borderRadius: 999, background: 'rgba(200,146,10,.14)', border: '1px solid rgba(180,120,0,0.36)', color: '#B4720A', fontSize: 10.5, fontWeight: 650 }}>{keyword}</span>)}
          </div>
        ) : null}
        <input
          value={match.asset.tags}
          onChange={(event) => onTagsChange(event.target.value)}
          disabled={disabled}
          aria-label={`Custom matching tags for ${match.asset.name}`}
          placeholder="Add matching tags, separated by spaces"
          maxLength={180}
          style={{ width: '100%', boxSizing: 'border-box', marginTop: 7, padding: '6px 8px', borderRadius: 9, border: '1px solid rgba(180,120,0,0.14)', background: '#FFFAEB', color: '#1A1000', fontSize: 11.5, fontFamily: 'inherit' }}
        />
      </div>
      <button type="button" onClick={onUse} disabled={disabled} style={{ ...ghostButton, alignSelf: 'center', padding: '7px 12px', opacity: disabled ? .5 : 1, cursor: disabled ? 'default' : 'pointer' }}>Use</button>
    </div>
  );
}

export default function NarrationStudio(props: NarrationStudioProps) {
  const { analysis, assets, script, running, sceneBusy, ttsAvailable } = props;
  const blocked = running || sceneBusy !== null;

  return (
    <section style={{ marginTop: 20, padding: 24, borderRadius: 24, border: '1px solid rgba(180,120,0,0.14)', background: 'rgba(255,255,255,0.78)', backdropFilter: 'blur(18px)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 18, fontWeight: 850 }}><Mic size={18} color="#C8920A" /> Narration &amp; visual matching</div>
          <div style={{ marginTop: 5, color: '#7A6030', fontSize: 13, lineHeight: 1.5 }}>Write or regenerate the spoken line for each scene, then attach the screenshot or clip that matches it. Suggestions come from your uploads and this workspace&rsquo;s clip library, matched on the narration&rsquo;s own keywords.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={props.onReloadLibrary} disabled={props.libraryLoading} style={{ ...ghostButton, opacity: props.libraryLoading ? .6 : 1 }}>
            {props.libraryLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Reload workspace media
          </button>
          <button type="button" onClick={props.onDiscard} disabled={running} style={{ ...ghostButton, opacity: running ? .5 : 1, cursor: running ? 'default' : 'pointer' }}>
            <X size={14} /> Discard narration
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 16, flexWrap: 'wrap' }}>
        {analysis.withoutVisualCount > 0
          ? <span style={{ ...chipStyle, color: analysis.missingCount > 0 ? '#991B1B' : '#B45309', background: analysis.missingCount > 0 ? 'rgba(153,27,27,.10)' : 'rgba(200,146,10,.14)' }}><AlertTriangle size={13} /> {sceneCountLabel(analysis.withoutVisualCount)} missing visuals</span>
          : <span style={{ ...chipStyle, color: '#166534', background: 'rgba(22,101,52,.12)' }}><Check size={13} /> Every narrated scene has a visual</span>}
        {analysis.missingCount > 0 ? <span style={chipStyle}>{sceneCountLabel(analysis.missingCount)} with no relevant match found</span> : null}
        {analysis.suggestedCount > 0 ? <span style={chipStyle}>{sceneCountLabel(analysis.suggestedCount)} waiting on a suggested match</span> : null}
        <span style={chipStyle}>{assets.length} asset{assets.length === 1 ? '' : 's'} in the pool</span>
        <span style={{ ...chipStyle, color: ttsAvailable ? '#B4720A' : '#B45309' }}>{ttsAvailable ? <Volume2 size={13} /> : <AlertTriangle size={13} />} {ttsAvailable ? 'ElevenLabs voice preview ready' : 'Narration as on-screen text overlay'}</span>
      </div>

      {props.notice ? <div style={{ marginTop: 14, padding: '12px 15px', borderRadius: 14, color: '#B45309', background: 'rgba(200,146,10,.12)', border: '1px solid rgba(180,120,0,0.36)', fontSize: 13, lineHeight: 1.5 }}>{props.notice}</div> : null}

      <div style={{ display: 'grid', gap: 14, marginTop: 18 }}>
        {script.acts.map((act, index) => {
          const scene = analysis.scenes[index];
          const narration = scene?.narration || '';
          const busy = sceneBusy === index;
          const preview = props.scenePreviews[index];
          return (
            <div key={index} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>Scene {index + 1}</div>
                <span style={chipStyle}>{SCREEN_LABELS[act.screenKey]}</span>
                <span style={chipStyle}>{act.durationSeconds}s</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => props.onRegenerate(index)} disabled={blocked} style={{ ...ghostButton, opacity: blocked ? .5 : 1, cursor: blocked ? 'default' : 'pointer' }}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Rewrite
                  </button>
                  <button type="button" onClick={() => props.onPreviewVoice(index)} disabled={blocked || !narration.trim()} style={{ ...ghostButton, opacity: blocked || !narration.trim() ? .5 : 1, cursor: blocked || !narration.trim() ? 'default' : 'pointer' }}>
                    <Volume2 size={14} /> Preview voice
                  </button>
                </div>
              </div>

              <textarea
                value={narration}
                onChange={(event) => props.onNarrationChange(index, event.target.value)}
                disabled={running}
                aria-label={`Narration for scene ${index + 1}`}
                rows={3}
                placeholder="What the voiceover says over this screen..."
                style={{ width: '100%', boxSizing: 'border-box', marginTop: 12, padding: '12px 14px', borderRadius: 14, border: '1px solid rgba(180,120,0,0.14)', background: '#FFFAEB', color: '#1A1000', fontSize: 14.5, lineHeight: 1.55, resize: 'vertical', fontFamily: 'inherit' }}
              />

              {scene?.keywords.length ? <div style={{ marginTop: 9, color: '#7A6030', fontSize: 12 }}>Matching on: {scene.keywords.slice(0, 8).join(' · ')}</div> : null}
              {preview ? <audio src={preview} controls style={{ width: '100%', marginTop: 11, height: 36 }} /> : null}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12, marginTop: 14 }}>
                <div>
                  <div style={{ color: '#7A6030', fontSize: 12, fontWeight: 700, letterSpacing: '.02em' }}>ATTACHED VISUAL</div>
                  {act.visual ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginTop: 9, padding: 9, borderRadius: 14, background: 'rgba(22,101,52,.10)', border: '1px solid rgba(22,101,52,.28)' }}>
                      <Thumb kind={act.visual.kind} previewUrl={act.visual.previewUrl} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{act.visual.name}</div>
                        <div style={{ marginTop: 3, color: '#166534', fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5 }}>{act.visual.kind === 'video' ? <VideoIcon size={11} /> : <PictureIcon size={11} />} Will appear in this scene</div>
                      </div>
                      <button type="button" aria-label={`Remove the visual from scene ${index + 1}`} onClick={() => props.onDetach(index)} disabled={running} style={{ ...ghostButton, padding: 8 }}><Trash2 size={13} /></button>
                    </div>
                  ) : (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 9, padding: '13px 14px', borderRadius: 14, border: '1px dashed rgba(180,120,0,0.14)', background: 'rgba(180,120,0,0.06)', color: '#3D2800', fontSize: 13, cursor: running ? 'default' : 'pointer' }}>
                      <Upload size={16} color="#C8920A" />
                      <span style={{ flex: 1 }}>Upload a screenshot for this scene</span>
                      <input type="file" accept="image/png,image/jpeg,image/webp" disabled={running} onChange={(event) => { props.onUpload(index, event.target.files); event.target.value = ''; }} style={{ display: 'none' }} />
                    </label>
                  )}
                </div>

                {act.visual ? null : (
                  <div>
                    <div style={{ color: '#7A6030', fontSize: 12, fontWeight: 700, letterSpacing: '.02em' }}>SUGGESTED VISUALS</div>
                    <div style={{ display: 'grid', gap: 8, marginTop: 9 }}>
                      {scene?.suggestions.length
                        ? scene.suggestions.map((match) => <Suggestion key={match.asset.id} match={match} disabled={running} onUse={() => props.onAttach(index, match.asset)} onTagsChange={(tags) => props.onAssetTagsChange(match.asset.id, tags)} />)
                        : <div style={{ padding: '13px 14px', borderRadius: 14, background: 'rgba(180,120,0,0.06)', border: '1px solid rgba(180,120,0,0.14)', color: '#7A6030', fontSize: 12.5, lineHeight: 1.5 }}>Nothing in the pool matches these narration keywords yet.</div>}
                    </div>
                  </div>
                )}
              </div>

              {scene?.status === 'missing' ? (
                <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 14, color: '#991B1B', background: 'rgba(153,27,27,.08)', border: '1px solid rgba(153,27,27,.26)', fontSize: 13.5, lineHeight: 1.5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 750 }}><AlertTriangle size={15} /> {MISSING_VISUAL_WARNING_EN}</div>
                  <div style={{ marginTop: 4, color: '#991B1B', fontSize: 12.5 }}>{MISSING_VISUAL_WARNING_HI}</div>
                </div>
              ) : null}
              {scene?.status === 'suggested' ? (
                <div style={{ marginTop: 12, padding: '11px 14px', borderRadius: 14, color: '#B45309', background: 'rgba(200,146,10,.12)', border: '1px solid rgba(180,120,0,0.36)', fontSize: 13, lineHeight: 1.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={14} /> No visual attached yet &mdash; attach one of the {sceneCountLabel(scene.suggestions.length, 'suggestion')} above, or upload your own.
                </div>
              ) : null}
              {!ttsAvailable && narration.trim() ? (
                <div style={{ marginTop: 12, padding: '11px 14px', borderRadius: 14, background: 'rgba(180,120,0,0.06)', border: '1px solid rgba(180,120,0,0.14)', color: '#3D2800', fontSize: 12.5, lineHeight: 1.5 }}>
                  <span style={{ color: '#B4720A', fontWeight: 700 }}>Text overlay instruction:</span> burn &ldquo;{narration.slice(0, 160)}{narration.length > 160 ? '…' : ''}&rdquo; over this screen.
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {analysis.withoutVisualCount > 0 ? (
        <div style={{ marginTop: 16, padding: '13px 15px', borderRadius: 14, color: '#B45309', background: 'rgba(200,146,10,.12)', border: '1px solid rgba(180,120,0,0.36)', fontSize: 13, lineHeight: 1.5 }}>
          {sceneCountLabel(analysis.withoutVisualCount)} still {analysis.withoutVisualCount === 1 ? 'has' : 'have'} no visual attached. You can render anyway &mdash; those scenes fall back to the coded product mockup.
        </div>
      ) : null}

      <button onClick={props.onContinue} disabled={running} style={{ width: '100%', marginTop: 18, border: 0, borderRadius: 999, padding: '16px 22px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, background: running ? 'rgba(180,120,0,0.14)' : 'linear-gradient(90deg,#E8B737,#C8920A)', color: running ? '#7A6030' : '#fff', fontSize: 16, fontWeight: 850, cursor: running ? 'wait' : 'pointer' }}>
        {running ? <Loader2 size={19} className="animate-spin" /> : <Sparkles size={19} />}{running ? 'Creating your video...' : 'Continue to Video with this narration'}
      </button>
    </section>
  );
}
