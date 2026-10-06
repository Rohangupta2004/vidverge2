// Dubbing languages, in two groups on purpose.
//
// CORE is ElevenLabs' documented 29-language set — the languages the
// multilingual models are built on, so a dub into one of these is expected to
// work. EXTENDED is everything else worth offering (including the rest of the
// Indian languages), kept in its own group because availability there depends
// on the ElevenLabs plan and model behind the key: an unsupported target comes
// back as the provider's own rejection rather than silently producing nothing.
// Listing them in one flat dropdown would promise 41 languages the account may
// not have.

export interface DubLanguage {
  code: string;
  label: string;
  native?: string;
}

export const CORE_LANGUAGES: DubLanguage[] = [
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'en', label: 'English' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்' },
  { code: 'ar', label: 'Arabic', native: 'العربية' },
  { code: 'bg', label: 'Bulgarian' },
  { code: 'zh', label: 'Chinese (Mandarin)', native: '中文' },
  { code: 'hr', label: 'Croatian' },
  { code: 'cs', label: 'Czech' },
  { code: 'da', label: 'Danish' },
  { code: 'nl', label: 'Dutch' },
  { code: 'fil', label: 'Filipino' },
  { code: 'fi', label: 'Finnish' },
  { code: 'fr', label: 'French', native: 'Français' },
  { code: 'de', label: 'German', native: 'Deutsch' },
  { code: 'el', label: 'Greek' },
  { code: 'id', label: 'Indonesian' },
  { code: 'it', label: 'Italian', native: 'Italiano' },
  { code: 'ja', label: 'Japanese', native: '日本語' },
  { code: 'ko', label: 'Korean', native: '한국어' },
  { code: 'ms', label: 'Malay' },
  { code: 'pl', label: 'Polish' },
  { code: 'pt', label: 'Portuguese', native: 'Português' },
  { code: 'ro', label: 'Romanian' },
  { code: 'ru', label: 'Russian', native: 'Русский' },
  { code: 'sk', label: 'Slovak' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'sv', label: 'Swedish' },
  { code: 'tr', label: 'Turkish', native: 'Türkçe' },
  { code: 'uk', label: 'Ukrainian' },
];

export const EXTENDED_LANGUAGES: DubLanguage[] = [
  { code: 'te', label: 'Telugu', native: 'తెలుగు' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা' },
  { code: 'mr', label: 'Marathi', native: 'मराठी' },
  { code: 'gu', label: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', label: 'Malayalam', native: 'മലയാളം' },
  { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਭੀ' },
  { code: 'ur', label: 'Urdu', native: 'اردو' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'he', label: 'Hebrew' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'no', label: 'Norwegian' },
];

export const ALL_LANGUAGES: DubLanguage[] = [...CORE_LANGUAGES, ...EXTENDED_LANGUAGES];

export function languageLabel(code: string): string {
  const match = ALL_LANGUAGES.find((entry) => entry.code === code);
  return match ? match.label : code.toUpperCase();
}
