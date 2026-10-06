// The four delivery controls ElevenLabs exposes on a voice. Shared by Text to
// Speech and Speech to Speech so the two tabs cannot drift apart on what they
// send or on what the numbers mean.
import type { VoiceSettings } from '../lib/elevenlabs';
import { Slider, Toggle } from './Ui';

export function VoiceSettingsPanel({
  value,
  onChange,
  disabled,
}: {
  value: VoiceSettings;
  onChange: (next: VoiceSettings) => void;
  disabled?: boolean;
}) {
  const percent = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <div className="space-y-4">
      <Slider
        label="Stability"
        value={value.stability}
        min={0}
        max={1}
        step={0.05}
        format={percent}
        disabled={disabled}
        hint="Lower is more expressive and varied. Higher is steadier and flatter."
        onChange={(stability) => onChange({ ...value, stability })}
      />
      <Slider
        label="Similarity boost"
        value={value.similarity_boost}
        min={0}
        max={1}
        step={0.05}
        format={percent}
        disabled={disabled}
        hint="How closely the output matches the original voice."
        onChange={(similarity_boost) => onChange({ ...value, similarity_boost })}
      />
      <Slider
        label="Style"
        value={value.style}
        min={0}
        max={1}
        step={0.05}
        format={percent}
        disabled={disabled}
        hint="Style exaggeration. Higher is more dramatic."
        onChange={(style) => onChange({ ...value, style })}
      />
      <Toggle
        label="Speaker boost"
        checked={value.use_speaker_boost}
        disabled={disabled}
        hint="Pushes the output closer to the original speaker."
        onChange={(use_speaker_boost) => onChange({ ...value, use_speaker_boost })}
      />
    </div>
  );
}
