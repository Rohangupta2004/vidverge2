// MotionType — AI kinetic typography studio.
//
// A line of text goes to Claude Opus 5 through the workspace's authenticated
// Anthropic proxy; what comes back is a structured animation plan, and the
// plan is rendered as real CSS keyframes on a 16:9 stage. The same validated
// plan drives all three outputs — the live preview, the Copy CSS export and
// the canvas recording — so none of them can drift from the others.
//
// WHERE THE PIECES LIVE
//   lib/motionPlan.ts      schema, system prompt, the proxied call, validation
//   lib/motionLayout.ts    stage geometry, the sequence clock, easing
//   lib/motionCss.ts       keyframes for the preview and for the export
//   lib/motionRecorder.ts  the canvas twin of the CSS renderer, plus WebM
//   components/            the two columns of the studio
import React from 'react';
import AppShell from '../../components/ui/AppShell';
import Badge from '../../components/ui/Badge';
import { COLORS, FONT } from '../../components/theme';
import MotionControls from './components/MotionControls';
import MotionStage from './components/MotionStage';
import type { StageStatus } from './components/MotionStage';
import { requestMotionPlan } from './lib/motionPlan';
import type { ColorTheme, MotionPlan, Speed, StylePreset } from './lib/motionPlan';

/**
 * Chrome styles for this app only. Scoped to `.mt-app` and prefixed keyframe
 * names, so nothing here reaches the dock, the agent panel or another studio.
 */
const APP_CSS = [
  '.mt-app-wordmark {',
  '  background: linear-gradient(100deg, #C8920A 0%, #E8B737 22%, #B4720A 50%, #E8B737 76%, #C8920A 100%);',
  '  background-size: 260% 100%;',
  '  -webkit-background-clip: text;',
  '  background-clip: text;',
  '  color: transparent;',
  '  animation: mtWordmarkSweep 7s linear infinite;',
  '}',
  '@keyframes mtWordmarkSweep {',
  '  0% { background-position: 0% 50%; }',
  '  100% { background-position: 260% 50%; }',
  '}',
].join('\n');

/** The layout folds to one column here, as the brief specifies. */
const WIDE_BREAKPOINT = 1024;

function StatusIndicator({ status }: { status: StageStatus }) {
  if (status === 'loading') {
    return (
      <Badge variant="amber" dot pulse>
        Directing
      </Badge>
    );
  }
  if (status === 'ready') {
    return (
      <Badge variant="green" dot>
        Animation ready
      </Badge>
    );
  }
  if (status === 'error') {
    return (
      <Badge variant="red" dot>
        Needs a retry
      </Badge>
    );
  }
  return <Badge variant="muted">No sequence yet</Badge>;
}

export default function MotionType() {
  const [text, setText] = React.useState('');
  const [style, setStyle] = React.useState<StylePreset>('Cinematic');
  const [speed, setSpeed] = React.useState<Speed>('Normal');
  const [colorTheme, setColorTheme] = React.useState<ColorTheme>('Cosmic');

  const [plan, setPlan] = React.useState<MotionPlan | null>(null);
  const [status, setStatus] = React.useState<StageStatus>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [wide, setWide] = React.useState(true);

  const mountedRef = React.useRef(true);
  // Only the newest generation may write to state: a slow first call must not
  // overwrite the plan a second, faster call already delivered.
  const requestRef = React.useRef(0);

  React.useEffect(function trackMount() {
    mountedRef.current = true;
    return function unmount() {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(function trackWidth() {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(min-width: ' + WIDE_BREAKPOINT + 'px)');
    function sync() {
      setWide(query.matches);
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

  const generate = React.useCallback(
    async function generate() {
      const trimmed = text.trim();
      if (!trimmed) return;
      const id = requestRef.current + 1;
      requestRef.current = id;
      setStatus('loading');
      setError(null);

      const result = await requestMotionPlan({ text: trimmed, style, speed, colorTheme });
      if (!mountedRef.current || requestRef.current !== id) return;

      if (result.ok) {
        setPlan(result.plan);
        setStatus('ready');
        return;
      }
      // The previous plan is left on the stage on purpose: a failed retry
      // should not wipe out the animation the user already has.
      setError(result.message);
      setStatus('error');
    },
    [text, style, speed, colorTheme],
  );

  return (
    <AppShell
      title="MotionType"
      maxWidth="full"
      header={false}
      watermark={false}
      className="mt-app"
    >
      <style>{APP_CSS}</style>

      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
          flexWrap: 'wrap',
          paddingBottom: 18,
          marginBottom: 22,
          borderBottom: '1px solid ' + COLORS.border,
        }}
      >
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <h1
            className="mt-app-wordmark"
            style={{
              margin: 0,
              display: 'inline-block',
              fontFamily: FONT.heading,
              fontSize: 'clamp(26px, 3.4vw, 38px)',
              fontWeight: 800,
              letterSpacing: -1.1,
              lineHeight: 1.1,
            }}
          >
            MotionType
          </h1>
          <p
            style={{
              margin: '6px 0 0',
              fontFamily: FONT.body,
              fontSize: 13.5,
              lineHeight: 1.55,
              color: COLORS.textMuted,
            }}
          >
            Kinetic Typography · Powered by Claude Opus 5
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6 }}>
          <StatusIndicator status={status} />
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: wide ? 'minmax(300px, 380px) minmax(0, 1fr)' : 'minmax(0, 1fr)',
          gap: wide ? 24 : 18,
          alignItems: 'start',
        }}
      >
        <MotionControls
          text={text}
          onTextChange={setText}
          style={style}
          onStyleChange={setStyle}
          speed={speed}
          onSpeedChange={setSpeed}
          colorTheme={colorTheme}
          onColorThemeChange={setColorTheme}
          onGenerate={generate}
          generating={status === 'loading'}
        />

        <MotionStage plan={plan} status={status} error={error} onRetry={generate} />
      </div>
    </AppShell>
  );
}
