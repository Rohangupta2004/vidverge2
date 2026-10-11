/**
 * AgentThinkingShowcase — the landing-page "Live AI Agent" marketing section.
 * A pulsing gradient orb over an auto-cycling thinking stream: three demo
 * sequences play through step by step (600ms per step, 1.5s pause between
 * sequences) inside a gradient-bordered dark card. Pure presentation — no
 * network calls, safe for the signed-out landing page.
 */
import { useEffect, useState } from 'react';
import { GradientOrb } from './GradientOrb';
import { ThinkingSteps } from './ThinkingSteps';
import type { ThinkingStep } from './ThinkingSteps';

const SEQUENCES: { icon: string; text: string }[][] = [
  [
    { icon: '👁️', text: 'Reading your product URL…' },
    { icon: '🧠', text: 'Extracting product name and features…' },
    { icon: '🎬', text: 'Planning 3 scenes…' },
    { icon: '✍️', text: 'Writing script…' },
    { icon: '🎥', text: 'Generating video…' },
    { icon: '✅', text: 'Video ready to download!' },
  ],
  [
    { icon: '🔍', text: 'Analysing your script…' },
    { icon: '🎭', text: 'Casting consistent character…' },
    { icon: '🌅', text: 'Generating Scene 1…' },
    { icon: '🌆', text: 'Generating Scene 2…' },
    { icon: '🎵', text: 'Adding music…' },
    { icon: '✅', text: 'Done!' },
  ],
  [
    { icon: '💡', text: 'Detecting product tone: energetic' },
    { icon: '📝', text: 'Drafting ad brief…' },
    { icon: '🎨', text: 'Generating visuals…' },
    { icon: '🔊', text: 'Adding voiceover…' },
    { icon: '📦', text: 'Rendering final ad…' },
    { icon: '✅', text: 'Ready to publish!' },
  ],
];

export function AgentThinkingShowcase() {
  const [seqIndex, setSeqIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    const sequence = SEQUENCES[seqIndex];
    if (visibleCount < sequence.length) {
      const timer = window.setTimeout(() => setVisibleCount((c) => c + 1), 600);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      setSeqIndex((i) => (i + 1) % SEQUENCES.length);
      setVisibleCount(1);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [seqIndex, visibleCount]);

  const sequence = SEQUENCES[seqIndex];
  const finished = visibleCount >= sequence.length;
  const steps: ThinkingStep[] = sequence.slice(0, visibleCount).map((step, i) => ({
    id: `demo-${seqIndex}-${i}`,
    icon: step.icon,
    text: step.text,
    status: i < visibleCount - 1 || finished ? 'done' : 'active',
  }));

  return (
    <section style={{ padding: '84px 24px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', borderRadius: 21, padding: 1, background: 'linear-gradient(135deg, rgba(217, 119, 6, 0.75), rgba(236, 72, 153, 0.65), rgba(245, 158, 11, 0.6))', boxShadow: '0 30px 80px rgba(217, 119, 6, 0.22)' }}>
        <div style={{ borderRadius: 20, background: '#0f0f1a', padding: 'clamp(28px, 6vw, 48px)', textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
            <GradientOrb size="lg" thinking />
          </div>
          <h2 style={{ margin: 0, fontSize: 'clamp(24px, 4vw, 32px)', fontWeight: 700, letterSpacing: '-0.02em', color: '#ffffff' }}>
            The Vidverge Agent thinks for you
          </h2>
          <p style={{ margin: '12px auto 28px', maxWidth: 460, fontSize: 15, lineHeight: 1.6, color: '#9aa3b8' }}>
            Watch it work — from idea to publish-ready video, no manual pipeline assembly
          </p>
          <div style={{ textAlign: 'left' }}>
            <ThinkingSteps steps={steps} isStreaming />
          </div>
          <p style={{ margin: '22px 0 0', fontSize: 12.5, color: '#6b7488' }}>
            Sign in to run the agent on your product
          </p>
        </div>
      </div>
    </section>
  );
}

export default AgentThinkingShowcase;
