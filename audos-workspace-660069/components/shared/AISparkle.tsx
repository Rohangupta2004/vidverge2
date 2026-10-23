import React from 'react';

/**
 * ✦ AI sparkle — the one-tap suggestion control that sits inside prompt,
 * script, URL, description and title fields across every Vidverge app.
 *
 * Click → one instant call to the OpenAI proxy (gpt-6-luna, reasoning off,
 * 200 tokens) → the field is filled with the suggestion. The caller supplies
 * the prompt (usually describing the field and any current value) and
 * receives the raw suggestion text back.
 */

const GOLD = '#6C63FF';
const GOLD_DEEP = '#5146E8';
const INK = '#0A0A0F';

export async function suggestWithAI(prompt: string): Promise<string> {
  const token = (window as unknown as { __workspaceDb?: { token?: string } }).__workspaceDb?.token;
  const res = await fetch('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workspace-DB-Token': token || '',
    },
    body: JSON.stringify({
      model: 'gpt-6-luna',
      reasoning_effort: 'none',
      max_completion_tokens: 200,
      messages: [
        {
          role: 'system',
          content:
            'You write ONE concise, specific, high-quality suggestion for an input field in an AI video creation studio. Reply with ONLY the suggestion text itself — no quotes, no preamble, no markdown.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error('AI suggestion failed (' + res.status + ')');
  const data = await res.json();
  const text: string | undefined = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('AI returned no suggestion');
  return text;
}

export interface AISparkleButtonProps {
  /** Builds the instruction sent to the model when the button is pressed. */
  buildPrompt: () => string;
  /** Receives the suggestion text (callers usually set their field state). */
  onSuggestion: (text: string) => void;
  onError?: (message: string) => void;
  title?: string;
  /** Extra positioning from the caller (e.g. absolute inset placement). */
  style?: React.CSSProperties;
  disabled?: boolean;
}

export const AISparkleButton: React.FC<AISparkleButtonProps> = ({
  buildPrompt,
  onSuggestion,
  onError,
  title,
  style,
  disabled,
}) => {
  const [busy, setBusy] = React.useState(false);
  const mounted = React.useRef(true);
  React.useEffect(() => () => {
    mounted.current = false;
  }, []);

  const run = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const text = await suggestWithAI(buildPrompt());
      if (mounted.current) onSuggestion(text);
    } catch (err) {
      if (mounted.current && onError) onError(err instanceof Error ? err.message : 'AI suggestion failed');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy || disabled}
      title={title || 'Suggest with AI'}
      aria-label={title || 'Suggest with AI'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 10px',
        borderRadius: 6,
        border: '1px solid rgba(108,99,255,0.35)',
        background: busy
          ? 'rgba(108,99,255,0.18)'
          : 'linear-gradient(135deg, rgba(108,99,255,0.14), rgba(81,70,232,0.1))',
        color: GOLD,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        cursor: busy || disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        transition: 'background 0.15s ease, border-color 0.15s ease',
        minHeight: 0,
        minWidth: 0,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = GOLD;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(108,99,255,0.35)';
      }}
    >
      <span
        aria-hidden
        style={
          busy
            ? { display: 'inline-block', animation: 'spin 0.9s linear infinite', color: GOLD_DEEP }
            : { color: GOLD }
        }
      >
        ✦
      </span>
      {busy ? '…' : 'AI'}
    </button>
  );
};

/**
 * Wraps a single input/textarea and seats the ✦ AI button inside its
 * right edge. Keeps the child untouched — purely a positioning shell.
 *
 *   <SparkleSlot buildPrompt={...} onSuggestion={(t) => setTopic(t)}>
 *     <input ... style={{ paddingRight: 64 }} />
 *   </SparkleSlot>
 */
export const SparkleSlot: React.FC<
  AISparkleButtonProps & { children: React.ReactNode; align?: 'center' | 'top' }
> = ({ children, align = 'center', ...btn }) => (
  <div style={{ position: 'relative', width: '100%' }}>
    {children}
    <div
      style={{
        position: 'absolute',
        right: 8,
        ...(align === 'center'
          ? { top: '50%', transform: 'translateY(-50%)' }
          : { top: 8 }),
        zIndex: 2,
      }}
    >
      <AISparkleButton {...btn} />
    </div>
  </div>
);

export default AISparkleButton;
