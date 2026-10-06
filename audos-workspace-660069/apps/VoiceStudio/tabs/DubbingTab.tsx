import { useEffect, useRef, useState } from 'react';
import { Globe, Languages } from 'lucide-react';
import { createDub, dubStatus, dubbedTrack, type DubStatus } from '../lib/elevenlabs';
import { CORE_LANGUAGES, EXTENDED_LANGUAGES, languageLabel } from '../lib/languages';
import { download, formatBytes, revokeBlobUrl, sleep, uploadToWorkspace } from '../lib/runtime';
import { useKeyVerdict } from '../hooks/useKeyVerdict';
import {
  AudioPlayer,
  Dropzone,
  EmptyState,
  Field,
  FileRow,
  GlassCard,
  Notice,
  PrimaryButton,
  ProgressBar,
  ProgressRail,
  Segmented,
  Select,
  T,
  TabHeader,
  TextInput,
  Toggle,
  useToast,
  type RailStep,
} from '../components/Ui';

const ACCEPT = 'video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4,audio/m4a,.mp4,.mov,.webm,.mp3,.wav,.m4a';
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const POLL_MS = 5000;
/** A stuck job must stop polling rather than spin until the tab is closed. */
const POLL_CEILING_MS = 25 * 60 * 1000;

const LANGUAGE_OPTIONS = [
  ...CORE_LANGUAGES.map((lang) => ({ id: lang.code, label: lang.native ? `${lang.label} — ${lang.native}` : lang.label, group: 'Core languages' })),
  ...EXTENDED_LANGUAGES.map((lang) => ({
    id: lang.code,
    label: lang.native ? `${lang.label} — ${lang.native}` : lang.label,
    group: 'Extended — depends on your ElevenLabs plan',
  })),
];

const SOURCE_OPTIONS = [{ id: 'auto', label: 'Auto-detect' }, ...LANGUAGE_OPTIONS];
const SPEAKER_OPTIONS = [
  { id: 'auto', label: 'Auto-detect' },
  { id: '1', label: '1 speaker' },
  { id: '2', label: '2 speakers' },
  { id: '3', label: '3 speakers' },
  { id: '4', label: '4 speakers' },
  { id: '5', label: '5 speakers' },
];

export default function DubbingTab() {
  const toast = useToast();
  const [mode, setMode] = useState<'upload' | 'url'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [targetLang, setTargetLang] = useState('hi');
  const [sourceLang, setSourceLang] = useState('auto');
  const [speakers, setSpeakers] = useState('auto');
  const [watermark, setWatermark] = useState(true);
  const [name, setName] = useState('');

  const [steps, setSteps] = useState<RailStep[] | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ url: string; language: string } | null>(null);
  const cancelled = useRef(false);

  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  const { unusable, message: keyMessage } = useKeyVerdict();

  const take = (files: File[]) => {
    const next = files[0];
    if (!next) return;
    if (next.size > MAX_UPLOAD_BYTES) {
      toast('error', 'That file is over 50 MB, which is the upload ceiling here. Paste a public URL to the video instead.');
      return;
    }
    setFile(next);
    setResult(null);
  };

  const setStep = (index: number, patch: Partial<RailStep>) =>
    setSteps((prev) => (prev ? prev.map((step, i) => (i === index ? { ...step, ...patch } : step)) : prev));

  const run = async () => {
    const ready = mode === 'upload' ? Boolean(file) : /^https?:\/\//i.test(sourceUrl.trim());
    if (!ready) {
      toast('info', mode === 'upload' ? 'Add a video or audio file first.' : 'Paste a public http(s) URL to the video.');
      return;
    }

    cancelled.current = false;
    setRunning(true);
    revokeBlobUrl(result?.url);
    setResult(null);
    setProgress(0);
    setSteps([
      { label: mode === 'upload' ? 'Uploading your file' : 'Checking the source URL', state: 'active' },
      { label: 'Submitting the dub to ElevenLabs', state: 'pending' },
      { label: `Dubbing into ${languageLabel(targetLang)}`, state: 'pending' },
      { label: 'Fetching the dubbed track', state: 'pending' },
    ]);

    try {
      // ElevenLabs reads its source from a URL, so an uploaded file goes to
      // workspace storage first and the resulting public address is handed over.
      let url = sourceUrl.trim();
      if (mode === 'upload' && file) {
        const uploaded = await uploadToWorkspace(file, file.name, 'voice-studio-dubbing');
        url = uploaded.url;
      }
      setStep(0, { state: 'done', detail: mode === 'upload' ? 'Stored in workspace storage' : undefined });
      setStep(1, { state: 'active' });

      const job = await createDub({
        sourceUrl: url,
        targetLang,
        sourceLang: sourceLang === 'auto' ? null : sourceLang,
        numSpeakers: speakers === 'auto' ? null : Number(speakers),
        watermark,
        name,
      });
      setStep(1, { state: 'done', detail: `Job ${job.dubbingId}` });
      setStep(2, {
        state: 'active',
        detail: job.expectedDurationSec ? `ElevenLabs expects about ${Math.round(job.expectedDurationSec)}s` : undefined,
      });

      const expected = Math.max(20, job.expectedDurationSec || 60);
      const startedAt = Date.now();
      let status: DubStatus = 'dubbing';
      let failure: string | undefined;

      while (!cancelled.current) {
        if (Date.now() - startedAt > POLL_CEILING_MS) {
          setStep(2, { state: 'failed', detail: 'Still dubbing after 25 minutes.' });
          throw new Error(
            `ElevenLabs is still working on dub ${job.dubbingId} after 25 minutes, so this tab stopped waiting. The job may still finish on ElevenLabs' side.`,
          );
        }
        await sleep(POLL_MS);
        if (cancelled.current) return;
        const snapshot = await dubStatus(job.dubbingId);
        status = snapshot.status;
        failure = snapshot.error;
        // The bar is driven by measured elapsed time against ElevenLabs' own
        // estimate and is capped below 100% until the job really reports done.
        setProgress(Math.min(0.95, (Date.now() - startedAt) / 1000 / expected));
        if (status !== 'dubbing') break;
      }
      if (cancelled.current) return;

      if (status === 'failed') {
        setStep(2, { state: 'failed', detail: failure || 'ElevenLabs reported the dub failed.' });
        throw new Error(failure || 'ElevenLabs could not dub that source.');
      }

      setProgress(1);
      setStep(2, { state: 'done' });
      setStep(3, { state: 'active' });
      const track = await dubbedTrack(job.dubbingId, targetLang);
      setStep(3, { state: 'done' });
      setResult({ url: track.url, language: targetLang });
      toast('success', `Dubbed into ${languageLabel(targetLang)}.`);
    } catch (e: any) {
      setSteps((prev) => (prev ? prev.map((step) => (step.state === 'active' ? { ...step, state: 'failed' } : step)) : prev));
      toast('error', String(e?.message || 'The dub could not be created.'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <TabHeader
        icon={Globe}
        title="Dubbing & Translation"
        description="Re-voice a finished video into another language, keeping each speaker's delivery."
      />

      {unusable && keyMessage ? (
        <div className="mb-4">
          <Notice tone="warning" title="Dubbing needs your own ElevenLabs key">
            {keyMessage}
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <GlassCard>
            <div className="mb-3">
              <Segmented
                value={mode}
                onChange={setMode}
                disabled={running}
                options={[
                  { id: 'upload', label: 'Upload a file' },
                  { id: 'url', label: 'Paste a video URL' },
                ]}
              />
            </div>
            {mode === 'upload' ? (
              <>
                <Dropzone
                  accept={ACCEPT}
                  disabled={running}
                  onFiles={take}
                  title={file ? 'Replace the source file' : 'Drop your video or audio here'}
                  hint="MP4, MOV, WEBM, MP3, WAV or M4A · up to 50 MB. Bigger files: host them and paste the URL."
                />
                {file ? (
                  <div className="mt-3">
                    <FileRow name={file.name} detail={formatBytes(file.size)} onRemove={running ? undefined : () => setFile(null)} />
                  </div>
                ) : null}
              </>
            ) : (
              <Field label="Video URL" hint="Must be publicly reachable">
                <TextInput
                  value={sourceUrl}
                  onChange={setSourceUrl}
                  disabled={running}
                  placeholder="https://example.com/my-video.mp4"
                />
              </Field>
            )}
          </GlassCard>

          {steps ? (
            <GlassCard>
              <ProgressRail steps={steps} />
              {running ? (
                <div className="mt-4">
                  <ProgressBar ratio={progress} label="Dubbing progress" />
                </div>
              ) : null}
            </GlassCard>
          ) : null}

          {result ? (
            <AudioPlayer
              src={result.url}
              title={`Dubbed audio — ${languageLabel(result.language)}`}
              onDownload={() => download(result.url, `voice-studio-dub-${result.language}.mp3`)}
            />
          ) : null}

          {!steps ? (
            <EmptyState
              icon={Languages}
              title="One video, every market"
              body="Point this at a finished video and pick a target language. ElevenLabs separates the speakers, translates what they said and re-voices each one, so a single Hindi explainer can ship in Tamil, Spanish and German without re-filming."
              suggestions={['Hindi → Tamil', 'English → Hindi', 'Hindi → English']}
              onPick={(suggestion) => {
                const map: Record<string, { source: string; target: string }> = {
                  'Hindi → Tamil': { source: 'hi', target: 'ta' },
                  'English → Hindi': { source: 'en', target: 'hi' },
                  'Hindi → English': { source: 'hi', target: 'en' },
                };
                const pick = map[suggestion];
                if (!pick) return;
                setSourceLang(pick.source);
                setTargetLang(pick.target);
              }}
            />
          ) : null}
        </div>

        <div className="space-y-4">
          <GlassCard>
            <div className="space-y-4">
              <Field label="Target language">
                <Select value={targetLang} onChange={setTargetLang} options={LANGUAGE_OPTIONS} disabled={running} />
              </Field>
              <Field label="Source language" hint="Auto-detect is usually right">
                <Select value={sourceLang} onChange={setSourceLang} options={SOURCE_OPTIONS} disabled={running} />
              </Field>
              <Field label="Number of speakers">
                <Select value={speakers} onChange={setSpeakers} options={SPEAKER_OPTIONS} disabled={running} />
              </Field>
              <Field label="Project name" hint="Optional">
                <TextInput value={name} onChange={setName} disabled={running} placeholder="Diwali launch — Tamil cut" />
              </Field>
              <Toggle
                label="Watermark the output"
                checked={watermark}
                onChange={setWatermark}
                disabled={running}
                hint="Free ElevenLabs tiers require this. Turn it off only if your plan allows an unwatermarked dub."
              />
            </div>
          </GlassCard>

          <Notice tone="info" title="Extended languages">
            The Core group is ElevenLabs' documented 29-language set. Anything under Extended — including Telugu, Bengali, Marathi
            and Gujarati — depends on the plan and model behind your key; if it is not available, ElevenLabs says so and nothing is
            charged for a finished dub.
          </Notice>

          <PrimaryButton
            full
            icon={Globe}
            busy={running}
            disabled={unusable || (mode === 'upload' ? !file : !sourceUrl.trim())}
            onClick={run}
          >
            {running ? 'Dubbing…' : 'Create dub'}
          </PrimaryButton>
          {running ? (
            <p className="text-center text-[11px]" style={{ color: T.textMuted }}>
              Status is checked every 5 seconds. Leave this tab open until it finishes.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
