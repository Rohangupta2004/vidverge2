/**
 * ProductStudio 3D interaction primitives — pure CSS 3D (no Three.js / WebGL,
 * per the build brief: perspective + rotateX/rotateY driven by pointer
 * position, 0.15s ease transitions, tilt-following shadows for depth).
 */
import { useCallback, useRef, useState } from 'react';

export const FX_CSS = `
@keyframes ps-slide-in-right { from { opacity: 0; transform: perspective(1200px) translateX(46px) rotateY(-6deg); } to { opacity: 1; transform: perspective(1200px) translateX(0) rotateY(0deg); } }
@keyframes ps-slide-in-left { from { opacity: 0; transform: perspective(1200px) translateX(-46px) rotateY(6deg); } to { opacity: 1; transform: perspective(1200px) translateX(0) rotateY(0deg); } }
@keyframes ps-fade-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.ps-enter-editor { animation: ps-slide-in-right 340ms cubic-bezier(0.22, 1, 0.36, 1) both; }
.ps-enter-gallery { animation: ps-slide-in-left 340ms cubic-bezier(0.22, 1, 0.36, 1) both; }
.ps-fade-up { animation: ps-fade-up 260ms ease both; }
.ps-frost { background: color-mix(in srgb, var(--space-surface-bg) 60%, transparent); backdrop-filter: blur(16px) saturate(1.15); -webkit-backdrop-filter: blur(16px) saturate(1.15); }
.ps-scroll-x { scrollbar-width: thin; }
@keyframes ps-spin { to { transform: rotate(360deg); } }
.rc-spin { animation: ps-spin 0.9s linear infinite; }
@keyframes ps-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.rc-pulse { animation: ps-pulse 1.4s ease-in-out infinite; }
@keyframes ps-skeleton { 0%, 100% { opacity: 0.55; } 50% { opacity: 0.9; } }
.ps-skeleton { animation: ps-skeleton 1.5s ease-in-out infinite; background: var(--space-surface-panel); border-radius: 16px; border: 1px solid var(--space-border-default); }
.ps-btn { transition: background .16s ease, border-color .16s ease, color .16s ease, filter .16s ease, transform .16s ease, box-shadow .16s ease; }
.ps-btn:hover:not(:disabled) { filter: brightness(1.12); }
.ps-btn:active:not(:disabled) { transform: scale(0.98); }
.ps-btn:focus-visible { outline: 2px solid var(--space-brand-primary-500); outline-offset: 2px; }
.ps-input { transition: border-color .16s ease, box-shadow .16s ease; outline: none; }
.ps-input:focus { border-color: var(--space-brand-primary-500) !important; box-shadow: 0 0 0 3px color-mix(in srgb, var(--space-brand-primary-500) 22%, transparent); }
@media (prefers-reduced-motion: reduce) { .ps-enter-editor, .ps-enter-gallery, .ps-fade-up { animation: none !important; } }
`;

/** Inject the ProductStudio keyframes/utility classes once per view. */
export function FxStyles() {
  return <style>{FX_CSS}</style>;
}

export function Tilt({
  children,
  maxTilt = 7,
  lifted = false,
  hoverLift = true,
  disabled = false,
  style,
  className,
  onClick,
  role,
  tabIndex,
  ariaLabel,
  testId,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  children: React.ReactNode;
  /** Max tilt in degrees at the card edge. Use 1–2 for large surfaces (preview), 6–9 for cards. */
  maxTilt?: number;
  /** Persistent lift (active/selected card): translateZ(8px) + scale(1.03) + deeper shadow. */
  lifted?: boolean;
  /** Lift on hover too (default). Turn off for the big preview surface. */
  hoverLift?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  role?: string;
  tabIndex?: number;
  ariaLabel?: string;
  testId?: string;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, hover: false });

  const onMove = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ rx: -(py * maxTilt * 2), ry: px * maxTilt * 2, hover: true });
  }, [disabled, maxTilt]);

  const reset = useCallback(() => setTilt({ rx: 0, ry: 0, hover: false }), []);

  const lift = lifted || (hoverLift && tilt.hover && !disabled);
  // Depth cue: the shadow shifts opposite the tilt and deepens when lifted.
  const shadowX = Math.round(-tilt.ry * 1.4);
  const shadowY = Math.round(tilt.rx * 1.4) + (lift ? 16 : 7);
  const shadowBlur = lift ? 30 : 16;
  const shadowAlpha = lift ? 0.45 : 0.26;

  return (
    <div style={{ perspective: 900 }} className={className}>
      <div
        ref={ref}
        role={role}
        tabIndex={tabIndex}
        aria-label={ariaLabel}
        data-testid={testId}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        onMouseMove={onMove}
        onMouseLeave={reset}
        onClick={onClick}
        onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e as unknown as React.MouseEvent); } } : undefined}
        style={{
          transform: disabled
            ? undefined
            : `rotateX(${tilt.rx.toFixed(2)}deg) rotateY(${tilt.ry.toFixed(2)}deg) translateZ(${lift ? 8 : 0}px) scale(${lift ? 1.03 : 1})`,
          transformStyle: 'preserve-3d',
          transition: 'transform 0.15s ease, box-shadow 0.22s ease',
          boxShadow: disabled ? undefined : `${shadowX}px ${shadowY}px ${shadowBlur}px rgba(2, 6, 18, ${shadowAlpha})`,
          willChange: 'transform',
          borderRadius: (style && style.borderRadius) || 14,
          outline: 'none',
          ...style,
        }}
      >
        {children}
      </div>
    </div>
  );
}
