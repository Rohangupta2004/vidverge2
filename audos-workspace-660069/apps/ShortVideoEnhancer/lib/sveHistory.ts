/**
 * Short Video Enhancer — undo / redo.
 *
 * The whole edit is one serialisable document, so history is just a stack of
 * them. Past, present and future live in ONE state object and every transition
 * is computed inside a single updater, so a double-invoked render can never
 * push the same entry twice.
 *
 * COALESCING. Dragging a slider fires a change per pixel. An edit tagged with
 * the same `label` as the one before it, within COALESCE_MS, replaces the top
 * of the stack instead of pushing a new entry — so one drag is one undo, not
 * ninety.
 *
 * KEYBOARD SCOPE. Ctrl/Cmd+Z and Ctrl/Cmd+Y (or Shift+Z) are bound on the
 * window and ignored while the creator is typing in a field, so undo never
 * steals a text edit.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

const LIMIT = 60;
const COALESCE_MS = 550;

interface Stack<T> {
  past: T[];
  present: T;
  future: T[];
  label: string;
  at: number;
  revision: number;
}

export interface History<T> {
  present: T;
  canUndo: boolean;
  canRedo: boolean;
  /** Apply an edit. `label` groups rapid edits of the same control. */
  commit: (next: T | ((current: T) => T), label?: string) => void;
  /** Replace the document without keeping history (load, new clip). */
  reset: (next: T) => void;
  undo: () => void;
  redo: () => void;
  /** Bumped on every change — the autosave trigger. */
  revision: number;
}

export function useHistory<T>(initial: T): History<T> {
  const [stack, setStack] = useState<Stack<T>>({
    past: [], present: initial, future: [], label: '', at: 0, revision: 0,
  });

  const commit = useCallback((next: T | ((current: T) => T), label = '') => {
    setStack((current) => {
      const value = typeof next === 'function' ? (next as (c: T) => T)(current.present) : next;
      if (value === current.present) return current;
      const now = Date.now();
      const coalesce = !!label && label === current.label && now - current.at < COALESCE_MS;
      return {
        past: coalesce ? current.past : current.past.concat([current.present]).slice(-LIMIT),
        present: value,
        future: [],
        label,
        at: now,
        revision: current.revision + 1,
      };
    });
  }, []);

  const reset = useCallback((next: T) => {
    setStack((current) => ({
      past: [], present: next, future: [], label: '', at: 0, revision: current.revision + 1,
    }));
  }, []);

  const undo = useCallback(() => {
    setStack((current) => {
      if (!current.past.length) return current;
      return {
        past: current.past.slice(0, -1),
        present: current.past[current.past.length - 1],
        future: [current.present].concat(current.future).slice(0, LIMIT),
        label: '',
        at: 0,
        revision: current.revision + 1,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setStack((current) => {
      if (!current.future.length) return current;
      return {
        past: current.past.concat([current.present]).slice(-LIMIT),
        present: current.future[0],
        future: current.future.slice(1),
        label: '',
        at: 0,
        revision: current.revision + 1,
      };
    });
  }, []);

  return useMemo(() => ({
    present: stack.present,
    canUndo: stack.past.length > 0,
    canRedo: stack.future.length > 0,
    commit,
    reset,
    undo,
    redo,
    revision: stack.revision,
  }), [commit, redo, reset, stack, undo]);
}

/** Ctrl/Cmd+Z and Ctrl/Cmd+Y / Shift+Z, muted while a field has focus. */
export function useUndoShortcuts(undo: () => void, redo: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);
}
