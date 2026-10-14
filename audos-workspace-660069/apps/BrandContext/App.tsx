// Brand Context — the paste-once brand primer for ChatGPT.
//
// One screen, no tabs, no AI calls, no database: the brand brief lives in the
// BRAND_CONTEXT constant below, the app renders it as a read-only terminal
// block, and one button puts it on the clipboard. The customer pastes it into
// ChatGPT, asks for a script, and brings the script back into a Vidverge
// studio. Edit BRAND_CONTEXT to change what every copy hands over.
import React from 'react';
import { Check, Clipboard, ClipboardCopy, MessageSquare, PenLine, Film } from 'lucide-react';
import AppShell from '../../components/ui/AppShell';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import { COLORS, FONT, RADIUS, alpha } from '../../components/theme';

/** The block the customer copies. This is the single place to edit the brand. */
const BRAND_CONTEXT = `You are helping me create content for my brand. Here is my full brand context:

Brand Name: Vidverge
What we do: AI-powered platform that turns text prompts into publish-ready videos end to end.
Target audience: Solo creators and small marketers who want consistent shippable video content.
Core problem we solve: Character drift across video scenes burns credits and leaves creators with nothing to ship.
Our differentiator: One pipeline from brief to final downloadable video with character consistency built in.
Video format: 15-60 seconds, 1-3 scenes, one complete video output.
Tone: Clear, confident, modern. Not salesy \u2014 show do not tell.
Pricing: Free trial 30 credits, Creator $35/mo 250 credits, Pro $70/mo 500 credits, Pay-as-you-go $9 = 60 credits. 1 credit = 1 second of video.

Use this context whenever I ask you to write scripts, video briefs, hooks, captions, or ad copy for Vidverge.`;

const NEXT_STEPS: Array<{ icon: React.ComponentType<any>; title: string; body: string }> = [
  {
    icon: MessageSquare,
    title: 'Paste into ChatGPT',
    body: 'Start any new conversation by pasting this block first, before you ask for anything.',
  },
  {
    icon: PenLine,
    title: 'Ask for your script',
    body: '\u201cWrite me a 30-second video script for [topic].\u201d Hooks, captions and ad copy work the same way.',
  },
  {
    icon: Film,
    title: 'Paste into Vidverge',
    body: 'Bring the script back into Script-to-Video or the Vidverge Agent and generate the video.',
  },
];

/** Clipboard API first; the hidden-textarea path covers insecure or iframed contexts. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export default function BrandContextApp() {
  const [copied, setCopied] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(function clearPendingReset() {
    return function cleanup() {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const copy = React.useCallback(async function copy() {
    const ok = await copyToClipboard(BRAND_CONTEXT);
    setCopied(ok);
    setFailed(!ok);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(function reset() {
      setCopied(false);
      setFailed(false);
    }, 2000);
  }, []);

  return (
    <AppShell
      title="Brand Context"
      subtitle={'Copy this once \u2192 paste into ChatGPT \u2192 use the output in Vidverge'}
      eyebrow="Brand kit"
      icon={
        <span
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 46,
            height: 46,
            borderRadius: RADIUS.md,
            background: alpha(COLORS.primary, 0.14),
            border: '1px solid ' + alpha(COLORS.primary, 0.32),
          }}
        >
          <Clipboard size={21} color={COLORS.primaryGlow} />
        </span>
      }
      actions={<Badge variant="brand">Ready to copy</Badge>}
      maxWidth={780}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        <section>
          <div
            style={{
              background: COLORS.input,
              border: '1px solid ' + COLORS.borderInput,
              borderRadius: RADIUS.md,
              overflow: 'hidden',
              boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 14px',
                background: COLORS.surface,
                borderBottom: '1px solid ' + COLORS.border,
              }}
            >
              <span aria-hidden="true" style={{ display: 'flex', gap: 5 }}>
                {[COLORS.textFaint, COLORS.textFaint, COLORS.primary].map(function dot(color, index) {
                  return (
                    <span
                      key={index}
                      style={{ width: 8, height: 8, borderRadius: '50%', background: color, opacity: 0.8 }}
                    />
                  );
                })}
              </span>
              <span
                style={{
                  flex: '1 1 auto',
                  minWidth: 0,
                  fontFamily: FONT.mono,
                  fontSize: 11.5,
                  letterSpacing: 0.3,
                  color: COLORS.textMuted,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                brand-context.txt
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={copy}
                aria-label="Copy brand context to clipboard"
                icon={copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
                style={{ color: copied ? COLORS.success : COLORS.textMuted }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>

            <pre
              tabIndex={0}
              style={{
                margin: 0,
                padding: '18px 20px 20px',
                maxHeight: 340,
                overflowY: 'auto',
                fontFamily: FONT.mono,
                fontSize: 12.5,
                lineHeight: 1.8,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: COLORS.text,
                outline: 'none',
              }}
            >
              {BRAND_CONTEXT}
            </pre>
          </div>

          <Button
            variant="primary"
            size="lg"
            block
            onClick={copy}
            icon={copied ? <Check size={17} /> : <ClipboardCopy size={17} />}
            style={{ marginTop: 16 }}
          >
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </Button>

          <p
            role="status"
            aria-live="polite"
            style={{
              margin: '10px 0 0',
              minHeight: 18,
              textAlign: 'center',
              fontSize: 12.5,
              color: failed ? COLORS.error : COLORS.success,
            }}
          >
            {failed
              ? 'Your browser blocked the clipboard \u2014 select the text above and copy it manually.'
              : copied
                ? 'Brand context copied \u2014 paste it into ChatGPT.'
                : ''}
          </p>
        </section>

        <section>
          <h2
            style={{
              margin: '0 0 12px',
              fontFamily: FONT.heading,
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: -0.2,
              color: COLORS.text,
            }}
          >
            What to do next
          </h2>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(216px, 1fr))',
              gap: 12,
            }}
          >
            {NEXT_STEPS.map(function step(item, index) {
              const Icon = item.icon;
              return (
                <Card key={item.title} padding={16}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
                    <span
                      style={{
                        display: 'grid',
                        placeItems: 'center',
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: alpha(COLORS.primary, 0.16),
                        border: '1px solid ' + alpha(COLORS.primary, 0.3),
                        fontFamily: FONT.mono,
                        fontSize: 11,
                        fontWeight: 700,
                        color: COLORS.primaryGlow,
                      }}
                    >
                      {index + 1}
                    </span>
                    <Icon size={14} color={COLORS.textMuted} />
                  </div>
                  <p
                    style={{
                      margin: '0 0 5px',
                      fontSize: 13.5,
                      fontWeight: 600,
                      letterSpacing: -0.1,
                      color: COLORS.text,
                    }}
                  >
                    {item.title}
                  </p>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: COLORS.textMuted }}>
                    {item.body}
                  </p>
                </Card>
              );
            })}
          </div>
        </section>

        <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.6, color: COLORS.textFaint }}>
          Your brand context is saved here. Update it any time you change your brand.
        </p>
      </div>
    </AppShell>
  );
}
