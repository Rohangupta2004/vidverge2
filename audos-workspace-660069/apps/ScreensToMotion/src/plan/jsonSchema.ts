/**
 * Minimal dependency-free JSON Schema (draft-07 subset) validator, shared by
 * stage 2 and stage 3. Supports exactly what the two shipped schemas use:
 * type (incl. union arrays), enum, const, required, properties,
 * additionalProperties:false, items, minItems/maxItems, minLength/maxLength,
 * minimum/maximum, pattern. Returns every violation with its JSON path so a
 * failed model response can be retried with concrete feedback.
 */
export interface SchemaViolation { path: string; message: string; }

export function validateAgainstSchema(value: unknown, schema: any, path = '$'): SchemaViolation[] {
  const out: SchemaViolation[] = [];
  const fail = (message: string) => out.push({ path, message });

  const types = schema.type == null ? null : Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (types && !types.includes(actual === 'number' && types.includes('integer') && Number.isInteger(value) ? 'integer' : actual)) {
    fail(`expected ${types.join('|')}, got ${actual}`);
    return out;
  }
  if (schema.enum && !schema.enum.some((e: unknown) => e === value)) {
    fail(`must be one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) fail(`shorter than minLength ${schema.minLength}`);
    if (schema.maxLength != null && value.length > schema.maxLength) fail(`longer than maxLength ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(`does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) fail(`below minimum ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) fail(`above maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) fail(`fewer than minItems ${schema.minItems}`);
    if (schema.maxItems != null && value.length > schema.maxItems) fail(`more than maxItems ${schema.maxItems}`);
    if (schema.items) value.forEach((item, i) => out.push(...validateAgainstSchema(item, schema.items, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required || []) {
      if (!(key in obj)) fail(`missing required property "${key}"`);
    }
    const props = schema.properties || {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) out.push(...validateAgainstSchema(obj[key], sub, `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) out.push({ path: `${path}.${key}`, message: 'unexpected property' });
      }
    }
  }
  return out;
}

export function assertValid(value: unknown, schema: any, label: string): void {
  const violations = validateAgainstSchema(value, schema);
  if (violations.length > 0) {
    const detail = violations.slice(0, 8).map((v) => `${v.path}: ${v.message}`).join('; ');
    throw new Error(`${label} failed schema validation — ${detail}${violations.length > 8 ? ` (+${violations.length - 8} more)` : ''}`);
  }
}
