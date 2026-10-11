import React from 'react';
import { AlertTriangle, Clapperboard, Copy, Play, Repeat, RotateCcw, Type } from 'lucide-react';
import Button from '../../../components/ui/Button';
import { COLORS, RADIUS, SHADOW, alpha } from '../../../components/theme';
import { buildCss, exportCss } from '../lib/motionCss';
import { STAGE_W, layoutWords } from '../lib/motionLayout';
import { detectRecorderSupport, downloadBlob, filenameFor, recordPlan } from '../lib/motionRecorder';
import type { MotionPlan } from '../lib/motionPlan';

/**
 * The right column: the 16:9 stage, the transport and the two export actions.
 *
 * The scene's stylesheet is generated from the validated plan and injected
 * through a <style> element that lives and dies with this component. Every
 * selector in it is prefixed with this instance's own scope class and every
 * @keyframes name carries the matching suffix, so nothing it declares can
 * reach the dock, the agent panel or another app.
 */

/** Gives each mounted stage its own selector scope and keyframe namespace. */
let scopeCounter = 0;

export type StageStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MotionStageProps {
  plan: MotionPlan | null;
  status: StageStatus;
  error: string | null;
  onRetry: () => void;
}

function Skeleton() {
  const bars = [62, 88, 44];
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        // Scrim: a regeneration keeps the previous sequence playing underneath,
        // and the skeleton has to read as the foreground while it does.
        background: 'rgba(255, 253, 244, 0.82)',
        backdropFilter: 'blur(3px)',
      }}
    >
      {bars.map(function bar(width, i) {
        return (
          <div
            key={i}
            style={{
              position: 'relative',
              width: width + '%',
              height: 26,
              borderRadius: 8,
              overflow: 'hidden',
              background: alpha(COLORS.primary, 0.08),
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(90deg, transparent 0%, ' + alpha(COLORS.primary, 0.22) + ' 50%, transparent 100%)',
                animation: 'vvSheen 1.4s ease-in-out infinite',
                animationDelay: i * 180 + 'ms',
              }}
            />
          </div>
        );
      })}
      <span style={{ fontSize: 12, letterSpacing: 0.4, color: COLORS.textMuted }}>
        Claude Opus 5 is directing the sequence…
      </span>
    </div>
  );
}

function Placeholder() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 24,
        textAlign: 'center',
      }}
    >
      <Type className="h-7 w-7" style={{ color: alpha(COLORS.primary, 0.75) }} />
      <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>Your stage is empty</span>
      <span style={{ fontSize: 12.5, maxWidth: 340, lineHeight: 1.6, color: COLORS.textMuted }}>
        Write a line, pick a style, pace and palette, then generate — the animation plays right here.
      </span>
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        gap: 12,
        padding: 16,
        borderRadius: RADIUS.md,
        background: alpha(COLORS.error, 0.08),
        border: '1px solid ' + alpha(COLORS.error, 0.35),
      }}
    >
      <AlertTriangle className="h-5 w-5" style={{ color: '#991B1B', flex: '0 0 auto', marginTop: 1 }} />
      <div style={{ minWidth: 0, flex: '1 1 auto' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#991B1B' }}>That generation did not land</div>
        <div style={{ marginTop: 4, fontSize: 12.5, lineHeight: 1.6, color: COLORS.textMuted }}>{message}</div>
      </div>
      <Button variant="secondary" size="sm" onClick={onRetry} style={{ flex: '0 0 auto', alignSelf: 'center' }}>
        Retry
      </Button>
    </div>
  );
}

export default function MotionStage({ plan, status, error, onRetry }: MotionStageProps) {
  const scopeRef = React.useRef('');
  if (!scopeRef.current) {
    scopeCounter += 1;
    scopeRef.current = 'mtscene' + scopeCounter;
  }
  const scope = scopeRef.current;

  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const mountedRef = React.useRef(true);
  const loopRef = React.useRef(true);
  const toastTimer = React.useRef<number | null>(null);

  const [scale, setScale] = React.useState(0.45);
  const [cycle, setCycle] = React.useState(0);
  const [running, setRunning] = React.useState(false);
  const [loop, setLoop] = React.useState(true);
  const [toast, setToast] = React.useState<string | null>(null);
  const [copyError, setCopyError] = React.useState<string | null>(null);
  const [recording, setRecording] = React.useState(false);
  const [recordProgress, setRecordProgress] = React.useState(0);
  const [recordError, setRecordError] = React.useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = React.useState(false);

  const support = React.useMemo(detectRecorderSupport, []);
  const placed = React.useMemo(
    function layout() {
      return plan ? layoutWords(plan) : [];
    },
    [plan],
  );

  const css = React.useMemo(
    function stylesheet() {
      if (!plan) return '';
      const prefix = '.' + scope + ' ';
      return (
        buildCss(plan, placed, { prefix, suffix: '-' + scope }) +
        '\n\n' +
        // The resting state: the finished composition, held still, for the
        // paused preview and for anyone who asked not to see motion.
        prefix + '.mt-word.mt-rest {\n' +
        '  animation: none !important;\n' +
        '  opacity: 1 !important;\n' +
        '  filter: none !important;\n' +
        '  clip-path: none !important;\n' +
        '  transform: translate(-50%, -50%) !important;\n' +
        '}'
      );
    },
    [plan, placed, scope],
  );

  React.useEffect(function trackMount() {
    mountedRef.current = true;
    return function unmount() {
      mountedRef.current = false;
      if (toastTimer.current) {
        window.clearTimeout(toastTimer.current);
        toastTimer.current = null;
      }
    };
  }, []);

  React.useEffect(
    function trackLoop() {
      loopRef.current = loop;
    },
    [loop],
  );

  React.useEffect(function trackReducedMotion() {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    function sync() {
      setReducedMotion(query.matches);
    }
    sync();
    if (query.addEventListener) {
      query.addEventListener('change', sync);
      return function cleanup() {
        query.removeEventListener('change', sync);
      };
    }
    query.addListener(sync);
    return function cleanup() {
      query.removeListener(sync);
    };
  }, []);

  // `--mt-scale` keeps the plan's type proportional to however wide the stage
  // happens to be, from a docked panel to a full-width window.
  React.useEffect(function trackWidth() {
    const element = boxRef.current;
    if (!element) return undefined;
    function measure() {
      const node = boxRef.current;
      if (node && node.clientWidth > 0) setScale(node.clientWidth / STAGE_W);
    }
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return function cleanup() {
        window.removeEventListener('resize', measure);
      };
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return function cleanup() {
      observer.disconnect();
    };
  }, []);

  // A freshly validated plan plays itself, so the result is never a still.
  React.useEffect(
    function autoPlay() {
      if (!plan) return;
      setCycle(function next(value) {
        return value + 1;
      });
      setRunning(true);
      setRecordError(null);
      setCopyError(null);
    },
    [plan],
  );

  // One timer per cycle. Reading `loop` from a ref is deliberate: toggling the
  // switch mid-sequence changes what happens at the boundary without tearing
  // down the timer and restarting the animation underneath the viewer.
  React.useEffect(
    function sequenceClock() {
      if (!plan || !running || reducedMotion) return undefined;
      const id = window.setTimeout(function boundary() {
        if (!mountedRef.current) return;
        if (loopRef.current) {
          setCycle(function next(value) {
            return value + 1;
          });
        } else {
          setRunning(false);
        }
      }, plan.durationMs);
      return function cleanup() {
        window.clearTimeout(id);
      };
    },
    [plan, running, cycle, reducedMotion],
  );

  function showToast(message: string) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(function clear() {
      toastTimer.current = null;
      if (mountedRef.current) setToast(null);
    }, 2000);
  }

  function replay() {
    setCycle(function next(value) {
      return value + 1;
    });
    setRunning(true);
  }

  async function handleCopy() {
    if (!plan) return;
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      setCopyError('This browser does not expose a clipboard to the page. Try a modern browser over HTTPS.');
      return;
    }
    try {
      await clipboard.writeText(exportCss(plan, placed));
      if (!mountedRef.current) return;
      setCopyError(null);
      showToast('CSS copied!');
    } catch (denied) {
      if (!mountedRef.current) return;
      setCopyError('Your browser blocked clipboard access. Allow it for this page, then copy again.');
    }
  }

  async function handleRecord() {
    if (!plan || recording) return;
    setRecordError(null);
    if (!support.supported) {
      setRecordError(support.reason);
      return;
    }
    setRecording(true);
    setRecordProgress(0);
    try {
      const result = await recordPlan({
        plan,
        placed,
        onProgress: function progress(ratio) {
          if (mountedRef.current) setRecordProgress(ratio);
        },
      });
      downloadBlob(result.blob, filenameFor(plan));
      if (mountedRef.current) showToast('Recording saved');
    } catch (failure) {
      if (mountedRef.current) {
        setRecordError(failure instanceof Error ? failure.message : 'The recording could not be completed.');
      }
    } finally {
      if (mountedRef.current) {
        setRecording(false);
        setRecordProgress(0);
      }
    }
  }

  const animating = Boolean(plan) && running && !reducedMotion;
  const seconds = plan ? (plan.durationMs / 1000).toFixed(1) + 's' : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        ref={boxRef}
        className={scope}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 9',
          minHeight: 220,
          borderRadius: RADIUS.lg,
          overflow: 'hidden',
          border: '1px solid ' + COLORS.border,
          background: plan ? plan.background : COLORS.bg,
          boxShadow: SHADOW.card,
          ['--mt-scale' as any]: String(scale),
        }}
      >
        {plan ? <style>{css}</style> : null}

        {plan ? (
          <div key={cycle} style={{ position: 'absolute', inset: 0 }}>
            {placed.map(function word(entry) {
              return (
                <span
                  key={entry.index}
                  className={'mt-word mt-word-' + (entry.index + 1) + (animating ? '' : ' mt-rest')}
                >
                  {entry.word.word}
                </span>
              );
            })}
          </div>
        ) : null}

        {status === 'loading' ? <Skeleton /> : null}
        {status === 'idle' && !plan ? <Placeholder /> : null}

        {toast ? (
          <div
            role="status"
            style={{
              position: 'absolute',
              left: '50%',
              bottom: 16,
              transform: 'translateX(-50%)',
              padding: '7px 16px',
              borderRadius: 999,
              fontSize: 12.5,
              fontWeight: 600,
              color: COLORS.text,
              background: COLORS.primaryGlow,
              boxShadow: SHADOW.glow,
              animation: 'fadeIn 180ms ease both',
              pointerEvents: 'none',
            }}
          >
            {toast}
          </div>
        ) : null}
      </div>

      {/* Transport */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <Button
          variant="secondary"
          size="sm"
          onClick={replay}
          disabled={!plan}
          icon={animating ? <RotateCcw className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        >
          {animating ? 'Replay' : 'Play'}
        </Button>

        <button
          type="button"
          onClick={function toggle() {
            setLoop(function flip(value) {
              return !value;
            });
          }}
          aria-pressed={loop}
          disabled={!plan}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            height: 32,
            padding: '0 12px',
            borderRadius: RADIUS.sm,
            fontSize: 12.5,
            fontWeight: 600,
            fontFamily: "'Inter', system-ui, sans-serif",
            cursor: plan ? 'pointer' : 'not-allowed',
            opacity: plan ? 1 : 0.5,
            color: loop ? COLORS.primaryGlow : COLORS.textMuted,
            background: loop ? alpha(COLORS.primary, 0.14) : 'transparent',
            border: '1px solid ' + (loop ? COLORS.borderHover : COLORS.border),
            transition: 'background 150ms ease, color 150ms ease, border-color 150ms ease',
          }}
        >
          <Repeat className="h-3.5 w-3.5" />
          Loop {loop ? 'on' : 'off'}
        </button>

        <span
          style={{
            minWidth: 0,
            flex: '1 1 160px',
            fontSize: 12.5,
            color: COLORS.textMuted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={plan ? plan.animationName : undefined}
        >
          {plan ? (
            <>
              <span style={{ color: COLORS.text, fontWeight: 600 }}>{plan.animationName}</span>
              <span style={{ color: COLORS.textFaint }}> · {seconds}</span>
            </>
          ) : (
            'No sequence yet'
          )}
        </span>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          disabled={!plan}
          icon={<Copy className="h-3.5 w-3.5" />}
        >
          Copy CSS
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRecord}
          disabled={!plan || recording}
          loading={recording}
          icon={recording ? undefined : <Clapperboard className="h-3.5 w-3.5" />}
          title={support.supported ? 'Render the plan to a WebM file' : support.reason}
        >
          {recording ? 'Recording ' + Math.round(recordProgress * 100) + '%' : 'Record Preview'}
        </Button>
      </div>

      {reducedMotion && plan ? (
        <span style={{ fontSize: 12, lineHeight: 1.6, color: COLORS.textFaint }}>
          Your system asks for reduced motion, so the sequence is held on its finished composition. Copy CSS and
          Record Preview still produce the full animation.
        </span>
      ) : null}

      {copyError ? (
        <span style={{ fontSize: 12, lineHeight: 1.6, color: '#991B1B' }}>{copyError}</span>
      ) : null}

      {recordError ? (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: RADIUS.md,
            fontSize: 12.5,
            lineHeight: 1.6,
            color: COLORS.textMuted,
            background: alpha(COLORS.warning, 0.07),
            border: '1px solid ' + alpha(COLORS.warning, 0.3),
          }}
        >
          <strong style={{ color: '#B45309', fontWeight: 600 }}>Recording unavailable. </strong>
          {recordError} You can still capture the preview with your browser or operating system screen recorder —
          in Chrome and Edge that is the Record button in DevTools’ Recorder panel, and on macOS it is
          Shift–Command–5.
        </div>
      ) : null}

      {status === 'error' && error ? <ErrorCard message={error} onRetry={onRetry} /> : null}

      {plan ? (
        <span style={{ fontSize: 11.5, lineHeight: 1.6, color: COLORS.textFaint }}>
          Recording redraws this plan on a 1280×720 canvas at 30fps. It reuses the same layout and timing as the
          preview, but it is a reconstruction rather than a screen capture, so text rendering and blur quality can
          differ slightly from what you see above.
        </span>
      ) : null}
    </div>
  );
}
