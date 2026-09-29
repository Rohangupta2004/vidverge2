/**
 * LightBeam icon set.
 *
 * The apps already draw from lucide-react, which is platform-pinned, so this
 * module re-exports the subset the LightBeam surfaces use under stable
 * names. Importing icons from here (rather than reaching into lucide in each
 * app) keeps one place to swap the set later, and keeps sizing consistent.
 *
 * Pair them with `iconProps` so every LightBeam icon has the same weight.
 */
export {
  // pipeline + production
  Clapperboard as IconFilm,
  Film as IconReel,
  Sparkles as IconGenerate,
  Wand2 as IconEnhance,
  Layers as IconScenes,
  Target as IconAds,
  Video as IconVideo,
  Rocket as IconLaunch,
  // transport
  Play as IconPlay,
  Pause as IconPause,
  Scissors as IconTrim,
  // io
  UploadCloud as IconUpload,
  Download as IconDownload,
  RefreshCw as IconRetry,
  // state
  Check as IconCheck,
  AlertCircle as IconAlert,
  ChevronRight as IconNext,
  ArrowLeft as IconBack,
  X as IconClose,
  Loader2 as IconBusy,
} from 'lucide-react';

/** Consistent stroke weight and size for LightBeam surfaces. */
export const iconProps = { size: 15, strokeWidth: 1.75 } as const;
export const iconPropsSmall = { size: 13, strokeWidth: 1.75 } as const;
export const iconPropsLarge = { size: 19, strokeWidth: 1.6 } as const;
