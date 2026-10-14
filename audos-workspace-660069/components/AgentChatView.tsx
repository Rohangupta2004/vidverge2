/**
 * AgentChatView — per-space agent UI.
 *
 * THIS FILE IS THE PER-SPACE AGENT APPEARANCE. Edit it to restyle the agent
 * element (colors, spacing, copy, layout, message bubbles, header card,
 * suggestion chips, empty state, input bar, etc.). Your edits PERSIST across
 * recompiles.
 *
 * The runtime hook `useAgentChatRuntime` and the `AgentChat.tsx` shell are
 * platform-managed and force-overwritten on each compile — do not put any
 * logic / state / fetch / effect work in here. This view is purely
 * presentational; it consumes the runtime and renders.
 */
import {
  ArrowUpRight,
  Bot,
  Send,
  BookOpen,
  Edit3,
  Save,
  Sparkles,
  Paperclip,
  X,
  FileImage,
  File,
  XCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getFriendlyTerm } from '../lib/friendly-terms';
import { tw } from '../lib/colors';
import type { AgentChatRuntime } from './useAgentChatRuntime';
import BrandLogo from './BrandLogo';
import VergeLoader from './VergeLoader';

interface AgentChatViewProps {
  runtime: AgentChatRuntime;
}

/**
 * First-run copy. The space config can supply its own welcome message and
 * conversation starters; these are what a visitor sees when it does not, and
 * they describe what VidVerge actually does rather than asking an empty
 * "how can I help".
 */
const VIDVERGE_HOME_WELCOME =
  'Welcome to Vidverge — bring me an idea and leave with a video. Paste your product URL and I will read your brand, write you six different ad scripts, storyboard the one you pick and render it in your own colours. Want the whole launch film directed for you? Product Launch takes that same link and decides the concept, the shots and the cut itself. Describe what you are launching instead and I will write the script and build the video — teaser, reveal, demo, explainer, founder-led or social clip — in 16:9, 9:16 or square. Bring footage you already shot and I will transcribe it, hand you a cut plan you can accept edit by edit, then reframe, caption and export it for every platform; or hand the whole thing to CineAgent and it will edit, score and render it without asking you to configure anything. Just give me a topic and I will research, script and film a faceless explainer, documentary or true-crime video end to end. Need the voice rather than the whole film? Voice Studio clones your voice, reads a Hinglish script in it, dubs a finished video into Tamil or Telugu, scores a music bed and lip-syncs an avatar presenter to any of it.';

/**
 * The one-line promise under the logo. The full welcome above is also the
 * agent's own opening turn in the thread, so printing all of it above the
 * composer turned the first screen into a wall of prose.
 */
const VIDVERGE_HOME_LEAD =
  'Bring me an idea and leave with a finished video — a product URL, a script, footage you already shot, or just a topic.';

/** First sentence of `text`, or `fallback` when that is missing or too long. */
function leadSentence(text: string, fallback: string): string {
  const clean = String(text || '').trim();
  if (!clean) return fallback;
  const end = clean.search(/[.!?](\s|$)/);
  const first = (end === -1 ? clean : clean.slice(0, end + 1)).trim();
  return first.length > 20 && first.length <= 190 ? first : fallback;
}

// Every starter has to land in a studio that is actually registered in
// config.json — a prompt that routes to a retired app is a dead end on the
// first screen the customer sees.
const VIDVERGE_STARTERS = [
  'Make a 15-second launch video from my link',
  'Turn my product URL into an ad',
  'Write and build my product launch video',
  'Compare my brand with my competitors',
  'Make me a faceless documentary video',
  'Cut, caption and reframe footage I already have',
  'Turn my script into a film, scene by scene',
  'Edit my raw footage into a finished cut for me',
  'Clone my voice and make an avatar video',
  'Dub my video into Hindi or Tamil',
];

/**
 * Starter prompts as a two-column menu rather than centre-wrapped pills.
 * Ten prompts of uneven length wrapped into ragged rows that were hard to
 * read down; fixed rows with a gradient edge scan like a list of choices.
 */
function StarterGrid({
  prompts,
  onPick,
}: {
  prompts: string[];
  onPick: (prompt: string) => void;
}) {
  if (prompts.length === 0) return null;
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          onClick={() => onPick(prompt)}
          data-testid={`starter-prompt-${prompt.slice(0, 24)}`}
          className="group flex items-center gap-3 rounded-2xl border border-[var(--space-border-default)] bg-[color-mix(in_srgb,var(--space-surface-panel)_72%,transparent)] px-4 py-3 text-left text-sm font-medium text-[var(--space-text-secondary)] shadow-[0_10px_30px_rgba(0,0,0,0.16)] transition hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--space-brand-primary-500)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--space-brand-primary-500)_9%,transparent)] hover:text-[var(--space-text-primary)]"
        >
          <span
            aria-hidden="true"
            className="h-7 w-[3px] shrink-0 rounded-full bg-gradient-to-b from-[var(--space-brand-primary-500)] to-[var(--space-brand-highlight-500)] opacity-60 transition group-hover:opacity-100"
          />
          <span className="min-w-0 flex-1 truncate">{prompt}</span>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[var(--space-text-muted)] opacity-0 transition group-hover:opacity-80" />
        </button>
      ))}
    </div>
  );
}

function WorkingIndicator({
  lastAction,
  agentLabel = 'Agent',
  thinkingText,
}: {
  lastAction?: string;
  agentLabel?: string;
  thinkingText?: string | null;
}) {
  const friendlyText = getFriendlyTerm(lastAction || '', 'thinking');

  return (
    <div className="flex items-center justify-center py-3 mr-8">
      <VergeLoader
        size={120}
        label={`${agentLabel} is working`}
        caption={thinkingText || `${agentLabel} is ${friendlyText}`}
      />
    </div>
  );
}

// react-markdown strips its internal `node` prop from the rest spread when
// destructured, which keeps it from leaking onto DOM elements.
const SAFE_MARKDOWN_PROTOCOLS = /^(subscribe|app|https?|mailto|tel|ircs?|xmpp):/i;

const markdownUrlTransform = (value: string): string => {
  if (typeof value === 'string' && SAFE_MARKDOWN_PROTOCOLS.test(value)) {
    return value;
  }

  const colon = value.indexOf(':');
  const slash = value.indexOf('/');
  const question = value.indexOf('?');
  const hash = value.indexOf('#');

  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (question !== -1 && colon > question) ||
    (hash !== -1 && colon > hash)
  ) {
    return value;
  }

  return '';
};

const markdownComponents: Components = {
  p({ node: _node, children, ...props }) {
    return (
      <p className="my-2 text-base" {...props}>
        {children}
      </p>
    );
  },
  ul({ node: _node, children, ...props }) {
    return (
      <ul
        className="my-3 pl-5 space-y-1"
        style={{ listStyleType: 'disc', listStylePosition: 'outside' }}
        {...props}
      >
        {children}
      </ul>
    );
  },
  ol({ node: _node, children, ...props }) {
    return (
      <ol
        className="my-3 pl-5 space-y-1"
        style={{ listStyleType: 'decimal', listStylePosition: 'outside' }}
        {...props}
      >
        {children}
      </ol>
    );
  },
  li({ node: _node, children, ...props }) {
    return (
      <li className="ml-0 text-base" style={{ display: 'list-item' }} {...props}>
        {children}
      </li>
    );
  },
  table({ node: _node, children, ...props }) {
    return (
      <div className="overflow-x-auto my-3">
        <table
          className="min-w-full border-collapse border border-[var(--space-border-strong)] text-sm"
          {...props}
        >
          {children}
        </table>
      </div>
    );
  },
  thead({ node: _node, children, ...props }) {
    return (
      <thead className="bg-[var(--space-surface-muted)]" {...props}>
        {children}
      </thead>
    );
  },
  tbody({ node: _node, children, ...props }) {
    return <tbody {...props}>{children}</tbody>;
  },
  tr({ node: _node, children, ...props }) {
    return (
      <tr className="border-b border-[var(--space-border-default)]" {...props}>
        {children}
      </tr>
    );
  },
  th({ node: _node, children, ...props }) {
    return (
      <th
        className="border border-[var(--space-border-strong)] px-3 py-2 text-left font-semibold"
        {...props}
      >
        {children}
      </th>
    );
  },
  td({ node: _node, children, ...props }) {
    return (
      <td className="border border-[var(--space-border-strong)] px-3 py-2" {...props}>
        {children}
      </td>
    );
  },
  code({ node: _node, children, className, ...props }) {
    const isBlock = typeof className === 'string' && className.includes('language-');
    if (isBlock) {
      return (
        <code className={`${className ?? ''} break-all`} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="bg-[var(--space-neutral-800)] text-[var(--space-neutral-100)] px-1.5 py-0.5 rounded text-sm break-all"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre({ node: _node, children, ...props }) {
    return (
      <pre
        className="bg-[var(--space-neutral-800)] text-[var(--space-neutral-100)] rounded-lg p-3 my-2 overflow-x-auto max-w-full"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
        {...props}
      >
        {children}
      </pre>
    );
  },
  a({ node: _node, href, children }) {
    if (typeof href === 'string' && href.startsWith('app://')) {
      const appId = href.replace('app://', '');
      return (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[AgentChat] Button click - opening app:', appId);
            window.dispatchEvent(new CustomEvent('openApp', { detail: { appId } }));
          }}
          className={`inline-flex items-center gap-1 px-3 py-1 ${tw.button.primary} rounded-lg transition-colors text-xs font-medium mx-1`}
          data-testid={`link-app-${appId}`}
        >
          {children}
        </button>
      );
    }
    if (typeof href === 'string' && href.startsWith('subscribe://')) {
      return (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('endIntroSession'));
          }}
          className="text-[var(--space-text-brand)] hover:underline break-all bg-transparent border-none p-0 font-inherit text-left"
          data-testid="link-subscribe-plans"
        >
          {children}
        </button>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={href}
        className="text-[var(--space-text-brand)] hover:underline break-all"
      >
        {children}
      </a>
    );
  },
};

export default function AgentChatView({ runtime }: AgentChatViewProps) {
  const {
    messages,
    streamingContent,
    isStreaming,
    loading,
    lastAction,
    isLoadingHistory,
    hasLoadedHistory,
    input,
    setInput,
    pendingAttachments,
    isUploadingAttachment,
    isDraggingOver,
    messagesEndRef,
    textareaRef,
    fileInputRef,
    dropZoneRef,
    abortStream,
    sendMessage,
    sendMessageWithContent,
    removeAttachment,
    handleFileSelect,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    handleKeyDown,
    greetingPrompt,
    isConfigLoaded,
    greetingSent,
    welcomeInjectedSource,
    isBeaconSpace,
    agentLabel,
    thinkingText,
    beaconIntake,
    beaconStarterPrompts,
    shortcutPrefix,
  } = runtime;

  // The platform-managed runtime hook does not return `starterPrompts` (it only
  // ships beaconStarterPrompts), so reading it off the typed runtime crashes the
  // view the moment it mounts. Guard it: use the field when a future runtime
  // supplies it, otherwise an empty list — the VidVerge fallback starters below
  // keep the first screen from ever being a bare input box.
  const starterPrompts: string[] = Array.isArray((runtime as any).starterPrompts)
    ? ((runtime as any).starterPrompts as string[])
    : [];

  const hasUserMessages = messages.some((message) => message.role === 'user');
  const shouldShowBeaconIntake = isBeaconSpace && !!beaconIntake && !hasUserMessages;
  const composerPlaceholder = pendingAttachments.length > 0
    ? isBeaconSpace
      ? 'Add any context about these files...'
      : 'Add a message about the files...'
    : isBeaconSpace
      ? shouldShowBeaconIntake
        ? 'We can keep building from your starter plan, or you can tell me what changed...'
        : "Tell me what happened, or what you're worried about..."
      : 'Describe the video you want, paste a product URL, or drop in footage…';

  const visibleMessages = messages.filter(
    (m) => !(m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[SYSTEM:')),
  );

  const isPending =
    isLoadingHistory ||
    !isConfigLoaded ||
    (!!greetingPrompt && !greetingSent) ||
    (greetingSent && !welcomeInjectedSource);

  const showPendingPlaceholder =
    visibleMessages.length === 0 &&
    !loading &&
    !streamingContent &&
    !shouldShowBeaconIntake &&
    isPending;

  const showEmptyStateWelcome =
    !isLoadingHistory &&
    hasLoadedHistory &&
    isConfigLoaded &&
    visibleMessages.length === 0 &&
    !greetingSent &&
    !greetingPrompt &&
    !shouldShowBeaconIntake;

  // Conversation-starter chips must be visible in the INITIAL state even when a
  // welcome assistant message has been injected (config.agent.welcomeMessage),
  // which makes visibleMessages non-empty and turns showEmptyStateWelcome off.
  // Gate on "no user messages yet" instead so the starters stay clickable until
  // the visitor sends their first message.
  const showStarterPromptsBelowWelcome =
    !isBeaconSpace &&
    !showEmptyStateWelcome &&
    !isLoadingHistory &&
    hasLoadedHistory &&
    isConfigLoaded &&
    !hasUserMessages &&
    !shouldShowBeaconIntake &&
    !loading &&
    !streamingContent &&
    starterPrompts.length > 0;

  const isHomeView =
    !isBeaconSpace &&
    !hasUserMessages &&
    hasLoadedHistory &&
    !isLoadingHistory &&
    isConfigLoaded &&
    !loading &&
    !streamingContent &&
    !shouldShowBeaconIntake &&
    !isPending;

  // Starters the space configured win; VidVerge's own are the fallback so the
  // first screen is never a bare input box.
  const homeStarters = starterPrompts.length > 0 ? starterPrompts : VIDVERGE_STARTERS;

  const firstAssistantMessage = visibleMessages.find((m) => m.role === 'assistant');
  const homeWelcomeText =
    typeof firstAssistantMessage?.content === 'string' && firstAssistantMessage.content.length <= 260
      ? firstAssistantMessage.content
      : '';

  const composerElement = (
    <>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          data-testid="input-file-attachment"
        />

        <div
          ref={dropZoneRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`rounded-2xl border transition-all overflow-hidden shadow-[0_18px_48px_rgba(0,0,0,0.32),0_1px_0_rgba(255,255,255,0.03)] focus-within:shadow-[0_22px_58px_rgba(0,0,0,0.4),0_0_0_3px_color-mix(in_srgb,var(--space-brand-primary-500)_10%,transparent)] ${
            isDraggingOver
              ? 'border-[var(--space-brand-primary-500)] bg-[var(--space-surface-accent-soft)]'
              : 'border-[var(--space-border-default)] bg-[var(--space-surface-card)]'
          }`}
        >
          {isDraggingOver && (
            <div className="flex items-center justify-center py-3 px-4 bg-[var(--space-surface-accent-soft)] border-b border-[var(--space-border-default)]">
              <FileImage className="w-4 h-4 text-[var(--space-text-brand)] mr-2" />
              <span className="text-sm text-[var(--space-text-brand)] font-medium">Drop files here</span>
            </div>
          )}

          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-2">
              {pendingAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="relative flex items-center gap-1 px-2 py-1 bg-[var(--space-surface-card)] rounded-lg text-xs border border-[var(--space-border-default)]"
                  data-testid={`attachment-preview-${attachment.id}`}
                >
                  {attachment.contentType.startsWith('image/') ? (
                    <FileImage className="w-3 h-3 text-[var(--space-text-brand)]" />
                  ) : (
                    <File className="w-3 h-3 text-[var(--space-text-muted)]" />
                  )}
                  <span className="max-w-[100px] truncate text-[var(--space-text-secondary)]">
                    {attachment.originalName}
                  </span>
                  <button
                    onClick={() => removeAttachment(attachment.id)}
                    className="ml-1 text-[var(--space-text-muted)] hover:text-[var(--space-semantic-danger)]"
                    data-testid={`button-remove-attachment-${attachment.id}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={composerPlaceholder}
            className="w-full border-0 bg-transparent px-4 py-3 text-sm focus:outline-none focus:ring-0 resize-none leading-5"
            rows={1}
            disabled={loading}
            data-testid="textarea-instruction"
          />

          <div className="flex items-center justify-between px-2 pb-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || isUploadingAttachment || pendingAttachments.length >= 5}
              className="h-8 w-8 flex items-center justify-center rounded-xl hover:bg-[var(--space-surface-muted)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              data-testid="button-attach-file"
              title="Attach files (images, PDFs)"
            >
              {isUploadingAttachment ? (
                <VergeLoader size={30} label="Uploading your file" />
              ) : (
                <Paperclip className="w-4 h-4 text-[var(--space-text-muted)]" />
              )}
            </button>

            <button
              onClick={loading ? abortStream : sendMessage}
              disabled={(!input.trim() && pendingAttachments.length === 0) && !loading}
              className={`h-8 w-8 flex items-center justify-center rounded-xl transition-colors ${
                loading
                  ? 'bg-[var(--space-semantic-danger-500)] hover:bg-[var(--space-semantic-danger-600)] text-[var(--space-text-on-primary)]'
                  : `${tw.button.primary} disabled:opacity-50 disabled:cursor-not-allowed`
              }`}
              data-testid="button-send-message"
            >
              {loading ? <XCircle className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
    </>
  );

  return (
    <div
      className={`h-full flex flex-col ${
        isBeaconSpace
          ? 'bg-gradient-to-br from-[var(--space-surface-gradient-from)] via-[var(--space-surface-gradient-via)] to-[var(--space-surface-gradient-to)]'
          : 'bg-[radial-gradient(ellipse_72%_42%_at_50%_-8%,color-mix(in_srgb,var(--space-brand-primary-500)_12%,transparent),transparent_64%),var(--space-surface-bg)]'
      }`}
    >
      {isHomeView ? (
        /* Home view — centered greeting + composer, like a fresh assistant session */
        <div className="flex-1 overflow-y-auto flex flex-col justify-center">
          <div className="mx-auto w-full max-w-2xl px-6 sm:px-10 py-10" data-testid="home-view">
            <div className="text-center mb-7">
              <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.28em] text-[var(--space-text-brand)]">AI video production suite</p>
              <div className="mb-4 flex justify-center">
                <BrandLogo size={176} />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--space-text-primary)] sm:text-[28px]">
                What are we bringing to screen?
              </h1>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[var(--space-text-secondary)]">
                {leadSentence(homeWelcomeText || VIDVERGE_HOME_WELCOME, VIDVERGE_HOME_LEAD)}
              </p>
            </div>
            {composerElement}
            {homeStarters.length > 0 && (
              <div className="mt-7">
                <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--space-text-muted)]">
                  Choose a production brief
                </p>
                <StarterGrid
                  prompts={homeStarters}
                  onPick={(prompt) => { void sendMessageWithContent(prompt, []); }}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
      <>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-3xl px-6 sm:px-10 py-6 space-y-4">
        {/* Pending-init placeholder so the user never sees a blank chat */}
        {showPendingPlaceholder && (
          <div className="flex justify-start mr-8">
            <div className="px-4 py-2">
              <VergeLoader size={96} caption="Getting ready" />
            </div>
          </div>
        )}

        {!isLoadingHistory && hasLoadedHistory && shouldShowBeaconIntake && beaconIntake && (
          <div className="px-4">
            <div className="mx-auto max-w-2xl overflow-hidden rounded-3xl border border-[var(--space-semantic-success-100)] bg-[var(--space-surface-card)] shadow-sm">
              <div className="border-b border-[var(--space-semantic-success-100)] bg-gradient-to-r from-[var(--space-semantic-success-50)] via-[var(--space-surface-card)] to-[var(--space-surface-accent-soft)] px-6 py-5">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--space-semantic-success-700)]">
                  Your Beacon starting point
                </p>
                <h2 className="mt-2 text-xl font-semibold text-[var(--space-text-primary)]">
                  {beaconIntake.headline}
                </h2>
                <p className="mt-2 text-sm leading-6 text-[var(--space-text-secondary)]">{beaconIntake.reflection}</p>
              </div>

              <div className="space-y-5 px-6 py-5">
                <div className="rounded-2xl border border-[var(--space-semantic-success-100)] bg-[var(--space-semantic-success-50)] px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--space-semantic-success-700)]">
                    Today's anchor
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--space-text-secondary)]">{beaconIntake.anchor}</p>
                </div>

                <div>
                  <p className="text-sm font-semibold text-[var(--space-text-primary)]">Good next steps</p>
                  <div className="mt-3 space-y-2">
                    {beaconIntake.nextSteps.map((step) => (
                      <div
                        key={step}
                        className="flex items-start gap-3 rounded-2xl bg-[var(--space-surface-muted)] px-4 py-3 text-sm text-[var(--space-text-secondary)]"
                      >
                        <div className="mt-0.5 h-2 w-2 rounded-full bg-[var(--space-semantic-success-600)]" />
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-semibold text-[var(--space-text-primary)]">Continue from here</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {beaconIntake.starterPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => {
                          void sendMessageWithContent(prompt, []);
                        }}
                        className="rounded-full border border-[var(--space-semantic-success-100)] bg-[var(--space-surface-card)] px-4 py-2 text-sm font-medium text-[var(--space-semantic-success-700)] shadow-sm transition hover:border-[var(--space-semantic-success-500)] hover:bg-[var(--space-semantic-success-50)]"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Welcome message - only shown when confirmed no history exists */}
        {showEmptyStateWelcome ? (
          <div className="mt-8 px-4">
            {isBeaconSpace ? (
              <div className="mx-auto max-w-xl rounded-3xl border border-[var(--space-semantic-success-100)] bg-gradient-to-b from-[var(--space-semantic-success-50)] via-[var(--space-surface-card)] to-[var(--space-surface-card)] px-6 py-8 text-center shadow-sm">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--space-semantic-success-700)] text-[var(--space-text-on-primary)] shadow-sm">
                  <Bot className="h-6 w-6" />
                </div>
                <h2 className="text-xl font-semibold text-[var(--space-text-primary)]">Start with the hard part</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--space-text-secondary)]">
                  Tell Beacon what happened, what conversation you are dreading, or what you need help saying next.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {beaconStarterPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => {
                        void sendMessageWithContent(prompt, []);
                      }}
                      className="rounded-full border border-[var(--space-semantic-success-100)] bg-[var(--space-surface-card)] px-4 py-2 text-sm font-medium text-[var(--space-semantic-success-700)] shadow-sm transition hover:border-[var(--space-semantic-success-500)] hover:bg-[var(--space-semantic-success-50)]"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-2xl text-center text-[var(--space-text-secondary)]">
                <div className="mb-4 flex justify-center"><BrandLogo size={148} /></div>
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--space-text-brand)]">VidVerge Director</p>
                <h2 className="text-xl font-semibold text-[var(--space-text-primary)]">What are we bringing to screen?</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6">Bring a product URL, a script, raw footage or a rough idea. I’ll route the brief and help direct it to a publish-ready video.</p>
                {homeStarters.length > 0 && (
                  <div className="mt-6 text-left">
                    <StarterGrid
                      prompts={homeStarters}
                      onPick={(prompt) => { void sendMessageWithContent(prompt, []); }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          visibleMessages.length > 0 &&
          visibleMessages.map((msg, idx) => (
            <div key={idx}>
              <div
                className={`p-3 rounded-lg overflow-hidden min-w-0 ${
                  msg.role === 'user' ? `${tw.message.user} ml-8` : `${tw.message.assistant} mr-8`
                }`}
              >
                <p className="text-sm font-medium mb-1">
                  {isBeaconSpace
                    ? msg.role === 'assistant'
                      ? 'Beacon'
                      : 'You'
                    : msg.role.charAt(0).toUpperCase() + msg.role.slice(1)}
                </p>

                {msg.role === 'user' && msg.attachments && msg.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {msg.attachments.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center gap-1 px-2 py-1 bg-[var(--space-surface-card)] rounded text-xs"
                      >
                        {att.contentType.startsWith('image/') ? (
                          <FileImage className="w-3 h-3 text-[var(--space-text-brand)]" />
                        ) : (
                          <File className="w-3 h-3 text-[var(--space-text-muted)]" />
                        )}
                        <span className="max-w-[100px] truncate">{att.originalName}</span>
                      </div>
                    ))}
                  </div>
                )}

                {typeof msg.content === 'string' || msg.content == null ? (
                  <div
                    className={`prose prose-base max-w-none ${
                      msg.role === 'user' ? 'text-base' : 'text-base'
                    }`}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                      urlTransform={markdownUrlTransform}
                    >
                      {typeof msg.content === 'string' ? msg.content : ''}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(Array.isArray(msg.content) ? msg.content : []).map((chunk, chunkIdx) => (
                      <div key={chunkIdx}>
                        {chunk.type === 'text' && chunk.text && (
                          <div className="prose prose-base max-w-none text-base">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={markdownComponents}
                              urlTransform={markdownUrlTransform}
                            >
                              {chunk.text}
                            </ReactMarkdown>
                          </div>
                        )}
                        {chunk.type === 'tool_use' && (
                          <div className="border border-[var(--space-border-strong)] rounded-lg overflow-hidden mt-2">
                            <div className="bg-[var(--space-surface-muted)] px-3 py-2 flex items-center gap-2 flex-wrap">
                              {chunk.name === 'edit_file' ? (
                                <Edit3 className="w-3.5 h-3.5 text-[var(--space-text-brand)]" />
                              ) : chunk.name === 'read_file' ? (
                                <BookOpen className="w-3.5 h-3.5 text-[var(--space-text-brand)]" />
                              ) : chunk.name === 'write_file' ? (
                                <Save className="w-3.5 h-3.5 text-[var(--space-semantic-success)]" />
                              ) : (
                                <Sparkles className="w-3.5 h-3.5 text-[var(--space-text-secondary)]" />
                              )}
                              <span className="text-xs font-semibold text-[var(--space-text-secondary)]">
                                {chunk.name === 'read_file'
                                  ? 'Viewing'
                                  : chunk.name === 'write_file'
                                    ? 'Creating'
                                    : chunk.name === 'edit_file'
                                      ? 'Updating'
                                      : getFriendlyTerm(chunk.name || '', 'Tool Use')}
                              </span>
                              {chunk.input?.file_path && (
                                <span className="font-mono text-xs text-[var(--space-text-secondary)] break-all">
                                  {chunk.input.file_path}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {showStarterPromptsBelowWelcome && (
          <div className="px-4 -mt-1">
            <p className="mb-2 text-xs font-medium text-[var(--space-text-muted)]">
              Try one of these to get started:
            </p>
            <StarterGrid
              prompts={starterPrompts}
              onPick={(prompt) => { void sendMessageWithContent(prompt, []); }}
            />
          </div>
        )}

        {loading && !streamingContent && (
          <WorkingIndicator lastAction={lastAction} agentLabel={agentLabel} thinkingText={thinkingText} />
        )}

        {streamingContent && (
          <div
            className={`${isBeaconSpace ? 'bg-[var(--space-surface-card)] border border-[var(--space-semantic-success-100)] shadow-sm' : 'bg-[var(--space-surface-panel)]'} mr-8 p-3 rounded-lg overflow-hidden min-w-0`}
          >
            <p className="text-sm font-medium mb-1">{agentLabel}</p>
            <div className="prose prose-base max-w-none text-base">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
                urlTransform={markdownUrlTransform}
              >
                {streamingContent}
              </ReactMarkdown>
              {isStreaming && (
                <span className="inline-block w-0.5 h-4 ml-1 bg-[var(--space-text-primary)] animate-pulse" />
              )}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area — floating composer, detached from the bottom edge */}
      <div className="px-4 sm:px-8 pb-5 pt-2">
        <div className="mx-auto w-full max-w-3xl">
        {composerElement}

        <p className="text-[10px] text-[var(--space-text-muted)] mt-1.5 text-center leading-tight">
          {shortcutPrefix}+Enter to send
        </p>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
