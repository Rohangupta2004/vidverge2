/**
 * VidVerge Create — THE MANUAL PATH.
 *
 * The agentic path is the product: a director reads the brief and writes the
 * shots. This is the other door, for the person who already knows the shots
 * and does not want a model rewriting them. They type one prompt per scene and
 * it renders exactly that.
 *
 * WHAT IS SHARED AND WHAT IS NOT. Only the WRITING is skipped. The scenes go
 * into apps/Create/agenticRunner.ts through startManualProduction(), which
 * builds the shot list from those prompts and hands it to the same run loop the
 * agentic path uses — same continuity agent, same router, same engines, same
 * live board, same final cut in My Videos. Two ways in, one pipeline.
 *
 * NO GATES. Submitting starts the render. There is no review screen, no
 * confirmation dialog and no "are you sure": the board appears with per-shot
 * status and the run is already moving.
 */
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Play, UserRound, X } from 'lucide-react';
import { uploadImage } from './studioApi';
import {
  MANUAL_MAX_SCENES,
  MANUAL_SCENE_SECONDS,
  setProductionAspect,
  setProductionTone,
  startManualProduction,
  useProduction,
} from './agenticRunner';
import { VEO_PROMPT_MAX, VEO_PROMPT_MIN } from './agenticTypes';
import { TONES } from './videoTypes';
import {
  Card,
  Chip,
  ErrorNotice,
  FieldLabel,
  FONT,
  GhostButton,
  PrimaryButton,
  SectionLabel,
  T,
  TextArea,
  TextInput,
} from './ui';

export type CreateTab = 'agentic' | 'manual';

// The tab lives in module scope for the same reason the run does: the shell
// unmounts the whole app whenever the visitor opens another one, and coming
// back to a different tab than you left on is disorienting.
let activeTab: CreateTab = 'agentic';
const tabListeners = new Set<() => void>();

export function getCreateTab(): CreateTab {
  return activeTab;
}

export function setCreateTab(tab: CreateTab): void {
  if (activeTab === tab) return;
  activeTab = tab;
  tabListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.warn('[Manual] tab listener failed:', error);
    }
  });
}

export function useCreateTab(): CreateTab {
  const [tab, setTab] = useState<CreateTab>(getCreateTab);
  useEffect(() => {
    const sync = () => setTab(getCreateTab());
    sync();
    tabListeners.add(sync);
    return () => {
      tabListeners.delete(sync);
    };
  }, []);
  return tab;
}

/** The two-way switch that sits above both forms. */
export function CreateTabs({ value, onChange }: { value: CreateTab; onChange: (tab: CreateTab) => void }) {
  const options: { id: CreateTab; label: string; note: string }[] = [
    { id: 'agentic', label: 'Agentic', note: 'We write the shots' },
    { id: 'manual', label: 'Manual', note: 'You write the shots' },
  ];
  return (
    <div
      role="tablist"
      aria-label="How this video is written"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 6,
        padding: 6,
        marginBottom: 22,
        borderRadius: 16,
        border: `1px solid ${T.border}`,
        background: 'rgba(255,255,255,0.03)',
      }}
      data-testid="tabs-create-mode"
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.id)}
            className="rc-press rc-ring"
            data-testid={`tab-create-${option.id}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              minHeight: 52,
              padding: '9px 12px',
              borderRadius: 12,
              cursor: 'pointer',
              fontFamily: FONT,
              color: selected ? '#fff' : T.sub,
              border: selected ? `1px solid ${T.accentBorder}` : '1px solid transparent',
              background: selected ? T.accentSoft : 'transparent',
              transition: 'all .15s ease',
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 650 }}>{option.label}</span>
            <span style={{ fontSize: 11, color: selected ? T.accentFg : T.muted }}>{option.note}</span>
          </button>
        );
      })}
    </div>
  );
}

function promptError(prompt: string): string {
  const length = prompt.trim().length;
  if (length === 0) return 'This scene still needs a prompt.';
  if (length < VEO_PROMPT_MIN) return `At least ${VEO_PROMPT_MIN} characters.`;
  if (length > VEO_PROMPT_MAX) return `${VEO_PROMPT_MAX} characters maximum.`;
  return '';
}

export default function ManualCreate() {
  const production = useProduction();
  const [sceneCount, setSceneCount] = useState(1);
  const [secondsPerScene, setSecondsPerScene] = useState(30);
  const [prompts, setPrompts] = useState<string[]>(['', '', '']);
  const [characterDescription, setCharacterDescription] = useState('');
  const [characterPhotoUrl, setCharacterPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [touched, setTouched] = useState(false);
  const photoRef = useRef<HTMLInputElement | null>(null);

  const active = prompts.slice(0, sceneCount);
  const errors = active.map(promptError);
  const ready = errors.every((error) => !error);
  const totalSeconds = sceneCount * secondsPerScene;

  const setPrompt = (index: number, value: string) => {
    setPrompts((current) => current.map((prompt, at) => (at === index ? value.slice(0, VEO_PROMPT_MAX) : prompt)));
  };

  const uploadPhoto = async (file: File | null) => {
    if (!file) return;
    setUploadError('');
    setUploading(true);
    try {
      setCharacterPhotoUrl(await uploadImage(file, 'characters'));
    } catch (error: any) {
      setUploadError((error && error.message) || 'That photo could not be uploaded — try another one.');
    } finally {
      setUploading(false);
    }
  };

  const submit = () => {
    setTouched(true);
    if (!ready || uploading) return;
    void startManualProduction({
      sceneCount,
      secondsPerScene,
      prompts: active,
      characterDescription,
      characterPhotoUrl,
    });
  };

  return (
    <div className="rc-fade" style={{ width: '100%', maxWidth: 860, margin: '0 auto' }}>
      <h1
        className="rc-grad-text"
        style={{ margin: 0, fontSize: 'clamp(22px, 4.4vw, 30px)', fontWeight: 750, letterSpacing: -0.8 }}
      >
        Write it yourself
      </h1>
      <p style={{ margin: '10px 0 26px', fontSize: 14.5, lineHeight: 1.65, color: T.sub, maxWidth: 620 }}>
        No scripting agent, no rewriting. Type the prompt for each scene and it renders exactly that, through the same
        engine and the same final cut as the agentic path.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        <div>
          <SectionLabel style={{ marginBottom: 10 }}>Scenes</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {Array.from({ length: MANUAL_MAX_SCENES }, (_, index) => index + 1).map((count) => (
              <Chip
                key={count}
                selected={sceneCount === count}
                onClick={() => setSceneCount(count)}
                testId={`chip-manual-scenes-${count}`}
              >
                {count} scene{count === 1 ? '' : 's'}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <SectionLabel style={{ marginBottom: 10 }}>Duration per scene</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {MANUAL_SCENE_SECONDS.map((seconds) => (
              <Chip
                key={seconds}
                selected={secondsPerScene === seconds}
                onClick={() => setSecondsPerScene(seconds)}
                testId={`chip-manual-seconds-${seconds}`}
              >
                {seconds}s
              </Chip>
            ))}
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 11.5, color: T.muted, lineHeight: 1.55 }}>
            {sceneCount} × {secondsPerScene}s ≈ {totalSeconds}s finished. Anything longer than one clip is rendered as
            consecutive shots that continue out of each other.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SectionLabel>Your prompts — one per scene</SectionLabel>
          {active.map((prompt, index) => {
            const length = prompt.trim().length;
            const error = touched ? errors[index] : '';
            const overLimit = length > VEO_PROMPT_MAX;
            return (
              <Card key={index} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <FieldLabel hint="Setting, subject, action, camera move, lighting — written the way you want it shot.">
                  Scene {index + 1}
                </FieldLabel>
                <TextArea
                  value={prompt}
                  onChange={(value) => setPrompt(index, value)}
                  rows={3}
                  placeholder="e.g. slow push-in on a barista pouring cold brew over ice in a sunlit window seat, warm morning light, shallow depth of field"
                  testId={`input-manual-prompt-${index + 1}`}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 11.5, color: error ? T.danger : T.muted }} role={error ? 'alert' : undefined}>
                    {error || `${VEO_PROMPT_MIN}–${VEO_PROMPT_MAX} characters`}
                  </span>
                  <span
                    style={{ fontSize: 11.5, fontWeight: 650, color: overLimit || (touched && !!error) ? T.danger : T.muted }}
                    data-testid={`count-manual-prompt-${index + 1}`}
                  >
                    {length}/{VEO_PROMPT_MAX}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>

        <div>
          <SectionLabel style={{ marginBottom: 10 }}>Character — optional</SectionLabel>
          <Card style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <FieldLabel hint="Describe the one person who has to look the same in every scene. Leave it empty for a video with nobody in it.">
                Character description
              </FieldLabel>
              <TextInput
                value={characterDescription}
                onChange={setCharacterDescription}
                placeholder="e.g. a woman in her thirties, short dark curls, olive linen shirt"
                testId="input-manual-character"
              />
            </div>

            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(event) => {
                void uploadPhoto(event.target.files && event.target.files[0]);
                event.currentTarget.value = '';
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 46,
                  height: 46,
                  borderRadius: 12,
                  flexShrink: 0,
                  overflow: 'hidden',
                  color: characterPhotoUrl ? T.accentFg : T.muted,
                  border: `1px solid ${characterPhotoUrl ? T.accentBorder : T.border}`,
                  background: characterPhotoUrl ? T.accentSoft : 'rgba(255,255,255,0.03)',
                }}
              >
                {characterPhotoUrl ? (
                  <img src={characterPhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <UserRound size={16} />
                )}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: T.text }}>Character photo</span>
                <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, lineHeight: 1.5, color: T.muted }}>
                  Optional. It becomes the reference every scene points back at.
                </span>
              </span>
              {characterPhotoUrl ? (
                <GhostButton
                  onClick={() => setCharacterPhotoUrl('')}
                  testId="button-manual-clear-photo"
                  style={{ flexShrink: 0, minHeight: 40 }}
                >
                  <X size={13} /> Remove
                </GhostButton>
              ) : (
                <GhostButton
                  onClick={() => photoRef.current && photoRef.current.click()}
                  disabled={uploading}
                  testId="button-manual-upload-photo"
                  style={{ flexShrink: 0, minHeight: 40 }}
                >
                  {uploading ? <Loader2 size={13} className="rc-spin" /> : <ImagePlus size={13} />}
                  {uploading ? 'Uploading…' : 'Add'}
                </GhostButton>
              )}
            </div>
            {uploadError ? <ErrorNotice>{uploadError}</ErrorNotice> : null}
          </Card>
        </div>

        <div>
          <SectionLabel style={{ marginBottom: 10 }}>Format</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            <Chip
              selected={production.aspect === '9:16'}
              onClick={() => setProductionAspect('9:16')}
              testId="chip-manual-vertical"
            >
              Vertical
            </Chip>
            <Chip
              selected={production.aspect === '16:9'}
              onClick={() => setProductionAspect('16:9')}
              testId="chip-manual-wide"
            >
              Wide
            </Chip>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8 }}>
            {TONES.map((tone) => (
              <Chip
                key={tone.id}
                selected={production.toneId === tone.id}
                onClick={() => setProductionTone(tone.id)}
                testId={`chip-manual-tone-${tone.id}`}
              >
                {tone.label}
              </Chip>
            ))}
          </div>
        </div>

        {production.error ? <ErrorNotice>{production.error}</ErrorNotice> : null}

        <PrimaryButton
          onClick={submit}
          disabled={uploading || (touched && !ready)}
          full
          testId="button-start-manual"
          style={{ minHeight: 56, fontSize: 16, borderRadius: 14 }}
        >
          <Play size={17} /> Generate {sceneCount} scene{sceneCount === 1 ? '' : 's'} · {totalSeconds}s
        </PrimaryButton>
        <p style={{ margin: 0, fontSize: 12, color: T.muted, textAlign: 'center', lineHeight: 1.6 }}>
          This starts the render straight away — there is nothing else to confirm. Progress appears shot by shot on the
          board, and the download shows up there the moment the cut is finished.
        </p>
      </div>
    </div>
  );
}
