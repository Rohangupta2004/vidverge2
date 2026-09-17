import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'framer-motion';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  Film,
  GitBranch,
  MessageCircle,
  Play,
  Rocket,
  Sparkles,
  UserRoundCheck,
  WandSparkles,
  Zap,
} from 'lucide-react';
import HeroScene from './HeroScene';
import { useCardTilt } from './hooks/useCardTilt';

const ENTRANCE_SPRING = { type: 'spring' as const, stiffness: 80, damping: 18 };
const MICRO_SPRING = { type: 'spring' as const, stiffness: 200, damping: 25 };
const EXAMPLES = [
  'A 30-second product video for a meditation app with a calm female narrator',
  '60-second ad for wireless earbuds showing commuters in a city',
  'Product intro for an AI writing tool, punchy and fast-paced',
];

const REAL_DEMO = 'https://storage.googleapis.com/audos-images/workspaces/f24710e5-7c6d-4db4-92b4-c2c235877575/uploads/videos/c860b676-a28b-4148-bb95-5bec11c80011.mp4';

type LandingShowcaseProps = {
  brandName: string;
  tagline: string;
  logoUrl?: string;
  email: string;
  loading: boolean;
  error: string;
  gdprEnabled: boolean;
  marketingConsent: boolean;
  socialProviders: string[];
  guestModeEnabled: boolean;
  onEmailChange: (value: string) => void;
  onMarketingConsentChange: (value: boolean) => void;
  onEmailSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSocialLogin: (provider: string) => void;
  onGuestMode: () => void;
};

function BrandMark({ name, logoUrl, size = 38 }: { name: string; logoUrl?: string; size?: number }) {
  if (logoUrl) {
    return <img src={logoUrl} alt={name} style={{ width: size, height: size, objectFit: 'contain', borderRadius: size * 0.25 }} />;
  }
  return (
    <span className="vv-brand-mark" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reducedMotion ? false : { opacity: 0, y: 28, scale: 0.97 }}
      whileInView={reducedMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ ...ENTRANCE_SPRING, delay }}
    >
      {children}
    </motion.div>
  );
}

function TiltCard({ children, className = '', featured = false }: { children: ReactNode; className?: string; featured?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { transform, style } = useCardTilt(ref);
  return (
    <motion.div
      ref={ref}
      className={`vv-tilt-card ${featured ? 'vv-featured-card' : ''} ${className}`}
      style={{ ...style, transform }}
      whileTap={{ scale: 0.985 }}
      transition={MICRO_SPRING}
    >
      {children}
    </motion.div>
  );
}

function MagneticButton({ children, onClick, secondary = false }: { children: ReactNode; onClick: () => void; secondary?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();
  const targetX = useMotionValue(0);
  const targetY = useMotionValue(0);
  const x = useSpring(targetX, { stiffness: 200, damping: 25 });
  const y = useSpring(targetY, { stiffness: 200, damping: 25 });

  useEffect(() => {
    if (reducedMotion || window.matchMedia('(hover: none), (pointer: coarse)').matches) return;
    const handlePointer = (event: PointerEvent) => {
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = event.clientX - centerX;
      const dy = event.clientY - centerY;
      const distance = Math.hypot(dx, dy);
      if (distance < Math.max(rect.width / 2, rect.height / 2) + 60) {
        targetX.set(Math.max(-16, Math.min(16, dx * 0.16)));
        targetY.set(Math.max(-10, Math.min(10, dy * 0.16)));
      } else {
        targetX.set(0);
        targetY.set(0);
      }
    };
    window.addEventListener('pointermove', handlePointer, { passive: true });
    return () => window.removeEventListener('pointermove', handlePointer);
  }, [reducedMotion, targetX, targetY]);

  return (
    <motion.button
      ref={ref}
      type="button"
      onClick={onClick}
      className={secondary ? 'vv-button vv-button-secondary' : 'vv-button vv-button-primary'}
      style={{ x, y }}
      whileHover={reducedMotion ? undefined : { scale: 1.025 }}
      whileTap={{ scale: 0.97 }}
      transition={MICRO_SPRING}
    >
      {children}
    </motion.button>
  );
}

function WaveBar({ index }: { index: number }) {
  const reducedMotion = useReducedMotion();
  const [high, setHigh] = useState(index % 2 === 0);
  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setInterval(() => setHigh(value => !value), 440 + index * 95);
    return () => window.clearInterval(timer);
  }, [index, reducedMotion]);
  return (
    <motion.i
      animate={{ scaleY: reducedMotion ? 0.55 : high ? 1 : 0.28 }}
      transition={ENTRANCE_SPRING}
      style={{ transformOrigin: 'center' }}
    />
  );
}

function GeneratingLine({ compact = false }: { compact?: boolean }) {
  const reducedMotion = useReducedMotion();
  const [filling, setFilling] = useState(true);
  useEffect(() => {
    if (reducedMotion) return;
    let resetTimer = 0;
    const cycle = window.setInterval(() => {
      setFilling(false);
      resetTimer = window.setTimeout(() => setFilling(true), 500);
    }, 3500);
    return () => {
      window.clearInterval(cycle);
      window.clearTimeout(resetTimer);
    };
  }, [reducedMotion]);
  return (
    <div className={`vv-generating ${compact ? 'vv-generating-compact' : ''}`}>
      <div className="vv-generating-label"><Sparkles size={13} /> Generating video...</div>
      <div className="vv-progress-track">
        <motion.span
          initial={{ scaleX: 0 }}
          animate={{ scaleX: reducedMotion ? 0.68 : filling ? 1 : 0 }}
          transition={filling ? ENTRANCE_SPRING : MICRO_SPRING}
        />
      </div>
    </div>
  );
}

function MiniRender({ accent = '#2563EB' }: { accent?: string }) {
  return (
    <div className="vv-mini-render" aria-hidden>
      <span className="vv-mini-screen" style={{ background: `linear-gradient(135deg, ${accent}, #11101a 72%)` }}>
        <Play size={12} fill="currentColor" />
      </span>
      <span className="vv-mini-timeline">
        {[36, 72, 48, 86, 58].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
      </span>
    </div>
  );
}

function useTypingExamples(reducedMotion: boolean) {
  const [exampleIndex, setExampleIndex] = useState(0);
  const [typed, setTyped] = useState(reducedMotion ? EXAMPLES[0] : '');
  useEffect(() => {
    if (reducedMotion) {
      setTyped(EXAMPLES[0]);
      return;
    }
    const text = EXAMPLES[exampleIndex];
    let position = 0;
    setTyped('');
    const typing = window.setInterval(() => {
      position += 1;
      setTyped(text.slice(0, position));
      if (position >= text.length) window.clearInterval(typing);
    }, 38);
    const next = window.setTimeout(() => setExampleIndex(index => (index + 1) % EXAMPLES.length), 4000);
    return () => {
      window.clearInterval(typing);
      window.clearTimeout(next);
    };
  }, [exampleIndex, reducedMotion]);
  return typed;
}

function SocialIcon({ provider }: { provider: string }) {
  if (provider === 'google') return <span className="vv-google">G</span>;
  if (provider === 'facebook') return <span style={{ color: '#60a5fa', fontWeight: 800 }}>f</span>;
  if (provider === 'apple') return <span style={{ fontSize: 18 }}>●</span>;
  if (provider === 'linkedin') return <span style={{ color: '#60a5fa', fontWeight: 800 }}>in</span>;
  return <span>•</span>;
}

export default function LandingShowcase(props: LandingShowcaseProps) {
  const reducedMotion = !!useReducedMotion();
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const backY = useTransform(scrollYProgress, [0, 1], [0, reducedMotion ? 0 : 70]);
  const frontY = useTransform(scrollYProgress, [0, 1], [0, reducedMotion ? 0 : 170]);
  const typedBrief = useTypingExamples(reducedMotion);
  const [demoReady, setDemoReady] = useState(reducedMotion);
  const brandName = typeof props.brandName === 'string' && props.brandName.trim() ? props.brandName : 'VidVerge';
  const tagline = typeof props.tagline === 'string' && props.tagline.trim() ? props.tagline : 'Brief to video in one shot';
  const socialProviders = Array.isArray(props.socialProviders) ? props.socialProviders : [];

  useEffect(() => {
    if (reducedMotion) {
      setDemoReady(true);
      return;
    }

    let readyTimer = window.setTimeout(() => setDemoReady(true), 2800);
    const cycleTimer = window.setInterval(() => {
      setDemoReady(false);
      window.clearTimeout(readyTimer);
      readyTimer = window.setTimeout(() => setDemoReady(true), 2800);
    }, 7600);

    return () => {
      window.clearTimeout(readyTimer);
      window.clearInterval(cycleTimer);
    };
  }, [reducedMotion]);

  const scrollToAuth = () => {
    const form = document.getElementById('vidverge-auth');
    form?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-testid="input-email"]')?.focus(), reducedMotion ? 0 : 550);
  };

  const features = [
    { icon: UserRoundCheck, title: 'Consistent Characters', copy: 'Same character, every scene. No drift, no resets.', accent: '#60A5FA' },
    { icon: GitBranch, title: 'Full Pipeline', copy: 'Script → Animation → Music → Download. Nothing to stitch together.', accent: '#2563EB' },
    { icon: Clock3, title: 'Credit-Smart', copy: '1 credit = 1 second. Use only what you need.', accent: '#3B82F6' },
    { icon: Rocket, title: 'Built for Creators', copy: 'Solo creators and small teams who move fast.', accent: '#1D4ED8' },
  ];
  const pricing = [
    { name: 'Free Trial', price: '$0', unit: '', credits: '30 credits', copy: 'One 30s video, no card needed', fill: '18%', featured: false, details: ['30 seconds included', 'Full pipeline access', 'Publish-ready MP4'] },
    { name: 'Creator', price: '$35', unit: '/mo', credits: '250 credits/mo', copy: '~4 full-length videos, credits roll over', fill: '58%', featured: true, details: ['250 seconds monthly', 'Credits roll over', 'Priority rendering'] },
    { name: 'Pro', price: '$70', unit: '/mo', credits: '500 credits/mo', copy: '~8 videos/month, rollover included', fill: '90%', featured: false, details: ['500 seconds monthly', 'Team-ready workflow', 'Priority rendering'] },
    { name: 'Pay as you go', price: '$9', unit: '', credits: '60 credits', copy: 'A flexible one-off top-up, whenever you need it', fill: '34%', featured: false, details: ['60 video seconds', 'No subscription', 'Credits never expire'] },
  ];

  return (
    <main className="vv-landing">
      <style>{`
        .vv-landing{min-height:100vh;overflow:hidden;background:#050507;color:#F8FAFC;font-family:'Inter','Geist',system-ui,-apple-system,sans-serif;--violet:#2563EB;--indigo:#1D4ED8;--muted:#64748B;--glass:rgba(255,255,255,.04);--border:rgba(255,255,255,.09)}
        .vv-landing *{box-sizing:border-box}.vv-container{width:min(1160px,calc(100% - 40px));margin:0 auto}.vv-section{position:relative;padding:112px 0;border-top:1px solid rgba(255,255,255,.06)}
        .vv-noise{position:absolute;inset:0;pointer-events:none;opacity:.2;background-image:repeating-radial-gradient(circle at 20% 30%,rgba(255,255,255,.11) 0 1px,transparent 1px 4px);background-size:7px 7px;mix-blend-mode:soft-light}
        .vv-nav{position:absolute;z-index:20;top:0;left:0;right:0;padding:26px 0}.vv-nav-inner{display:flex;justify-content:space-between;align-items:center}.vv-brand{display:flex;gap:11px;align-items:center;font-weight:750;letter-spacing:-.02em}.vv-brand-mark{display:inline-flex;align-items:center;justify-content:center;border-radius:11px;background:linear-gradient(135deg,#60A5FA,#2563EB 48%,#1D4ED8);box-shadow:0 8px 30px rgba(37,99,235,.34);font-weight:800}
        .vv-nav-status{display:flex;align-items:center;gap:8px;color:#94A3B8;font-size:12px}.vv-nav-status i{width:7px;height:7px;border-radius:50%;background:#3B82F6;box-shadow:0 0 12px #3B82F6}
        .vv-hero{min-height:100svh;position:relative;display:flex;align-items:center;background:radial-gradient(900px 600px at 74% 46%,rgba(37,99,235,.19),transparent 62%),radial-gradient(700px 520px at 20% 12%,rgba(29,78,216,.14),transparent 68%),#050507}
        .vv-hero-grid{display:grid;grid-template-columns:minmax(0,.9fr) minmax(460px,1.1fr);align-items:center;gap:28px;padding:130px 0 90px}.vv-hero-copy{position:relative;z-index:5}.vv-eyebrow{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border-radius:999px;border:1px solid rgba(96,165,250,.24);background:rgba(37,99,235,.09);color:#93C5FD;font-size:11px;font-weight:750;letter-spacing:.12em;text-transform:uppercase}
        .vv-hero h1{font-size:clamp(52px,6.5vw,92px);line-height:.94;letter-spacing:-.065em;margin:24px 0 24px;max-width:760px}.vv-gradient-text{background:linear-gradient(115deg,#F8FAFC 8%,#93C5FD 48%,#60A5FA 92%);background-clip:text;-webkit-background-clip:text;color:transparent}.vv-hero-copy>p{max-width:620px;color:#94A3B8;font-size:clamp(17px,1.8vw,21px);line-height:1.7;margin:0 0 34px}.vv-hero-actions{display:flex;align-items:center;gap:18px;flex-wrap:wrap}.vv-trust{color:#64748B;font-size:12px;display:flex;gap:8px;align-items:center}.vv-trust svg{color:#60A5FA}
        .vv-button{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:10px;border:0;border-radius:14px;padding:15px 21px;font:inherit;font-size:14px;font-weight:750;cursor:pointer;color:#fff;will-change:transform}.vv-button-primary{background:linear-gradient(135deg,#3B82F6,#2563EB 52%,#1D4ED8);box-shadow:0 14px 38px rgba(37,99,235,.3),inset 0 1px 0 rgba(255,255,255,.25)}.vv-button-secondary{background:rgba(255,255,255,.05);border:1px solid var(--border);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
        .vv-hero-visual{height:560px;position:relative;z-index:2}.vv-hero-canvas{position:absolute;inset:0}.vv-orbit{position:absolute;border:1px solid rgba(37,99,235,.14);border-radius:50%;inset:12% 8%;box-shadow:0 0 100px rgba(37,99,235,.08)}
        @keyframes vvSceneFloat{0%,100%{transform:rotateX(-7deg) rotateY(-13deg) translateY(0)}50%{transform:rotateX(7deg) rotateY(14deg) translateY(-18px)}}@keyframes vvHaloSpin{to{transform:rotate(360deg)}}@keyframes vvLoaderSpin{to{transform:rotate(360deg)}}
        .vv-hero-fallback{height:100%;position:relative;perspective:1200px;transform-style:preserve-3d}.vv-css-stage{position:absolute;inset:2% 0 0;perspective:1200px;transform-style:preserve-3d}.vv-css-object{position:absolute;inset:8% 3%;transform-style:preserve-3d;animation:vvSceneFloat 8s cubic-bezier(.22,1,.36,1) infinite;will-change:transform}.vv-css-halo{position:absolute;left:50%;top:48%;width:62%;aspect-ratio:1;border-radius:50%;border:1px solid rgba(96,165,250,.26);box-shadow:0 0 70px rgba(37,99,235,.2),inset 0 0 50px rgba(29,78,216,.1);transform-style:preserve-3d;animation:vvHaloSpin 18s linear infinite}.vv-css-halo-one{transform:translate(-50%,-50%) rotateX(68deg)}.vv-css-halo-two{width:48%;border-color:rgba(37,99,235,.18);animation-direction:reverse;animation-duration:13s}.vv-css-frame{position:absolute;width:54%;aspect-ratio:1.68;border-radius:18px;padding:10px;background:rgba(16,12,26,.9);border:1px solid rgba(255,255,255,.15);box-shadow:0 26px 70px rgba(0,0,0,.55),0 0 48px rgba(37,99,235,.18);backdrop-filter:blur(12px);transform-style:preserve-3d}.vv-css-frame-edge{position:absolute;inset:8px -9px -9px 8px;border-radius:18px;background:linear-gradient(145deg,#2B174A,#100B1F);transform:translateZ(-18px);box-shadow:0 26px 60px rgba(0,0,0,.48)}.vv-css-frame-1{left:0;top:34%;transform:translateZ(-34px) rotateY(27deg) rotateZ(-5deg)}.vv-css-frame-2{left:23%;top:20%;z-index:2;transform:translateZ(72px) rotateX(-2deg)}.vv-css-frame-3{right:0;top:36%;transform:translateZ(-34px) rotateY(-27deg) rotateZ(5deg)}.vv-css-frame-screen{height:75%;position:relative;border-radius:12px;background:radial-gradient(circle at 30% 24%,rgba(147,197,253,.58),transparent 28%),linear-gradient(135deg,rgba(37,99,235,.76),#0A0712 68%);display:flex;align-items:center;justify-content:center;overflow:hidden;transform:translateZ(16px)}.vv-css-frame-scene{position:absolute;width:48%;height:120%;right:-7%;bottom:-45%;border-radius:46%;background:linear-gradient(160deg,rgba(255,255,255,.28),rgba(29,78,216,.12));transform:rotate(-18deg)}.vv-css-frame-play{position:relative;width:38px;height:38px;border-radius:50%;background:#F8FAFC;color:#1D4ED8;display:grid;place-items:center;font-size:12px;box-shadow:0 8px 22px rgba(0,0,0,.38);transform:translateZ(24px)}.vv-css-frame-timeline{height:25%;display:flex;align-items:center;gap:6px;padding:4px 8px;transform:translateZ(12px)}.vv-css-frame-timeline i{width:12%;border-radius:3px;background:linear-gradient(#60A5FA,#1D4ED8)}.vv-css-logo-extrusion{position:absolute;left:43%;top:43%;width:70px;height:70px;transform-style:preserve-3d;transform:translateZ(142px) rotateY(-12deg)}.vv-css-logo-extrusion span{position:absolute;inset:0;border-radius:18px;display:grid;place-items:center;font-size:31px;font-weight:900;color:#fff;background:linear-gradient(135deg,#60A5FA,#1D4ED8);border:1px solid rgba(255,255,255,.28);box-shadow:0 14px 35px rgba(29,78,216,.28)}.vv-css-floor{position:absolute;left:16%;right:16%;bottom:5%;height:90px;border-radius:50%;background:radial-gradient(ellipse,rgba(37,99,235,.28),transparent 68%);filter:blur(22px);transform:rotateX(76deg) translateZ(-70px)}.vv-hero-fallback[data-reduced-motion='true'] .vv-css-object,.vv-hero-fallback[data-reduced-motion='true'] .vv-css-halo{animation:none}.vv-hero-fallback[data-flat='true']{perspective:none}.vv-hero-fallback[data-flat='true'] .vv-css-object{animation:none;transform:none}.vv-hero-fallback[data-flat='true'] .vv-css-frame{transform:none}.vv-hero-fallback[data-flat='true'] .vv-css-frame-1{left:0}.vv-hero-fallback[data-flat='true'] .vv-css-frame-3{right:0}.vv-hero-fallback[data-flat='true'] .vv-css-logo-extrusion{display:none}
        .vv-kicker{text-align:center;margin-bottom:54px}.vv-kicker h2{font-size:clamp(34px,5vw,58px);line-height:1.02;letter-spacing:-.045em;margin:16px 0}.vv-kicker p{color:#64748B;max-width:620px;margin:0 auto;line-height:1.7}.vv-glow-section{background:radial-gradient(700px 400px at 50% 45%,rgba(37,99,235,.11),transparent 70%),#050507}
        .vv-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;position:relative}.vv-step-card,.vv-feature-card,.vv-price-card{height:100%;padding:24px;border-radius:22px;background:var(--glass);border:1px solid var(--border);backdrop-filter:blur(12px);position:relative;overflow:hidden}.vv-tilt-card{transform-style:preserve-3d;perspective:1000px}.vv-tilt-card:before{content:'';position:absolute;inset:-50%;z-index:0;pointer-events:none;background:radial-gradient(circle at var(--tilt-gloss-x,20%) 40%,rgba(255,255,255,.18),transparent 28%);opacity:0;transform:translateZ(1px)}.vv-tilt-card[data-tilting='true']:before{opacity:1}.vv-card-content{position:relative;z-index:1;transform:translateZ(28px)}.vv-icon{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;color:#93C5FD;background:rgba(37,99,235,.13);border:1px solid rgba(96,165,250,.19);margin-bottom:30px}.vv-step-num{position:absolute;right:22px;top:20px;color:rgba(255,255,255,.14);font-weight:800;font-size:13px}.vv-step-card h3,.vv-feature-card h3,.vv-price-card h3{font-size:18px;margin:0 0 8px;letter-spacing:-.02em}.vv-step-card p,.vv-feature-card p{margin:0;color:#64748B;font-size:14px;line-height:1.65}.vv-step-render{margin-top:24px}.vv-connector{position:absolute;z-index:3;left:29%;width:14%;top:calc(50% - 1px);pointer-events:none}.vv-generating{padding:11px;border-radius:12px;background:#0B0911;border:1px solid rgba(255,255,255,.08);box-shadow:0 14px 30px rgba(0,0,0,.4)}.vv-generating-label{display:flex;align-items:center;gap:6px;font-size:10px;color:#60A5FA;margin-bottom:8px}.vv-progress-track{height:4px;border-radius:99px;background:rgba(255,255,255,.07);overflow:hidden}.vv-progress-track span{display:block;width:100%;height:100%;transform-origin:left;border-radius:inherit;background:linear-gradient(90deg,#1D4ED8,#60A5FA);box-shadow:0 0 12px #2563EB}.vv-generating-compact{padding:9px}
        .vv-demo-panel{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:22px;border-radius:28px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.1);box-shadow:0 35px 100px rgba(0,0,0,.45),0 0 90px rgba(37,99,235,.09);backdrop-filter:blur(14px)}.vv-demo-side{border-radius:20px;background:#09090D;border:1px solid rgba(255,255,255,.08);padding:22px;min-height:380px}.vv-window-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;color:#64748B;font-size:11px}.vv-dots{display:flex;gap:5px}.vv-dots i{width:6px;height:6px;border-radius:50%;background:#25222d}.vv-textarea{min-height:210px;border-radius:16px;padding:18px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.08);font-size:16px;line-height:1.65;color:#CBD5E1}.vv-caret{display:inline-block;width:2px;height:1.1em;margin-left:2px;background:#60A5FA;vertical-align:-2px}.vv-demo-output{position:relative;overflow:hidden;padding:0;background:#07070A}.vv-demo-output video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transform:scale(1.04);transition:opacity .7s ease,transform 1.2s cubic-bezier(.22,1,.36,1)}.vv-demo-output video.vv-demo-video-ready{opacity:.56;transform:scale(1)}.vv-demo-loading{position:absolute;inset:0;z-index:3;display:grid;place-items:center;background:radial-gradient(circle at 50% 42%,rgba(37,99,235,.2),transparent 34%),#07070A;text-align:center}.vv-loader-orbit{width:76px;height:76px;margin:0 auto 20px;border-radius:50%;border:1px solid rgba(96,165,250,.2);border-top:2px solid #60A5FA;box-shadow:0 0 38px rgba(37,99,235,.25);animation:vvLoaderSpin 1.2s linear infinite}.vv-loader-core{position:absolute;left:50%;top:50%;width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#60A5FA,#1D4ED8);transform:translate(-50%,-84%) rotate(12deg);box-shadow:0 0 30px rgba(37,99,235,.5)}.vv-demo-loading strong{display:block;font-size:14px}.vv-demo-loading span{display:block;margin-top:7px;color:#64748B;font-size:11px}.vv-video-overlay{position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,5,7,.08),rgba(5,5,7,.86));display:flex;flex-direction:column;justify-content:flex-end;padding:22px}.vv-play-pulse{position:absolute;left:50%;top:43%;transform:translate(-50%,-50%);width:64px;height:64px;border-radius:50%;display:grid;place-items:center;color:#fff;background:rgba(37,99,235,.78);border:1px solid rgba(255,255,255,.24);box-shadow:0 0 0 12px rgba(37,99,235,.09),0 0 55px rgba(37,99,235,.5)}.vv-wave{height:38px;display:flex;align-items:center;gap:5px;margin:14px 0}.vv-wave i{display:block;width:4px;height:100%;border-radius:99px;background:linear-gradient(#93C5FD,#1D4ED8)}.vv-output-meta{display:flex;justify-content:space-between;color:#94A3B8;font-size:11px}.vv-demo-cta{display:flex;justify-content:center;margin-top:30px}
        .vv-feature-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}.vv-feature-card{min-height:250px}.vv-feature-card .vv-icon{margin-bottom:42px}.vv-feature-copy{display:grid;grid-template-columns:1fr 132px;align-items:end;gap:18px}.vv-mini-render{height:82px;border-radius:11px;background:#09090D;border:1px solid rgba(255,255,255,.08);padding:8px;display:flex;flex-direction:column;gap:6px}.vv-mini-screen{flex:1;border-radius:7px;display:grid;place-items:center;color:#fff}.vv-mini-timeline{height:13px;display:flex;align-items:center;gap:3px}.vv-mini-timeline i{display:block;flex:1;border-radius:3px;background:#514c5e}
        .vv-pricing-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;align-items:stretch}.vv-pricing-grid>div{height:100%}.vv-price-shell{height:410px;perspective:1200px;transform-style:preserve-3d}.vv-price-pop{transform:translateY(-14px);transform-style:preserve-3d}.vv-price-card-inner{position:relative;width:100%;height:100%;transform-style:preserve-3d;transition:transform .78s cubic-bezier(.22,1,.36,1)}.vv-price-shell:hover .vv-price-card-inner,.vv-price-shell:focus-within .vv-price-card-inner{transform:rotateY(180deg)}.vv-price-card{position:absolute;inset:0;padding:25px;min-height:0;display:flex;flex-direction:column;backface-visibility:hidden;-webkit-backface-visibility:hidden;transform-style:preserve-3d}.vv-price-front{transform:rotateY(0deg)}.vv-price-back{transform:rotateY(180deg);background:radial-gradient(circle at 50% 10%,rgba(37,99,235,.2),transparent 45%),#0B0911}.vv-price-back h3,.vv-price-back p,.vv-price-details,.vv-price-back .vv-button{transform:translateZ(28px)}.vv-featured-card{border-color:rgba(96,165,250,.52);background:linear-gradient(180deg,rgba(37,99,235,.13),rgba(255,255,255,.045))}.vv-popular{align-self:flex-start;color:#DBEAFE;background:rgba(37,99,235,.25);border:1px solid rgba(96,165,250,.3);padding:5px 9px;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.vv-price{font-size:42px;line-height:1;letter-spacing:-.05em;font-weight:800;margin:24px 0 9px;transform:translateZ(30px)}.vv-price small{font-size:14px;color:#64748B;letter-spacing:0}.vv-credits{color:#93C5FD;font-weight:700;font-size:14px;transform:translateZ(24px)}.vv-price-copy{color:#64748B;font-size:13px;line-height:1.6;min-height:44px;transform:translateZ(20px)}.vv-seconds-meter{margin:22px 0;padding:13px;border-radius:12px;background:#09090D;border:1px solid rgba(255,255,255,.07);transform:translateZ(22px)}.vv-seconds-top{display:flex;justify-content:space-between;color:#64748B;font-size:10px;margin-bottom:8px}.vv-seconds-track{height:5px;background:rgba(255,255,255,.07);border-radius:99px;overflow:hidden}.vv-seconds-track i{display:block;height:100%;background:linear-gradient(90deg,#1D4ED8,#60A5FA);border-radius:inherit}.vv-price-hint{margin-top:auto;color:#64748B;font-size:11px;transform:translateZ(18px)}.vv-price-details{display:grid;gap:13px;margin:22px 0 28px;padding:0;list-style:none;color:#CBD5E1;font-size:13px}.vv-price-details li{display:flex;gap:9px;align-items:center}.vv-price-details svg{color:#60A5FA}.vv-price-card .vv-button{margin-top:auto;width:100%}.vv-payg{text-align:center;color:#64748B;font-size:13px;margin-top:28px}
        .vv-final{padding:126px 0;text-align:center;overflow:hidden;background:#050507}.vv-final-gradient{position:absolute;width:680px;height:680px;border-radius:45%;left:50%;top:50%;background:conic-gradient(from 0deg,transparent,#1D4ED8,transparent,#2563EB,transparent);filter:blur(100px);opacity:.12;transform:translate(-50%,-50%)}.vv-final h2{position:relative;font-size:clamp(40px,6vw,70px);line-height:1;letter-spacing:-.055em;margin:0 auto 30px;max-width:780px}.vv-final-actions{position:relative;display:flex;justify-content:center}
        .vv-auth-section{padding:110px 0;background:radial-gradient(600px 400px at 50% 50%,rgba(37,99,235,.12),transparent 70%),#050507}.vv-auth-wrap{width:min(500px,calc(100% - 40px));margin:auto}.vv-auth-heading{text-align:center;margin-bottom:25px}.vv-auth-heading h2{font-size:32px;letter-spacing:-.04em;margin:12px 0 8px}.vv-auth-heading p{color:#64748B;margin:0;line-height:1.6}.vv-auth-card{padding:26px;border-radius:22px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.1);box-shadow:0 28px 80px rgba(0,0,0,.52),0 0 70px rgba(37,99,235,.11);backdrop-filter:blur(16px)}.vv-auth-form{display:grid;gap:13px}.vv-input{width:100%;padding:15px 16px;border-radius:12px;background:#0B0A10;border:1px solid rgba(255,255,255,.11);color:#F8FAFC;font:inherit;font-size:15px;outline:0}.vv-input:focus{border-color:#2563EB;box-shadow:0 0 0 3px rgba(37,99,235,.18)}.vv-input::placeholder{color:#4B5563}.vv-submit{width:100%;padding:15px;border:0;border-radius:12px;background:linear-gradient(135deg,#3B82F6,#2563EB,#1D4ED8);color:#fff;font:inherit;font-weight:750;cursor:pointer;box-shadow:0 12px 32px rgba(37,99,235,.28)}.vv-submit:disabled{opacity:.45;cursor:not-allowed}.vv-error{color:#F87171;font-size:12px;margin:7px 0 0}.vv-gdpr{font-size:11px;color:#64748B;padding:11px;border-radius:10px;background:rgba(255,255,255,.025)}.vv-gdpr a{color:#CBD5E1}.vv-gdpr label{display:flex;gap:8px;margin-top:8px}.vv-auth-proof{display:flex;justify-content:center;gap:16px;flex-wrap:wrap;margin:16px 0 0;color:#64748B;font-size:11px}.vv-auth-proof span{display:flex;gap:5px;align-items:center}.vv-auth-proof svg{color:#60A5FA}.vv-divider{display:flex;align-items:center;gap:10px;color:#4B5563;font-size:10px;margin:18px 0 12px}.vv-divider:before,.vv-divider:after{content:'';height:1px;flex:1;background:rgba(255,255,255,.08)}.vv-social-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.vv-social{display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;border-radius:11px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.025);color:#CBD5E1;text-transform:capitalize;cursor:pointer}.vv-google{font-weight:800;background:conic-gradient(from -45deg,#4285F4,#34A853,#FBBC05,#EA4335,#4285F4);background-clip:text;-webkit-background-clip:text;color:transparent}.vv-guest{display:block;margin:15px auto 0;border:0;background:none;color:#64748B;cursor:pointer}.vv-footer{padding:34px 20px;border-top:1px solid rgba(255,255,255,.06);text-align:center;color:#4B5563;font-size:11px}.vv-footer-brand{display:flex;justify-content:center;align-items:center;gap:8px;color:#94A3B8;margin-bottom:9px}
        @media(max-width:1100px) and (min-width:901px){.vv-pricing-grid{grid-template-columns:repeat(2,1fr)}}
        @media(max-width:900px){.vv-hero-grid{grid-template-columns:1fr;padding-top:130px}.vv-hero-copy{text-align:center}.vv-hero-copy>p{margin-left:auto;margin-right:auto}.vv-hero-actions{justify-content:center}.vv-hero-visual{height:460px}.vv-steps,.vv-pricing-grid{grid-template-columns:1fr}.vv-connector{display:none}.vv-price-pop{transform:none}.vv-price-shell{height:390px}.vv-demo-panel{grid-template-columns:1fr}.vv-demo-side{min-height:330px}}
        @media(max-width:767px){.vv-container{width:min(1160px,calc(100% - 28px))}.vv-section{padding:82px 0}.vv-nav-status{display:none}.vv-hero h1{font-size:clamp(48px,15vw,70px)}.vv-hero-visual{height:360px;margin:0 -14px}.vv-hero-grid{gap:0;padding-bottom:55px}.vv-css-frame-1,.vv-css-frame-3{display:none}.vv-css-frame-2{width:82%;left:9%;top:22%}.vv-feature-grid{grid-template-columns:1fr}.vv-feature-copy{grid-template-columns:1fr 120px}.vv-kicker{margin-bottom:38px}.vv-demo-panel{padding:12px;border-radius:22px}.vv-demo-side{padding:16px}.vv-final{padding:90px 0}.vv-social-grid{grid-template-columns:1fr}}
        @media(prefers-reduced-motion:reduce){.vv-landing *{scroll-behavior:auto!important}.vv-tilt-card:before{display:none}}
      `}</style>

      <section ref={heroRef} className="vv-hero">
        <div className="vv-noise" />
        <nav className="vv-nav">
          <div className="vv-container vv-nav-inner">
            <div className="vv-brand"><BrandMark name={brandName} logoUrl={props.logoUrl} /> {brandName}</div>
            <span className="vv-nav-status"><i /> AI video pipeline online</span>
          </div>
        </nav>
        <motion.div className="vv-orbit" style={{ y: backY }} />
        <div className="vv-container vv-hero-grid">
          <motion.div className="vv-hero-copy" style={{ y: backY }} initial={reducedMotion ? false : { opacity: 0, y: 35 }} animate={{ opacity: 1, y: 0 }} transition={ENTRANCE_SPRING}>
            <span className="vv-eyebrow"><WandSparkles size={13} /> AI production, end to end</span>
            <h1><span className="vv-gradient-text">Brief to Video.</span><br />Instantly.</h1>
            <p>Describe your idea. Vidverge scripts it, animates it, and delivers a download-ready video — consistent characters, every shot.</p>
            <div className="vv-hero-actions">
              <MagneticButton onClick={scrollToAuth}>Generate Your First Video <ArrowRight size={17} /></MagneticButton>
              <span className="vv-trust"><CheckCircle2 size={14} /> 30 credits free · no card</span>
            </div>
          </motion.div>
          <motion.div className="vv-hero-visual" style={{ y: frontY }} initial={reducedMotion ? false : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...ENTRANCE_SPRING, delay: 0.08 }}>
            <div className="vv-hero-canvas"><HeroScene /></div>
          </motion.div>
        </div>
      </section>

      <section className="vv-section vv-glow-section">
        <div className="vv-container">
          <Reveal><div className="vv-kicker"><span className="vv-eyebrow">How it works</span><h2>One brief. Three moves.<br />A finished video.</h2><p>Each stage flows into the next, with live rendering progress from first word to final MP4.</p></div></Reveal>
          <div className="vv-steps">
            {[
              { icon: MessageCircle, title: 'Describe', copy: 'Describe your video in plain language', accent: '#60A5FA' },
              { icon: Zap, title: 'Generate', copy: 'AI scripts, animates, and renders your video', accent: '#2563EB' },
              { icon: Download, title: 'Download', copy: 'One click export. Publish-ready MP4.', accent: '#1D4ED8' },
            ].map((step, index) => (
              <Reveal key={step.title} delay={index * 0.08}>
                <TiltCard className="vv-step-card"><div className="vv-card-content"><span className="vv-step-num">0{index + 1}</span><div className="vv-icon"><step.icon size={21} /></div><h3>{step.title}</h3><p>{step.copy}</p><div className="vv-step-render"><MiniRender accent={step.accent} /></div></div></TiltCard>
              </Reveal>
            ))}
            <div className="vv-connector"><GeneratingLine compact /></div>
          </div>
        </div>
      </section>

      <section className="vv-section">
        <div className="vv-container">
          <Reveal><div className="vv-kicker"><span className="vv-eyebrow">See it in action</span><h2>From sentence to scene.</h2><p>Watch the brief become a rendered, timed, ready-to-publish video inside one production surface.</p></div></Reveal>
          <Reveal delay={0.08}>
            <TiltCard className="vv-demo-panel">
              <div className="vv-demo-side"><div className="vv-window-bar"><span>VIDEO BRIEF</span><span className="vv-dots"><i /><i /><i /></span></div><div className="vv-textarea">{typedBrief}<motion.span className="vv-caret" animate={{ opacity: reducedMotion ? 1 : [1, 0.15] }} transition={{ ...MICRO_SPRING, repeat: Infinity, repeatType: 'reverse' }} /></div><div style={{ marginTop: 18 }}><GeneratingLine /></div></div>
              <div className="vv-demo-side vv-demo-output"><video className={demoReady ? 'vv-demo-video-ready' : ''} src={REAL_DEMO} autoPlay muted loop playsInline preload="metadata" aria-label="Vidverge generated video preview" />{!demoReady ? <motion.div className="vv-demo-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><div><div style={{ position: 'relative' }}><div className="vv-loader-orbit" /><div className="vv-loader-core" /></div><strong>Building your video</strong><span>Scripting · animating · mixing sound</span></div></motion.div> : <motion.div className="vv-video-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={ENTRANCE_SPRING}><motion.div className="vv-play-pulse" animate={reducedMotion ? undefined : { scale: [1, 1.08] }} transition={{ ...ENTRANCE_SPRING, repeat: Infinity, repeatType: 'reverse' }}><Play size={24} fill="currentColor" /></motion.div><span className="vv-eyebrow" style={{ alignSelf: 'flex-start' }}><CheckCircle2 size={12} /> Render complete</span><div className="vv-wave">{Array.from({ length: 18 }, (_, index) => <WaveBar key={index} index={index} />)}</div><div className="vv-output-meta"><span>6 scenes rendered</span><span>00:30 · MP4 ready</span></div></motion.div>}</div>
            </TiltCard>
          </Reveal>
          <div className="vv-demo-cta"><MagneticButton onClick={scrollToAuth}>Generate Video <ArrowRight size={17} /></MagneticButton></div>
        </div>
      </section>

      <section className="vv-section vv-glow-section">
        <div className="vv-container">
          <Reveal><div className="vv-kicker"><span className="vv-eyebrow">Built for shippable output</span><h2>The whole studio,<br />without the stitching.</h2></div></Reveal>
          <div className="vv-feature-grid">
            {features.map((feature, index) => (
              <Reveal key={feature.title} delay={index * 0.08}><TiltCard className="vv-feature-card"><div className="vv-card-content"><div className="vv-icon"><feature.icon size={21} /></div><div className="vv-feature-copy"><div><h3>{feature.title}</h3><p>{feature.copy}</p></div><MiniRender accent={feature.accent} /></div></div></TiltCard></Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="vv-section">
        <div className="vv-container">
          <Reveal><div className="vv-kicker"><span className="vv-eyebrow">Simple pricing</span><h2>Credits that map<br />to real video.</h2><p>One credit equals one second, so every plan is clear before you press generate.</p></div></Reveal>
          <div className="vv-pricing-grid">
            {pricing.map((tier, index) => (
              <Reveal key={tier.name} delay={index * 0.07}>
                <div className={tier.featured ? 'vv-price-pop' : ''}>
                  <div className="vv-price-shell" tabIndex={0} aria-label={`${tier.name} plan; hover or focus for details`}>
                    <div className="vv-price-card-inner">
                      <div className={`vv-price-card vv-price-front ${tier.featured ? 'vv-featured-card' : ''}`}>
                        {tier.featured && <span className="vv-popular">Most popular</span>}
                        <h3 style={{ marginTop: tier.featured ? 18 : 0 }}>{tier.name}</h3>
                        <div className="vv-price">{tier.price}<small>{tier.unit}</small></div>
                        <div className="vv-credits">{tier.credits}</div>
                        <p className="vv-price-copy">{tier.copy}</p>
                        <div className="vv-seconds-meter"><div className="vv-seconds-top"><span><Film size={11} style={{ display: 'inline', marginRight: 5 }} />video capacity</span><span>{tier.credits}</span></div><div className="vv-seconds-track"><motion.i initial={{ width: 0 }} whileInView={{ width: tier.fill }} viewport={{ once: true }} transition={{ ...ENTRANCE_SPRING, delay: 0.16 + index * 0.07 }} /></div></div>
                        <span className="vv-price-hint">Hover or focus to flip →</span>
                      </div>
                      <div className={`vv-price-card vv-price-back ${tier.featured ? 'vv-featured-card' : ''}`}>
                        <h3>{tier.name}, unpacked</h3>
                        <p className="vv-price-copy">Everything you need to move from an idea to a finished video.</p>
                        <ul className="vv-price-details">{tier.details.map(detail => <li key={detail}><Check size={14} /> {detail}</li>)}</ul>
                        <MagneticButton onClick={scrollToAuth} secondary={!tier.featured}>Choose {tier.name} <ArrowRight size={16} /></MagneticButton>
                      </div>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <p className="vv-payg">One credit equals one second of generated video. Upgrade or top up whenever you need.</p>
        </div>
      </section>

      <section className="vv-final vv-section">
        <motion.div className="vv-final-gradient" animate={reducedMotion ? undefined : { rotate: 360 }} transition={{ ...ENTRANCE_SPRING, repeat: Infinity, duration: 18 }} />
        <div className="vv-container"><Reveal><h2>Ready to make your first video?</h2><div style={{ width: 220, margin: '0 auto 24px', position: 'relative' }}><GeneratingLine compact /></div><div className="vv-final-actions"><MagneticButton onClick={scrollToAuth}>Generate Video <ArrowRight size={17} /></MagneticButton></div></Reveal></div>
      </section>

      <section id="vidverge-auth" className="vv-auth-section">
        <div className="vv-auth-wrap">
          <Reveal><div className="vv-auth-heading"><BrandMark name={brandName} logoUrl={props.logoUrl} size={48} /><h2>Generate your first video</h2><p>Enter your email and start briefing Vidverge.<br />No card. No setup.</p></div></Reveal>
          <Reveal delay={0.08}>
            <div className="vv-auth-card">
              <form onSubmit={props.onEmailSubmit} className="vv-auth-form">
                <div><input type="email" value={props.email} onChange={event => props.onEmailChange(event.target.value)} placeholder="you@work.com" className="vv-input" disabled={props.loading} required data-testid="input-email" />{props.error && <p className="vv-error" data-testid="text-error">{props.error}</p>}</div>
                {props.gdprEnabled && <div className="vv-gdpr"><p style={{ margin: 0 }}>By entering your email, you agree to our <a href="/privacy">Privacy Policy</a>.</p><label><input type="checkbox" checked={props.marketingConsent} onChange={event => props.onMarketingConsentChange(event.target.checked)} /><span>I want to receive marketing emails and updates (optional)</span></label></div>}
                <motion.button type="submit" disabled={props.loading || !props.email} className="vv-submit" data-testid="button-continue" whileHover={reducedMotion ? undefined : { scale: 1.018 }} whileTap={{ scale: 0.98 }} transition={MICRO_SPRING}>{props.loading ? 'Just a moment...' : 'Create my first video →'}</motion.button>
              </form>
              <div className="vv-auth-proof">{['Free first video', 'No credit card', 'Yours to keep'].map(item => <span key={item}><Check size={12} />{item}</span>)}</div>
              {socialProviders.length > 0 && <><div className="vv-divider">or continue with</div><div className="vv-social-grid">{socialProviders.map(provider => <button key={provider} type="button" onClick={() => props.onSocialLogin(provider)} disabled={props.loading} className="vv-social"><SocialIcon provider={provider} />{provider}</button>)}</div></>}
              {props.guestModeEnabled && <button type="button" onClick={props.onGuestMode} disabled={props.loading} className="vv-guest">Continue as guest →</button>}
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="vv-footer"><div className="vv-footer-brand"><BrandMark name={brandName} logoUrl={props.logoUrl} size={24} /> {brandName}</div><div>{tagline} · © 2026</div></footer>
    </main>
  );
}
