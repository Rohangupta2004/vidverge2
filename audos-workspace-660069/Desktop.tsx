import { useState, Suspense, LazyExoticComponent, ComponentType, useEffect, useRef, Component, ErrorInfo, ReactNode } from 'react';
import { Bot, Folder, X, Activity, Clapperboard, Moon, Heart, Calendar, Users, FileText, BarChart, Settings as SettingsIcon, MessageCircle, Plane, TrendingUp, LineChart, Dumbbell, Brain, Target, Zap, Star, Clock, CheckCircle, List, BookOpen, Coffee, Music, Camera, MapPin, Wallet, ShoppingCart, Gift, Lightbulb, Sparkles, Rocket, Home, Building, Globe, Mail, Phone, Video, Mic, Image, Play, Pause, Volume2, Wifi, Cloud, Sun, Umbrella, Thermometer, Wind, Droplets, Leaf, Flower2, Film, Mountain, Waves, Compass, Map, Navigation, Car, Bike, Ship, Award, Trophy, Medal, Crown, Diamond, Gem, Key, Lock, Unlock, Shield, Eye, Search, Filter, SortAsc, Download, Upload, Share2, Link, ExternalLink, Copy, Clipboard, Trash2, Edit, Pencil, PenTool, Scissors, Bookmark, Flag, Bell, AlertCircle, Info, HelpCircle, XCircle, CheckCircle2, Circle, Square, Triangle, Hexagon, Octagon, Hash, AtSign, DollarSign, Percent, Calculator, Code, Terminal, Database, Server, Cpu, Monitor, Smartphone, Tablet, Laptop, Watch, Headphones, Speaker, Radio, Tv, Printer, Scan, QrCode, Barcode, CreditCard, Receipt, Banknote, PiggyBank, TrendingDown, AreaChart, PieChart } from 'lucide-react';
import type { SpaceConfig, DesktopBranding, DesktopThemeTokens } from './types';
import { useSpaceRuntime } from './SpaceRuntimeContext';
import FileBrowser from './components/FileBrowser';
import EmailGate from './components/EmailGate';
import Settings from './components/Settings';
import PricingScreen from './components/PricingScreen';
import {
  getPlanId,
  isPaidTier,
  isProTier,
  PRICING_EVENT,
  SUBSCRIPTION_GATE_DISABLED,
  useUserTier,
} from './lib/plans';
import type { PricingTrigger } from './lib/plans';
import { tw } from './lib/colors';
import { isTenantDelegationCanvas } from './lib/tenant-delegation-canvas';
import { LauncherToolCard, LauncherFX } from './components/HomeLauncher';

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
    return '"Sora", system-ui, -apple-system, sans-serif';
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
  Map, Navigation, Car, Bike, Ship, Award, Trophy, Medal, Crown, Diamond,
  Gem, Key, Lock, Unlock, Shield, Eye, Search, Filter, SortAsc, Download,
  Upload, Share2, Link, ExternalLink, Copy, Clipboard, Trash2, Edit, Pencil,
  PenTool, Scissors, Bookmark, Flag, Bell, AlertCircle, Info, HelpCircle,
  XCircle, CheckCircle2, Circle, Square, Triangle, Hexagon, Octagon, Hash,
  AtSign, DollarSign, Percent, Calculator, Code, Terminal, Database, Server,
  Cpu, Monitor, Smartphone, Tablet, Laptop, Watch, Headphones, Speaker,
  Radio, Tv, Printer, Scan, QrCode, Barcode, CreditCard, Receipt, Banknote,
  PiggyBank, TrendingDown, AreaChart, PieChart, Flower2, Clapperboard, Film,
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

interface SpaceDesktopProps {
  mode: 'entrepreneur' | 'customer';
  spaceId: string;
  sessionId?: string;
  config: SpaceConfig;
  apps: Record<string, LazyExoticComponent<any>>;
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
  // Plans overlay. Mounted here rather than inside an app so it can take the
  // whole screen from any shell state, and so every surface can raise it.
  const [pricingTrigger, setPricingTrigger] = useState<PricingTrigger | null>(null);

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

  // Listen for plans requests from app and Settings surfaces.
  useEffect(() => {
    const handleOpenPricing = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      setPricingTrigger(detail.trigger === 'trial-limit' ? 'trial-limit' : 'nav');
    };

    window.addEventListener(PRICING_EVENT, handleOpenPricing as EventListener);
    return () => window.removeEventListener(PRICING_EVENT, handleOpenPricing as EventListener);
  }, []);

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
  const themeVariables = (runtimeTheme.themeTokens.cssVariables || {}) as Record<string, string>;
  const rootStyle = {
    ...themeVariables,
    ['--space-font-family' as any]:
      runtimeTheme.themeTokens.typography?.fontFamily ||
      `"${runtimeTheme.themeTokens.typography?.headingFont || 'Sora'}", system-ui, -apple-system, sans-serif`,
    fontFamily:
      runtimeTheme.themeTokens.typography?.fontFamily ||
      `"${runtimeTheme.themeTokens.typography?.headingFont || 'Sora'}", system-ui, -apple-system, sans-serif`,
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
          {LoadingSpinner ? <LoadingSpinner /> : <div className="w-8 h-8 rounded-full border-2 border-current border-t-transparent animate-spin" />}
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
          {LoadingSpinner ? <LoadingSpinner /> : <div className="w-8 h-8 rounded-full border-2 border-current border-t-transparent animate-spin" />}
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
          {LoadingSpinner ? <LoadingSpinner /> : <div className="w-8 h-8 rounded-full border-2 border-current border-t-transparent animate-spin" />}
        </div>
      );
    }

    return (
      <div
        className="fixed inset-0 overflow-hidden bg-[var(--space-surface-card,#fff)]"
        style={rootStyle}
        data-testid="tenant-delegation-canvas"
      >
        <AppErrorBoundary key={currentAppConfig.id} appName={currentAppConfig.name}>
          <Suspense fallback={LoadingSpinner ? <LoadingSpinner /> : null}>
            <CurrentApp appConfig={currentAppConfig} dataFile={currentAppConfig.dataFile || ''} />
          </Suspense>
        </AppErrorBoundary>
      </div>
    );
  }

  return (
    <>
      {/* Google Fonts - Load brand font or fallback to Sora */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      {runtimeTheme.themeTokens.typography?.headingFont && runtimeTheme.themeTokens.typography.headingFont !== 'Sora' && (
        <link 
          href={`https://fonts.googleapis.com/css2?family=${encodeURIComponent(runtimeTheme.themeTokens.typography.headingFont)}:wght@300;400;500;600;700;800&display=swap`} 
          rel="stylesheet" 
        />
      )}
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />

      <div 
        className="min-h-screen"
        style={rootStyle}
      >
        {/* Plans - always reachable from the shell chrome (mobile uses the dock) */}
        <button
          onClick={() => setPricingTrigger('nav')}
          className="hidden md:flex fixed top-4 right-4 items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold text-white transition-all hover:scale-105"
          style={{
            zIndex: 60,
            background: isSubscriber
              ? 'linear-gradient(90deg, #2563eb 0%, #1d4ed8 100%)'
              : 'linear-gradient(90deg, #131320 0%, #0c0c12 100%)',
            border: isSubscriber ? '1px solid rgba(96,165,250,0.7)' : '1px solid rgba(37,99,235,0.45)',
            boxShadow: isSubscriber ? '0 6px 26px rgba(37,99,235,0.55)' : '0 6px 22px rgba(37,99,235,0.3)',
          }}
          title={planButtonTitle}
          data-testid="button-open-plans"
          data-plan-tier={userTier || 'unknown'}
        >
          <Crown className="w-4 h-4" style={{ color: isSubscriber ? '#ffffff' : '#93c5fd' }} />
          {planLabel}
        </button>

        {/* Left Dock - Desktop Only - Animates away in launcher mode */}
      <div className={`hidden md:flex fixed top-1/2 -translate-y-1/2 ${tw.dock.glass} p-4 z-50 transition-all duration-500 ease-in-out ${
        isLauncherMode
          ? '-left-24 opacity-0'
          : 'left-4 opacity-100'
      }`}>
        <div className="flex flex-col gap-3">
          {/* Memory Icon - Hidden in customer mode (use Cmd+M to access for debugging) */}
          {mode === 'entrepreneur' && (
            <button
              onClick={() => setActiveWindowId('files')}
              className={`p-3 rounded-xl transition-all ${
                activeWindowId === 'files' ? tw.dock.active : tw.dock.inactive
              }`}
              title="Memory"
            >
              <Folder className="w-6 h-6" />
            </button>
          )}

          {/* App Icons */}
          {config.apps.map(app => {
            const isActive = activeWindowId === app.id;
            const IconComponent = app.icon && iconMap[app.icon] ? iconMap[app.icon] : Activity;
            return (
              <button
                key={app.id}
                onClick={() => openApp(app.id)}
                className={`p-3 rounded-xl transition-all ${
                  isActive ? tw.dock.active : tw.dock.inactive
                }`}
                title={app.name}
              >
                <IconComponent className="w-6 h-6" />
              </button>
            );
          })}

          {/* Divider */}
          <div className="h-px bg-[var(--space-border-default)] my-1"></div>

          {/* Settings Icon */}
          <button
            onClick={() => setActiveWindowId('settings')}
            className={`p-3 rounded-xl transition-all ${
              activeWindowId === 'settings' ? tw.dock.active : tw.dock.inactive
            }`}
            title="Settings"
          >
            <SettingsIcon className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Desktop: Main Content Area */}
      <div className="hidden md:block h-screen min-h-0 overflow-hidden">
        {/* App Launcher Grid - Shows when in launcher mode */}
        {isLauncherMode && (
          <div className="relative overflow-hidden flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-6 animate-in fade-in duration-500">
            <LauncherFX />
            {/* Branding */}
            {runtimeTheme.branding.name && (
              <div className="relative text-center mb-12 vv-fade-up">
                <h1 className="text-4xl font-bold text-[var(--space-text-primary)] mb-2" style={{ letterSpacing: '-0.02em' }}>
                  <span className="vv-title-shimmer">{runtimeTheme.branding.name}</span>
                </h1>
                {runtimeTheme.branding.tagline && (
                  <p className="text-lg text-[var(--space-text-secondary)]">
                    {runtimeTheme.branding.tagline}
                  </p>
                )}
              </div>
            )}

            {/* App Grid */}
            <div className="relative grid grid-cols-2 gap-6 w-full max-w-4xl">
              {/* App Cards */}
              {config.apps.map((app, appIndex) => (
                <LauncherToolCard
                  key={app.id}
                  app={app}
                  index={appIndex}
                  variant="desktop"
                  onOpen={() => openApp(app.id)}
                />
              ))}

              {/* Memory Card - Hidden in customer mode (use Cmd+M to access for debugging) */}
              {mode === 'entrepreneur' && (
                <button
                  onClick={() => setActiveWindowId('files')}
                  className="group flex flex-col items-center p-6 bg-[var(--space-surface-panel)] backdrop-blur-md rounded-2xl border border-[var(--space-border-default)] shadow-lg hover:bg-[var(--space-surface-panel-strong)] hover:shadow-xl hover:scale-105 transition-all duration-300 cursor-pointer"
                >
                  <div className="w-16 h-16 flex items-center justify-center bg-[var(--space-surface-accent-soft)] rounded-2xl mb-4 group-hover:brightness-95 transition-colors">
                    <Folder className={`w-8 h-8 ${tw.appIcon.files}`} />
                  </div>
                  <h3 className="text-base font-semibold text-[var(--space-text-primary)] mb-1">Memory</h3>
                  <p className="text-xs text-[var(--space-text-secondary)] text-center line-clamp-2">
                    Browse files and data
                  </p>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Normal window layout */}
        {!isLauncherMode && (
        <>
        <div className="flex h-full w-full items-stretch gap-px overflow-hidden pl-20">
          {/* App Window - LEFT side, slides in when selected */}
          {activeWindowId && (
            <div className="min-w-0 h-full flex-1 transition-all duration-500 ease-in-out">
              <div className="w-full h-full flex flex-col bg-[var(--space-surface-card)] overflow-hidden">
                {/* App Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--space-border-default)]">
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
                {/* App Content */}
                <div className="flex-1 overflow-y-auto min-h-0">
                  {activeWindowId === 'files' && (
                    <FileBrowser fileAccessLogs={fileAccessLogs} />
                  )}
                  {activeWindowId === 'settings' && (
                    <Settings spaceId={spaceId} />
                  )}
                  {isAppWindow && CurrentApp && currentAppConfig && (
                    <AppErrorBoundary key={currentAppConfig.id} appName={currentAppConfig.name}>
                      <Suspense fallback={<LoadingSpinner />}>
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
          {/* Mobile two-app home */}
          {!activeWindowId && isMobile && (
            <div className="relative h-full overflow-y-auto px-5 py-10 bg-[var(--space-surface-bg)]">
              <LauncherFX compact />
              <div className="relative mx-auto max-w-md">
                <div className="mb-8 text-center vv-fade-up">
                  <h1 className="text-3xl font-bold text-[var(--space-text-primary)]">
                    <span className="vv-title-shimmer">{runtimeTheme.branding.name}</span>
                  </h1>
                  <p className="mt-2 text-sm text-[var(--space-text-secondary)]">
                    {runtimeTheme.branding.tagline}
                  </p>
                </div>
                <div className="grid gap-4">
                  {config.apps.map((app, appIndex) => (
                    <LauncherToolCard
                      key={app.id}
                      app={app}
                      index={appIndex}
                      variant="mobile"
                      onOpen={() => openApp(app.id)}
                    />
                  ))}
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
              <div className="flex-1 overflow-y-auto min-h-0">
                {activeWindowId === 'files' && (
                  <FileBrowser fileAccessLogs={fileAccessLogs} />
                )}
                {activeWindowId === 'settings' && (
                  <Settings spaceId={spaceId} />
                )}
                {isAppWindow && CurrentApp && currentAppConfig && (
                  <AppErrorBoundary key={currentAppConfig.id} appName={currentAppConfig.name}>
                    <Suspense fallback={<LoadingSpinner />}>
                      <CurrentApp appConfig={currentAppConfig} dataFile={currentAppConfig.dataFile || ''} />
                    </Suspense>
                  </AppErrorBoundary>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Mobile Dock - Fixed to bottom */}
        <div className="fixed bottom-0 left-0 right-0 bg-[var(--space-surface-card)] border-t border-[var(--space-border-default)] px-3 py-2 safe-bottom">
          <div className="flex items-center justify-center gap-1">
            {/* Files Icon - Hidden in customer mode (use Cmd+M to access for debugging) */}
            {mode === 'entrepreneur' && (
              <button
                onClick={() => setActiveWindowId('files')}
                className={`p-2.5 rounded-xl transition-all ${
                  activeWindowId === 'files'
                    ? 'bg-[var(--space-brand-primary)] text-white'
                    : 'bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)]'
                }`}
              >
                <Folder className="w-5 h-5" />
              </button>
            )}

            {/* App Icons */}
            {config.apps.map(app => {
              const isActive = activeWindowId === app.id;
              const IconComponent = app.icon && iconMap[app.icon] ? iconMap[app.icon] : Activity;
              return (
                <button
                  key={app.id}
                  onClick={() => setActiveWindowId(app.id)}
                  className={`p-2.5 rounded-xl transition-all ${
                    isActive
                      ? 'bg-[var(--space-brand-primary)] text-white'
                      : 'bg-[var(--space-surface-muted)] text-[var(--space-text-secondary)]'
                  }`}
                >
                  <IconComponent className="w-5 h-5" />
                </button>
              );
            })}

            {/* Plans */}
            <button
              onClick={() => setPricingTrigger('nav')}
              className={`relative p-2.5 rounded-xl transition-all ${
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
              className={`p-2.5 rounded-xl transition-all ${
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

      {pricingTrigger && (
        <PricingScreen
          trigger={pricingTrigger}
          currentPlanId={getPlanId()}
          onClose={() => setPricingTrigger(null)}
        />
      )}
    </>
  );
}
