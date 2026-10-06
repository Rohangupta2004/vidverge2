// Target languages for video translation.
//
// HeyGen advertises 175+ languages, and the authoritative list is HeyGen's
// own — `fetchTargetLanguages` asks for it first. The bundled list below is
// the fallback for an account whose plan does not expose a language endpoint,
// so the dropdown is never empty and never silently short.
//
// Order is deliberate: the languages SceneForge's customers reach for most
// (India's major languages, then the global majors) sit at the top, and the
// long tail follows alphabetically.
import { get, listOf } from './heygenApi';

export interface TargetLanguage {
  /** The value sent as `target_language`. */
  code: string;
  label: string;
}

export const BUNDLED_LANGUAGES: TargetLanguage[] = [
  { code: 'hindi', label: 'Hindi' },
  { code: 'english', label: 'English' },
  { code: 'bengali', label: 'Bengali' },
  { code: 'tamil', label: 'Tamil' },
  { code: 'telugu', label: 'Telugu' },
  { code: 'marathi', label: 'Marathi' },
  { code: 'gujarati', label: 'Gujarati' },
  { code: 'kannada', label: 'Kannada' },
  { code: 'malayalam', label: 'Malayalam' },
  { code: 'punjabi', label: 'Punjabi' },
  { code: 'odia', label: 'Odia' },
  { code: 'assamese', label: 'Assamese' },
  { code: 'urdu', label: 'Urdu' },
  { code: 'spanish', label: 'Spanish' },
  { code: 'mandarin', label: 'Chinese (Mandarin)' },
  { code: 'arabic', label: 'Arabic' },
  { code: 'french', label: 'French' },
  { code: 'german', label: 'German' },
  { code: 'portuguese', label: 'Portuguese' },
  { code: 'russian', label: 'Russian' },
  { code: 'japanese', label: 'Japanese' },
  { code: 'korean', label: 'Korean' },
  { code: 'italian', label: 'Italian' },
  { code: 'indonesian', label: 'Indonesian' },
  { code: 'dutch', label: 'Dutch' },
  { code: 'turkish', label: 'Turkish' },
  { code: 'vietnamese', label: 'Vietnamese' },
  { code: 'polish', label: 'Polish' },
  { code: 'thai', label: 'Thai' },
  { code: 'filipino', label: 'Filipino (Tagalog)' },
  { code: 'swahili', label: 'Swahili' },
  { code: 'afrikaans', label: 'Afrikaans' },
  { code: 'albanian', label: 'Albanian' },
  { code: 'amharic', label: 'Amharic' },
  { code: 'armenian', label: 'Armenian' },
  { code: 'azerbaijani', label: 'Azerbaijani' },
  { code: 'basque', label: 'Basque' },
  { code: 'belarusian', label: 'Belarusian' },
  { code: 'bosnian', label: 'Bosnian' },
  { code: 'bulgarian', label: 'Bulgarian' },
  { code: 'burmese', label: 'Burmese' },
  { code: 'cantonese', label: 'Chinese (Cantonese)' },
  { code: 'catalan', label: 'Catalan' },
  { code: 'cebuano', label: 'Cebuano' },
  { code: 'chichewa', label: 'Chichewa' },
  { code: 'corsican', label: 'Corsican' },
  { code: 'croatian', label: 'Croatian' },
  { code: 'czech', label: 'Czech' },
  { code: 'danish', label: 'Danish' },
  { code: 'dari', label: 'Dari' },
  { code: 'esperanto', label: 'Esperanto' },
  { code: 'estonian', label: 'Estonian' },
  { code: 'ewe', label: 'Ewe' },
  { code: 'finnish', label: 'Finnish' },
  { code: 'frisian', label: 'Frisian' },
  { code: 'galician', label: 'Galician' },
  { code: 'georgian', label: 'Georgian' },
  { code: 'greek', label: 'Greek' },
  { code: 'guarani', label: 'Guarani' },
  { code: 'haitian-creole', label: 'Haitian Creole' },
  { code: 'hausa', label: 'Hausa' },
  { code: 'hawaiian', label: 'Hawaiian' },
  { code: 'hebrew', label: 'Hebrew' },
  { code: 'hmong', label: 'Hmong' },
  { code: 'hungarian', label: 'Hungarian' },
  { code: 'icelandic', label: 'Icelandic' },
  { code: 'igbo', label: 'Igbo' },
  { code: 'ilocano', label: 'Ilocano' },
  { code: 'irish', label: 'Irish' },
  { code: 'javanese', label: 'Javanese' },
  { code: 'kazakh', label: 'Kazakh' },
  { code: 'khmer', label: 'Khmer' },
  { code: 'kinyarwanda', label: 'Kinyarwanda' },
  { code: 'kurdish', label: 'Kurdish' },
  { code: 'kyrgyz', label: 'Kyrgyz' },
  { code: 'lao', label: 'Lao' },
  { code: 'latin', label: 'Latin' },
  { code: 'latvian', label: 'Latvian' },
  { code: 'lingala', label: 'Lingala' },
  { code: 'lithuanian', label: 'Lithuanian' },
  { code: 'luxembourgish', label: 'Luxembourgish' },
  { code: 'macedonian', label: 'Macedonian' },
  { code: 'malagasy', label: 'Malagasy' },
  { code: 'malay', label: 'Malay' },
  { code: 'maltese', label: 'Maltese' },
  { code: 'maori', label: 'Maori' },
  { code: 'mongolian', label: 'Mongolian' },
  { code: 'nepali', label: 'Nepali' },
  { code: 'norwegian', label: 'Norwegian' },
  { code: 'oromo', label: 'Oromo' },
  { code: 'pashto', label: 'Pashto' },
  { code: 'persian', label: 'Persian (Farsi)' },
  { code: 'quechua', label: 'Quechua' },
  { code: 'romanian', label: 'Romanian' },
  { code: 'samoan', label: 'Samoan' },
  { code: 'scots-gaelic', label: 'Scots Gaelic' },
  { code: 'serbian', label: 'Serbian' },
  { code: 'sesotho', label: 'Sesotho' },
  { code: 'shona', label: 'Shona' },
  { code: 'sindhi', label: 'Sindhi' },
  { code: 'sinhala', label: 'Sinhala' },
  { code: 'slovak', label: 'Slovak' },
  { code: 'slovenian', label: 'Slovenian' },
  { code: 'somali', label: 'Somali' },
  { code: 'sundanese', label: 'Sundanese' },
  { code: 'swedish', label: 'Swedish' },
  { code: 'tajik', label: 'Tajik' },
  { code: 'tatar', label: 'Tatar' },
  { code: 'tibetan', label: 'Tibetan' },
  { code: 'tigrinya', label: 'Tigrinya' },
  { code: 'tsonga', label: 'Tsonga' },
  { code: 'turkmen', label: 'Turkmen' },
  { code: 'twi', label: 'Twi' },
  { code: 'ukrainian', label: 'Ukrainian' },
  { code: 'uyghur', label: 'Uyghur' },
  { code: 'uzbek', label: 'Uzbek' },
  { code: 'welsh', label: 'Welsh' },
  { code: 'wolof', label: 'Wolof' },
  { code: 'xhosa', label: 'Xhosa' },
  { code: 'yiddish', label: 'Yiddish' },
  { code: 'yoruba', label: 'Yoruba' },
  { code: 'zulu', label: 'Zulu' },
];

function normalize(entry: any): TargetLanguage | null {
  if (typeof entry === 'string') {
    const code = entry.trim();
    if (!code) return null;
    return { code, label: code.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) };
  }
  const code = String(entry?.language || entry?.code || entry?.target_language || entry?.language_code || entry?.name || '').trim();
  if (!code) return null;
  const label = String(entry?.label || entry?.display_name || entry?.name || code).trim();
  return { code, label };
}

/**
 * HeyGen's live language list, falling back to the bundled one.
 *
 * Two candidate routes are tried because the translation API's language
 * endpoint is not part of the documented platform contract. Whichever answers
 * wins; if neither does, the bundled list ships and the UI is none the wiser.
 */
export async function fetchTargetLanguages(): Promise<{ languages: TargetLanguage[]; live: boolean }> {
  for (const path of ['v3/video-translations/target-languages', 'v2/video_translate/target_languages']) {
    try {
      const payload = await get(path);
      const languages = listOf(payload).map(normalize).filter(Boolean) as TargetLanguage[];
      if (languages.length >= 20) {
        const seen = new Set<string>();
        const unique = languages.filter((language) => {
          const key = language.code.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return { languages: unique, live: true };
      }
    } catch { /* try the next candidate, then the bundled list */ }
  }
  return { languages: BUNDLED_LANGUAGES, live: false };
}
