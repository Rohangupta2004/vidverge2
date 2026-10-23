/**
 * ShellNav — the ONE navigation surface for every Vidverge route.
 *
 * Two exports, both mounted once by Desktop.tsx so no route can grow a second
 * nav or a second header:
 *
 *   ShellHeader — the 60px top bar: logo + wordmark, a single breadcrumb
 *                 pattern ("Vidverge / <section>"), a factual Jobs count, the
 *                 credits figure as plain text, and one avatar menu. On phones
 *                 it also owns the dock launcher, so the nav trigger can never
 *                 sit on top of a composer or be covered by the keyboard.
 *
 *   ShellDock   — the floating vertical dock: 68px wide, 16px off the left
 *                 edge, 44px targets, one FIXED icon order taken from the app
 *                 registry, tooltips that appear on hover AND on keyboard
 *                 focus, and aria-current on the active route. On phones the
 *                 same list renders as a focus-managed drawer instead.
 *
 * There is deliberately no wide rail here. A rail plus a dock was the old
 * double-nav, and the dock collapses itself rather than overlapping content on
 * short viewports.
 *
 * Selected state is never colour alone: the active item also carries an accent
 * edge bar, a ring, and aria-current.
 */
import {
  ComponentType,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { ChevronRight, Menu, Settings as SettingsIcon, X } from 'lucide-react';
import BrandLogo from './BrandLogo';

export const SHELL_HEADER_HEIGHT = 60;
export const SHELL_DOCK_WIDTH = 68;

export type WorkspaceMode = 'agent' | 'manual';

function WorkspaceModeSwitch({
  mode,
  onModeChange,
  fullWidth = false,
}: {
  mode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
  fullWidth?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Workspace mode"
      className={`flex rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-panel-strong)] p-1 ${fullWidth ? 'w-full' : ''}`}
    >
      {(['agent', 'manual'] as const).map((value) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onModeChange(value)}
            aria-pressed={active}
            className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vg-focus)] ${fullWidth ? 'flex-1' : ''} ${
              active
                ? 'bg-[var(--vg-accent)] text-[var(--vg-on-accent)] shadow-sm'
                : 'text-[var(--space-text-secondary)] hover:bg-[var(--vg-hover)] hover:text-[var(--space-text-primary)]'
            }`}
          >
            {value === 'agent' ? 'Agent' : 'Manual'}
          </button>
        );
      })}
    </div>
  );
}

export interface ShellNavItem {
  /** Matches the registry app id (or 'files' / 'settings' for the utilities). */
  id: string;
  label: string;
  Icon: ComponentType<any>;
}

/** The dock item, shared by the desktop rail and the mobile drawer. */
function dockItemClasses(active: boolean): string {
  return [
    'relative flex h-14 min-w-[64px] flex-col items-center justify-center gap-1 rounded-[10px] px-2 transition-colors duration-150',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
    'focus-visible:outline-[var(--vg-focus)]',
    active
      ? 'bg-[color-mix(in_srgb,var(--vg-accent)_16%,transparent)] text-[var(--vg-accent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--vg-accent)_55%,transparent)]'
      : 'text-[var(--space-text-muted)] hover:bg-[var(--vg-hover)] hover:text-[var(--space-text-primary)]',
  ].join(' ');
}

interface DockLinkProps {
  item: ShellNavItem;
  active: boolean;
  onSelect: (id: string) => void;
  /** Desktop shows a hover/focus tooltip; the drawer shows the label inline. */
  variant: 'rail' | 'drawer';
}

function DockLink({ item, active, onSelect, variant }: DockLinkProps) {
  const tooltipId = `${useId()}-tip`;
  const { Icon } = item;
  // The dock panel scrolls when the registry is taller than the viewport, and a
  // scroll container clips an absolutely positioned child on BOTH axes (a
  // computed `overflow-y: auto` forces `overflow-x` to auto too). So the
  // tooltip is positioned in the viewport instead of inside the panel, from the
  // anchor's own rect. Hover and keyboard focus both open it.
  const [tipAt, setTipAt] = useState<{ top: number; left: number } | null>(null);
  const showTip = (event: { currentTarget: HTMLElement }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTipAt({ top: rect.top + rect.height / 2, left: rect.right + 10 });
  };
  const hideTip = () => setTipAt(null);

  if (variant === 'drawer') {
    return (
      <a
        href={`#${item.id}`}
        aria-current={active ? 'page' : undefined}
        onClick={(event) => {
          event.preventDefault();
          onSelect(item.id);
        }}
        className={[
          'flex min-h-11 items-center gap-3 rounded-[10px] px-2.5 text-sm font-semibold no-underline transition-colors',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vg-focus)]',
          active
            ? 'bg-[color-mix(in_srgb,var(--vg-accent)_16%,transparent)] text-[var(--vg-accent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--vg-accent)_55%,transparent)]'
            : 'text-[var(--space-text-secondary)] hover:bg-[var(--vg-hover)] hover:text-[var(--space-text-primary)]',
        ].join(' ')}
      >
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">{item.label}</span>
        {active ? (
          <span className="ml-auto text-[10px] font-bold uppercase tracking-[0.1em]">Open</span>
        ) : null}
      </a>
    );
  }

  return (
    <div className="relative flex justify-center">
      <a
        href={`#${item.id}`}
        aria-current={active ? 'page' : undefined}
        aria-describedby={tipAt ? tooltipId : undefined}
        onClick={(event) => {
          event.preventDefault();
          hideTip();
          onSelect(item.id);
        }}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        className={dockItemClasses(active)}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
        <span className="max-w-[72px] truncate text-[10px] font-semibold leading-none">{item.label}</span>
        {/* Selected state is not colour-only: an accent edge bar marks it too. */}
        {active ? (
          <span
            aria-hidden="true"
            className="absolute bottom-0 left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-full bg-[var(--vg-accent)]"
          />
        ) : null}
      </a>
      {tipAt ? (
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none fixed z-[100] -translate-y-1/2 whitespace-nowrap rounded-lg border border-[var(--space-border-strong)] bg-[var(--space-surface-panel-strong)] px-2.5 py-1.5 text-xs font-semibold text-[var(--space-text-primary)] shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
          style={{ top: tipAt.top, left: tipAt.left }}
        >
          {item.label}
        </span>
      ) : null}
    </div>
  );
}

export interface ShellDockProps {
  workspaceName: string;
  /** Registry order, already filtered to the visible apps. */
  items: ShellNavItem[];
  /** Utilities pinned under a divider (Memory in entrepreneur mode, Settings). */
  utilityItems: ShellNavItem[];
  homeItem: ShellNavItem;
  activeId: string | null;
  onSelect: (id: string) => void;
  onHome: () => void;
  /** Open state of the phone drawer, owned by the header's launcher. */
  drawerOpen: boolean;
  onDrawerClose: () => void;
  mode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
}

export function ShellDock({
  workspaceName,
  items,
  utilityItems,
  homeItem,
  activeId,
  onSelect,
  onHome,
  drawerOpen,
  onDrawerClose,
  mode,
  onModeChange,
}: ShellDockProps) {
  const drawerRef = useRef<HTMLDivElement | null>(null);

  const select = useCallback(
    (id: string) => {
      if (id === homeItem.id) {
        onHome();
      } else {
        onSelect(id);
      }
      onDrawerClose();
    },
    [homeItem.id, onDrawerClose, onHome, onSelect],
  );

  // Drawer focus management: move focus in on open, Escape closes. The header
  // launcher restores focus to itself, so nothing is left orphaned.
  useEffect(() => {
    if (!drawerOpen) return;
    const node = drawerRef.current;
    const first = node?.querySelector<HTMLElement>('a[href], button');
    first?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDrawerClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, onDrawerClose]);

  const allItems = items;

  return (
    <>
      {/* Desktop / tablet: one centered floating bottom dock. */}
      <nav
        aria-label={`${workspaceName} navigation`}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] block h-[86px]"
      >
        <div
          className="pointer-events-auto absolute bottom-3 left-1/2 flex max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-2xl border border-[var(--space-border-default)] bg-[color-mix(in_srgb,var(--space-surface-card)_94%,transparent)] px-2 py-2 shadow-[0_18px_50px_rgba(0,0,0,0.48)] backdrop-blur-xl"
          style={{ scrollbarWidth: 'none' }}
        >
          {allItems.map((item) => (
            <DockLink
              key={item.id}
              item={item}
              active={activeId === item.id}
              onSelect={select}
              variant="rail"
            />
          ))}
          {utilityItems.length ? (
            <span
              aria-hidden="true"
              className="my-1 h-px w-7 shrink-0 bg-[var(--space-border-default)]"
            />
          ) : null}
          {utilityItems.map((item) => (
            <DockLink
              key={item.id}
              item={item}
              active={activeId === item.id}
              onSelect={select}
              variant="rail"
            />
          ))}
        </div>
      </nav>

      {/* Phones: the same list, same order, as a drawer the header opens. It
          sits above the content and is dismissed before anything is typed, so
          it never covers an active composer or fights the keyboard. */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-[95] md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onDrawerClose}
            className="absolute inset-0 h-full w-full border-0 bg-[color-mix(in_srgb,#000_62%,transparent)]"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${workspaceName} navigation`}
            className="absolute inset-y-0 left-0 flex w-[min(280px,86vw)] flex-col border-r border-[var(--space-border-default)] bg-[var(--space-surface-card)] shadow-[0_0_60px_rgba(0,0,0,0.6)]"
            style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[var(--space-border-default)] px-3">
              <span className="text-sm font-bold text-[var(--space-text-primary)]">{workspaceName}</span>
              <button
                type="button"
                onClick={onDrawerClose}
                aria-label="Close navigation"
                className="grid h-11 w-11 place-items-center rounded-[10px] text-[var(--space-text-muted)] hover:bg-[var(--vg-hover)] hover:text-[var(--space-text-primary)]"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="border-b border-[var(--space-border-default)] p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--space-text-muted)]">Workspace mode</p>
              <WorkspaceModeSwitch mode={mode} onModeChange={onModeChange} fullWidth />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
              {allItems.map((item) => (
                <DockLink
                  key={item.id}
                  item={item}
                  active={activeId === item.id}
                  onSelect={select}
                  variant="drawer"
                />
              ))}
              {utilityItems.length ? (
                <span aria-hidden="true" className="my-1.5 h-px w-full bg-[var(--space-border-default)]" />
              ) : null}
              {utilityItems.map((item) => (
                <DockLink
                  key={item.id}
                  item={item}
                  active={activeId === item.id}
                  onSelect={select}
                  variant="drawer"
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export interface ShellHeaderProps {
  workspaceName: string;
  /** One breadcrumb pattern everywhere: workspace, then the open section. */
  sectionLabel: string | null;
  /** The factual Jobs control (BackgroundJobsTray) and credits text. */
  jobsSlot?: ReactNode;
  creditsSlot?: ReactNode;
  onHome: () => void;
  onSettings: () => void;
  onPlans: () => void;
  planLabel: string;
  /** Present only while an app or utility is open, so Close stays reachable. */
  onCloseSection?: () => void;
  /** Phone-only dock launcher. */
  onOpenDrawer: () => void;
  drawerOpen: boolean;
  mode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
}

export function ShellHeader({
  workspaceName,
  sectionLabel,
  jobsSlot,
  creditsSlot,
  onHome,
  onSettings,
  onPlans,
  planLabel,
  onCloseSection,
  onOpenDrawer,
  drawerOpen,
  mode,
  onModeChange,
}: ShellHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Return focus to the launcher when the drawer closes.
  const wasOpen = useRef(drawerOpen);
  useEffect(() => {
    if (wasOpen.current && !drawerOpen) launcherRef.current?.focus();
    wasOpen.current = drawerOpen;
  }, [drawerOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header
      className="fixed inset-x-0 top-0 z-[90] flex items-center gap-2 border-b border-[var(--space-border-default)] bg-[color-mix(in_srgb,var(--space-surface-card)_94%,transparent)] px-3 backdrop-blur-xl sm:px-4"
      style={{ height: SHELL_HEADER_HEIGHT }}
    >
      {/* Phone dock launcher. Top-left, so it is never under the keyboard. */}
      <button
        ref={launcherRef}
        type="button"
        onClick={onOpenDrawer}
        aria-label="Open navigation"
        aria-expanded={drawerOpen}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] border border-[var(--space-border-default)] text-[var(--space-text-secondary)] transition-colors hover:bg-[var(--vg-hover)] hover:text-[var(--space-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vg-focus)] md:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* Logo + wordmark, and the way home. The asset is the workspace logo as
          shipped — BrandLogo owns it, nothing here re-colours or crops it. */}
      <a
        href="#"
        onClick={(event) => {
          event.preventDefault();
          onHome();
        }}
        className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-[10px] px-1 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vg-focus)]"
        aria-label={`${workspaceName} home`}
      >
        <BrandLogo size={40} glow={false} />
        <span
          className="text-[15px] font-bold text-[var(--space-text-primary)]"
          style={{ letterSpacing: '-0.01em' }}
        >
          {workspaceName}
        </span>
      </a>

      {/* The single breadcrumb pattern used on every route. */}
      {sectionLabel ? (
        <nav aria-label="Breadcrumb" className="ml-1 hidden min-w-0 sm:block">
          <ol className="flex min-w-0 list-none items-center gap-1.5 p-0 text-[13px]">
            <li className="shrink-0">
              <ChevronRight
                className="h-3.5 w-3.5 text-[var(--space-text-muted)]"
                aria-hidden="true"
              />
            </li>
            <li className="min-w-0">
              <span
                aria-current="page"
                className="block max-w-[32ch] truncate font-semibold text-[var(--space-text-brand)]"
              >
                {sectionLabel}
              </span>
            </li>
          </ol>
        </nav>
      ) : null}

      <div className="ml-2 hidden sm:block">
        <WorkspaceModeSwitch mode={mode} onModeChange={onModeChange} />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2.5">
        {/* Factual, quiet status text — not a cluster of loud pills. Jobs is
            shown at every width: it is the only place a failed or queued run
            is surfaced, and it used to float over the composer on phones. */}
        {jobsSlot}
        {creditsSlot}

        {onCloseSection ? (
          <button
            type="button"
            onClick={onCloseSection}
            className="hidden min-h-11 items-center rounded-[10px] px-2.5 text-xs font-semibold text-[var(--space-text-secondary)] transition-colors hover:bg-[var(--vg-hover)] hover:text-[var(--space-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vg-focus)] lg:flex"
          >
            Close
          </button>
        ) : null}

        {/* One avatar style, one menu. Settings and Plans both live behind it
            so the header never grows a second row of actions. */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="Account menu"
            className="flex min-h-11 items-center gap-1 rounded-full border border-[var(--space-border-default)] pl-0.5 pr-2 transition-colors hover:bg-[var(--vg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vg-focus)]"
          >
            <span
              aria-hidden="true"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--vg-accent-soft)] text-[13px] font-bold text-[var(--vg-accent)]"
            >
              {(workspaceName || 'V').trim().charAt(0).toUpperCase()}
            </span>
            <ChevronRight
              className={`h-3.5 w-3.5 text-[var(--space-text-muted)] transition-transform ${menuOpen ? '-rotate-90' : 'rotate-90'}`}
              aria-hidden="true"
            />
          </button>

          {menuOpen ? (
            <div
              role="menu"
              aria-label="Account"
              className="absolute right-0 top-[calc(100%+8px)] z-[95] w-56 overflow-hidden rounded-xl border border-[var(--space-border-default)] bg-[var(--space-surface-card)] p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onSettings();
                }}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-sm font-semibold text-[var(--space-text-secondary)] transition-colors hover:bg-[var(--vg-hover)] hover:text-[var(--space-text-primary)]"
              >
                <SettingsIcon className="h-4 w-4" aria-hidden="true" />
                Settings
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onPlans();
                }}
                className="flex min-h-11 w-full items-center justify-between gap-2.5 rounded-[10px] px-2.5 text-sm font-semibold text-[var(--space-text-secondary)] transition-colors hover:bg-[var(--vg-hover)] hover:text-[var(--space-text-primary)]"
              >
                Plans
                <span className="text-xs font-semibold text-[var(--space-text-muted)]">{planLabel}</span>
              </button>
              {onCloseSection ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onCloseSection();
                  }}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-sm font-semibold text-[var(--space-text-secondary)] transition-colors hover:bg-[var(--vg-hover)] hover:text-[var(--space-text-primary)] lg:hidden"
                >
                  Close this view
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
