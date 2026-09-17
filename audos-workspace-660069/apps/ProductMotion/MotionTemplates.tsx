import { useEffect, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';

export interface SlideTemplateProps {
  compact?: boolean;
}

type TemplateComponent = ComponentType<SlideTemplateProps>;

const ink = '#f8fafc';
const muted = 'rgba(226,232,240,.72)';

const MOTION_PREVIEW_CSS = `
@keyframes mtp-rise { 0%,12% { opacity:0; transform:translateY(14px) } 28%,82% { opacity:1; transform:none } 100% { opacity:0; transform:translateY(-5px) } }
@keyframes mtp-slide-left { 0%,12% { opacity:0; transform:translateX(-24px) } 30%,84% { opacity:1; transform:none } 100% { opacity:0; transform:translateX(8px) } }
@keyframes mtp-slide-right { 0%,12% { opacity:0; transform:translateX(24px) } 30%,84% { opacity:1; transform:none } 100% { opacity:0; transform:translateX(-8px) } }
@keyframes mtp-pop { 0%,12% { opacity:0; transform:scale(.72) } 32%,82% { opacity:1; transform:scale(1) } 100% { opacity:0; transform:scale(1.06) } }
@keyframes mtp-float { 0%,100% { transform:translateY(0) rotate(3deg) } 50% { transform:translateY(-8px) rotate(1deg) } }
@keyframes mtp-grow { 0%,15% { transform:scaleY(.08); opacity:.3 } 42%,84% { transform:scaleY(1); opacity:1 } 100% { opacity:.35 } }
@keyframes mtp-wipe { 0%,12% { transform:translateX(-76px) } 45%,78% { transform:translateX(0) } 100% { transform:translateX(76px) } }
@keyframes mtp-pan { 0%,12% { transform:translateX(-10px); opacity:.25 } 45%,78% { transform:translateX(8px); opacity:1 } 100% { transform:translateX(16px); opacity:.25 } }
@keyframes mtp-cursor { 0%,15% { transform:translate(-28px,20px) } 45% { transform:translate(10px,-5px) } 72% { transform:translate(28px,14px) scale(.82) } 100% { transform:translate(-28px,20px) } }
@keyframes mtp-spin { to { transform:rotate(360deg) } }
@keyframes mtp-pulse { 0%,100% { transform:scale(.94); opacity:.75 } 50% { transform:scale(1.05); opacity:1 } }
.mtp-frame > * { will-change:transform,opacity }
.mtp-title > div:first-child { animation:mtp-spin 14s linear infinite }
.mtp-title > div:last-child, .mtp-quote > div:last-child { animation:mtp-rise 3.4s ease-in-out infinite }
.mtp-product > div:first-child > div:first-child { animation:mtp-slide-left 3.6s ease-in-out infinite }
.mtp-product > div:first-child > div:last-child { animation:mtp-float 2.8s ease-in-out infinite }
.mtp-testimonial > div > div:first-child, .mtp-team > div:last-child > div:first-child { animation:mtp-pop 3.5s ease-in-out infinite }
.mtp-testimonial > div > div:last-child, .mtp-team > div:last-child > div:last-child { animation:mtp-slide-right 3.5s ease-in-out infinite }
.mtp-stat > div > div:first-child { animation:mtp-rise 3.4s ease-in-out infinite }
.mtp-stat > div > div:last-child span { transform-origin:center bottom; animation:mtp-grow 3.4s ease-in-out infinite }
.mtp-stat > div > div:last-child span:nth-child(2), .mtp-steps > div > div:last-child > div:nth-child(2), .mtp-case > div > div:last-child > div:nth-child(2) { animation-delay:.12s }
.mtp-stat > div > div:last-child span:nth-child(3), .mtp-steps > div > div:last-child > div:nth-child(3), .mtp-case > div > div:last-child > div:nth-child(3) { animation-delay:.24s }
.mtp-feature > div:first-child { animation:mtp-slide-left 3.5s ease-in-out infinite }
.mtp-feature > div:last-child { animation:mtp-slide-right 3.5s ease-in-out infinite }
.mtp-steps > div > div:last-child > div, .mtp-case > div > div:last-child > div { animation:mtp-rise 3.6s ease-in-out infinite }
.mtp-before > div:last-child { animation:mtp-wipe 3.8s ease-in-out infinite }
.mtp-timeline > div > div:last-child > div:last-child > div { animation:mtp-rise 3.8s ease-in-out infinite }
.mtp-timeline > div > div:last-child > div:last-child > div:nth-child(2) { animation-delay:.12s }
.mtp-timeline > div > div:last-child > div:last-child > div:nth-child(3) { animation-delay:.24s }
.mtp-timeline > div > div:last-child > div:last-child > div:nth-child(4) { animation-delay:.36s }
.mtp-quote > div:first-child { animation:mtp-pulse 2.4s ease-in-out infinite }
.mtp-demo > div:first-child { animation:mtp-pan 3.8s ease-in-out infinite }
.mtp-demo > div:first-child > div:last-child > div:last-child span:last-child { animation:mtp-cursor 3.2s ease-in-out infinite }
.mtp-compare > div > div:last-child > div { animation:mtp-pop 3.6s ease-in-out infinite }
.mtp-compare > div > div:last-child > div:last-child { animation-delay:.22s }
.mtp-announce > div:first-child { animation:mtp-spin 10s linear infinite }
.mtp-announce > div:last-child { animation:mtp-pop 3.2s ease-in-out infinite }
.mtp-outro > div:last-child { animation:mtp-pulse 2.8s ease-in-out infinite }
@media (prefers-reduced-motion:reduce) { .mtp-frame * { animation:none!important } }
`;

function Frame({
  children,
  background = '#0b1020',
  color = ink,
  motion,
  style,
}: {
  children: ReactNode;
  background?: string;
  color?: string;
  motion: string;
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      className={`mtp-frame mtp-${motion}`}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        overflow: 'hidden',
        borderRadius: 10,
        color,
        background,
        fontFamily: "'Inter','Geist',system-ui,sans-serif",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Lines({ widths = ['86%', '62%'], dark = false }: { widths?: string[]; dark?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 5, width: '100%' }}>
      {widths.map((width, index) => (
        <span key={`${width}-${index}`} style={{ width, height: index === 0 ? 5 : 4, borderRadius: 99, background: dark ? 'rgba(15,23,42,.28)' : 'rgba(255,255,255,.34)' }} />
      ))}
    </div>
  );
}

/** Editorial title card with a cinematic reveal and oversized typography. */
export function TitleCardTemplate(_: SlideTemplateProps) {
  return (
    <Frame motion="title" background="linear-gradient(135deg,#080b16 0%,#111936 58%,#6d28d9 140%)">
      <div style={{ position: 'absolute', width: '44%', aspectRatio: '1', borderRadius: '50%', right: '-8%', top: '-38%', border: '1px solid rgba(167,139,250,.42)', boxShadow: '0 0 42px rgba(124,58,237,.32)' }} />
      <div style={{ position: 'absolute', inset: '15% 10%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <span style={{ width: 42, height: 3, marginBottom: 11, borderRadius: 9, background: '#a78bfa' }} />
        <strong style={{ maxWidth: '75%', fontSize: 'clamp(15px,3.2vw,27px)', lineHeight: .95, letterSpacing: '-.06em' }}>THE BIG IDEA<br />STARTS HERE</strong>
        <span style={{ marginTop: 10, color: muted, fontSize: 7, letterSpacing: '.18em' }}>A CINEMATIC OPENING</span>
      </div>
    </Frame>
  );
}

/** Product hero layout with a floating product card and benefit callouts. */
export function ProductSpotlightTemplate(_: SlideTemplateProps) {
  return (
    <Frame motion="product" background="linear-gradient(145deg,#061523,#0d2b3b)">
      <div style={{ position: 'absolute', inset: '13% 8%', display: 'grid', gridTemplateColumns: '1fr .9fr', gap: '8%', alignItems: 'center' }}>
        <div>
          <span style={{ color: '#5eead4', fontSize: 7, fontWeight: 800, letterSpacing: '.14em' }}>PRODUCT SPOTLIGHT</span>
          <div style={{ marginTop: 8, fontSize: 'clamp(13px,2.5vw,22px)', fontWeight: 850, lineHeight: 1 }}>Made to stand out.</div>
          <div style={{ marginTop: 10 }}><Lines widths={['92%', '68%']} /></div>
          <div style={{ display: 'flex', gap: 5, marginTop: 11 }}>{['FAST', 'SMART', 'SIMPLE'].map((x) => <span key={x} style={{ padding: '3px 5px', borderRadius: 99, color: '#99f6e4', border: '1px solid rgba(94,234,212,.32)', fontSize: 5.5, fontWeight: 800 }}>{x}</span>)}</div>
        </div>
        <div style={{ position: 'relative', height: '78%', borderRadius: 12, transform: 'rotate(3deg)', background: 'linear-gradient(160deg,#2dd4bf,#0f766e)', boxShadow: '0 16px 28px rgba(0,0,0,.35)' }}>
          <div style={{ position: 'absolute', inset: '13%', borderRadius: 9, background: 'linear-gradient(145deg,rgba(255,255,255,.72),rgba(255,255,255,.16))' }} />
          <span style={{ position: 'absolute', right: -8, top: '18%', padding: '4px 6px', borderRadius: 7, color: '#042f2e', background: '#ccfbf1', fontSize: 6, fontWeight: 900 }}>NEW</span>
        </div>
      </div>
    </Frame>
  );
}

/** Social-proof slide with portrait, pull quote, and rating details. */
export function TestimonialTemplate(_: SlideTemplateProps) {
  return (
    <Frame motion="testimonial" background="linear-gradient(135deg,#fff7ed,#ffedd5)" color="#431407">
      <div style={{ position: 'absolute', inset: '13% 9%', display: 'grid', gridTemplateColumns: '.55fr 1.45fr', gap: '9%', alignItems: 'center' }}>
        <div style={{ position: 'relative', aspectRatio: '.82', borderRadius: '48% 48% 18% 18%', background: 'linear-gradient(160deg,#fb923c,#9a3412)', boxShadow: '8px 9px 0 #fed7aa' }}>
          <div style={{ position: 'absolute', width: '42%', aspectRatio: '1', left: '29%', top: '17%', borderRadius: '50%', background: '#ffedd5' }} />
          <div style={{ position: 'absolute', width: '66%', height: '37%', left: '17%', bottom: '10%', borderRadius: '50% 50% 16% 16%', background: '#7c2d12' }} />
        </div>
        <div>
          <div style={{ color: '#ea580c', fontFamily: 'Georgia,serif', fontSize: 25, lineHeight: .4 }}>“</div>
          <strong style={{ display: 'block', fontFamily: 'Georgia,serif', fontSize: 'clamp(10px,2vw,17px)', lineHeight: 1.15 }}>This changed how we tell our story.</strong>
          <div style={{ marginTop: 9 }}><Lines dark widths={['88%', '72%']} /></div>
          <div style={{ marginTop: 10, color: '#9a3412', fontSize: 6.5, fontWeight: 900 }}>MAYA R. · ★★★★★</div>
        </div>
      </div>
    </Frame>
  );
}

/** Single-metric impact slide with animated count-up and supporting micro chart. */
export function BigStatTemplate(_: SlideTemplateProps) {
  return (
    <Frame motion="stat" background="linear-gradient(150deg,#0a1020,#15274d)">
      <div style={{ position: 'absolute', inset: '11% 9%', display: 'grid', gridTemplateColumns: '1.25fr .75fr', gap: '8%', alignItems: 'end' }}>
        <div>
          <span style={{ color: '#93c5fd', fontSize: 7, fontWeight: 800, letterSpacing: '.12em' }}>THE RESULT</span>
          <div style={{ marginTop: 3, fontSize: 'clamp(34px,8vw,68px)', fontWeight: 900, letterSpacing: '-.08em', lineHeight: .92 }}>84%</div>
          <div style={{ marginTop: 5, color: muted, fontSize: 8 }}>more audience attention</div>
        </div>
        <div style={{ height: '62%', display: 'flex', alignItems: 'flex-end', gap: 5, paddingBottom: 5, borderBottom: '1px solid rgba(147,197,253,.35)' }}>
          {[30, 48, 42, 68, 84].map((height, i) => <span key={i} style={{ flex: 1, height: `${height}%`, borderRadius: '4px 4px 0 0', background: i === 4 ? '#60a5fa' : 'rgba(96,165,250,.25)' }} />)}
        </div>
      </div>
    </Frame>
  );
}

/** Image-and-copy split used to introduce one focused feature. */
export function FeatureSplitTemplate(_: SlideTemplateProps) {
  return (
    <Frame motion="feature" background="#111827">
      <div style={{ position: 'absolute', inset: 0, width: '48%', background: 'linear-gradient(145deg,#f43f5e,#7f1d1d)', clipPath: 'polygon(0 0,100% 0,84% 100%,0 100%)' }}>
        <div style={{ position: 'absolute', width: '48%', aspectRatio: '1', borderRadius: '50%', left: '24%', top: '22%', background: 'rgba(255,255,255,.17)', border: '1px solid rgba(255,255,255,.4)' }} />
        <span style={{ position: 'absolute', left: '37%', top: '43%', width: 0, height: 0, borderTop: '9px solid transparent', borderBottom: '9px solid transparent', borderLeft: '14px solid white' }} />
      </div>
      <div style={{ position: 'absolute', left: '53%', right: '8%', top: '23%' }}>
        <span style={{ color: '#fda4af', fontSize: 6.5, fontWeight: 850, letterSpacing: '.13em' }}>FEATURE 01</span>
        <strong style={{ display: 'block', marginTop: 7, fontSize: 'clamp(12px,2.3vw,20px)', lineHeight: 1 }}>One message.<br />Zero distraction.</strong>
        <div style={{ marginTop: 11 }}><Lines widths={['100%', '80%', '62%']} /></div>
      </div>
    </Frame>
  );
}

/** Three-beat numbered process with a moving path between steps. */
export function StepByStepTemplate(_: SlideTemplateProps) {
  return (
    <Frame motion="steps" background="linear-gradient(145deg,#071a18,#12332e)">
      <div style={{ position: 'absolute', inset: '15% 8%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}><strong style={{ fontSize: 14 }}>How it works</strong><span style={{ color: '#6ee7b7', fontSize: 6.5, fontWeight: 800 }}>THREE SIMPLE STEPS</span></div>
        <div style={{ position: 'absolute', left: '8%', right: '8%', top: '56%', height: 2, background: 'linear-gradient(90deg,#34d399,rgba(52,211,153,.18))' }} />
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '7%', marginTop: '13%' }}>
          {['DISCOVER', 'CREATE', 'LAUNCH'].map((label, index) => <div key={label}><span style={{ width: 25, height: 25, display: 'grid', placeItems: 'center', borderRadius: 8, color: '#022c22', background: index === 2 ? '#a7f3d0' : '#34d399', fontSize: 8, fontWeight: 900 }}>{index + 1}</span><strong style={{ display: 'block', marginTop: 8, fontSize: 7 }}>{label}</strong><div style={{ marginTop: 5 }}><Lines widths={['90%', '68%']} /></div></div>)}
        </div>
      </div>
    </Frame>
  );
}

/** Contrasting before/after reveal with a draggable visual divider. */
export function BeforeAfterTemplate(_: SlideTemplateProps) {
  return (
    <Frame motion="before" background="#171717">
      <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ padding: '16% 13%', color: '#a3a3a3', background: 'linear-gradient(145deg,#262626,#0a0a0a)' }}><span style={{ fontSize: 6, fontWeight: 900, letterSpacing: '.15em' }}>BEFORE</span><div style={{ marginTop: 13, opacity: .45 }}><Lines widths={['78%', '95%', '58%']} /></div><div style={{ width: '55%', height: 20, marginTop: 11, borderRadius: 6, border: '1px dashed #737373' }} /></div>
        <div style={{ padding: '16% 13%', color: '#052e16', background: 'linear-gradient(145deg,#dcfce7,#86efac)' }}><span style={{ fontSize: 6, fontWeight: 900, letterSpacing: '.15em' }}>AFTER</span><strong style={{ display: 'block', marginTop: 11, color: '#14532d', fontSize: 13 }}>Clear. Fast. Ready.</strong><div style={{ marginTop: 8 }}><Lines dark widths={['86%', '60%']} /></div></div>
      </div>
      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, background: '#fff' }}><span style={{ position: 'absolute', width: 22, height: 22, left: -10, top: '42%', display: 'grid', placeItems: 'center', borderRadius: '50%', color: '#111', background: '#fff', fontSize: 8, fontWeight: 900 }}>↔</span></div>
    </Frame>
  );
}

/** Milestone timeline for launches, company stories, and roadmaps. */
export function TimelineTemplate(_: SlideTemplateProps) {
  return (
    <Frame motion="timeline" background="linear-gradient(145deg,#17122c,#2e1f57)">
      <div style={{ position: 'absolute', inset: '15% 8%' }}>
        <span style={{ color: '#c4b5fd', fontSize: 6.5, fontWeight: 850, letterSpacing: '.14em' }}>OUR JOURNEY</span>
        <strong style={{ display: 'block', marginTop: 5, fontSize: 15 }}>From idea to impact</strong>
        <div style={{ position: 'relative', height: '48%', marginTop: '10%' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 12, height: 2, background: 'linear-gradient(90deg,#8b5cf6,#e879f9)' }} />
          <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)' }}>{['IDEA','BUILD','BETA','TODAY'].map((x,i) => <div key={x} style={{ textAlign: i === 3 ? 'right' : i === 0 ? 'left' : 'center' }}><span style={{ display: 'inline-block', width: i === 3 ? 13 : 9, height: i === 3 ? 13 : 9, marginTop: i === 3 ? 6 : 8, borderRadius: '50%', border: '2px solid #ddd6fe', background: i === 3 ? '#e879f9' : '#6d28d9' }} /><strong style={{ display: 'block', marginTop: 7, fontSize: 6.5 }}>{x}</strong><span style={{ color: muted, fontSize: 5.5 }}>{2023 + i}</span></div>)}</div>
        </div>
      </div>
    </Frame>
  );
}

/** Elegant full-screen pull quote for thought leadership and narration. */
export function PullQuoteTemplate(_: SlideTemplateProps) {
  return (
    <Frame motion="quote" background="linear-gradient(135deg,#f8fafc,#e2e8f0)" color="#0f172a">
      <div style={{ position: 'absolute', left: '9%', top: '12%', color: '#0ea5e9', fontFamily: 'Georgia,serif', fontSize: 42, lineHeight: 1 }}>“</div>
      <div style={{ position: 'absolute', inset: '20% 14%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <strong style={{ maxWidth: '94%', fontFamily: 'Georgia,serif', fontSize: 'clamp(13px,2.7vw,23px)', lineHeight: 1.13, letterSpacing: '-.025em' }}>Make the complex feel inevitable.</strong>
        <div style={{ width: 36, height: 2, marginTop: 14, background: '#0ea5e9' }} />
        <span style={{ marginTop: 7, color: '#475569', fontSize: 6.5, fontWeight: 800, letterSpacing: '.12em' }}>THE DESIGN PRINCIPLE</span>
      </div>
    </Frame>
  );
}

/** Browser-window walkthrough with cursor focus and feature caption. */
export function AppDemoTemplate(_: SlideTemplateProps) {
  return (
    <Frame motion="demo" background="linear-gradient(145deg,#020617,#172554)">
      <div style={{ position: 'absolute', inset: '10% 7% 16%', overflow: 'hidden', borderRadius: 9, border: '1px solid rgba(147,197,253,.35)', background: '#f8fafc', boxShadow: '0 15px 28px rgba(0,0,0,.42)' }}>
        <div style={{ height: '14%', display: 'flex', alignItems: 'center', gap: 3, padding: '0 5%', background: '#e2e8f0' }}>{['#fb7185','#fbbf24','#34d399'].map(x => <span key={x} style={{ width: 4, height: 4, borderRadius: '50%', background: x }} />)}<span style={{ width: '52%', height: 4, marginLeft: '8%', borderRadius: 5, background: '#cbd5e1' }} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '.34fr 1fr', height: '86%' }}><div style={{ padding: '14%', background: '#eff6ff' }}><Lines dark widths={['88%','66%','74%','54%']} /></div><div style={{ position: 'relative', padding: '7%' }}><div style={{ height: '29%', borderRadius: 5, background: 'linear-gradient(90deg,#dbeafe,#bfdbfe)' }} /><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 5, marginTop: 6 }}>{[0,1,2].map(i => <span key={i} style={{ height: 22, borderRadius: 5, background: i === 1 ? '#60a5fa' : '#e2e8f0' }} />)}</div><span style={{ position: 'absolute', left: '63%', top: '47%', fontSize: 14, color: '#0f172a', filter: 'drop-shadow(1px 2px 1px rgba(0,0,0,.2))' }}>➤</span></div></div>
      </div>
      <span style={{ position: 'absolute', right: '8%', bottom: '5%', color: '#bfdbfe', fontSize: 6.5, fontWeight: 800 }}>WATCH IT WORK →</span>
    </Frame>
  );
}

/** Two-column feature comparison with a clear recommended winner. */
export function ComparisonTemplate(_: SlideTemplateProps) {
  return (
    <Frame motion="compare" background="linear-gradient(145deg,#1c1917,#292524)">
      <div style={{ position: 'absolute', inset: '11% 9%' }}>
        <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 850 }}>Choose the better way</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
          {[['THE OLD WAY','#44403c','#a8a29e','×'],['THE NEW WAY','#854d0e','#fde68a','✓']].map(([label,bg,fg,icon]) => <div key={label} style={{ position: 'relative', padding: '10px 9px', borderRadius: 9, color: fg, background: bg, border: label === 'THE NEW WAY' ? '1px solid #facc15' : '1px solid #57534e' }}><strong style={{ fontSize: 6.5 }}>{label}</strong>{[0,1,2].map(i => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 7 }}><span style={{ width: 11, height: 11, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'rgba(255,255,255,.1)', fontSize: 6 }}>{icon}</span><span style={{ width: `${72 - i * 9}%`, height: 4, borderRadius: 8, background: 'currentColor', opacity: .42 }} /></div>)}</div>)}
        </div>
      </div>
    </Frame>
  );
}

/** Compact challenge-solution-result story for customer outcomes. */
export function CaseStudyTemplate(_: SlideTemplateProps) {
  return (
    <Frame motion="case" background="linear-gradient(145deg,#042f2e,#134e4a)">
      <div style={{ position: 'absolute', inset: '12% 8%' }}>
        <span style={{ color: '#99f6e4', fontSize: 6.5, fontWeight: 850, letterSpacing: '.14em' }}>CUSTOMER STORY</span>
        <strong style={{ display: 'block', marginTop: 5, fontSize: 14 }}>From stuck to scaling</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginTop: 12 }}>
          {[['01','CHALLENGE','#115e59'],['02','SOLUTION','#0f766e'],['03','RESULT','#14b8a6']].map(([num,label,bg],i) => <div key={label} style={{ minHeight: 55, padding: 8, borderRadius: 8, background: bg }}><span style={{ color: i === 2 ? '#042f2e' : '#5eead4', fontSize: 6, fontWeight: 900 }}>{num}</span><strong style={{ display: 'block', marginTop: 5, color: i === 2 ? '#042f2e' : '#fff', fontSize: 6.5 }}>{label}</strong><div style={{ marginTop: 7 }}><Lines widths={['90%','66%']} dark={i === 2} /></div></div>)}
        </div>
      </div>
    </Frame>
  );
}

/** Human introduction card for a founder, host, expert, or team member. */
export function TeamIntroTemplate(_: SlideTemplateProps) {
  return (
    <Frame motion="team" background="linear-gradient(135deg,#312e81,#7c3aed)">
      <div style={{ position: 'absolute', width: '52%', height: '145%', left: '-12%', top: '-20%', borderRadius: '50%', background: 'rgba(255,255,255,.08)' }} />
      <div style={{ position: 'absolute', inset: '13% 10%', display: 'grid', gridTemplateColumns: '.75fr 1.25fr', gap: '10%', alignItems: 'center' }}>
        <div style={{ position: 'relative', aspectRatio: '1', borderRadius: '50%', background: 'linear-gradient(160deg,#ddd6fe,#8b5cf6)', border: '3px solid rgba(255,255,255,.6)' }}><div style={{ position: 'absolute', width: '36%', aspectRatio: '1', left: '32%', top: '20%', borderRadius: '50%', background: '#4c1d95' }} /><div style={{ position: 'absolute', width: '58%', height: '32%', left: '21%', bottom: '12%', borderRadius: '50% 50% 20% 20%', background: '#4c1d95' }} /></div>
        <div><span style={{ color: '#ddd6fe', fontSize: 6.5, fontWeight: 800, letterSpacing: '.14em' }}>MEET YOUR HOST</span><strong style={{ display: 'block', marginTop: 5, fontSize: 'clamp(13px,2.5vw,21px)' }}>Alex Morgan</strong><span style={{ display: 'block', marginTop: 4, color: '#c4b5fd', fontSize: 7 }}>Founder · Builder · Storyteller</span><div style={{ marginTop: 10 }}><Lines widths={['90%','68%']} /></div></div>
      </div>
    </Frame>
  );
}

/** High-energy launch announcement with badge, rays, and product date. */
export function AnnouncementTemplate(_: SlideTemplateProps) {
  return (
    <Frame motion="announce" background="linear-gradient(140deg,#7f1d1d,#dc2626 55%,#fb923c)">
      <div style={{ position: 'absolute', width: '82%', aspectRatio: '1', left: '9%', top: '-58%', borderRadius: '50%', background: 'repeating-conic-gradient(from 0deg,rgba(255,255,255,.16) 0 9deg,transparent 9deg 18deg)' }} />
      <div style={{ position: 'absolute', inset: '14% 10%', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div><span style={{ display: 'inline-block', padding: '4px 8px', borderRadius: 99, color: '#7f1d1d', background: '#fef3c7', fontSize: 6, fontWeight: 900, letterSpacing: '.12em' }}>JUST LAUNCHED</span><strong style={{ display: 'block', marginTop: 8, fontSize: 'clamp(19px,4.1vw,35px)', lineHeight: .9, letterSpacing: '-.06em' }}>SOMETHING<br />BIG IS HERE</strong><span style={{ display: 'block', marginTop: 9, color: '#ffedd5', fontSize: 7 }}>AVAILABLE NOW · START CREATING</span></div>
      </div>
    </Frame>
  );
}

/** Brand-led closing frame with a single action and clean end-card hold. */
export function OutroCtaTemplate(_: SlideTemplateProps) {
  return (
    <Frame motion="outro" background="linear-gradient(150deg,#030712,#111827)">
      <div style={{ position: 'absolute', width: 120, height: 120, left: '50%', top: '50%', transform: 'translate(-50%,-50%) rotate(45deg)', borderRadius: 28, background: 'linear-gradient(145deg,rgba(56,189,248,.15),rgba(168,85,247,.18))', filter: 'blur(1px)' }} />
      <div style={{ position: 'absolute', inset: '14% 10%', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div><span style={{ width: 25, height: 25, display: 'inline-grid', placeItems: 'center', borderRadius: 9, color: '#fff', background: 'linear-gradient(135deg,#38bdf8,#8b5cf6)', fontSize: 11, fontWeight: 900 }}>V</span><strong style={{ display: 'block', marginTop: 8, fontSize: 'clamp(14px,2.7vw,23px)' }}>Ready to make yours?</strong><span style={{ display: 'inline-block', marginTop: 10, padding: '5px 11px', borderRadius: 99, color: '#0f172a', background: '#f8fafc', fontSize: 6.5, fontWeight: 900 }}>GET STARTED →</span><span style={{ display: 'block', marginTop: 8, color: muted, fontSize: 5.5 }}>YOURBRAND.COM</span></div>
      </div>
    </Frame>
  );
}

export interface PresentationTemplateDefinition {
  id: string;
  label: string;
  description: string;
  generationPrompt: string;
  Preview: TemplateComponent;
}

export const PRESENTATION_TEMPLATES = [
  { id: 'title-card', label: 'Title Card', description: 'Cinematic opening with oversized type.', generationPrompt: 'Use bold editorial title cards, slow push-ins, and dramatic text reveals to frame each beat.', Preview: TitleCardTemplate },
  { id: 'product-spotlight', label: 'Product Spotlight', description: 'Hero product, benefits, and callouts.', generationPrompt: 'Keep the product as the hero, using floating feature callouts, tactile close-ups, and clean benefit reveals.', Preview: ProductSpotlightTemplate },
  { id: 'testimonial', label: 'Testimonial', description: 'Portrait-led quote and social proof.', generationPrompt: 'Present the story as credible customer testimony with warm portrait framing, pull quotes, and proof details.', Preview: TestimonialTemplate },
  { id: 'big-stat', label: 'Big Stat', description: 'One number drives the whole scene.', generationPrompt: 'Build scenes around one dominant animated metric with restrained charts and a confident count-up reveal.', Preview: BigStatTemplate },
  { id: 'feature-split', label: 'Feature Split', description: 'Focused media-and-copy split layout.', generationPrompt: 'Use crisp split-screen compositions: demonstration on one side, concise feature copy on the other.', Preview: FeatureSplitTemplate },
  { id: 'step-by-step', label: 'Step by Step', description: 'A clear three-beat process flow.', generationPrompt: 'Explain the idea as a numbered progression with a moving path, one action per beat, and clean handoffs.', Preview: StepByStepTemplate },
  { id: 'before-after', label: 'Before & After', description: 'Contrast the problem and outcome.', generationPrompt: 'Use a decisive before-and-after reveal, contrasting color, pace, and composition across a central divider.', Preview: BeforeAfterTemplate },
  { id: 'timeline', label: 'Timeline', description: 'Milestones move across a visual path.', generationPrompt: 'Move through milestones on a horizontal timeline with progressive highlights and smooth lateral camera motion.', Preview: TimelineTemplate },
  { id: 'pull-quote', label: 'Pull Quote', description: 'Elegant narration and thought leadership.', generationPrompt: 'Favor minimal editorial frames, elegant pull quotes, generous negative space, and subtle typographic motion.', Preview: PullQuoteTemplate },
  { id: 'app-demo', label: 'App Demo', description: 'Browser walkthrough with cursor focus.', generationPrompt: 'Stage the video as a polished interface walkthrough with cursor-led focus, screen crops, and feature captions.', Preview: AppDemoTemplate },
  { id: 'comparison', label: 'Comparison', description: 'Side-by-side options with a winner.', generationPrompt: 'Compare alternatives side by side, progressively revealing criteria and clearly emphasizing the recommended choice.', Preview: ComparisonTemplate },
  { id: 'case-study', label: 'Case Study', description: 'Challenge, solution, result in three beats.', generationPrompt: 'Tell a concise challenge-solution-result story with three structured beats and proof-forward visual transitions.', Preview: CaseStudyTemplate },
  { id: 'team-intro', label: 'Team Intro', description: 'Introduce a host, founder, or expert.', generationPrompt: 'Use human-centered introduction cards, confident portrait framing, role captions, and warm documentary movement.', Preview: TeamIntroTemplate },
  { id: 'announcement', label: 'Announcement', description: 'High-energy launch and reveal.', generationPrompt: 'Create a high-energy launch reveal with punchy scale changes, celebratory accents, and a fast hero payoff.', Preview: AnnouncementTemplate },
  { id: 'outro-cta', label: 'Outro CTA', description: 'Branded closing frame and clear action.', generationPrompt: 'Shape every scene toward a clean branded end card with one strong call to action and a deliberate final hold.', Preview: OutroCtaTemplate },
] as const satisfies readonly PresentationTemplateDefinition[];

export type MotionTemplate = (typeof PRESENTATION_TEMPLATES)[number]['label'];
export const DEFAULT_MOTION_TEMPLATE: MotionTemplate = 'Title Card';

export function presentationTemplateByLabel(label: MotionTemplate): PresentationTemplateDefinition {
  return PRESENTATION_TEMPLATES.find((template) => template.label === label) || PRESENTATION_TEMPLATES[0];
}

export function MotionTemplatePreview({ template }: { template: PresentationTemplateDefinition }) {
  const Preview = template.Preview;
  return (
    <>
      <style>{MOTION_PREVIEW_CSS}</style>
      <Preview compact />
    </>
  );
}

export function MotionStyleShowreel({
  selected,
  onSelect,
}: {
  selected: MotionTemplate;
  onSelect: (template: MotionTemplate) => void;
}) {
  const initial = Math.max(0, PRESENTATION_TEMPLATES.findIndex((template) => template.label === selected));
  const [activeIndex, setActiveIndex] = useState(initial);
  const [paused, setPaused] = useState(false);
  const active = PRESENTATION_TEMPLATES[activeIndex] || PRESENTATION_TEMPLATES[0];

  useEffect(() => {
    const selectedIndex = PRESENTATION_TEMPLATES.findIndex((template) => template.label === selected);
    if (selectedIndex >= 0) setActiveIndex(selectedIndex);
  }, [selected]);

  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % PRESENTATION_TEMPLATES.length);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [paused]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      data-testid="motion-style-showreel"
      style={{
        overflow: 'hidden',
        marginBottom: 18,
        borderRadius: 16,
        border: '1px solid var(--space-border-default)',
        background: 'var(--space-surface-panel)',
      }}
    >
      <div key={active.id} style={{ position: 'relative' }}>
        <MotionTemplatePreview template={active} />
        <span style={{ position: 'absolute', top: 10, left: 10, zIndex: 5, padding: '4px 8px', borderRadius: 999, color: '#fff', background: 'rgba(2,6,23,.72)', backdropFilter: 'blur(8px)', fontSize: 9, fontWeight: 850, letterSpacing: '.08em', textTransform: 'uppercase' }}>
          ● Live motion preview
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px' }}>
        <button type="button" onClick={() => setActiveIndex((activeIndex - 1 + PRESENTATION_TEMPLATES.length) % PRESENTATION_TEMPLATES.length)} aria-label="Previous motion style" style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid var(--space-border-default)', color: 'var(--space-text-primary)', background: 'var(--space-surface-card)', cursor: 'pointer' }}>‹</button>
        <button type="button" onClick={() => setPaused((value) => !value)} aria-label={paused ? 'Play motion previews' : 'Pause motion previews'} style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid var(--space-border-default)', color: 'var(--space-text-primary)', background: 'var(--space-surface-card)', cursor: 'pointer' }}>{paused ? '▶' : 'Ⅱ'}</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ display: 'block', fontSize: 13 }}>{active.label}</strong>
          <span style={{ display: 'block', marginTop: 2, color: 'var(--space-text-muted)', fontSize: 10.5 }}>{activeIndex + 1} of {PRESENTATION_TEMPLATES.length} · {active.description}</span>
        </div>
        <button type="button" onClick={() => onSelect(active.label as MotionTemplate)} style={{ minHeight: 32, padding: '0 11px', borderRadius: 9, border: selected === active.label ? '1px solid var(--space-brand-primary-500)' : '1px solid var(--space-border-default)', color: selected === active.label ? 'var(--space-text-on-primary)' : 'var(--space-text-primary)', background: selected === active.label ? 'var(--space-brand-primary-600)' : 'var(--space-surface-card)', cursor: 'pointer', fontSize: 10.5, fontWeight: 800 }}>{selected === active.label ? 'Selected' : 'Use this style'}</button>
        <button type="button" onClick={() => setActiveIndex((activeIndex + 1) % PRESENTATION_TEMPLATES.length)} aria-label="Next motion style" style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid var(--space-border-default)', color: 'var(--space-text-primary)', background: 'var(--space-surface-card)', cursor: 'pointer' }}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${PRESENTATION_TEMPLATES.length},1fr)`, gap: 3, padding: '0 12px 11px' }}>
        {PRESENTATION_TEMPLATES.map((template, index) => (
          <button key={template.id} type="button" onClick={() => setActiveIndex(index)} aria-label={`Preview ${template.label}`} style={{ height: 3, padding: 0, border: 0, borderRadius: 99, cursor: 'pointer', background: index === activeIndex ? 'var(--space-brand-primary-500)' : 'var(--space-border-default)' }} />
        ))}
      </div>
    </div>
  );
}

export function MotionStylePicker({
  selected,
  onSelect,
}: {
  selected: MotionTemplate;
  onSelect: (template: MotionTemplate) => void;
}) {
  return (
    <div data-testid="motionui-presentation-style-picker">
      <MotionStyleShowreel selected={selected} onSelect={onSelect} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,170px),1fr))', gap: 10 }} role="radiogroup" aria-label="Presentation template">
        {PRESENTATION_TEMPLATES.map((template) => {
          const active = selected === template.label;
          return (
            <button
              key={template.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(template.label as MotionTemplate)}
              data-testid={`motionui-presentation-${template.id}`}
              style={{
                position: 'relative',
                padding: 9,
                overflow: 'hidden',
                borderRadius: 13,
                textAlign: 'left',
                cursor: 'pointer',
                color: 'var(--space-text-primary)',
                border: active ? '2px solid var(--space-brand-primary-500)' : '1px solid var(--space-border-default)',
                background: active ? 'var(--space-surface-accent-soft)' : 'var(--space-surface-panel)',
              }}
            >
              <MotionTemplatePreview template={template} />
              <strong style={{ display: 'block', marginTop: 8, paddingRight: 20, fontSize: 11.5 }}>{template.label}</strong>
              <span style={{ display: 'block', marginTop: 3, color: 'var(--space-text-muted)', fontSize: 9.5, lineHeight: 1.35 }}>{template.description}</span>
              {active ? <span aria-label="Selected" style={{ position: 'absolute', top: 14, right: 14, width: 20, height: 20, display: 'grid', placeItems: 'center', borderRadius: 999, color: 'var(--space-text-on-primary)', background: 'var(--space-brand-primary-600)', fontSize: 11, fontWeight: 900 }}>✓</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
