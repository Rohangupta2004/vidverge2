/**
 * useTopicSuggestions — three angles on whatever the topic field says so far.
 *
 * Deliberately the cheapest call in the app: gpt-5.6-luna with reasoning off,
 * two hundred output tokens, and a 300ms debounce so a sentence being typed
 * costs one request rather than forty. Nothing here is allowed to be loud —
 * a failed suggestion is simply no suggestion, because the field it sits
 * under works perfectly well without it.
 *
 * The three angles always come back in the same order so the chips can be
 * labelled: a hook, a question, and a data-led framing.
 */

import { useEffect, useRef, useState } from 'react';
import { FAST_TEXT_MODEL, callFastText, workspaceToken } from '../lib/platform';

export const SUGGESTION_DEBOUNCE_MS = 300;
export const SUGGESTION_MODEL = FAST_TEXT_MODEL;

const MIN_INPUT_CHARS = 4;
const MAX_INPUT_CHARS = 240;

export const SUGGESTION_KINDS = ['Hook', 'Question', 'Data-led'] as const;

export interface TopicSuggestion {
  kind: string;
  text: string;
}

export interface TopicSuggestionsState {
  suggestions: TopicSuggestion[];
  loading: boolean;
  /** Set only so a caller can choose to show it. This app stays silent. */
  error: string | null;
}

function promptFor(input: string): string {
  return [
    `Given this partial topic: '${input}', suggest 3 short viral documentary angles (max 10 words each).`,
    'Return a JSON array of exactly 3 strings, in this order: first a HOOK framing (a statement that stops a scroll),',
    'second a QUESTION framing, third a DATA-LED framing built around a number or a measurable claim.',
    'No commentary, no markdown, no object wrapper — just the array.',
  ].join(' ');
}

/** Lenient on purpose: a model that wraps the array in prose still gets used. */
function parseAngles(raw: string): string[] {
  const text = String(raw || '').trim();
  if (!text) return [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  const slice = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry) => String(entry == null ? '' : entry).trim().replace(/^["'\u201c]|["'\u201d]$/g, ''))
    .filter((entry) => entry.length >= 3)
    .slice(0, 3);
}

async function fetchAngles(input: string, signal: AbortSignal): Promise<string[]> {
  // Signed-out or still booting: no token, so no call and no complaint.
  if (!workspaceToken()) return [];
  const raw = await callFastText({
    signal,
    maxTokens: 200,
    system:
      'You name documentary angles. Every answer is a bare JSON array of three strings, each at most ten words, each a different way into the same subject.',
    user: promptFor(input),
  });
  return parseAngles(raw);
}

export function useTopicSuggestions(input: string, enabled = true): TopicSuggestionsState {
  const [state, setState] = useState<TopicSuggestionsState>({
    suggestions: [],
    loading: false,
    error: null,
  });
  // Suggestions for text the user has already typed past are worse than none.
  const latest = useRef(0);

  useEffect(() => {
    const trimmed = String(input || '').trim().slice(0, MAX_INPUT_CHARS);
    if (!enabled || trimmed.length < MIN_INPUT_CHARS) {
      setState({ suggestions: [], loading: false, error: null });
      return undefined;
    }

    const requestId = latest.current + 1;
    latest.current = requestId;
    const controller = new AbortController();

    const timer = window.setTimeout(() => {
      setState((previous) => ({ ...previous, loading: true, error: null }));
      fetchAngles(trimmed, controller.signal)
        .then((angles) => {
          if (latest.current !== requestId) return;
          setState({
            suggestions: angles.map((text, index) => ({
              kind: SUGGESTION_KINDS[index] || 'Angle',
              text,
            })),
            loading: false,
            error: null,
          });
        })
        .catch((error: any) => {
          if (controller.signal.aborted || latest.current !== requestId) return;
          setState({ suggestions: [], loading: false, error: String(error?.message || error).slice(0, 160) });
        });
    }, SUGGESTION_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [input, enabled]);

  return state;
}
