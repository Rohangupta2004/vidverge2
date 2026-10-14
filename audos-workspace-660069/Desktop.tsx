import { useState, Suspense, LazyExoticComponent, ComponentType, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { Bot, Folder, X, Activity, Clapperboard, Moon, Heart, Calendar, Users, FileText, BarChart, Settings as SettingsIcon, MessageCircle, Plane, TrendingUp, LineChart, Dumbbell, Brain, Target, Zap, Star, Clock, CheckCircle, List, BookOpen, Coffee, Music, Camera, MapPin, Wallet, ShoppingCart, Gift, Lightbulb, Sparkles, Rocket, Home, Building, Globe, Mail, Phone, Video, Mic, Image, Play, Pause, Volume2, Wifi, Cloud, Sun, Umbrella, Thermometer, Wind, Droplets, Leaf, Flower2, Film, Mountain, Waves, Compass, Map as MapIcon, Navigation, Car, Bike, Ship, Award, Trophy, Medal, Crown, Diamond, Gem, Key, Lock, Unlock, Shield, Eye, Search, Filter, SortAsc, Download, Upload, Share2, Link, ExternalLink, Copy, Clipboard, Trash2, Edit, Pencil, PenTool, Scissors, Bookmark, Flag, Bell, AlertCircle, Info, HelpCircle, XCircle, CheckCircle2, Circle, Square, Triangle, Hexagon, Octagon, Hash, AtSign, DollarSign, Percent, Calculator, Code, Terminal, Database, Server, Cpu, Monitor, Smartphone, Tablet, Laptop, Watch, Headphones, Speaker, Radio, Tv, Printer, Scan, QrCode, Barcode, CreditCard, Receipt, Banknote, PiggyBank, TrendingDown, AreaChart, PieChart, FlaskConical, Ghost, Radar, Crosshair, Wand2, Type, ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { AppConfig, SpaceConfig, DesktopBranding, DesktopThemeTokens } from './types';
import { useSpaceRuntime } from './SpaceRuntimeContext';
import FileBrowser from './components/FileBrowser';
import EmailGate from './components/EmailGate';
import Settings from './components/Settings';
import PricingScreen from './components/PricingScreen';
import CreditBalance from './components/CreditBalance';
import {
  getPlanId,
  isPaidTier,
  isProTier,
  PRICING_EVENT,
  SUBSCRIPTION_GATE_DISABLED,
  useUserTier,
} from './lib/plans';
import type { PricingRequest, PricingTrigger } from './lib/plans';
import { consumeCheckoutReturn, refreshCredits } from './lib/credits';
import { tw } from './lib/colors';
import { isTenantDelegationCanvas } from './lib/tenant-delegation-canvas';
import { LauncherFX } from './components/HomeLauncher';
import AgentChatView from './components/AgentChatView';
import VergeLoader from './components/VergeLoader';
import BrandLogo from './components/BrandLogo';
import { useAgentChatRuntime } from './components/useAgentChatRuntime';
import GlobalStyles from './components/ui/GlobalStyles';

const DESKTOP_VERSION = 2;

// Hook to detect mobile vs desktop using JS (prevents double-mounting of components)
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768; // md breakpoint
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);

    // Set initial value
    setIsMobile(mediaQuery.matches);

    // Listen for changes
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

/**
 * HeroAgentChat — the VidVerge agent as the hero of the main screen.
 * Glue only: the platform-managed runtime hook + the per-space view
 * (components/AgentChatView.tsx). Do not rebuild chat logic here.
 */
function HeroAgentChat({ spaceId }: { spaceId: string }) {
  const runtime = useAgentChatRuntime({ spaceId });
  return <AgentChatView runtime={runtime} />;
}

interface AppErrorBoundaryProps {
  appName?: string;
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  retryKey: number;
}

class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, retryKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[AppErrorBoundary] App "${this.props.appName || 'unknown'}" crashed:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '32px', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px', color: 'var(--space-text-primary, #f5f5f7)' }}>
            {this.props.appName ? `"${this.props.appName}" failed to load` : 'App failed to load'}
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--space-text-secondary, #a1a1ab)', marginBottom: '20px', maxWidth: '400px', margin: '0 auto 20px' }}>
            {this.state.error?.message || 'An unexpected error occurred while loading this app.'}
          </p>
          <button
            onClick={() => {
              this.setState((prev) => ({ hasError: false, error: null, retryKey: prev.retryKey + 1 }));
            }}
            style={{
              padding: '8px 20px',
              borderRadius: '8px',
              border: '1px solid var(--space-border-default, rgba(255,255,255,0.1))',
              background: 'var(--space-surface-muted, rgba(255,255,255,0.06))',
              color: 'var(--space-text-primary, #f5f5f7)',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            ↻ Retry
          </button>
        </div>
      );
    }
    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}

function buildFontFamily(fontName?: string): string {
  if (!fontName) {
    return '"Inter", system-ui, -apple-system, sans-serif';
  }

  return `"${fontName}", system-ui, -apple-system, sans-serif`;
}

function resolveGenesisRuntimeTheme(config: SpaceConfig) {
  const branding = (config.desktop?.branding || {}) as DesktopBranding;
  const themeTokens = (config.desktop?.themeTokens || {}) as DesktopThemeTokens;
  const headingFont =
    themeTokens.typography?.headingFont ||
    branding.headingFont ||
    'Sora';
  const bodyFont =
    themeTokens.typography?.bodyFont ||
    branding.bodyFont ||
    headingFont;

  return {
    branding: {
      name: branding.name || config.name || 'Welcome',
      tagline: branding.tagline,
      logoUrl:
        branding.logoUrl ||
        (config as any).iconUrl ||
        (config as any).logoUrl,
    },
    themeTokens: {
      palette: themeTokens.palette || branding.palette || branding.colors,
      typography: {
        headingFont,
        bodyFont,
        fontFamily:
          themeTokens.typography?.fontFamily || buildFontFamily(headingFont),
      },
      shell: themeTokens.shell,
      cssVariables: themeTokens.cssVariables || {},
    },
  };
}

// Icon mapping for app icons - supports both PascalCase and lowercase
const baseIconMap: Record<string, ComponentType<any>> = {
  Activity, Moon, Heart, Calendar, Users, FileText, BarChart, Bot, Folder,
  Plane, TrendingUp, LineChart, Dumbbell, Brain, Target, Zap, Star, Clock,
  CheckCircle, List, BookOpen, Coffee, Music, Camera, MapPin, Wallet,
  ShoppingCart, Gift, Lightbulb, Sparkles, Rocket, Home, Building, Globe,
  Mail, Phone, Video, Mic, Image, Play, Pause, Volume2, Wifi, Cloud, Sun,
  Umbrella, Thermometer, Wind, Droplets, Leaf, Mountain, Waves, Compass,
  Map: MapIcon, Navigation, Car, Bike, Ship, Award, Trophy, Medal, Crown, Diamond,
  Gem, Key, Lock, Unlock, Shield, Eye, Search, Filter, SortAsc, Download,
  Upload, Share2, Link, ExternalLink, Copy, Clipboard, Trash2, Edit, Pencil,
  PenTool, Scissors, Bookmark, Flag, Bell, AlertCircle, Info, HelpCircle,
  XCircle, CheckCircle2, Circle, Square, Triangle, Hexagon, Octagon, Hash,
  AtSign, DollarSign, Percent, Calculator, Code, Terminal, Database, Server,
  Cpu, Monitor, Smartphone, Tablet, Laptop, Watch, Headphones, Speaker,
  Radio, Tv, Printer, Scan, QrCode, Barcode, CreditCard, Receipt, Banknote,
  PiggyBank, TrendingDown, AreaChart, PieChart, Flower2, Clapperboard, Film,
  FlaskConical, Ghost, Radar, Crosshair, Wand2, Type,
};

// Create case-insensitive lookup with common aliases
const iconMap: Record<string, ComponentType<any>> = {};
Object.entries(baseIconMap).forEach(([key, value]) => {
  iconMap[key] = value;
  iconMap[key.toLowerCase()] = value;
  // Handle kebab-case (e.g., "line-chart" -> LineChart)
  const kebabKey = key.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
  iconMap[kebabKey] = value;
});
// Common aliases
iconMap['chart'] = BarChart;
iconMap['graph'] = LineChart;
iconMap['workout'] = Dumbbell;
iconMap['fitness'] = Dumbbell;
iconMap['gym'] = Dumbbell;
iconMap['stock'] = TrendingUp;
iconMap['stocks'] = TrendingUp;
iconMap['trip'] = Plane;
iconMap['travel'] = Plane;
iconMap['flight'] = Plane;
iconMap['money'] = Wallet;
iconMap['finance'] = DollarSign;
iconMap['health'] = Heart;
iconMap['wellness'] = Heart;
iconMap['notes'] = FileText;
iconMap['note'] = FileText;
iconMap['log'] = List;
iconMap['tracker'] = Activity;
iconMap['tracking'] = Activity;
iconMap['ai'] = Sparkles;
iconMap['smart'] = Brain;
iconMap['idea'] = Lightbulb;
iconMap['ideas'] = Lightbulb;
iconMap['time'] = Clock;
iconMap['schedule'] = Calendar;
iconMap['event'] = Calendar;
iconMap['events'] = Calendar;
iconMap['people'] = Users;
iconMap['team'] = Users;
iconMap['community'] = Users;
iconMap['book'] = BookOpen;
iconMap['read'] = BookOpen;
iconMap['reading'] = BookOpen;
iconMap['shop'] = ShoppingCart;
iconMap['shopping'] = ShoppingCart;
iconMap['cart'] = ShoppingCart;
iconMap['location'] = MapPin;
iconMap['place'] = MapPin;
iconMap['weather'] = Cloud;
iconMap['photo'] = Camera;
iconMap['photos'] = Camera;
iconMap['video'] = Video;
iconMap['movie'] = Play;
iconMap['audio'] = Music;
iconMap['sound'] = Volume2;
iconMap['call'] = Phone;
iconMap['email'] = Mail;
iconMap['message'] = MessageCircle;
iconMap['messages'] = MessageCircle;
iconMap['chat'] = MessageCircle;
iconMap['settings'] = SettingsIcon;
iconMap['config'] = SettingsIcon;
iconMap['gear'] = SettingsIcon;

// =============================================================================
// SIDEBAR
// =============================================================================

const SIDEBAR_WIDTH = 248;
const SIDEBAR_WIDTH_COLLAPSED = 76;
const SIDEBAR_COLLAPSE_KEY = 'vv-sidebar-collapsed';
const SIDEBAR_BORDER = 'var(--space-border-default, rgba(255,255,255,0.07))';

/**
 * How the studios are grouped in the sidebar. Ids are matched against
 * config.apps, so a renamed app keeps its place and an unregistered app drops
 * out. Anything registered but not listed here is swept into a trailing
 * "More" section rather than vanishing from the nav.
 */
const SIDEBAR_GROUPS: Array<{ label: string; emoji: string; appIds: string[] }> = [
  {
    label: 'Video',
    emoji: '\u{1F3AC}',
    appIds: [
      'vidverge-agent',
      'vidverge-engine',
      'sceneforge',
      'script-to-video',
      'faceless',
      'faceless-content',
      'video-enhancer',
    ],
  },
  {
    label: 'Lab & Tools',
    emoji: '\u{1F52C}',
    appIds: ['video-provider-lab', 'cineagent', 'phantom'],
  },
  {
    label: 'Creative',
    emoji: '\u{1F3A8}',
    appIds: ['ads-studio', 'motion-type', 'voice-studio', 'product-launch', 'brand-context'],
  },
];

interface SidebarSection {
  label: string;
  emoji: string;
  items: AppConfig[];
}

function buildSidebarSections(apps: AppConfig[]): SidebarSection[] {
  const byId = new Map(apps.map((app) => [app.id, app]));
  const claimed = new Set<string>();

  const sections: SidebarSection[] = [];
  SIDEBAR_GROUPS.forEach((group) => {
    const items: AppConfig[] = [];
    group.appIds.forEach((id) => {
      const app = byId.get(id);
      if (!app || claimed.has(id)) return;
      claimed.add(id);
      items.push(app);
    });
    if (items.length) sections.push({ label: group.label, emoji: group.emoji, items });
  });

  const unlisted = apps.filter((app) => !claimed.has(app.id));
  if (unlisted.length) {
    sections.push({ label: 'More', emoji: '\u2728', items: unlisted });
  }

  return sections;
}

interface SidebarNavItemProps {
  icon: ComponentType<any>;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}

function SidebarNavItem({ icon: Icon, label, active, collapsed, onClick }: SidebarNavItemProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-current={active ? 'page' : undefined}
      className={[
        'relative flex w-full items-center rounded-[10px] transition-all duration-200 ease-out',
        collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5',
        active
          ? 'bg-[var(--space-brand-primary)] text-[var(--space-text-on-primary)] shadow-[0_8px_28px_rgba(214,171,74,0.22)]'
          : 'text-[var(--space-text-muted)] hover:bg-[rgba(255,255,255,0.055)] hover:text-[var(--space-text-primary)]',
      ].join(' ')}
    >
      <Icon className="w-[18px] h-[18px] shrink-0" />
      {!collapsed && (
        <span
          className="min-w-0 truncate text-[13px] font-semibold"
          style={{ letterSpacing: '-0.01em' }}
        >
          {label}
        </span>
      )}
    </button>
  );
}

interface SpaceDesktopProps {
  mode: 'entrepreneur' | 'customer';
  spaceId: string;
  sessionId?: string;
  config: SpaceConfig;
  apps: Record<string, LazyExoticComponent<ComponentType<any>>>;
  LoadingSpinner: ComponentType;
  initialAppId?: string | null;
}

type WindowId = 'files' | 'settings' | string; // string for app IDs

interface FileAccessLog {
  timestamp: number;
  path: string;
  action: 'read' | 'write';
  tool: string;
}

export default function SpaceDesktop({
  mode,
  spaceId,
  sessionId: _unusedProp, // Ignore prop, read from context instead
  config,
  apps,
  LoadingSpinner,
  initialAppId
}: SpaceDesktopProps) {
  const { sessionId, isBootstrappingSession, trackEvent, subscriptionReady } = useSpaceRuntime();
  const isMobile = useIsMobile();
  // SUBSCRIPTION GATE TEMPORARILY DISABLED — all users have full access.
  // This used to be the visitor's tier from the `subscriptions` table, looked
  // up by email, and it decided whether Pro features were unlocked. That lookup
  // is bypassed in lib/plans.ts (SUBSCRIPTION_GATE_DISABLED): every visitor now
  // resolves as Pro with an unlimited allowance, whether or not they have a row,
  // so nothing here can gate a feature or raise a paywall. Only the plan chrome
  // (the crown label / badge) still reads it.
  const { tier: userTier, unlimited } = useUserTier(spaceId, sessionId);
  const isSubscriber = isPaidTier(userTier);
  const planLabel = isProTier(userTier)
    ? 'Pro'
    : userTier === 'creator'
      ? 'Creator'
      : userTier === 'payg'
        ? 'Pay-as-you-go'
        : 'Plans';
  const planButtonTitle = !isSubscriber
    ? 'VidVerge plans'
    : unlimited
      ? `You're on VidVerge ${planLabel} \u2014 unlimited videos`
      : `You're on VidVerge ${planLabel}`;

  // Timeout guard: if subscriptionReady stays false for too long, unblock the UI
  // so the user isn't stuck on an infinite spinner (fixes EmailGate hang bug).
  const [subscriptionTimedOut, setSubscriptionTimedOut] = useState(false);
  useEffect(() => {
    if (subscriptionReady) return;
    if (!sessionId) return;
    const timer = setTimeout(() => setSubscriptionTimedOut(true), 8000);
    return () => clearTimeout(timer);
  }, [subscriptionReady, sessionId]);

  // Lock body/html scroll on mobile to prevent iOS Safari from scrolling
  // the page when the keyboard opens or the address bar animates.
  // The requestAnimationFrame flush forces Android Chrome to discard stale
  // compositor tiles that may linger from the initial paint (before position
  // switches to fixed), preventing GPU tile corruption artifacts.
  useEffect(() => {
    if (!isMobile) return;
    const html = document.documentElement;
    const body = document.body;
    html.style.overflow = 'hidden';
    html.style.height = '100%';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.width = '100%';
    body.style.height = '100%';
    body.style.top = '0';
    body.style.left = '0';
    const raf = requestAnimationFrame(() => {
      body.style.opacity = '0.999';
      requestAnimationFrame(() => { body.style.opacity = ''; });
    });
    return () => {
      cancelAnimationFrame(raf);
      html.style.overflow = '';
      html.style.height = '';
      body.style.overflow = '';
      body.style.position = '';
      body.style.width = '';
      body.style.height = '';
      body.style.top = '';
      body.style.left = '';
    };
  }, [isMobile]);
  const [activeWindowId, setActiveWindowId] = useState<WindowId | null>(null);
  const [fileAccessLogs] = useState<FileAccessLog[]>([]);
  // Sidebar collapse is a per-visitor preference, so it is read straight out
  // of localStorage on first render rather than flashing expanded first.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      // A blocked storage quota must never take the shell down.
    }
  }, [sidebarCollapsed]);
  // Plans overlay. Mounted here rather than inside an app so it can take the
  // whole screen from any shell state, and so every surface can raise it.
  // The whole request is kept rather than just the trigger: a credit wall
  // carries what the blocked render needed, so the screen can say it.
  const [pricingRequest, setPricingRequest] = useState<PricingRequest | null>(null);

  // Track whether hash changes were triggered by this shell.
  const isInternalHashChange = useRef(false);
  // Track if initial window setup has been done (to prevent deep link handler from re-running)
  const hasInitialized = useRef(false);
  // Track if space_entered has been tracked to avoid duplicates
  const hasTrackedSpaceEntry = useRef(false);

  const openApp = (appId: string) => {
    const app = config.apps.find(a => a.id === appId);
    if (app) {
      trackEvent('app_opened', { appId, appName: app.name });
    }
    setActiveWindowId(appId);
  };

  // Show email gate for customer mode if no session (from context)
  // Suppress gate while post-checkout auto-session bootstrap is in flight to avoid flashing EmailGate
  // Also bypass when the URL targets a public app (e.g. tokenised PhotoUpload deep-link from email):
  // the public app validates the token itself, so the EmailGate is not needed.
  const publicAppBypass = (() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    const requestedAppId = params.get('app') || (window as any).__DEEP_LINK_APP_ID__ || initialAppId;
    if (!requestedAppId) return false;
    const matchingApp = config.apps.find(a => a.id.toLowerCase() === String(requestedAppId).toLowerCase());
    return !!matchingApp && (matchingApp as any).public === true;
  })();
  // Tenant-agent delegation (Product Run standing access / job handoff): the
  // delegation token in the injected bootstrap or URL is the visitor's
  // credential — every data API validates it server-side — so the email gate
  // must not block the delegated canvas.
  const tenantDelegationBypass = (() => {
    if (typeof window === 'undefined') return false;
    // U7 task-mode Product Run: the release-owned artifact document renders
    // the app UI while the canonical task conversation lives in the parent
    // chrome — no visitor session or delegation token exists inside the
    // opaque sandbox (R42), so the email gate must not block it.
    if ((window as any).__TENANT_TASK_MODE__?.nonce) return true;
    const injected = (window as any).__TENANT_DELEGATION__ as
      | { sessionId?: string; token?: string }
      | undefined;
    if (injected?.sessionId && injected?.token) return true;
    const params = new URLSearchParams(window.location.search);
    return !!(params.get('ta_session') && params.get('delegation_token'));
  })();
  // `?as=visitor` (injected as window.__AUDOS_FORCE_VISITOR__ at serve time)
  // forces the logged-out gate so the desk preview shows the real visitor view
  // regardless of any stored same-origin session.
  const forceVisitor =
    typeof window !== 'undefined' && (window as any).__AUDOS_FORCE_VISITOR__ === true;
  const showEmailGate =
    mode === 'customer' &&
    (forceVisitor ||
      (!sessionId && !isBootstrappingSession && !publicAppBypass && !tenantDelegationBypass));

  // With no active window, show the two-app launcher on every screen size.
  const isLauncherMode = activeWindowId === null;

  // Track space_entered when session becomes available (first entry after email gate)
  useEffect(() => {
    if (sessionId && !hasTrackedSpaceEntry.current) {
      hasTrackedSpaceEntry.current = true;
      trackEvent('space_entered', {
        referrer: document.referrer || null,
        url: window.location.href,
      });
    }
  }, [sessionId, trackEvent]);

  // Handle URL hash-based deep linking and otherwise leave the two-app home visible.
  useEffect(() => {
    if (hasInitialized.current) return;
    if (!sessionId && !publicAppBypass && !tenantDelegationBypass) return;

    hasInitialized.current = true;

    const hash = window.location.hash.slice(1).toLowerCase();
    const urlAppParam = new URLSearchParams(window.location.search).get('app') || (window as any).__DEEP_LINK_APP_ID__ || initialAppId;
    const deepLinkId = hash || urlAppParam?.toLowerCase() || '';

    // App-first landing: when nothing deep-links to a specific view, open the
    // configured default landing app (config.desktop.layout.defaultLandingView
    // = 'app') instead of the agent-hero launcher.
    if (!deepLinkId) {
      // Always land on Vidverge Agent when no deep link is present
      const landing = (config.desktop?.layout || {}) as any;
      const defaultAppId = landing.defaultLandingAppId || 'vidverge-agent';
      const landingApp = config.apps.find(app => app.id === defaultAppId) || config.apps[0];
      if (landingApp) {
        setActiveWindowId(landingApp.id);
        return;
      }
    }

    if (deepLinkId) {
      const matchingApp = config.apps.find(
        app => app.id.toLowerCase() === deepLinkId || app.name.toLowerCase() === deepLinkId
      );

      if (matchingApp) {
        setActiveWindowId(matchingApp.id);
        return;
      }

      if (deepLinkId === 'files' || deepLinkId === 'memory') {
        setActiveWindowId('files');
        return;
      }

      if (deepLinkId === 'settings') {
        setActiveWindowId('settings');
      }
    }
  }, [sessionId, config.apps]);

  // Update URL hash when the active app or utility changes.
  useEffect(() => {
    if (activeWindowId) {
      const currentHash = window.location.hash.slice(1);
      if (currentHash !== activeWindowId) {
        isInternalHashChange.current = true;
        window.location.hash = activeWindowId;
        setTimeout(() => {
          isInternalHashChange.current = false;
        }, 0);
      }
    } else if (window.location.hash) {
      isInternalHashChange.current = true;
      window.location.hash = '';
      setTimeout(() => {
        isInternalHashChange.current = false;
      }, 0);
    }
  }, [activeWindowId]);

  // Listen for browser back/forward navigation via hash changes
  useEffect(() => {
    const handleHashChange = () => {
      // Skip if this was an internal hash change (UI navigation)
      if (isInternalHashChange.current) {
        return;
      }

      const hash = window.location.hash.slice(1).toLowerCase();

      if (!hash) {
        // No hash returns to the two-app launcher.
        setActiveWindowId(null);
        return;
      }

      // Try to find matching app
      const matchingApp = config.apps.find(
        app => app.id.toLowerCase() === hash || app.name.toLowerCase() === hash
      );

      if (matchingApp) {
        setActiveWindowId(matchingApp.id);
        return;
      }

      // Check for special windows
      if (hash === 'files' || hash === 'memory') {
        setActiveWindowId('files');
        return;
      }

      if (hash === 'settings') {
        setActiveWindowId('settings');
        return;
      }

      // Invalid hash returns to the launcher.
      setActiveWindowId(null);
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [config.apps]);

  // Listen for app deep-link events from other shell surfaces.
  useEffect(() => {
    const handleOpenApp = (event: CustomEvent) => {
      const { appId } = event.detail || {};
      if (appId) setActiveWindowId(appId);
    };

    window.addEventListener('openApp', handleOpenApp as EventListener);
    return () => window.removeEventListener('openApp', handleOpenApp as EventListener);
  }, []);

  // Mini-apps can return the visitor to the two-app launcher.
  useEffect(() => {
    const handleCloseApp = () => setActiveWindowId(null);

    window.addEventListener('closeApp', handleCloseApp as EventListener);
    return () => window.removeEventListener('closeApp', handleCloseApp as EventListener);
  }, []);

  // Listen for plans requests from app, chat and Settings surfaces.
  useEffect(() => {
    const handleOpenPricing = (event: Event) => {
      const detail = ((event as CustomEvent).detail || {}) as Partial<PricingRequest>;
      const trigger: PricingTrigger =
        detail.trigger === 'credits' || detail.trigger === 'trial-limit' ? detail.trigger : 'nav';
      setPricingRequest({ ...detail, trigger });
    };

    window.addEventListener(PRICING_EVENT, handleOpenPricing as EventListener);
    return () => window.removeEventListener(PRICING_EVENT, handleOpenPricing as EventListener);
  }, []);

  // Credits: resolve the balance once a session exists, and finish any checkout
  // the visitor has just come back from. The wallet function re-reads the
  // payment from the platform before crediting anything, so a hand-typed
  // return URL buys nothing.
  useEffect(() => {
    if (!sessionId) return;
    void consumeCheckoutReturn().then((applied) => {
      if (!applied) void refreshCredits();
    });
  }, [sessionId]);

  // Keyboard shortcut: Cmd+M (Mac) / Ctrl+M (Windows) to toggle Memory window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        if (activeWindowId === 'files') {
          setActiveWindowId(null);
        } else {
          setActiveWindowId('files');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeWindowId]);

  // Get current app config and component if viewing an app
  const isAppWindow = activeWindowId && activeWindowId !== 'files' && activeWindowId !== 'settings';
  const currentAppConfig = isAppWindow ? config.apps.find(app => app.id === activeWindowId) : null;
  const CurrentApp = isAppWindow && activeWindowId ? apps[activeWindowId] : null;

  const runtimeTheme = resolveGenesisRuntimeTheme(config);
  const workspaceName = runtimeTheme.branding.name || 'VidVerge';
  const sidebarSections = buildSidebarSections(config.apps);
  const sidebarWidth = sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH;
  const themeVariables = (runtimeTheme.themeTokens.cssVariables || {}) as Record<string, string>;
  const rootStyle = {
    ...themeVariables,
    ['--space-font-family' as any]:
      runtimeTheme.themeTokens.typography?.fontFamily ||
      `"${runtimeTheme.themeTokens.typography?.headingFont || 'Inter'}", system-ui, -apple-system, sans-serif`,
    fontFamily:
      runtimeTheme.themeTokens.typography?.fontFamily ||
      `"${runtimeTheme.themeTokens.typography?.headingFont || 'Inter'}", system-ui, -apple-system, sans-serif`,
    background:
      runtimeTheme.themeTokens.shell?.pageBackground ||
      `linear-gradient(135deg, var(--space-surface-gradient-from), var(--space-surface-gradient-via), var(--space-surface-gradient-to))`,
  } as React.CSSProperties;

  // Show brief loading indicator while post-checkout auto-session is being established
  if (isBootstrappingSession) {
    return (
      <div
        style={{ ...themeVariables, background: `linear-gradient(135deg, var(--space-surface-gradient-from), var(--space-surface-gradient-via), var(--space-surface-gradient-to))` } as React.CSSProperties}
        className="fixed inset-0 flex items-center justify-center"
      >
        <div className="flex flex-col items-center gap-3 opacity-70">
          <VergeLoader size={120} />
          <span className="text-sm" style={{ color: 'var(--space-text)' }}>Setting up your account…</span>
        </div>
      </div>
    );
  }

  // Show email gate if no session in customer mode
  if (showEmailGate) {
    return (
      <EmailGate
        spaceId={spaceId}
        branding={runtimeTheme.branding}
        themeTokens={runtimeTheme.themeTokens}
      />
    );
  }

  // SUBSCRIPTION GATE TEMPORARILY DISABLED — all users have full access.
  // This block held the shell on a full-screen spinner until the platform
  // subscription-status check resolved (up to the 8s timeout above) so no
  // "protected" content could flash before an access check redirected. Nothing
  // is gated on that answer anymore, so every visitor goes straight into the
  // app. Drop the `!SUBSCRIPTION_GATE_DISABLED &&` line to restore it.
  if (
    !SUBSCRIPTION_GATE_DISABLED &&
    mode === 'customer' &&
    sessionId &&
    !subscriptionReady &&
    !subscriptionTimedOut &&
    !tenantDelegationBypass &&
    !isBootstrappingSession
  ) {
    return (
      <div
        style={{ ...themeVariables, background: `linear-gradient(135deg, var(--space-surface-gradient-from), var(--space-surface-gradient-via), var(--space-surface-gradient-to))` } as React.CSSProperties}
        className="fixed inset-0 flex items-center justify-center"
      >
        <div className="flex flex-col items-center gap-3 opacity-70">
          <VergeLoader size={120} />
        </div>
      </div>
    );
  }

  // Tenant agent handoff (Product Run iframe): render the target app edge-to-edge
  // with no dock, agent shell, or floating window chrome.
  if (isTenantDelegationCanvas()) {
    if (!isAppWindow || !CurrentApp || !currentAppConfig) {
      return (
        <div className="fixed inset-0 flex items-center justify-center" style={rootStyle}>
          <VergeLoader size={120} />
        </div>
      );
    }

    return (
      <div
        className="fixed inset-0 overflow-hidden vv-dark bg-[var(--space-surface-card,#15120A)]"
        style={rootStyle}
        data-testid="tenant-delegation-canvas"
      >
        {/* This branch returns before the main tree, so the global dark rules
            have to be mounted here too or `vv-dark` resolves to nothing. */}
        <GlobalStyles />
        <AppErrorBoundary key={currentAppConfig.id} appName={currentAppConfig.name}>
          <Suspense fallback={<div className="flex h-full w-full items-center justify-center"><VergeLoader size={120} caption="Opening your studio" /></div>}>
            <CurrentApp appConfig={currentAppConfig} dataFile={currentAppConfig.dataFile || ''} />
          </Suspense>
        </AppErrorBoundary>
      </div>
    );
  }

  return (
    <>
      {/* Google Fonts. Inter is the brand face and is always loaded; the
          conditional link covers a space configured onto some other font. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      {runtimeTheme.themeTokens.typography?.headingFont && runtimeTheme.themeTokens.typography.headingFont !== 'Inter' && (
        <link 
          href={`https://fonts.googleapis.com/css2?family=${encodeURIComponent(runtimeTheme.themeTokens.typography.headingFont)}:wght@300;400;500;600;700;800&display=swap`} 
          rel="stylesheet" 
        />
      )}
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />

      {/* Dark ground, dark scrollbars and the light-utility neutraliser that
          finishes the dark conversion inside apps written before it. */}
      <GlobalStyles />

      <div 
        className="min-h-screen vv-dark"
        style={rootStyle}
      >
        {/* Credits + Plans - always reachable from the shell chrome (mobile uses the dock) */}
        <div className="hidden md:flex fixed top-4 right-4 items-center gap-2" style={{ zIndex: 60 }}>
          <CreditBalance />
          <button
            onClick={() => setPricingRequest({ trigger: 'nav' })}
            className="flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold text-[var(--space-text-primary)] transition-all hover:scale-105"
            style={{
              // Quiet chrome on the dark ground: a subscriber gets the gold
              // edge, everyone else a neutral one. The gradient CTA stays the
              // single loud accent anywhere on screen.
              background: 'linear-gradient(90deg, var(--space-surface-panel) 0%, var(--space-surface-panel-strong) 100%)',
              border: isSubscriber ? '1px solid color-mix(in srgb, var(--space-brand-primary-500) 55%, transparent)' : '1px solid var(--space-border-default)',
              boxShadow: '0 12px 36px rgba(0,0,0,0.38)',
            }}
            title={planButtonTitle}
            data-testid="button-open-plans"
            data-plan-tier={userTier || 'unknown'}
          >
            <Crown className="w-4 h-4" style={{ color: 'var(--space-brand-highlight-500)' }} />
            {planLabel}
          </button>
        </div>

      {/* Left Sidebar — the product's primary navigation, present in every
          desktop shell state including the launcher. Collapses to icons. */}
      <aside
        className="hidden md:flex fixed left-0 top-0 bottom-0 z-50 flex-col border-r transition-[width] duration-300 ease-in-out"
        style={{
          width: sidebarWidth,
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--space-surface-card) 96%, transparent), var(--space-surface-bg))',
          borderColor: SIDEBAR_BORDER,
          boxShadow: '14px 0 44px rgba(0,0,0,0.28)',
        }}
        aria-label={`${workspaceName} studios`}
      >
        {/* Workspace mark + name, and the way back to the launcher */}
        <button
          onClick={() => setActiveWindowId(null)}
          title={`${workspaceName} home`}
          className={`flex h-[68px] shrink-0 items-center border-b transition-colors hover:bg-[rgba(255,255,255,0.03)] ${
            sidebarCollapsed ? 'justify-center px-0' : 'gap-2 px-4'
          }`}
          style={{ borderColor: SIDEBAR_BORDER }}
        >
          <BrandLogo size={sidebarCollapsed ? 44 : 54} glow={false} />
          {!sidebarCollapsed && (
            <span className="flex min-w-0 flex-col items-start">
              <span
                className="truncate text-sm font-bold text-[var(--space-text-primary)]"
                style={{ letterSpacing: '-0.01em' }}
              >
                {workspaceName}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--space-text-muted)]">
                Video studios
              </span>
            </span>
          )}
        </button>

        {/* Grouped studio nav */}
        <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-2">
          {/* Memory - Hidden in customer mode (use Cmd+M to access for debugging) */}
          {mode === 'entrepreneur' && (
            <div className="px-2.5 pb-1">
              <SidebarNavItem
                icon={Folder}
                label="Memory"
                active={activeWindowId === 'files'}
                collapsed={sidebarCollapsed}
                onClick={() => setActiveWindowId('files')}
              />
            </div>
          )}

          {sidebarSections.map(section => (
            <div key={section.label} className="pb-1">
              {sidebarCollapsed ? (
                <div
                  className="mx-auto my-2 h-px w-8"
                  style={{ background: SIDEBAR_BORDER }}
                  aria-hidden="true"
                />
              ) : (
                <div className="px-[22px] pb-1.5 pt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--space-text-muted)]">
                  <span className="mr-1.5" aria-hidden="true">{section.emoji}</span>
                  {section.label}
                </div>
              )}
              <div className="flex flex-col gap-0.5 px-2.5">
                {section.items.map(app => (
                  <SidebarNavItem
                    key={app.id}
                    icon={app.icon && iconMap[app.icon] ? iconMap[app.icon] : Activity}
                    label={app.name}
                    active={activeWindowId === app.id}
                    collapsed={sidebarCollapsed}
                    onClick={() => openApp(app.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Settings, then the collapse toggle pinned to the bottom */}
        <div className="shrink-0 border-t px-2.5 py-2" style={{ borderColor: SIDEBAR_BORDER }}>
          <SidebarNavItem
            icon={SettingsIcon}
            label="Settings"
            active={activeWindowId === 'settings'}
            collapsed={sidebarCollapsed}
            onClick={() => setActiveWindowId('settings')}
          />
          <button
            onClick={() => setSidebarCollapsed(prev => !prev)}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!sidebarCollapsed}
            className={`mt-1 flex w-full items-center rounded-[10px] py-2.5 text-[12px] font-semibold text-[var(--space-text-muted)] transition-all duration-200 hover:bg-[rgba(255,255,255,0.055)] hover:text-[var(--space-text-primary)] ${
              sidebarCollapsed ? 'justify-center px-0' : 'gap-3 px-3'
            }`}
          >
            {sidebarCollapsed ? (
              <ChevronsRight className="h-[18px] w-[18px] shrink-0" />
            ) : (
              <>
                <ChevronsLeft className="h-[18px] w-[18px] shrink-0" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Desktop: Main Content Area */}
      <div className="hidden md:block h-screen min-h-0 overflow-hidden">
        {/* Launcher = the VidVerge agent front and center, full height beside the sidebar */}
        {isLauncherMode && (
          <div
            className="relative h-screen flex flex-col overflow-hidden pr-8 animate-in fade-in duration-500 transition-[padding] duration-300 ease-in-out"
            style={{ paddingLeft: sidebarWidth + 32 }}
          >
            <LauncherFX />
            {/* Headline above the hero chat */}
            <div className="relative text-center pt-7 pb-4 vv-fade-up">
              {/* The mark is drawn from the brand tokens rather than loaded from
                  branding.logoUrl: that PNG is still painted in the retired
                  gold, and `objectFit: cover` at 118x64 was cropping the tips
                  of the V off. */}
              <div className="mb-2 flex justify-center">
                <BrandLogo size={190} />
              </div>
              <h1 className="text-3xl font-bold text-[var(--space-text-primary)]" style={{ letterSpacing: '-0.02em' }}>
                <span className="vv-title-shimmer">What would you like to make today?</span>
              </h1>
              <p className="mt-1.5 text-sm text-[var(--space-text-secondary)]">
                Tell the {workspaceName} agent your idea — or pick a studio from the sidebar on the left.
              </p>
            </div>

            {/* Hero agent chat — the dominant element of the main screen */}
            <div className="relative flex-1 min-h-0 w-full max-w-5xl mx-auto pb-6 vv-fade-up">
              <div className="h-full rounded-3xl border border-[var(--space-border-default)] bg-[color-mix(in_srgb,var(--space-surface-card)_94%,transparent)] backdrop-blur-xl overflow-hidden shadow-[0_24px_70px_rgba(0,0,0,0.42)]">
                <HeroAgentChat spaceId={spaceId} />
              </div>
            </div>
          </div>
        )}

        {/* Normal window layout */}
        {!isLauncherMode && (
        <>
        <div
          className="flex h-full w-full items-stretch gap-px overflow-hidden transition-[padding] duration-300 ease-in-out"
          style={{ paddingLeft: sidebarWidth }}
        >
          {/* App Window - LEFT side, slides in when selected */}
          {activeWindowId && (
            <div className="min-w-0 h-full flex-1 transition-all duration-500 ease-in-out">
              <div className="w-full h-full flex flex-col bg-[var(--space-surface-card)] overflow-hidden">
                {/* App Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--space-border-default)] bg-[color-mix(in_srgb,var(--space-surface-panel)_72%,transparent)] backdrop-blur-xl">
                  <div className="flex items-center gap-2">
                    {activeWindowId === 'files' && (
                      <>
                        <Folder className={`w-4 h-4 ${tw.icon.primary}`} />
                        <span className="text-sm font-semibold text-[var(--space-text-primary)]">Memory</span>
                      </>
                    )}
                    {activeWindowId === 'settings' && (
                      <>
                        <SettingsIcon className={`w-4 h-4 ${tw.icon.neutral}`} />
                        <span className="text-sm font-semibold text-[var(--space-text-primary)]">Settings</span>
                      </>
                    )}
                    {isAppWindow && currentAppConfig && (
                      <>
                        {(() => {
                          const IconComponent = currentAppConfig.icon && iconMap[currentAppConfig.icon] ? iconMap[currentAppConfig.icon] : Activity;
                          return <IconComponent className={`w-4 h-4 ${tw.icon.accent}`} />;
                        })()}
                        <span className="text-sm font-semibold text-[var(--space-text-primary)]">{currentAppConfig.name}</span>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      // When closing window, show empty desktop
                      setActiveWindowId(null);
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-[var(--space-text-secondary)] hover:bg-[var(--space-surface-muted)] hover:text-[var(--space-text-primary)] rounded-lg transition-colors"
                  >
                    Close
                  </button>
                </div>
                {/* App Content — `relative` is load-bearing: apps that fill
                    their frame with `position:absolute; inset:0` need a
                    positioned ancestor here, or they anchor to the viewport
                    and render underneath the left sidebar.

                    `vv-dark` is the colour-only scope from
                    components/ui/GlobalStyles.tsx. Applying it here means an
                    app inherits the dark ground, dark scrollbars and the
                    light-utility neutraliser whether or not it opted into the
                    design system itself. */}
                <div className="relative flex-1 overflow-y-auto min-h-0 vv-dark">
                  {activeWindowId === 'files' && (
                    <FileBrowser fileAccessLogs={fileAccessLogs} />
                  )}
                  {activeWindowId === 'settings' && (
                    <Settings spaceId={spaceId} />
                  )}
                  {isAppWindow && CurrentApp && currentAppConfig && (
                    <AppErrorBoundary key={currentAppConfig.id} appName={currentAppConfig.name}>
                      <Suspense fallback={<div className="flex h-full w-full items-center justify-center"><VergeLoader size={120} caption="Opening your studio" /></div>}>
                        <CurrentApp appConfig={currentAppConfig} dataFile={currentAppConfig.dataFile || ''} />
                      </Suspense>
                    </AppErrorBoundary>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        </>
        )}
      </div>

      {/* Mobile: Vertical Stack Layout */}
      <div className="md:hidden fixed inset-0 flex flex-col pb-16 overflow-hidden">
        {/* Main content - two-app home or active app */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mobile home — agent chat hero with a labeled app nav strip above it */}
          {!activeWindowId && isMobile && (
            <div className="relative h-full flex flex-col overflow-hidden bg-[var(--space-surface-bg)]">
              <LauncherFX compact />
              <div className="relative px-5 pt-5 pb-1 text-center vv-fade-up">
                <div className="mb-1 flex justify-center">
                  <BrandLogo size={132} />
                </div>
                <h1 className="text-xl font-bold text-[var(--space-text-primary)]">
                  <span className="vv-title-shimmer">What would you like to make today?</span>
                </h1>
              </div>

              {/* App nav — every studio, icon + name, horizontally scrollable.
                  Ordered by the same grouping as the desktop sidebar so the
                  two navs never disagree about where a studio sits. */}
              <div className="relative px-3 pt-2 pb-1">
                <div className="flex gap-2 overflow-x-auto py-1" style={{ scrollbarWidth: 'none' }}>
                  {sidebarSections.flatMap(section => section.items).map(app => {
                    const isActive = activeWindowId === app.id;
                    const IconComponent = app.icon && iconMap[app.icon] ? iconMap[app.icon] : Activity;
                    return (
                      <button
                        key={app.id}
                        onClick={() => openApp(app.id)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-full border text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${
                          isActive
                            ? 'border-[var(--space-brand-primary)] bg-[var(--space-brand-primary)] text-white'
                            : 'border-[var(--space-border-default)] bg-[var(--space-surface-panel)] text-[var(--space-text-primary)]'
                        }`}
                      >
                        <IconComponent
                          className={`w-4 h-4 ${isActive ? 'text-white' : 'text-[var(--space-text-brand)]'}`}
                        />
                        {app.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Hero agent chat */}
              <div className="relative flex-1 min-h-0 px-3 pb-3 pt-1">
                <div className="h-full rounded-2xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] overflow-hidden">
                  <HeroAgentChat spaceId={spaceId} />
                </div>
              </div>
            </div>
          )}

          {/* App View */}
          {activeWindowId && (
            <div className="h-full flex flex-col bg-[var(--space-surface-card)]">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--space-border-default)]">
                <div className="flex items-center gap-2">
                  {activeWindowId === 'files' && (
                    <>
                      <Folder className={`w-4 h-4 ${tw.appIcon.files}`} />
                      <span className="text-sm font-semibold text-[var(--space-text-primary)]">Memory</span>
                    </>
                  )}
                  {activeWindowId === 'settings' && (
                    <>
                      <SettingsIcon className={`w-4 h-4 ${tw.appIcon.settings}`} />
                      <span className="text-sm font-semibold text-[var(--space-text-primary)]">Settings</span>
                    </>
                  )}
                  {isAppWindow && currentAppConfig && (
                    <>
                      {(() => {
                        const IconComponent = currentAppConfig.icon && iconMap[currentAppConfig.icon] ? iconMap[currentAppConfig.icon] : Activity;
                        return <IconComponent className={`w-4 h-4 ${tw.appIcon.active}`} />;
                      })()}
                      <span className="text-sm font-semibold text-[var(--space-text-primary)]">{currentAppConfig.name}</span>
                    </>
                  )}
                </div>
                <button
                  onClick={() => setActiveWindowId(null)}
                  className="px-3 py-1.5 text-xs font-medium text-[var(--space-text-secondary)] hover:bg-[var(--space-surface-muted)] hover:text-[var(--space-text-primary)] rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
              <div className="relative flex-1 overflow-y-auto min-h-0 vv-dark">
                {activeWindowId === 'files' && (
                  <FileBrowser fileAccessLogs={fileAccessLogs} />
                )}
                {activeWindowId === 'settings' && (
                  <Settings spaceId={spaceId} />
                )}
                {isAppWindow && CurrentApp && currentAppConfig && (
                  <AppErrorBoundary key={currentAppConfig.id} appName={currentAppConfig.name}>
                    <Suspense fallback={<div className="flex h-full w-full items-center justify-center"><VergeLoader size={120} caption="Opening your studio" /></div>}>
                      <CurrentApp appConfig={currentAppConfig} dataFile={currentAppConfig.dataFile || ''} />
                    </Suspense>
                  </AppErrorBoundary>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Mobile Dock - Fixed to bottom */}
        <div className="fixed bottom-0 left-0 right-0 bg-[var(--space-surface-card)] border-t border-[var(--space-border-default)] px-1 py-2 safe-bottom">
          <div className="flex items-center justify-center gap-0.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {/* Files Icon - Hidden in customer mode (use Cmd+M to access for debugging) */}
            {mode === 'entrepreneur' && (
              <button
                onClick={() => setActiveWindowId('files')}
                aria-label="Memory"
                title="Memory"
                className={`p-1.5 rounded-xl transition-all ${
                  activeWindowId === 'files'
                    ? 'bg-[var(--space-brand-primary)] text-white'
                    : 'bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)]'
                }`}
              >
                <Folder className="w-5 h-5" />
              </button>
            )}

            {/* App Icons */}
            {sidebarSections.flatMap(section => section.items).map(app => {
              const isActive = activeWindowId === app.id;
              const IconComponent = app.icon && iconMap[app.icon] ? iconMap[app.icon] : Activity;
              return (
                <button
                  key={app.id}
                  onClick={() => openApp(app.id)}
                  aria-label={app.name}
                  title={app.name}
                  className={`p-1.5 rounded-xl transition-all ${
                    isActive
                      ? 'bg-[var(--space-brand-primary)] text-white'
                      : 'bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)]'
                  }`}
                >
                  <IconComponent className="w-5 h-5" />
                </button>
              );
            })}

            {/* Credits */}
            <CreditBalance variant="dock" />

            {/* Plans */}
            <button
              onClick={() => setPricingRequest({ trigger: 'nav' })}
              aria-label="Plans"
              className={`relative p-1.5 rounded-xl transition-all ${
                isSubscriber
                  ? 'bg-[var(--space-brand-primary)] text-white'
                  : 'bg-[var(--space-surface-accent-soft)] text-[var(--space-text-brand)]'
              }`}
              title={planButtonTitle}
              data-testid="button-open-plans-mobile"
              data-plan-tier={userTier || 'unknown'}
            >
              <Crown className="w-5 h-5" />
            </button>

            {/* Settings Icon */}
            <button
              onClick={() => setActiveWindowId('settings')}
              aria-label="Settings"
              title="Settings"
              className={`p-1.5 rounded-xl transition-all ${
                activeWindowId === 'settings'
                  ? 'bg-[var(--space-brand-primary)] text-white'
                  : 'bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)]'
              }`}
            >
              <SettingsIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
      </div>

      {pricingRequest && (
        <PricingScreen
          trigger={pricingRequest.trigger}
          request={pricingRequest}
          currentPlanId={getPlanId()}
          onClose={() => setPricingRequest(null)}
        />
      )}
    </>
  );
}
