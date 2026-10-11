// Voice Studio's UI kit. Colours are applied with inline styles rather than
// Tailwind arbitrary values so nothing depends on a class string being visible
// to the compiler, and so the amber accent is declared in exactly one place.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { AlertTriangle, CheckCircle2, Download, Info, Loader2, Pause, Play, Upload, X } from 'lucide-react';
import { formatClock } from '../lib/runtime';
import { COLORS } from '../../../components/theme';

/**
 * The app's palette, mapped onto the shared Vidverge dark-cosmic tokens in
 * components/theme.ts so Voice Studio reads as part of the same product family.
 * `page` stays transparent because the surrounding AppShell paints the ground
 * and runs the beam layer behind it.
 */
export const T = {
  accent: COLORS.primary,
  accentBright: COLORS.primaryGlow,
  accentDeep: '#b45309',
  accentSoft: 'rgba(200,146,10,0.14)',
  accentSofter: 'rgba(200,146,10,0.07)',
  accentLine: COLORS.borderHover,
  glass: 'rgba(255,255,255,0.78)',
  glassStrong: 'rgba(255,250,235,0.94)',
  inset: 'rgba(255,253,244,0.9)',
  border: COLORS.border,
  borderStrong: COLORS.borderHover,
  text: COLORS.text,
  textSecondary: '#3D2800',
  textMuted: COLORS.textMuted,
  success: '#166534',
  successSoft: 'rgba(22,101,52,0.12)',
  danger: '#991B1B',
  dangerSoft: 'rgba(153,27,27,0.12)',
  warning: '#B45309',
  warningSoft: 'rgba(180,83,9,0.12)',
  cyan: COLORS.accent,
  cyanBright: COLORS.accentGlow,
  page: 'transparent',
};

/**
 * Range inputs and the shimmer used by the skeletons cannot be styled inline,
 * so the few rules that need a stylesheet are injected once from the app root.
 */
export function StudioStyles() {
  return (
    <style>{`
      .vs-range { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 999px; outline: none; }
      .vs-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%;
        background: #ffffff; border: 3px solid ${T.accent}; cursor: pointer; box-shadow: 0 2px 10px rgba(200,146,10,0.55); }
      .vs-range::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: #ffffff; border: 3px solid ${T.accent};
        cursor: pointer; box-shadow: 0 2px 10px rgba(200,146,10,0.55); }
      .vs-range:disabled::-webkit-slider-thumb { border-color: ${T.borderStrong}; box-shadow: none; cursor: not-allowed; }
      @keyframes vs-shimmer { 0% { background-position: -420px 0; } 100% { background-position: 420px 0; } }
      .vs-skeleton { background-image: linear-gradient(90deg, rgba(180,120,0,0.06) 0%, rgba(180,120,0,0.14) 50%, rgba(180,120,0,0.06) 100%);
        background-size: 420px 100%; animation: vs-shimmer 1.4s linear infinite; }
      @keyframes vs-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      .vs-rise { animation: vs-rise 260ms cubic-bezier(0.22, 1, 0.36, 1) both; }
      @keyframes vs-toast-in { from { opacity: 0; transform: translateY(14px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
      .vs-toast { animation: vs-toast-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both; }
      @media (prefers-reduced-motion: reduce) {
        .vs-skeleton, .vs-rise, .vs-toast { animation: none !important; }
      }
      .vs-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
      .vs-scroll::-webkit-scrollbar-thumb { background: rgba(200,146,10,0.4); border-radius: 999px; }
      .vs-scroll::-webkit-scrollbar-thumb:hover { background: rgba(200,146,10,0.7); }
      .vs-scroll::-webkit-scrollbar-track { background: #FFFAEB; }
    `}</style>
  );
}

// ------------------------------------------------------------------ toasts ----

type ToastTone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<(tone: ToastTone, message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((prev) => [...prev.slice(-3), { id, tone, message }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), tone === 'error' ? 9000 : 5000);
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((toast) => toast.id !== id));

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-[min(26rem,calc(100vw-2.5rem))]">
        {toasts.map((toast) => {
          const tone =
            toast.tone === 'success'
              ? { color: T.success, background: T.successSoft, Icon: CheckCircle2 }
              : toast.tone === 'error'
                ? { color: T.danger, background: T.dangerSoft, Icon: AlertTriangle }
                : { color: T.accentBright, background: T.accentSoft, Icon: Info };
          return (
            <div
              key={toast.id}
              className="vs-toast flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm shadow-2xl"
              style={{
                background: T.glassStrong,
                border: `1px solid ${tone.color}55`,
                color: T.text,
                backdropFilter: 'blur(18px)',
              }}
            >
              <span className="mt-0.5 rounded-md p-1" style={{ background: tone.background }}>
                <tone.Icon className="h-3.5 w-3.5" style={{ color: tone.color }} />
              </span>
              <span className="flex-1 leading-snug">{toast.message}</span>
              <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss" className="mt-0.5 shrink-0">
                <X className="h-3.5 w-3.5" style={{ color: T.textMuted }} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------- surfaces ----

export function GlassCard({
  children,
  className = '',
  padded = true,
  tone = 'default',
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  tone?: 'default' | 'accent';
}) {
  return (
    <div
      className={`rounded-2xl ${padded ? 'p-4 sm:p-5' : ''} ${className}`}
      style={{
        background: tone === 'accent' ? `linear-gradient(160deg, ${T.accentSoft}, ${T.glass})` : T.glass,
        border: `1px solid ${tone === 'accent' ? T.accentLine : T.border}`,
        backdropFilter: 'blur(16px)',
      }}
    >
      {children}
    </div>
  );
}

export function TabHeader({
  icon: Icon,
  title,
  description,
  right,
}: {
  icon: ComponentType<any>;
  title: string;
  description: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
          style={{ background: T.accentSoft, border: `1px solid ${T.accentLine}` }}
        >
          <Icon className="h-5 w-5" style={{ color: T.accentBright }} />
        </span>
        <div>
          <h2 className="text-lg font-semibold leading-tight sm:text-xl" style={{ color: T.text }}>
            {title}
          </h2>
          <p className="mt-0.5 text-[13px] leading-snug" style={{ color: T.textMuted }}>
            {description}
          </p>
        </div>
      </div>
      {right}
    </div>
  );
}

export function Badge({ children, tone = 'accent' }: { children: ReactNode; tone?: 'accent' | 'success' | 'warning' | 'muted' }) {
  const map = {
    accent: { color: T.accentBright, background: T.accentSoft, border: T.accentLine },
    success: { color: T.success, background: T.successSoft, border: 'rgba(22,101,52,0.34)' },
    warning: { color: T.warning, background: T.warningSoft, border: 'rgba(180,83,9,0.34)' },
    muted: { color: T.textMuted, background: 'rgba(180,120,0,0.08)', border: T.border },
  }[tone];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: map.color, background: map.background, border: `1px solid ${map.border}` }}
    >
      {children}
    </span>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'error' | 'success';
  title?: string;
  children: ReactNode;
}) {
  const map = {
    info: { color: T.accentBright, background: T.accentSofter, border: T.accentLine, Icon: Info },
    warning: { color: T.warning, background: T.warningSoft, border: 'rgba(180,83,9,0.34)', Icon: AlertTriangle },
    error: { color: T.danger, background: T.dangerSoft, border: 'rgba(153,27,27,0.34)', Icon: AlertTriangle },
    success: { color: T.success, background: T.successSoft, border: 'rgba(22,101,52,0.34)', Icon: CheckCircle2 },
  }[tone];
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-[13px] leading-relaxed"
      style={{ background: map.background, border: `1px solid ${map.border}`, color: T.textSecondary }}
    >
      <map.Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: map.color }} />
      <div className="min-w-0">
        {title ? (
          <div className="mb-0.5 font-semibold" style={{ color: T.text }}>
            {title}
          </div>
        ) : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ inputs ----

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.textMuted }}>
          {label}
        </span>
        {hint ? (
          <span className="text-[11px]" style={{ color: T.textMuted }}>
            {hint}
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

const controlStyle = {
  background: T.inset,
  border: `1px solid ${T.border}`,
  color: T.text,
};

export function TextInput(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  type?: string;
}) {
  return (
    <input
      type={props.type || 'text'}
      value={props.value}
      disabled={props.disabled}
      maxLength={props.maxLength}
      placeholder={props.placeholder}
      onChange={(event: ChangeEvent<HTMLInputElement>) => props.onChange(event.target.value)}
      className="w-full rounded-xl px-3 py-2.5 text-sm outline-none transition-colors disabled:opacity-50"
      style={controlStyle}
      onFocus={(event) => {
        event.currentTarget.style.borderColor = T.accentLine;
      }}
      onBlur={(event) => {
        event.currentTarget.style.borderColor = T.border;
      }}
    />
  );
}

export function TextArea(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
}) {
  return (
    <textarea
      value={props.value}
      rows={props.rows || 6}
      disabled={props.disabled}
      maxLength={props.maxLength}
      placeholder={props.placeholder}
      onChange={(event) => props.onChange(event.target.value)}
      className="vs-scroll w-full resize-y rounded-xl px-3.5 py-3 text-sm leading-relaxed outline-none transition-colors disabled:opacity-50"
      style={controlStyle}
      onFocus={(event) => {
        event.currentTarget.style.borderColor = T.accentLine;
      }}
      onBlur={(event) => {
        event.currentTarget.style.borderColor = T.border;
      }}
    />
  );
}

export function Select<V extends string>(props: {
  value: V;
  onChange: (value: V) => void;
  options: { id: V; label: string; group?: string }[];
  disabled?: boolean;
}) {
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, typeof props.options>();
    props.options.forEach((option) => {
      const key = option.group || '';
      if (!byGroup.has(key)) {
        byGroup.set(key, []);
        order.push(key);
      }
      byGroup.get(key)!.push(option);
    });
    return order.map((key) => ({ key, options: byGroup.get(key)! }));
  }, [props.options]);

  return (
    <select
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.target.value as V)}
      className="w-full cursor-pointer rounded-xl px-3 py-2.5 text-sm outline-none disabled:opacity-50"
      style={controlStyle}
    >
      {groups.map((group) =>
        group.key ? (
          <optgroup key={group.key} label={group.key}>
            {group.options.map((option) => (
              <option key={option.id} value={option.id} style={{ background: '#FFFFFF' }}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ) : (
          group.options.map((option) => (
            <option key={option.id} value={option.id} style={{ background: '#FFFFFF' }}>
              {option.label}
            </option>
          ))
        ),
      )}
    </select>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  hint?: string;
  disabled?: boolean;
}) {
  const ratio = Math.max(0, Math.min(1, (props.value - props.min) / (props.max - props.min || 1)));
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: T.textMuted }}>
          {props.label}
        </span>
        <span className="text-xs font-semibold tabular-nums" style={{ color: T.accentBright }}>
          {props.format ? props.format(props.value) : props.value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        className="vs-range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(Number(event.target.value))}
        style={{
          background: `linear-gradient(90deg, ${T.accent} 0%, ${T.accentBright} ${ratio * 100}%, rgba(180,120,0,0.18) ${ratio * 100}%, rgba(180,120,0,0.18) 100%)`,
        }}
      />
      {props.hint ? (
        <p className="mt-1.5 text-[11px] leading-snug" style={{ color: T.textMuted }}>
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}

export function Toggle(props: { label: string; checked: boolean; onChange: (next: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors disabled:opacity-50"
      style={{ background: T.inset, border: `1px solid ${props.checked ? T.accentLine : T.border}` }}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium" style={{ color: T.text }}>
          {props.label}
        </span>
        {props.hint ? (
          <span className="mt-0.5 block text-[11px] leading-snug" style={{ color: T.textMuted }}>
            {props.hint}
          </span>
        ) : null}
      </span>
      <span
        className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
        style={{ background: props.checked ? T.accent : 'rgba(180,120,0,0.24)' }}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
          style={{ left: props.checked ? '1.125rem' : '0.125rem' }}
        />
      </span>
    </button>
  );
}

export function Segmented<V extends string>(props: {
  value: V;
  onChange: (value: V) => void;
  options: { id: V; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-xl p-1" style={{ background: T.inset, border: `1px solid ${T.border}` }}>
      {props.options.map((option) => {
        const active = option.id === props.value;
        return (
          <button
            key={option.id}
            type="button"
            disabled={props.disabled}
            onClick={() => props.onChange(option.id)}
            className="flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50"
            style={{
              background: active ? T.accent : 'transparent',
              color: active ? '#FFFFFF' : T.textMuted,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function PrimaryButton(props: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon?: ComponentType<any>;
  full?: boolean;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled || props.busy}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-45 ${props.full ? 'w-full' : ''}`}
      style={{
        background: `linear-gradient(135deg, ${T.accent}, ${T.accentDeep})`,
        color: '#FFFFFF',
        boxShadow: props.disabled || props.busy ? 'none' : '0 8px 24px rgba(200,146,10,0.32)',
      }}
    >
      {props.busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {props.children}
    </button>
  );
}

export function GhostButton(props: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  icon?: ComponentType<any>;
  tone?: 'default' | 'danger';
}) {
  const Icon = props.icon;
  const color = props.tone === 'danger' ? T.danger : T.textSecondary;
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
      style={{ background: 'transparent', border: `1px solid ${T.border}`, color }}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {props.children}
    </button>
  );
}

// --------------------------------------------------------------- skeletons ----

export function Skeleton({ className = '', rounded = '0.75rem' }: { className?: string; rounded?: string }) {
  return <div className={`vs-skeleton ${className}`} style={{ borderRadius: rounded }} />;
}

/** The placeholder a tab shows while a generation is in flight. */
export function GeneratingSkeleton({ label }: { label: string }) {
  return (
    <GlassCard>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium" style={{ color: T.accentBright }}>
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        {label}
      </div>
      <Skeleton className="h-12 w-full" />
      <div className="mt-2 flex gap-2">
        <Skeleton className="h-3 w-24" rounded="999px" />
        <Skeleton className="h-3 w-16" rounded="999px" />
      </div>
    </GlassCard>
  );
}

// ------------------------------------------------------------------ players ----

/**
 * Deterministic bar heights: the same source always draws the same waveform, so
 * the shape reads as a property of the clip rather than noise that changes on
 * every render. These are decorative — they are not decoded sample peaks, and
 * nothing in the app claims they are.
 */
function barHeights(seed: string, count: number): number[] {
  let hash = 1;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
  const heights: number[] = [];
  for (let i = 0; i < count; i += 1) {
    // Park-Miller: the multiplier is small enough that every intermediate
    // product stays inside IEEE-754's exact-integer range, so the sequence is
    // genuinely varied instead of collapsing once precision is lost.
    hash = (hash * 16807) % 2147483647;
    const base = 0.3 + ((hash % 1000) / 1000) * 0.7;
    // Taper the first and last few bars so the shape reads like a clip.
    const edge = Math.min(1, Math.min(i, count - 1 - i) / 4 + 0.35);
    heights.push(Math.max(0.16, base * edge));
  }
  return heights;
}

export function AudioPlayer({
  src,
  title,
  onDownload,
  meta,
}: {
  src: string;
  title: string;
  onDownload?: () => void;
  meta?: ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const bars = useMemo(() => barHeights(src, 56), [src]);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
  }, [src]);

  const ratio = duration > 0 ? current / duration : 0;

  const seek = (event: ReactMouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(duration, ((event.clientX - rect.left) / rect.width) * duration));
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  };

  return (
    <GlassCard tone="accent" className="vs-rise">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full"
          style={{ background: T.accent, color: '#FFFFFF', boxShadow: '0 6px 18px rgba(200,146,10,0.4)' }}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="truncate text-sm font-medium" style={{ color: T.text }}>
              {title}
            </span>
            <span className="shrink-0 text-xs tabular-nums" style={{ color: T.textMuted }}>
              {formatClock(current)} / {duration ? formatClock(duration) : '--:--'}
            </span>
          </div>
          <div className="flex h-9 cursor-pointer items-end gap-[2px]" onClick={seek} role="presentation">
            {bars.map((height, index) => (
              <span
                key={index}
                className="flex-1 rounded-sm transition-colors"
                style={{
                  height: `${Math.round(height * 100)}%`,
                  background: index / bars.length <= ratio ? T.accentBright : 'rgba(180,120,0,0.20)',
                }}
              />
            ))}
          </div>
        </div>
        {onDownload ? (
          <button
            type="button"
            onClick={onDownload}
            aria-label="Download"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
            style={{ background: T.inset, border: `1px solid ${T.border}`, color: T.textSecondary }}
          >
            <Download className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {meta ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: T.textMuted }}>
          {meta}
        </div>
      ) : null}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          setDuration(Number.isFinite(value) ? value : 0);
        }}
        className="hidden"
      />
    </GlassCard>
  );
}

export function VideoPlayer({
  src,
  poster,
  portrait,
  onDownload,
}: {
  src: string;
  poster?: string;
  portrait?: boolean;
  onDownload?: () => void;
}) {
  return (
    <GlassCard tone="accent" className="vs-rise">
      <div className="mx-auto" style={{ maxWidth: portrait ? '20rem' : '100%' }}>
        <video
          src={src}
          poster={poster}
          controls
          playsInline
          className="w-full rounded-xl"
          style={{ aspectRatio: portrait ? '9 / 16' : '16 / 9', background: '#000000' }}
        />
      </div>
      {onDownload ? (
        <div className="mt-3 flex justify-center">
          <PrimaryButton icon={Download} onClick={onDownload}>
            Download MP4
          </PrimaryButton>
        </div>
      ) : null}
    </GlassCard>
  );
}

// ----------------------------------------------------------------- dropzone ----

export function Dropzone({
  accept,
  multiple,
  onFiles,
  title,
  hint,
  disabled,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title: string;
  hint: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    if (!list || !list.length) return;
    onFiles(Array.from(list));
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (!disabled) take(event.dataTransfer?.files || null);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      // The file input itself is hidden, so the drop target has to be the
      // thing a keyboard reaches.
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={`flex flex-col items-center justify-center gap-2 rounded-2xl px-5 py-8 text-center transition-colors ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
      style={{
        background: over ? T.accentSoft : T.inset,
        border: `1px dashed ${over ? T.accent : T.borderStrong}`,
      }}
    >
      <span className="grid h-10 w-10 place-items-center rounded-full" style={{ background: T.accentSoft }}>
        <Upload className="h-4 w-4" style={{ color: T.accentBright }} />
      </span>
      <span className="text-sm font-semibold" style={{ color: T.text }}>
        {title}
      </span>
      <span className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
        {hint}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        // The programmatic click below bubbles, and the wrapper's own onClick
        // would catch it and open the picker again, forever.
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          take(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}

export function FileRow({ name, detail, onRemove }: { name: string; detail: string; onRemove?: () => void }) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-2"
      style={{ background: T.inset, border: `1px solid ${T.border}` }}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm" style={{ color: T.text }}>
          {name}
        </div>
        <div className="text-[11px]" style={{ color: T.textMuted }}>
          {detail}
        </div>
      </div>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label="Remove" className="shrink-0">
          <X className="h-4 w-4" style={{ color: T.textMuted }} />
        </button>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------- empty state ----

export function EmptyState({
  icon: Icon,
  title,
  body,
  suggestions,
  onPick,
}: {
  icon: ComponentType<any>;
  title: string;
  body: string;
  suggestions?: string[];
  onPick?: (suggestion: string) => void;
}) {
  return (
    <div className="rounded-2xl px-5 py-8 text-center" style={{ background: T.accentSofter, border: `1px dashed ${T.accentLine}` }}>
      <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full" style={{ background: T.accentSoft }}>
        <Icon className="h-5 w-5" style={{ color: T.accentBright }} />
      </span>
      <h3 className="text-sm font-semibold" style={{ color: T.text }}>
        {title}
      </h3>
      <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed" style={{ color: T.textMuted }}>
        {body}
      </p>
      {suggestions?.length ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onPick?.(suggestion)}
              className="rounded-full px-3 py-1.5 text-xs transition-colors"
              style={{ background: T.glass, border: `1px solid ${T.border}`, color: T.textSecondary }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------- progress rail ----

export type StepState = 'pending' | 'active' | 'done' | 'failed';
export interface RailStep {
  label: string;
  state: StepState;
  detail?: string;
}

/** The step-by-step readout for the multi-stage runs (dubbing, avatar lip-sync). */
export function ProgressRail({ steps }: { steps: RailStep[] }) {
  return (
    <ol className="space-y-2.5">
      {steps.map((step, index) => {
        const color =
          step.state === 'done' ? T.success : step.state === 'failed' ? T.danger : step.state === 'active' ? T.accentBright : T.textMuted;
        return (
          <li key={step.label} className="flex items-start gap-2.5">
            <span
              className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold"
              style={{
                background: step.state === 'pending' ? 'rgba(180,120,0,0.10)' : `${color}22`,
                border: `1px solid ${step.state === 'pending' ? T.border : color}`,
                color,
              }}
            >
              {step.state === 'done' ? '✓' : step.state === 'failed' ? '!' : step.state === 'active' ? '' : index + 1}
              {step.state === 'active' ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-sm" style={{ color: step.state === 'pending' ? T.textMuted : T.text }}>
                {step.label}
              </span>
              {step.detail ? (
                <span className="block text-[11px] leading-snug" style={{ color: T.textMuted }}>
                  {step.detail}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function ProgressBar({ ratio, label }: { ratio: number; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return (
    <div>
      {label ? (
        <div className="mb-1.5 flex justify-between text-[11px]" style={{ color: T.textMuted }}>
          <span>{label}</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
      ) : null}
      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(180,120,0,0.18)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${T.accent}, ${T.accentBright})` }}
        />
      </div>
    </div>
  );
}
