// tsx-scan — reading generated source without running it.
//
// The compile gate has to answer three questions about a file the model just
// wrote: is it structurally whole, which components does it mount, and with
// what props. Running the code to find out is not an option (that is the
// render we are trying not to pay for) and neither is eval'ing its
// expressions inside this page.
//
// So this is a scanner, not a compiler. It walks the text once with a small
// state machine that understands strings, template literals, comments and
// regex literals — enough to never mistake a bracket inside a string for
// structure — and reports what it found. Anything it cannot read for certain
// it reports as unreadable rather than guessing.

export type AttrKind = 'string' | 'expression' | 'shorthand';

export interface JsxAttr {
  name: string;
  kind: AttrKind;
  /** The literal text between the quotes, or inside the braces. */
  raw: string;
  line: number;
}

export interface JsxElement {
  name: string;
  attrs: JsxAttr[];
  selfClosing: boolean;
  line: number;
}

export interface ScanResult {
  elements: JsxElement[];
  /** Structural problems: unbalanced brackets, unterminated strings, stray tags. */
  errors: string[];
  /** Every import specifier the file declares. */
  imports: string[];
  /** Every string passed to resolveAsset(...). */
  assetHandles: string[];
  /** Every <Sequence> from / durationInFrames pair that could be read. */
  sequences: Array<{ from: number | null; durationInFrames: number | null; line: number }>;
}

/** Words a JSX element may legitimately follow. Anything else is a generic. */
const JSX_PRECEDING_KEYWORDS = [
  'return', 'case', 'yield', 'else', 'do', 'await', 'default', 'typeof', 'in', 'of',
];

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$.]/;
const ATTR_PART = /[A-Za-z0-9_:-]/;

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';
}

class Scanner {
  readonly code: string;

  index = 0;

  line = 1;

  errors: string[] = [];

  constructor(code: string) {
    this.code = code;
  }

  at(offset = 0): string {
    return this.code.charAt(this.index + offset);
  }

  advance(count = 1): void {
    for (let i = 0; i < count; i += 1) {
      if (this.code.charAt(this.index) === '\n') this.line += 1;
      this.index += 1;
    }
  }

  eof(): boolean {
    return this.index >= this.code.length;
  }

  skipSpace(): void {
    while (!this.eof() && isSpace(this.at())) this.advance();
  }

  /** Consume a quoted string and return its contents, honouring escapes. */
  readQuoted(): string {
    const quote = this.at();
    const startLine = this.line;
    this.advance();
    let out = '';
    while (!this.eof()) {
      const ch = this.at();
      if (ch === '\\') { out += this.at(1); this.advance(2); continue; }
      if (ch === quote) { this.advance(); return out; }
      out += ch;
      this.advance();
    }
    this.errors.push('Line ' + String(startLine) + ': a string is never closed.');
    return out;
  }

  /** Consume a template literal, including nested dollar-brace expressions. */
  readTemplate(): void {
    const startLine = this.line;
    this.advance();
    while (!this.eof()) {
      const ch = this.at();
      if (ch === '\\') { this.advance(2); continue; }
      if (ch === '`') { this.advance(); return; }
      if (ch === '$' && this.at(1) === '{') {
        this.advance(2);
        this.readBalanced('{', '}', 1);
        continue;
      }
      this.advance();
    }
    this.errors.push('Line ' + String(startLine) + ': a template literal is never closed.');
  }

  skipComment(): boolean {
    if (this.at() === '/' && this.at(1) === '/') {
      while (!this.eof() && this.at() !== '\n') this.advance();
      return true;
    }
    if (this.at() === '/' && this.at(1) === '*') {
      const startLine = this.line;
      this.advance(2);
      while (!this.eof() && !(this.at() === '*' && this.at(1) === '/')) this.advance();
      if (this.eof()) {
        this.errors.push('Line ' + String(startLine) + ': a block comment is never closed.');
        return true;
      }
      this.advance(2);
      return true;
    }
    return false;
  }

  /**
   * Consume up to and including the closer that matches an opener already
   * consumed, and return the text in between. Depth starts at 1.
   */
  readBalanced(open: string, close: string, startDepth: number): string {
    const startLine = this.line;
    const begin = this.index;
    let depth = startDepth;
    while (!this.eof()) {
      if (this.skipComment()) continue;
      const ch = this.at();
      if (ch === '"' || ch === "'") { this.readQuoted(); continue; }
      if (ch === '`') { this.readTemplate(); continue; }
      if (ch === open) { depth += 1; this.advance(); continue; }
      if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          const text = this.code.slice(begin, this.index);
          this.advance();
          return text;
        }
        this.advance();
        continue;
      }
      this.advance();
    }
    this.errors.push('Line ' + String(startLine) + ': a "' + open + '" is never closed.');
    return this.code.slice(begin);
  }

  readIdentifier(pattern: RegExp): string {
    let out = '';
    while (!this.eof() && pattern.test(this.at())) {
      out += this.at();
      this.advance();
    }
    return out;
  }
}

/**
 * Scan a TSX file.
 *
 * Only ELEMENT tags are collected — a tag whose name starts with a capital
 * letter. Lowercase intrinsics (div, span) are structurally tracked but not
 * reported, because the SDK contract has nothing to say about them.
 */
export function scanTsx(code: string): ScanResult {
  const scanner = new Scanner(String(code || ''));
  const elements: JsxElement[] = [];
  const imports: string[] = [];
  const assetHandles: string[] = [];
  const sequences: ScanResult['sequences'] = [];
  const openTags: Array<{ name: string; line: number }> = [];

  // Bracket depth outside strings, comments and JSX attribute expressions.
  // A model answer that was cut off mid-file almost always lands here: the
  // braces do not come back to zero, and that is cheaper to find now than
  // after a render.
  const depth = { curly: 0, paren: 0, square: 0 };

  while (!scanner.eof()) {
    if (scanner.skipComment()) continue;

    const ch = scanner.at();

    if (ch === '"' || ch === "'") { scanner.readQuoted(); continue; }
    if (ch === '`') { scanner.readTemplate(); continue; }

    // import ... from 'x'  /  import 'x'
    if (ch === 'i' && scanner.code.startsWith('import', scanner.index)
      && !IDENT_PART.test(scanner.code.charAt(scanner.index - 1) || ' ')) {
      const lineEnd = scanner.code.indexOf('\n', scanner.index);
      const statement = scanner.code.slice(scanner.index, lineEnd < 0 ? undefined : lineEnd);
      const quote = statement.match(/from\s+['"]([^'"]+)['"]/) || statement.match(/^import\s+['"]([^'"]+)['"]/);
      if (quote) imports.push(quote[1]);
    }

    // resolveAsset('handle')
    if (ch === 'r' && scanner.code.startsWith('resolveAsset(', scanner.index)) {
      const match = scanner.code.slice(scanner.index).match(/^resolveAsset\(\s*['"]([^'"]*)['"]\s*\)/);
      if (match) assetHandles.push(match[1]);
      else assetHandles.push('');   // a non-literal argument, which the gate rejects
    }

    if (ch === '{') depth.curly += 1;
    if (ch === '}') depth.curly -= 1;
    if (ch === '(') depth.paren += 1;
    if (ch === ')') depth.paren -= 1;
    if (ch === '[') depth.square += 1;
    if (ch === ']') depth.square -= 1;

    if (ch !== '<') { scanner.advance(); continue; }

    // Closing tag
    if (scanner.at(1) === '/') {
      const line = scanner.line;
      scanner.advance(2);
      const name = scanner.readIdentifier(IDENT_PART);
      scanner.skipSpace();
      if (scanner.at() === '>') scanner.advance();
      const last = openTags.pop();
      if (!last) {
        scanner.errors.push('Line ' + String(line) + ': closing tag </' + name + '> has no opening tag.');
      } else if (last.name !== name) {
        scanner.errors.push('Line ' + String(line) + ': <' + last.name + '> opened on line '
          + String(last.line) + ' is closed by </' + name + '>.');
      }
      continue;
    }

    // Fragment <> ... </>
    if (scanner.at(1) === '>') { scanner.advance(2); openTags.push({ name: '', line: scanner.line }); continue; }

    if (!IDENT_START.test(scanner.at(1))) { scanner.advance(); continue; }

    // React.FC<Props> and useState<string> are type-argument lists, not tags.
    // Both start with a capital letter, so they are told apart by what sits in
    // front of the angle bracket: a tag never follows an IDENTIFIER, but it
    // very often follows a keyword, as in `return <Stage>`.
    let back = scanner.index - 1;
    while (back >= 0 && isSpace(scanner.code.charAt(back))) back -= 1;
    const before = back >= 0 ? scanner.code.charAt(back) : '';
    if (before && /[A-Za-z0-9_$.]/.test(before)) {
      let wordStart = back;
      while (wordStart >= 0 && /[A-Za-z0-9_$]/.test(scanner.code.charAt(wordStart))) wordStart -= 1;
      const word = scanner.code.slice(wordStart + 1, back + 1);
      if (JSX_PRECEDING_KEYWORDS.indexOf(word) < 0) { scanner.advance(); continue; }
    }

    const line = scanner.line;
    scanner.advance();
    const name = scanner.readIdentifier(IDENT_PART);
    const attrs: JsxAttr[] = [];
    let selfClosing = false;
    let closed = false;

    while (!scanner.eof()) {
      scanner.skipSpace();
      if (scanner.at() === '/' && scanner.at(1) === '>') {
        selfClosing = true;
        closed = true;
        scanner.advance(2);
        break;
      }
      if (scanner.at() === '>') { closed = true; scanner.advance(); break; }

      if (scanner.at() === '{') {
        // A spread, which the house rules forbid; recorded so the gate can say so.
        scanner.advance();
        const spread = scanner.readBalanced('{', '}', 1);
        attrs.push({ name: '...', kind: 'expression', raw: spread.trim(), line: scanner.line });
        continue;
      }

      if (!ATTR_PART.test(scanner.at())) {
        scanner.errors.push('Line ' + String(scanner.line) + ': <' + name
          + '> has something unreadable where an attribute should be.');
        scanner.advance();
        continue;
      }

      const attrLine = scanner.line;
      const attrName = scanner.readIdentifier(ATTR_PART);
      scanner.skipSpace();
      if (scanner.at() !== '=') {
        attrs.push({ name: attrName, kind: 'shorthand', raw: 'true', line: attrLine });
        continue;
      }
      scanner.advance();
      scanner.skipSpace();

      if (scanner.at() === '"' || scanner.at() === "'") {
        attrs.push({ name: attrName, kind: 'string', raw: scanner.readQuoted(), line: attrLine });
        continue;
      }
      if (scanner.at() === '{') {
        scanner.advance();
        const expression = scanner.readBalanced('{', '}', 1);
        attrs.push({ name: attrName, kind: 'expression', raw: expression.trim(), line: attrLine });
        const inner = expression.match(/resolveAsset\(\s*['"]([^'"]*)['"]\s*\)/g);
        if (inner) {
          for (const call of inner) {
            const handle = call.match(/['"]([^'"]*)['"]/);
            if (handle) assetHandles.push(handle[1]);
          }
        }
        continue;
      }
      scanner.errors.push('Line ' + String(attrLine) + ': ' + name + '.' + attrName
        + ' has no value. Write it as ' + attrName + '="text" or ' + attrName + '={expression}.');
    }

    if (!closed) {
      scanner.errors.push('Line ' + String(line) + ': <' + name + '> is never closed with > or />.');
      break;
    }

    const isComponent = /^[A-Z]/.test(name);
    if (isComponent) elements.push({ name, attrs, selfClosing, line });
    if (!selfClosing) openTags.push({ name, line });

    if (name === 'Sequence') {
      const read = (attrName: string): number | null => {
        const attr = attrs.find((entry) => entry.name === attrName);
        if (!attr) return null;
        const value = Number(attr.raw);
        return isFinite(value) ? value : null;
      };
      sequences.push({ from: read('from'), durationInFrames: read('durationInFrames'), line });
    }
  }

  for (const open of openTags) {
    scanner.errors.push('Line ' + String(open.line) + ': <' + (open.name || 'fragment')
      + '> is opened and never closed.');
  }

  const unbalanced: Array<[string, number, string, string]> = [
    ['curly', depth.curly, '{', '}'],
    ['paren', depth.paren, '(', ')'],
    ['square', depth.square, '[', ']'],
  ];
  for (const [, count, open, close] of unbalanced) {
    if (count > 0) {
      scanner.errors.push('The file ends with ' + String(count) + ' unclosed "' + open
        + '". It looks truncated — send the whole file.');
    } else if (count < 0) {
      scanner.errors.push('The file has ' + String(-count) + ' more "' + close
        + '" than it opens.');
    }
  }

  return { elements, errors: scanner.errors, imports, assetHandles, sequences };
}

// ---------------------------------------------------------------------------
// Literal parsing
// ---------------------------------------------------------------------------

export interface LiteralResult {
  ok: boolean;
  value: unknown;
}

const UNREADABLE: LiteralResult = { ok: false, value: undefined };

/**
 * Parse a JavaScript literal expression — number, string, boolean, null,
 * array or object with bare or quoted keys.
 *
 * Deliberately NOT eval: the input is model-written source, and the whole
 * point of the gate is to inspect it without executing it. Anything beyond a
 * literal (a call, an identifier, arithmetic) comes back ok:false, and the
 * caller treats that prop as present but unreadable.
 */
export function parseLiteral(expression: string): LiteralResult {
  const text = String(expression || '').trim();
  if (!text) return UNREADABLE;

  let cursor = 0;

  const skip = (): void => {
    while (cursor < text.length && isSpace(text.charAt(cursor))) cursor += 1;
  };

  const parseValue = (): LiteralResult => {
    skip();
    const ch = text.charAt(cursor);
    if (!ch) return UNREADABLE;

    if (ch === '"' || ch === "'") {
      cursor += 1;
      let out = '';
      while (cursor < text.length) {
        const current = text.charAt(cursor);
        if (current === '\\') { out += text.charAt(cursor + 1); cursor += 2; continue; }
        if (current === ch) { cursor += 1; return { ok: true, value: out }; }
        out += current;
        cursor += 1;
      }
      return UNREADABLE;
    }

    if (ch === '[') {
      cursor += 1;
      const items: unknown[] = [];
      for (;;) {
        skip();
        if (text.charAt(cursor) === ']') { cursor += 1; return { ok: true, value: items }; }
        const item = parseValue();
        if (!item.ok) return UNREADABLE;
        items.push(item.value);
        skip();
        if (text.charAt(cursor) === ',') { cursor += 1; continue; }
        if (text.charAt(cursor) === ']') { cursor += 1; return { ok: true, value: items }; }
        return UNREADABLE;
      }
    }

    if (ch === '{') {
      cursor += 1;
      const out: Record<string, unknown> = {};
      for (;;) {
        skip();
        if (text.charAt(cursor) === '}') { cursor += 1; return { ok: true, value: out }; }
        let key = '';
        const keyChar = text.charAt(cursor);
        if (keyChar === '"' || keyChar === "'") {
          const parsed = parseValue();
          if (!parsed.ok || typeof parsed.value !== 'string') return UNREADABLE;
          key = parsed.value;
        } else {
          while (cursor < text.length && /[A-Za-z0-9_$]/.test(text.charAt(cursor))) {
            key += text.charAt(cursor);
            cursor += 1;
          }
        }
        if (!key) return UNREADABLE;
        skip();
        if (text.charAt(cursor) !== ':') return UNREADABLE;
        cursor += 1;
        const value = parseValue();
        if (!value.ok) return UNREADABLE;
        out[key] = value.value;
        skip();
        if (text.charAt(cursor) === ',') { cursor += 1; continue; }
        if (text.charAt(cursor) === '}') { cursor += 1; return { ok: true, value: out }; }
        return UNREADABLE;
      }
    }

    if (text.startsWith('true', cursor)) { cursor += 4; return { ok: true, value: true }; }
    if (text.startsWith('false', cursor)) { cursor += 5; return { ok: true, value: false }; }
    if (text.startsWith('null', cursor)) { cursor += 4; return { ok: true, value: null }; }

    const number = text.slice(cursor).match(/^-?\d+(\.\d+)?([eE][-+]?\d+)?/);
    if (number) {
      cursor += number[0].length;
      return { ok: true, value: Number(number[0]) };
    }
    return UNREADABLE;
  };

  const result = parseValue();
  skip();
  if (!result.ok || cursor !== text.length) return UNREADABLE;
  return result;
}

/** Line number of a character index, 1-based. */
export function lineAt(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < code.length; i += 1) {
    if (code.charAt(i) === '\n') line += 1;
  }
  return line;
}
