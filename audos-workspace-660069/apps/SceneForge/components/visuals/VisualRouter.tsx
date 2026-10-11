// SCENE ROUTER — one SceneSpec in, the right visual out. This is the only
// place in the browser that maps a visual type onto a component, so adding a
// new grammar is a one-line change here plus its component (and its mirror in
// remotion/sceneForgeSource).
import type { SceneSpec } from '../../lib/sceneSpec';
import { DIRECTOR_THEME } from './visualTheme';
import TextRevealVisual from './TextRevealVisual';
import TimelineVisual from './TimelineVisual';
import ChartVisual from './ChartVisual';
import FlowVisual from './FlowVisual';
import DiagramVisual from './DiagramVisual';
import OrbitVisual from './OrbitVisual';
import ImageKenBurnsVisual from './ImageKenBurnsVisual';
import CalloutVisual from './CalloutVisual';
import MapVisual from './MapVisual';
import HighlightVisual from './HighlightVisual';

export interface VisualRouterProps {
  spec: SceneSpec;
  /** 0..1 through this scene. Defaults to a settled frame for still previews. */
  progress?: number;
  accent?: string;
}

export default function VisualRouter({ spec, progress = 1, accent = DIRECTOR_THEME.accent }: VisualRouterProps) {
  const props = { spec, progress, accent };
  switch (spec.visual.type) {
    case 'text_reveal': return <TextRevealVisual {...props} />;
    case 'timeline': return <TimelineVisual {...props} />;
    case 'chart': return <ChartVisual {...props} />;
    case 'flow': return <FlowVisual {...props} />;
    case 'diagram': return <DiagramVisual {...props} />;
    case 'orbit': return <OrbitVisual {...props} />;
    case 'image_kenburns': return <ImageKenBurnsVisual {...props} />;
    case 'callout': return <CalloutVisual {...props} />;
    case 'map': return <MapVisual {...props} />;
    case 'highlight': return <HighlightVisual {...props} />;
    default: return <TextRevealVisual {...props} />;
  }
}

export {
  TextRevealVisual,
  TimelineVisual,
  ChartVisual,
  FlowVisual,
  DiagramVisual,
  OrbitVisual,
  ImageKenBurnsVisual,
  CalloutVisual,
  MapVisual,
  HighlightVisual,
};
