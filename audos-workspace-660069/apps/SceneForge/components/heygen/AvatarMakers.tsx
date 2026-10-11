// The three ways to BUILD a presenter rather than pick one.
//
// Split out of AvatarPanel because these forms own a lot of transient state
// (the file, the prompt, the up-to-a-minute training wait) that the library
// grid has no business knowing about. The panel keeps the lock; this file only
// hands back a finished character.
import { useEffect, useState } from 'react';
import { Film, UserPlus } from 'lucide-react';
import { describeError } from '../../lib/heygenApi';
import { createCinematicAvatar, createPhotoAvatar, createPromptAvatar, type CreatedAvatar } from '../../lib/heygenAvatars';
import { setToggles, useHeyGenSession } from '../../lib/heygenSession';
import { Button, CapabilityNote, Field, Notice, Progress, Toggle } from './ui';

export type Maker = 'library' | 'photo' | 'prompt' | 'cinematic';
export type MakerOrigin = 'photo' | 'prompt' | 'cinematic';

export default function AvatarMakers({ maker, onCreated }: { maker: MakerOrigin; onCreated: (created: CreatedAvatar, origin: MakerOrigin) => void }) {
  const session = useHeyGenSession();
  const [building, setBuilding] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [photoName, setPhotoName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [cinematicPrompt, setCinematicPrompt] = useState('');

  useEffect(() => {
    if (!building) return;
    const clock = window.setInterval(() => setElapsed((current) => current + 1), 1000);
    return () => window.clearInterval(clock);
  }, [building]);

  async function build(kind: MakerOrigin, file?: File) {
    setError('');
    setElapsed(0);
    setBuilding(kind);
    try {
      if (kind === 'photo') {
        if (!file) return;
        const { avatar } = await createPhotoAvatar(file, photoName);
        onCreated(avatar, 'photo');
      } else if (kind === 'prompt') {
        onCreated(await createPromptAvatar(prompt), 'prompt');
      } else {
        onCreated(await createCinematicAvatar(cinematicPrompt, session.avatarId), 'cinematic');
        // Building a cinematic look is a statement of intent: the toggle that
        // actually applies it to renders is turned on rather than left off
        // for the customer to discover.
        setToggles({ cinematicMode: true });
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBuilding('');
    }
  }

  const fileInputClass = 'st-field file:mr-3 file:rounded-lg file:border-0 file:bg-[color-mix(in_srgb,#C8920A_22%,transparent)] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#1A1000]';

  return <div className="space-y-3">
    {maker === 'photo' ? <>
      <CapabilityNote capability="avatar-photo" label="Photo avatars" />
      <Field label="Name this character" hint="Shown on the lock badge so you can tell your characters apart.">
        <input value={photoName} onChange={(event) => setPhotoName(event.target.value)} placeholder="Me, on camera" className="st-field" />
      </Field>
      <Field label="Your photo" hint="A JPG, PNG or WebP of one person facing the camera. Building the avatar takes up to a minute.">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={Boolean(building)}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void build('photo', file);
          }}
          className={fileInputClass}
        />
      </Field>
    </> : null}

    {maker === 'prompt' ? <>
      <CapabilityNote capability="avatar-prompt" label="Prompt-built avatars" />
      <Field label="Describe your ideal character" hint="Age, look, clothing and setting. The more specific, the more consistent the result.">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          placeholder="A warm, 30-something Indian founder in a charcoal shirt, standing in a bright modern office"
          className="st-field resize-y"
        />
      </Field>
      <Button onClick={() => void build('prompt')} busy={building === 'prompt'} disabled={prompt.trim().length < 12}>
        <UserPlus className="h-4 w-4" />Build this character
      </Button>
    </> : null}

    {maker === 'cinematic' ? <>
      <CapabilityNote capability="avatar-cinematic" label="Cinematic avatars" />
      <Field label="Describe the cinematic look" hint="Framing, lighting and setting rather than the person — this is the shot, not the character.">
        <textarea
          value={cinematicPrompt}
          onChange={(event) => setCinematicPrompt(event.target.value)}
          rows={3}
          placeholder="Shallow-depth medium close-up, warm rim light, dusk window behind, premium product-ad feel"
          className="st-field resize-y"
        />
      </Field>
      <Toggle
        checked={session.cinematicMode}
        onChange={(value) => setToggles({ cinematicMode: value })}
        label="Cinematic mode on every scene"
        hint="Renders with HeyGen's film-style framing instead of the standard talking-head crop."
      />
      <Button onClick={() => void build('cinematic')} busy={building === 'cinematic'} disabled={!cinematicPrompt.trim()}>
        <Film className="h-4 w-4" />Build cinematic look
      </Button>
    </> : null}

    {building ? <Progress
      elapsedSec={elapsed}
      expectedSec={60}
      label={building === 'photo' ? 'Creating your avatar from your photo' : building === 'prompt' ? 'Building your character' : 'Rendering your cinematic look'}
    /> : null}
    {error ? <Notice tone="error" title="That character could not be built">{error}</Notice> : null}
  </div>;
}
