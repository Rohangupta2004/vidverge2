import type { ReactNode } from 'react';
import { LB } from './LightBeam';

/** Shared identity rail for VidVerge's three core creation surfaces. */
export default function ProductSuiteHeader({
  name,
  voice,
  working = false,
  showIcon = true,
  actions,
}: {
  name: string;
  voice: string;
  /** Kept for caller compatibility — the header no longer renders a brand mark. */
  working?: boolean;
  /** Kept for caller compatibility — the header no longer renders a brand mark. */
  showIcon?: boolean;
  actions?: ReactNode;
}) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
      flexWrap: 'wrap', padding: '12px 14px', borderRadius: 14,
      background: LB.bgCard, border: LB.border,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: LB.textPrimary, fontSize: 16, fontWeight: 750, letterSpacing: -0.2 }}>{name}</div>
          <div style={{ color: LB.textSecondary, fontSize: 11.5, lineHeight: 1.45 }}>{voice}</div>
        </div>
      </div>
      {actions ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{actions}</div> : null}
    </header>
  );
}
