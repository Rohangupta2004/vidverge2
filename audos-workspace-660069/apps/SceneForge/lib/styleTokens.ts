export type SceneForgeThemeId = 'dark-cinematic' | 'vox-paper';

export interface SceneForgeStyleTokens {
  id: SceneForgeThemeId;
  background: string;
  surface: string;
  ink: string;
  mutedInk: string;
  accent: string;
  secondaryAccent: string;
  highlight: string;
  fontHeadline: string;
  fontBody: string;
  paperGrain: boolean;
  halftone: boolean;
  tornEdges: boolean;
  /** Serializable CSS filter used by browser, SVG capture and Remotion. */
  duotoneFilter: string;
  /** CSS polygon fallback when an SVG torn-edge mask is not available. */
  tornClipPath: string;
  grainCss: Record<string, string | number>;
  halftoneCss: Record<string, string | number>;
}

export const THEMES: Record<SceneForgeThemeId, SceneForgeStyleTokens> = {
  'dark-cinematic': {
    id: 'dark-cinematic',
    background: '#0A0F1E',
    surface: '#121C30',
    ink: '#FFFFFF',
    mutedInk: '#CBD5E1',
    accent: '#F59E0B',
    secondaryAccent: '#38BDF8',
    highlight: '#F59E0B',
    fontHeadline: "Inter, system-ui, sans-serif",
    fontBody: "Inter, system-ui, sans-serif",
    paperGrain: false,
    halftone: false,
    tornEdges: false,
    duotoneFilter: 'saturate(.9) contrast(1.08)',
    tornClipPath: 'none',
    grainCss: {},
    halftoneCss: {},
  },
  'vox-paper': {
    id: 'vox-paper',
    background: '#F5F0E8',
    surface: '#E9E2D3',
    ink: '#1A1208',
    mutedInk: '#5E5548',
    accent: '#E8B84B',
    secondaryAccent: '#E4572E',
    highlight: '#FFE566',
    fontHeadline: "'Archivo Black', 'Arial Black', sans-serif",
    fontBody: "'Work Sans', Inter, sans-serif",
    paperGrain: true,
    halftone: true,
    tornEdges: true,
    // Sepia supplies one luminance axis; hue/saturation lock photography into
    // cream/ink/yellow instead of leaving a random full-colour photograph.
    duotoneFilter: 'grayscale(1) sepia(.72) saturate(1.55) hue-rotate(352deg) contrast(1.12)',
    tornClipPath: 'polygon(0 2%,5% 0,12% 2%,19% 0,27% 1.5%,36% 0,44% 2%,52% .5%,61% 2%,70% 0,79% 1.5%,88% 0,95% 2%,100% 1%,99% 12%,100% 23%,98.5% 34%,100% 46%,99% 58%,100% 70%,98.5% 82%,100% 94%,98% 100%,88% 98.5%,79% 100%,69% 98%,59% 100%,49% 98.5%,39% 100%,30% 98%,20% 100%,10% 98.5%,1% 100%,2% 89%,0 78%,1.5% 66%,0 54%,2% 42%,0 30%,1.5% 18%)',
    grainCss: {
      backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 180 180\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'.8\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'.18\'/%3E%3C/svg%3E")',
      mixBlendMode: 'multiply',
      opacity: 0.2,
    },
    halftoneCss: {
      backgroundImage: 'radial-gradient(circle, rgba(26,18,8,.34) 1.1px, transparent 1.3px)',
      backgroundSize: '7px 7px',
      mixBlendMode: 'multiply',
    },
  },
};

export function themeOf(id?: string | null): SceneForgeStyleTokens {
  return id === 'vox-paper' ? THEMES['vox-paper'] : THEMES['dark-cinematic'];
}

export function themeFromProjectStyle(style?: string | null): SceneForgeThemeId {
  return style === 'vox-explainer' || style === 'vox-paper' ? 'vox-paper' : 'dark-cinematic';
}
