// ProductContext — the research package, built before any creative decision.
//
// Step 1 of the pipeline produces exactly one of these per run and nothing
// downstream is allowed to assume anything that is not in it. The honesty
// fields (extraction_gaps, manufacture_required, extraction_confidence) are
// load-bearing: the critic uses manufacture_required to tell 'the film failed
// to execute the concept' apart from 'the concept was unachievable with the
// assets this product actually has'.

import type { SceneRole } from './film-spec.types';

export type AssetType = 'screenshot' | 'logo' | 'ui_detail' | 'hero_image' | 'diagram' | 'testimonial_card';
export type VisualQuality = 'high' | 'medium' | 'low';
export type DesignMaturity = 'polished' | 'functional' | 'rough';

export interface ExtractedAsset {
  handle: string;           // e.g. 'homepage_hero', 'feature_character_lock'
  type: AssetType;
  source_url: string;
  description: string;      // what it specifically shows
  visual_quality: VisualQuality;
  film_usability: string;   // directive: 'strong hook candidate — shows character drift clearly'
  suitable_for_roles: SceneRole[];
}

export interface BrandExtraction {
  primary_colors: string[];   // hex, ranked by visual prominence
  accent_colors: string[];
  background_color: string;
  text_color: string;
  logo_handle?: string;
  typography_feel: string;    // 'geometric sans, tight tracking, heavy weight'
  visual_style: string;       // 'minimal dark SaaS' | 'bold editorial' | etc.
  design_maturity: DesignMaturity;
}

export interface ProductFeature {
  name: string;
  description: string;
  has_visual: boolean;
  asset_handle?: string;
}

export interface SocialProofItem {
  type: 'testimonial' | 'customer_logo' | 'metric' | 'press_mention';
  content: string;
  film_usable: boolean;
}

export interface ProductContext {
  url: string;
  extracted_at: string;       // ISO timestamp
  pages_analyzed: string[];

  product_name: string;
  tagline: string;
  product_category: string;
  target_audience: string;
  core_problem: string;
  core_solution: string;
  key_features: ProductFeature[];
  value_prop_in_one_line: string; // synthesis, not copy-paste from site

  pricing_model?: string;
  price_anchors?: string[];

  social_proof: SocialProofItem[];

  brand: BrandExtraction;
  assets: ExtractedAsset[];       // ordered by film usability, descending

  best_hook_asset?: string;         // handle of single strongest visual for hook
  ui_richness: 'high' | 'medium' | 'low';
  ui_richness_rationale: string;
  extraction_confidence: number;    // 0–1
  extraction_gaps: string[];
  manufacture_required: string[];   // what the film must construct vs pull from assets
}

export const ASSET_TYPES: AssetType[] = [
  'screenshot', 'logo', 'ui_detail', 'hero_image', 'diagram', 'testimonial_card',
];

export const VISUAL_QUALITIES: VisualQuality[] = ['high', 'medium', 'low'];

export const DESIGN_MATURITIES: DesignMaturity[] = ['polished', 'functional', 'rough'];

/** Every handle the film is allowed to reference. */
export function assetHandles(ctx: ProductContext): string[] {
  const handles = ctx.assets.map((asset) => asset.handle);
  if (ctx.brand.logo_handle && handles.indexOf(ctx.brand.logo_handle) < 0) {
    handles.push(ctx.brand.logo_handle);
  }
  return handles;
}
