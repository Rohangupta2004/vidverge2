import type { ComparisonItem, EditPlan, ImageStyle, Overlay, OverlayPosition, OverlayType, TranscriptResult } from '../types';

const TYPES: OverlayType[] = ['seedance_motion', 'static_image', 'text_fact', 'comparison_card'];
const POSITIONS: OverlayPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center', 'sidebar-left', 'sidebar-right'];

const getToken = () => {
  const value = (window as any).__workspaceDb?.token;
  if (!value) throw new Error('Workspace authentication is not ready. Refresh and try again.');
  return value as string;
};

const SYSTEM_PROMPT = `You are an award-winning professional short-form video editor. Create a restrained, practical edit plan for a talking-head avatar video. Return JSON only.
Choose overlay types intelligently: seedance_motion only for short punchy b-roll moments that benefit from motion; static_image for illustrative b-roll; text_fact for essential facts or statistics rendered as live React text; comparison_card for structured comparisons rendered as editable React UI. Do not turn every moment into an image. Keep the presenter visible and avoid overlapping overlays.
For seedance_motion, imagePrompt must explicitly include the exact textContent baked visibly into the image and motionPrompt must begin from blank or dark before elements materialize with kinetic energy. For static_image, request clean b-roll with no words. For text_fact and comparison_card, imagePrompt must be null. Keep every overlay inside the video duration.
Schema: {"cuts":[{"start":0,"end":4.2,"label":"Hook"}],"overlays":[{"id":"overlay_1","type":"seedance_motion|static_image|text_fact|comparison_card","startSec":2.1,"durationSec":3.5,"position":"top-left|top-right|bottom-left|bottom-right|center|sidebar-left|sidebar-right","imagePrompt":"string or null","textContent":"string or null","motionPrompt":"string or null","items":[{"label":"Feature A","value":"✓","highlight":true}] or null}]}`;

export async function planEdits(transcript: TranscriptResult, style: ImageStyle): Promise<EditPlan> {
  const timedTranscript = transcript.words.map((word) => `[${word.start.toFixed(2)}-${word.end.toFixed(2)}] ${word.word}`).join(' ');
  const response = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workspace-DB-Token': getToken(),
    },
    body: JSON.stringify({
      model: 'gpt-5.6-sol',
      reasoning_effort: 'medium',
      max_completion_tokens: 6000,
      response_format: { type: 'json_object' },
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Video duration: ${transcript.duration.toFixed(2)} seconds\nDetected language: ${transcript.language}\nImage style: ${style}\nTimestamped transcript:\n${timedTranscript}` },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.error || `Edit planning failed (${response.status})`);

  const raw = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
  const duration = Math.max(0.1, transcript.duration);
  const cuts = (Array.isArray(raw.cuts) ? raw.cuts : []).map((cut: any, index: number) => ({
    start: Math.max(0, Math.min(duration, Number(cut.start) || 0)),
    end: Math.max(0, Math.min(duration, Number(cut.end) || duration)),
    label: String(cut.label || `Section ${index + 1}`),
  })).filter((cut: any) => cut.end > cut.start);

  const overlays: Overlay[] = (Array.isArray(raw.overlays) ? raw.overlays : []).map((item: any, index: number) => {
    const type: OverlayType = TYPES.includes(item.type) ? item.type : 'text_fact';
    const startSec = Math.max(0, Math.min(duration - 0.1, Number(item.startSec) || 0));
    const durationSec = Math.max(0.5, Math.min(duration - startSec, Number(item.durationSec) || 2.5));
    const items: ComparisonItem[] | null = type === 'comparison_card' && Array.isArray(item.items)
      ? item.items.map((row: any, rowIndex: number) => ({ id: `item_${index}_${rowIndex}`, label: String(row.label || ''), value: String(row.value || ''), highlight: Boolean(row.highlight) }))
      : null;
    return {
      id: String(item.id || `overlay_${index + 1}`),
      type,
      startSec,
      durationSec,
      position: POSITIONS.includes(item.position) ? item.position : 'bottom-left',
      imagePrompt: type === 'seedance_motion' || type === 'static_image' ? String(item.imagePrompt || '') : null,
      textContent: item.textContent == null ? null : String(item.textContent),
      motionPrompt: type === 'seedance_motion' ? String(item.motionPrompt || 'Animate from a dark blank frame as elements materialize with kinetic energy.') : null,
      items,
    };
  });

  return { cuts: cuts.length ? cuts : [{ start: 0, end: duration, label: 'Full video' }], overlays };
}
