/**
 * Short Video Enhancer — Hinglish caption support.
 *
 * Hinglish is romanized Hindi mixed with English: "Yaar, yeh video ekdum fire
 * hai!". It is Latin script from end to end, so the heavy Inter stack this
 * app already ships renders it correctly and NO new font is loaded.
 *
 * WHAT IS LEFT IN HERE is vocabulary and the creator's saved choice. The
 * five-tier caption style system this language selector used to own now
 * applies to EVERY track whatever its language, and lives in
 * `lib/sveCaptionTiers.ts`. Picking Hinglish changes two things and nothing
 * else:
 *
 *   1. the filler list the key-word picker and the B-roll keyword picker
 *      skip, so neither offers to pin a cutaway to "karna" or pop "hain";
 *   2. the five reference sample lines the editor can drop into a clip.
 */

import type { CaptionLanguage, EditDoc } from './sveTypes';

/** Where the creator's language choice is remembered between sessions. */
export const CAPTION_LANGUAGE_KEY = 'sve:captionLanguage';

/**
 * Five reference lines, one per caption tier, for trying the mixed style out
 * on a real clip: ordinary dialogue, a kinetic key word, a cinematic hook, a
 * beat line and a timeline row.
 */
export const HINGLISH_SAMPLE_LINES: string[] = [
  'Yaar, yeh video ekdum fire hai!',
  'FORGET mat karo — revision karo!',
  "BRAIN ISN'T THE PROBLEM.",
  'Sirf 15 MINUTES daily.',
  '1 → 3 → 7 → 14 DIN',
];

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** English filler. Never a B-roll keyword, never the word worth popping. */
export const EN_STOP_WORDS = new Set([
  'the', 'and', 'but', 'for', 'you', 'your', 'that', 'this', 'with', 'have', 'has',
  'are', 'was', 'were', 'they', 'them', 'from', 'what', 'when', 'will', 'just',
  'about', 'into', 'than', 'then', 'there', 'their', 'been', 'because', 'very',
  'like', 'some', 'more', 'most', 'make', 'made', 'gonna', 'really', 'actually',
]);

/**
 * Romanized Hindi function words. Without these the keyword picker would
 * happily pin B-roll to "karna" or pop "hain", because they are long enough to
 * beat the English length test.
 */
export const HI_STOP_WORDS = new Set([
  'aur', 'ya', 'ka', 'ki', 'ke', 'ko', 'se', 'me', 'mein', 'par', 'pe', 'tak', 'sath',
  'hai', 'hain', 'ho', 'hoga', 'hogi', 'hota', 'hoti', 'hote', 'tha', 'thi', 'the',
  'yeh', 'ye', 'woh', 'wo', 'is', 'us', 'in', 'un', 'iska', 'iski', 'iske',
  'uska', 'uski', 'uske', 'kya', 'kyu', 'kyun', 'kyunki', 'jo', 'joh', 'koi', 'kuch',
  'sab', 'toh', 'to', 'bhi', 'nahi', 'nahin', 'na', 'mat', 'ab', 'tab', 'jab',
  'phir', 'fir', 'abhi', 'agar', 'lekin', 'magar', 'liye', 'wala', 'wali', 'wale',
  'kar', 'karo', 'karna', 'karne', 'kiya', 'karte', 'karta', 'karti',
  'raha', 'rahe', 'rahi', 'apna', 'apne', 'apni', 'mera', 'meri', 'mere',
  'tera', 'teri', 'tere', 'tumhara', 'tumhari', 'hum', 'tum', 'aap', 'main', 'mai',
  'jaise', 'waise', 'aisa', 'aise', 'aisi', 'yahan', 'wahan', 'kahan',
]);

/**
 * Intensifiers and hook words, in both languages.
 *
 * A line carrying one of these is the line a creator would make big, so it
 * scores toward the cinematic band and supplies the kinetic key word. The
 * list is read for every track, not only a Hinglish one — "forget",
 * "mistake" and "secret" are hook words in English too.
 */
export const HI_PUNCH_WORDS = new Set([
  'yaar', 'bhai', 'arre', 'are', 'ekdum', 'bilkul', 'pakka', 'sach', 'sachme',
  'sirf', 'bas', 'seedha', 'zaroori', 'jaruri', 'zarurat', 'jhakaas', 'mast',
  'dekho', 'suno', 'samjho', 'yaad', 'bhool', 'galti', 'matlab', 'guarantee',
  'forget', 'revision', 'practice', 'mistake', 'problem', 'solution', 'secret',
  'trick', 'hack', 'fire', 'insane', 'crazy', 'important', 'score', 'rank',
  'topper', 'stop', 'never', 'always', 'free', 'best', 'worst', 'fail', 'pass',
]);

/** True when the word carries no meaning worth pinning or popping. */
export function isStopWord(word: string, language: CaptionLanguage): boolean {
  const w = String(word || '').toLowerCase().replace(/[^a-z0-9']/g, '');
  if (!w) return true;
  if (EN_STOP_WORDS.has(w)) return true;
  return language === 'hinglish' && HI_STOP_WORDS.has(w);
}

// ---------------------------------------------------------------------------
// The creator's saved choice
// ---------------------------------------------------------------------------

export function readStoredCaptionLanguage(): CaptionLanguage | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(CAPTION_LANGUAGE_KEY);
    if (raw === 'hinglish') return 'hinglish';
    if (raw === 'en') return 'en';
    return null;
  } catch {
    return null;
  }
}

export function storeCaptionLanguage(language: CaptionLanguage): void {
  try {
    window.localStorage.setItem(CAPTION_LANGUAGE_KEY, language);
  } catch {
    /* storage unavailable — the choice still applies to this edit */
  }
}

/**
 * Seed a fresh or restored document with the language saved on this device.
 * Nothing stored means nothing changes, so a first visit still opens whatever
 * the saved project itself asked for.
 */
export function applyStoredCaptionLanguage(doc: EditDoc): EditDoc {
  const language = readStoredCaptionLanguage();
  if (!language || language === doc.caption.language) return doc;
  return { ...doc, caption: { ...doc.caption, language } };
}
