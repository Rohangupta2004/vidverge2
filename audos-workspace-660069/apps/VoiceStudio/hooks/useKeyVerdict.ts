// Subscribes to the module-level verdict on the founder's own ElevenLabs key.
// The verdict is probed once per session by whichever call happens first, so a
// tab that opens later needs to be told about it rather than probing again.
import { useEffect, useState } from 'react';
import { keyVerdict, keyVerdictMessage, onKeyVerdictChange, type KeyVerdict } from '../lib/secretsProxy';

export function useKeyVerdict(): { verdict: KeyVerdict; unusable: boolean; message: string | null } {
  const [verdict, setVerdict] = useState<KeyVerdict>(keyVerdict());

  useEffect(() => {
    setVerdict(keyVerdict());
    return onKeyVerdictChange(setVerdict);
  }, []);

  return {
    verdict,
    unusable: verdict === 'missing' || verdict === 'host-not-allowed' || verdict === 'rejected',
    message: keyVerdictMessage(verdict),
  };
}
