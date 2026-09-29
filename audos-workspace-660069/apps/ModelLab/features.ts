export type TabId =
  | 'text'
  | 'creative'
  | 'code'
  | 'analysis'
  | 'business'
  | 'data'
  | 'prompting'
  | 'compare'
  // Media tabs. These are NOT feature grids — they render MediaStudio, which
  // has its own model catalogue in mediaModels.ts, so no Feature entries here
  // carry these ids.
  | 'images'
  | 'videos'
  // Runway provider section. Like the media tabs this is NOT a feature grid —
  // it renders RunwayLab, which reads the live Runway capabilities endpoint.
  | 'runway';

/** Tabs that render the media studio instead of the text-feature grid. */
export const MEDIA_TABS: TabId[] = ['images', 'videos'];

export function isMediaTab(tab: TabId): tab is 'images' | 'videos' {
  return MEDIA_TABS.indexOf(tab) >= 0;
}

export interface TabDef {
  id: TabId;
  label: string;
  icon: string;
}

export const TABS: TabDef[] = [
  { id: 'text', label: 'Text', icon: '✍️' },
  { id: 'creative', label: 'Creative', icon: '🎨' },
  { id: 'code', label: 'Code', icon: '💻' },
  { id: 'analysis', label: 'Analysis', icon: '🔍' },
  { id: 'business', label: 'Business', icon: '💼' },
  { id: 'data', label: 'Data', icon: '📊' },
  { id: 'prompting', label: 'Prompting', icon: '🎯' },
  { id: 'compare', label: 'Compare', icon: '⚖️' },
  { id: 'images', label: 'Images', icon: '🖼️' },
  { id: 'videos', label: 'Videos', icon: '🎬' },
  { id: 'runway', label: 'Runway', icon: '🎞️' },
];

export interface ModelDef {
  key: string;
  label: string;
  badge: string;
  color: string;
  provider: 'openai' | 'anthropic';
}

export const MODELS: ModelDef[] = [
  { key: 'gpt-5.6-terra', label: 'GPT Terra', badge: 'Balanced', color: '#10b981', provider: 'openai' },
  { key: 'gpt-5.6-sol', label: 'GPT Sol', badge: 'Frontier', color: '#f59e0b', provider: 'openai' },
  { key: 'gpt-5.6-luna', label: 'GPT Luna', badge: 'Fast', color: '#3b82f6', provider: 'openai' },
  { key: 'claude-sonnet-5', label: 'Sonnet 5', badge: 'Balanced', color: '#8b5cf6', provider: 'anthropic' },
  { key: 'claude-opus-5', label: 'Opus 5', badge: 'Frontier', color: '#ec4899', provider: 'anthropic' },
];

export interface ExtraField {
  label: string;
  type: 'select' | 'text';
  options?: string[];
  placeholder?: string;
  defaultValue?: string;
}

export type SpecialMode = 'speed' | 'consistency' | 'creativity' | 'multiturn';

export interface Feature {
  id: number;
  tab: TabId;
  title: string;
  description: string;
  inputPlaceholder: string;
  buildPrompt: (input: string, extra: string) => string;
  extraField?: ExtraField;
  code?: boolean;
  special?: SpecialMode;
  optionalInput?: boolean;
}

export const BENCH_PROMPT =
  'Explain how photosynthesis works in about 150 words, covering light absorption, the role of chlorophyll, the conversion of carbon dioxide and water, and the outputs of the process.';

function F(
  id: number,
  tab: TabId,
  title: string,
  description: string,
  inputPlaceholder: string,
  buildPrompt: (input: string, extra: string) => string,
  opts: Partial<Feature> = {},
): Feature {
  return { id, tab, title, description, inputPlaceholder, buildPrompt, ...opts };
}

export const FEATURES: Feature[] = [
  // ─────────── TAB 1 · TEXT (1–15) ───────────
  F(1, 'text', 'Chat / Q&A', 'Ask anything, get a direct answer.', 'Ask any question…',
    (i) => `You are a helpful assistant. Answer concisely and accurately.\n\n${i}`),
  F(2, 'text', 'Summarize', 'Condense text into key points.', 'Paste the text to summarize…',
    (i) => `Summarize the following text into 3–5 bullet points:\n\n${i}`),
  F(3, 'text', 'Translate', 'Translate to a target language.', 'Paste the text to translate…',
    (i, x) => `Translate the following text to ${x || 'Spanish'}:\n\n${i}`,
    { extraField: { label: 'Target language', type: 'text', placeholder: 'e.g. Spanish', defaultValue: 'Spanish' } }),
  F(4, 'text', 'Expand', 'Make a short idea into a full paragraph.', 'Type a short idea…',
    (i) => `Expand the following idea into a well-developed paragraph:\n\n${i}`),
  F(5, 'text', 'Compress', 'Reduce long text to its essence.', 'Paste the long text…',
    (i) => `Compress the following text to under 50 words while preserving meaning:\n\n${i}`),
  F(6, 'text', 'Rewrite / Paraphrase', 'Same meaning, fresh wording.', 'Paste the text to rewrite…',
    (i) => `Rewrite the following text in fresh wording while preserving the meaning:\n\n${i}`),
  F(7, 'text', 'Fix Grammar', 'Correct grammar, spelling, punctuation.', 'Paste text with errors…',
    (i) => `Fix all grammar, spelling, and punctuation errors in the following text. Return only the corrected text:\n\n${i}`),
  F(8, 'text', 'Change Tone', 'Rewrite in a new tone.', 'Paste the text to re-tone…',
    (i, x) => `Rewrite the following text in a ${x || 'formal'} tone:\n\n${i}`,
    { extraField: { label: 'Tone', type: 'select', options: ['formal', 'casual', 'friendly', 'professional', 'persuasive', 'humorous'] } }),
  F(9, 'text', 'Write Email', 'Draft a professional email.', 'Describe the email you need — recipient, purpose, key points…',
    (i) => `Write a professional email based on this brief: ${i}. Include Subject line, greeting, body, and sign-off.`),
  F(10, 'text', 'Blog Post', 'Draft a full blog post.', 'What should the blog post be about?',
    (i) => `Write a blog post with title, intro, 3 subheadings with content, and conclusion based on: ${i}`),
  F(11, 'text', 'Product Description', 'Compelling product copy.', 'Describe the product…',
    (i) => `Write a compelling product description (150 words) for: ${i}`),
  F(12, 'text', 'Social Media Post', 'Punchy social copy.', 'What is the post about?',
    (i, x) => `Write a ${x || 'Twitter'} post about: ${i}`,
    { extraField: { label: 'Platform', type: 'select', options: ['Twitter', 'Instagram', 'LinkedIn'] } }),
  F(13, 'text', 'Press Release', 'Formal announcement copy.', 'What are you announcing?',
    (i) => `Write a press release for: ${i}. Include headline, dateline, body, boilerplate, and contact section.`),
  F(14, 'text', 'TLDR', 'One-line summary of anything.', 'Paste anything long…',
    (i) => `Give me a one-sentence TLDR of the following:\n\n${i}`),
  F(15, 'text', 'Extract Action Items', 'Pull out to-dos from text.', 'Paste meeting notes, an email thread, anything…',
    (i) => `Extract all action items from the following text as a numbered list:\n\n${i}`),

  // ─────────── TAB 2 · CREATIVE (16–30) ───────────
  F(16, 'creative', 'Creative Story', 'Short fiction from a prompt.', 'A story about…',
    (i) => `Write a 200-word creative short story based on: ${i}`),
  F(17, 'creative', 'Poem', 'A poem in any style.', 'What should the poem be about?',
    (i, x) => `Write a ${x || 'free verse'} poem about: ${i}`,
    { extraField: { label: 'Style', type: 'select', options: ['free verse', 'sonnet', 'haiku', 'limerick'] } }),
  F(18, 'creative', 'Song Lyrics', 'Verse and chorus.', 'What is the song about?',
    (i) => `Write song lyrics with a verse and chorus for a song about: ${i}`),
  F(19, 'creative', 'Screenplay Scene', 'Formatted scene.', 'Describe the scene…',
    (i) => `Write a short screenplay scene (INT/EXT format) based on: ${i}`),
  F(20, 'creative', 'Character Profile', 'Rich character sheet.', 'Describe the character concept…',
    (i) => `Create a detailed character profile (name, backstory, motivations, quirks, appearance) for: ${i}`),
  F(21, 'creative', 'World Building', 'Fictional world description.', 'Seed idea for the world…',
    (i) => `Describe a fictional world based on: ${i}. Include geography, culture, history, and magic/technology.`),
  F(22, 'creative', 'Plot Twist', 'Unexpected story turns.', 'What is the story about?',
    (i) => `Generate 5 creative plot twists for a story about: ${i}`),
  F(23, 'creative', 'Dialogue Writer', 'Natural conversation.', 'e.g. a detective and a nervous witness who used to be friends',
    (i) => `Write a short natural dialogue between ${i} (make the two characters and their relationship clear).`),
  F(24, 'creative', 'Metaphor Generator', 'Fresh metaphors.', 'A concept, feeling, or thing…',
    (i) => `Generate 5 original metaphors for: ${i}`),
  F(25, 'creative', 'Analogy Creator', 'Explain via comparison.', 'What needs explaining?',
    (i) => `Create 3 analogies to explain ${i} to someone unfamiliar with it.`),
  F(26, 'creative', 'Joke Writer', 'Original jokes.', 'Joke topic…',
    (i) => `Write 3 original jokes about: ${i}`),
  F(27, 'creative', 'Riddle Creator', 'Fun riddles.', 'The answer to the riddle…',
    (i) => `Create a riddle where the answer is: ${i}`),
  F(28, 'creative', 'Fantasy Name Generator', 'Names for characters and places.', 'e.g. wizard, kingdom, dragon',
    (i) => `Generate 10 fantasy names for a ${i}.`),
  F(29, 'creative', 'Haiku', '5-7-5 syllable poem.', 'Haiku subject…',
    (i) => `Write a haiku about: ${i}`),
  F(30, 'creative', 'Fairy Tale', 'Classic story structure.', 'Inspiration for the tale…',
    (i) => `Write a short fairy tale (once upon a time format) inspired by: ${i}`),

  // ─────────── TAB 3 · CODE (31–45) ───────────
  F(31, 'code', 'Generate Code', 'Describe it, get working code.', 'Describe what the code should do…',
    (i, x) => `Write ${x || 'Python'} code that ${i}. Include comments.`,
    { code: true, extraField: { label: 'Language', type: 'text', placeholder: 'e.g. Python', defaultValue: 'Python' } }),
  F(32, 'code', 'Explain Code', 'Plain-English explanation.', 'Paste the code to explain…',
    (i) => `Explain the following code in plain English, line by line:\n\n${i}`, { code: true }),
  F(33, 'code', 'Debug Code', 'Find and fix bugs.', 'Paste the buggy code…',
    (i) => `Find all bugs in the following code and return the fixed version with explanations:\n\n${i}`, { code: true }),
  F(34, 'code', 'Refactor Code', 'Cleaner, better-structured.', 'Paste the code to refactor…',
    (i) => `Refactor the following code for readability, performance, and best practices:\n\n${i}`, { code: true }),
  F(35, 'code', 'Code Review', 'Strengths, issues, suggestions.', 'Paste the code to review…',
    (i) => `Review the following code. List: strengths, issues, and specific improvement suggestions:\n\n${i}`, { code: true }),
  F(36, 'code', 'Unit Tests', 'Test suite generation.', 'Paste the code to test…',
    (i, x) => `Write unit tests for the following code using ${x || 'Jest'}:\n\n${i}`,
    { code: true, extraField: { label: 'Framework', type: 'select', options: ['Jest', 'Pytest', 'JUnit', 'Go testing'] } }),
  F(37, 'code', 'Documentation', 'JSDoc, docstring, or README.', 'Paste the code to document…',
    (i, x) => `Write ${x || 'JSDoc'} documentation for the following code:\n\n${i}`,
    { code: true, extraField: { label: 'Doc type', type: 'select', options: ['JSDoc', 'docstring', 'README section'] } }),
  F(38, 'code', 'Language Converter', 'Translate code between languages.', 'Paste the source code…',
    (i, x) => `Convert the following code to ${x || 'TypeScript'}, preserving logic:\n\n${i}`,
    { code: true, extraField: { label: 'Target language', type: 'text', placeholder: 'e.g. TypeScript', defaultValue: 'TypeScript' } }),
  F(39, 'code', 'SQL Query', 'Generate database queries.', 'Describe the query — tables, filters, output…',
    (i) => `Write a SQL query to: ${i}`, { code: true }),
  F(40, 'code', 'Regex Generator', 'Pattern matching expressions.', 'Describe what the pattern should match…',
    (i) => `Write a regex pattern that matches: ${i}. Explain each part.`, { code: true }),
  F(41, 'code', 'API Design', 'RESTful endpoint design.', 'Describe the service or resource…',
    (i) => `Design a RESTful API for: ${i}. List endpoints, methods, request/response schemas.`, { code: true }),
  F(42, 'code', 'Algorithm Design', 'Step-by-step algorithm.', 'Describe the problem to solve…',
    (i) => `Design an efficient algorithm to solve: ${i}. Include pseudocode and time complexity.`, { code: true }),
  F(43, 'code', 'Add Comments', 'Annotate existing code.', 'Paste the uncommented code…',
    (i) => `Add clear inline comments to the following code:\n\n${i}`, { code: true }),
  F(44, 'code', 'Optimize Performance', 'Speed and memory improvements.', 'Paste the slow code…',
    (i) => `Identify and fix performance bottlenecks in the following code:\n\n${i}`, { code: true }),
  F(45, 'code', 'Security Audit', 'Vulnerabilities and fixes.', 'Paste the code to audit…',
    (i) => `Audit the following code for security vulnerabilities. List each issue and how to fix it:\n\n${i}`, { code: true }),

  // ─────────── TAB 4 · ANALYSIS (46–60) ───────────
  F(46, 'analysis', 'Sentiment Analysis', 'Positive, negative, or neutral.', 'Paste the text to analyze…',
    (i) => `Analyze the sentiment of the following text. Return: overall sentiment (positive/negative/neutral), confidence %, and key phrases driving the sentiment:\n\n${i}`),
  F(47, 'analysis', 'Keyword Extraction', 'Top topics and terms.', 'Paste the text…',
    (i) => `Extract the top 10 keywords and key phrases from the following text, ranked by importance:\n\n${i}`),
  F(48, 'analysis', 'Named Entity Recognition', 'People, places, orgs.', 'Paste the text…',
    (i) => `Extract all named entities (people, organizations, locations, dates, products) from the following text and categorize them:\n\n${i}`),
  F(49, 'analysis', 'Topic Classification', 'What is this about?', 'Paste the text to classify…',
    (i) => `Classify the following text into up to 3 topic categories and explain why:\n\n${i}`),
  F(50, 'analysis', 'Fact Check', 'Assess factual claims.', 'Paste the text with claims…',
    (i) => `Identify the main factual claims in the following text and assess each as: likely true / uncertain / likely false, with reasoning:\n\n${i}`),
  F(51, 'analysis', 'Bias Detection', 'Identify slanted language.', 'Paste the text…',
    (i) => `Identify any bias, loaded language, or one-sided framing in the following text:\n\n${i}`),
  F(52, 'analysis', 'Readability Score', 'How easy is it to read?', 'Paste the text…',
    (i) => `Assess the readability of the following text. Estimate grade level, reading ease, and suggest improvements:\n\n${i}`),
  F(53, 'analysis', 'Tone Analysis', 'Formal, casual, aggressive…', 'Paste the text…',
    (i) => `Analyze the tone of the following text. Identify primary tone, secondary tones, and examples:\n\n${i}`),
  F(54, 'analysis', 'Intent Detection', 'What is the author trying to do?', 'Paste the text…',
    (i) => `Detect the primary intent behind the following text (inform, persuade, entertain, request, etc.) and explain:\n\n${i}`),
  F(55, 'analysis', 'Emotion Analysis', 'Emotions present in text.', 'Paste the text…',
    (i) => `Identify the emotions expressed in the following text. List each emotion with supporting quotes:\n\n${i}`),
  F(56, 'analysis', 'Language Detection', 'What language is this?', 'Paste text in any language…',
    (i) => `Detect the language of the following text. If mixed, identify all languages present and their approximate proportions:\n\n${i}`),
  F(57, 'analysis', 'Complexity Analysis', 'How complex is this?', 'Paste a text or describe a concept…',
    (i) => `Analyze the complexity of the following text or concept. Rate it 1–10 and explain:\n\n${i}`),
  F(58, 'analysis', 'Argument Strength', 'How convincing is this?', 'Paste the argumentative text…',
    (i) => `Evaluate the strength of the arguments in the following text. Rate each argument and explain its logical soundness:\n\n${i}`),
  F(59, 'analysis', 'Claim Extraction', 'Pull out assertions.', 'Paste the text…',
    (i) => `Extract all distinct claims made in the following text as a numbered list:\n\n${i}`),
  F(60, 'analysis', 'Evidence Mapping', 'Match claims to evidence.', 'Paste the text…',
    (i) => `Map each claim in the following text to the evidence provided for it. Note unsupported claims:\n\n${i}`),

  // ─────────── TAB 5 · BUSINESS (61–72) ───────────
  F(61, 'business', 'SWOT Analysis', 'Strengths, Weaknesses, Opportunities, Threats.', 'Company, product, or idea…',
    (i) => `Perform a SWOT analysis for: ${i}`),
  F(62, 'business', 'Business Plan Section', 'Draft any section.', 'Describe the business…',
    (i, x) => `Write a ${x || 'Executive Summary'} section for a business plan for: ${i}`,
    { extraField: { label: 'Section name', type: 'text', placeholder: 'e.g. Executive Summary', defaultValue: 'Executive Summary' } }),
  F(63, 'business', 'Value Proposition', 'Clear value statement.', 'Product or service…',
    (i) => `Write 3 distinct value propositions for: ${i}`),
  F(64, 'business', 'Target Audience', 'Customer profile.', 'Product or service…',
    (i) => `Define the ideal target audience for: ${i}. Include demographics, psychographics, pain points, and where to find them.`),
  F(65, 'business', 'Competitive Analysis', 'Market positioning.', 'Product, service, or market…',
    (i) => `Perform a competitive analysis framework for: ${i}. Suggest how to differentiate.`),
  F(66, 'business', 'Marketing Copy', 'Benefit-focused copy.', 'Describe the product…',
    (i, x) => `Write marketing copy for ${i} in a ${x || 'bold'} tone.`,
    { extraField: { label: 'Tone', type: 'select', options: ['bold', 'subtle', 'technical', 'emotional'] } }),
  F(67, 'business', 'Sales Script', 'Persuasive sales dialogue.', 'What are you selling?',
    (i) => `Write a 5-exchange sales conversation script for selling: ${i}`),
  F(68, 'business', 'Meeting Agenda', 'Structured meeting plan.', 'e.g. quarterly planning, sprint retro…',
    (i) => `Create a structured meeting agenda for a ${i} meeting. Include time slots.`),
  F(69, 'business', 'Job Description', 'Role posting.', 'Role title and context…',
    (i) => `Write a job description for: ${i}. Include responsibilities, requirements, and benefits.`),
  F(70, 'business', 'Cover Letter', 'Application letter.', 'Describe the candidate background…',
    (i, x) => `Write a cover letter for ${x || 'the role'} from a candidate with background: ${i}`,
    { extraField: { label: 'Role', type: 'text', placeholder: 'e.g. Senior Product Designer' } }),
  F(71, 'business', 'OKR Generator', 'Objectives and key results.', 'What is the company focused on?',
    (i) => `Generate 3 OKRs (Objective + 3 Key Results each) for a company focused on: ${i}`),
  F(72, 'business', 'KPI Suggestions', 'Measurable success metrics.', 'What needs measuring?',
    (i) => `Suggest 10 KPIs for measuring success of: ${i}. For each, describe what it measures and how to track it.`),

  // ─────────── TAB 6 · DATA (73–82) ───────────
  F(73, 'data', 'Generate JSON', 'Structured data.', 'Describe the object — e.g. a user profile with orders…',
    (i) => `Generate a JSON object representing: ${i}`, { code: true }),
  F(74, 'data', 'Generate CSV', 'Tabular data.', 'Describe the table — e.g. monthly sales by region…',
    (i) => `Generate a CSV with headers and 5 rows of sample data for: ${i}`, { code: true }),
  F(75, 'data', 'Create Outline', 'Hierarchical outline.', 'Topic to outline…',
    (i) => `Create a detailed hierarchical outline for: ${i}`),
  F(76, 'data', 'Build Checklist', 'Step-by-step list.', 'e.g. launching a product, moving house…',
    (i) => `Create a comprehensive checklist for: ${i}`),
  F(77, 'data', 'Survey Questions', 'Research questions.', 'What do you want to measure?',
    (i) => `Generate 10 survey questions to measure: ${i}. Include a mix of question types.`),
  F(78, 'data', 'Schema Design', 'Database and data model.', 'Describe the application or domain…',
    (i) => `Design a database schema for: ${i}. List tables, fields, types, and relationships.`, { code: true }),
  F(79, 'data', 'Timeline', 'Chronological plan.', 'Project or goal…',
    (i) => `Create a detailed timeline for: ${i}. Include milestones and dependencies.`),
  F(80, 'data', 'Mind Map', 'Text-based mind map.', 'Central topic…',
    (i) => `Create a text-based mind map structure for the topic: ${i}. Use indentation to show hierarchy.`, { code: true }),
  F(81, 'data', 'Decision Matrix', 'Weighted options.', 'What decision are you making?',
    (i) => `Create a decision matrix to evaluate options for: ${i}. Suggest criteria and scoring.`),
  F(82, 'data', 'Process Flow', 'Step-by-step process.', 'What process should be mapped?',
    (i) => `Map out the complete process flow for: ${i}. Include decision points.`),

  // ─────────── TAB 7 · PROMPTING (83–90) ───────────
  F(83, 'prompting', 'Improve My Prompt', 'Better prompt engineering.', 'Paste the prompt to improve…',
    (i) => `Improve the following AI prompt to be clearer, more specific, and more likely to get a great result: ${i}`),
  F(84, 'prompting', 'Chain of Thought', 'Step-by-step reasoning prompt.', 'Paste the prompt to convert…',
    (i) => `Rewrite the following as a chain-of-thought prompt that asks the model to reason step by step: ${i}`),
  F(85, 'prompting', 'Few-Shot Examples', 'Add examples to a prompt.', 'Paste the prompt…',
    (i) => `Add 3 few-shot examples to this prompt to guide the model: ${i}`),
  F(86, 'prompting', 'System Prompt Builder', 'Persona and role prompt.', 'Describe what the assistant should do…',
    (i) => `Write a system prompt for an AI assistant that: ${i}`),
  F(87, 'prompting', 'Prompt Compressor', 'Shorter, same meaning.', 'Paste the long prompt…',
    (i) => `Compress the following prompt to be as short as possible while preserving intent: ${i}`),
  F(88, 'prompting', 'Style Transfer', 'Write like X.', 'Paste the text to restyle…',
    (i, x) => `Rewrite the following in the style of ${x || 'Hemingway'}: ${i}`,
    { extraField: { label: 'Target style', type: 'text', placeholder: 'e.g. Hemingway, Twitter, academic, legal', defaultValue: 'Hemingway' } }),
  F(89, 'prompting', 'Role-Play Setup', 'Scenario for the model.', 'Describe the scenario…',
    (i) => `Create a detailed role-play scenario prompt for an AI based on: ${i}`),
  F(90, 'prompting', 'Constraint Writer', 'Add creative constraints.', 'Paste the text AND list the constraints to apply…',
    (i) => `Rewrite the following with these creative constraints: ${i}`),

  // ─────────── TAB 8 · COMPARE (91–100) ───────────
  F(91, 'compare', 'Side-by-Side Chat', 'Same question, all models answer at once.', 'Ask any question…',
    (i) => i),
  F(92, 'compare', 'Speed Benchmark', 'Race all models — live leaderboard of response times.', 'Optional: custom benchmark prompt (leave empty for the standard one)…',
    (i) => (i.trim() ? i : BENCH_PROMPT), { special: 'speed', optionalInput: true }),
  F(93, 'compare', 'Token Counter', 'Approximate token counts per model for the same prompt.', 'Enter any prompt…',
    (i) => i),
  F(94, 'compare', 'Consistency Test', 'Same prompt, two runs per model — differences highlighted.', 'Enter a prompt to run twice…',
    (i) => i, { special: 'consistency' }),
  F(95, 'compare', 'Creativity Score', 'Each model rates the others’ creative output 1–10.', 'A creative topic — e.g. a city where it rains music…',
    (i) => `Write a short, highly creative piece (under 120 words) about: ${i}`, { special: 'creativity' }),
  F(96, 'compare', 'Multi-turn Conversation', 'A 3-message conversation — do models keep context?', 'Start the conversation — e.g. help me plan a product launch…',
    (i) => i, { special: 'multiturn' }),
  F(97, 'compare', 'Context Length Test', 'Long context handling.', 'Paste a long text, then add your question about it at the end…',
    (i) => `Read the following long text carefully, then answer the question at the end accurately, citing specifics from the text:\n\n${i}`),
  F(98, 'compare', 'Instruction Following', 'Five precise rules — who complies?', 'A topic to write about…',
    (i) => `Write about the following topic while following ALL five of these rules exactly: (1) under 100 words, (2) no adjectives, (3) start with a verb, (4) mention a color, (5) end with a question.\n\nTopic: ${i}`),
  F(99, 'compare', 'Factual Accuracy', 'Knowledge test with a known answer.', 'Ask a factual question you know the answer to…',
    (i) => `Answer the following factual question as accurately and precisely as possible. State the answer first, then give one sentence of context:\n\n${i}`),
  F(100, 'compare', 'Style Consistency', 'One style guide, three outputs — does the style hold?', 'A subject — e.g. an espresso machine…',
    (i) => `Style guide — follow these 3 rules in every output: (1) short punchy sentences under 10 words each, (2) always address the reader as "you", (3) end every piece with an em-dash cliffhanger. Now write 3 separate outputs in that exact style, labeled Output 1, Output 2, and Output 3: (a) a product teaser about ${i}, (b) a motivational note about ${i}, (c) a warning about ${i}.`),
];
