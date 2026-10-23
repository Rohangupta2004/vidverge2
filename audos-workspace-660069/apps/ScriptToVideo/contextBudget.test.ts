import { AGENT_CONTEXT_CHAR_BUDGET, prepareContextBody, requestWithContextRetry } from './contextBudget';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const body = (system: string, messages: any[]) => ({ model: 'claude-opus-5', system, messages });

export async function runContextBudgetTests(): Promise<void> {
  const system = 'SYSTEM MUST SURVIVE';
  const latest = 'LATEST TURN MUST SURVIVE';
  const oversizedHistory = Array.from({ length: 80 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `turn ${index} ${'x'.repeat(4_000)}` }));
  const first = prepareContextBody({ system, messages: [...oversizedHistory, { role: 'user', content: latest }], buildBody: body });
  assert(first.chars < AGENT_CONTEXT_CHAR_BUDGET, 'oversized history must fit the hard budget');
  assert(first.system.includes(system), 'system prompt must be preserved');
  assert(JSON.stringify(first.messages).includes(latest), 'latest user turn must be preserved');
  assert(Boolean(first.runningSummary), 'older history must become a running summary');

  const tool = prepareContextBody({ system, messages: [{ role: 'assistant', content: 'tool use' }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify({ status: 'failed', operation_id: 'op_1', error: 'provider refusal', payload: 'y'.repeat(80_000) }) }] }, { role: 'user', content: latest }], buildBody: body });
  const toolJson = JSON.stringify(tool.body);
  assert(toolJson.includes('operation_id'), 'tool compaction must keep key ids');
  assert(toolJson.includes('provider refusal'), 'tool compaction must keep provider error');
  assert(toolJson.length < AGENT_CONTEXT_CHAR_BUDGET, 'oversized tool result must be capped');

  const binary = prepareContextBody({ system, messages: [{ role: 'user', content: `look data:image/png;base64,${'A'.repeat(8_000)} ${latest}` }], buildBody: body });
  assert(!JSON.stringify(binary.body).includes('A'.repeat(200)), 'base64 must never enter text history');
  assert(JSON.stringify(binary.body).includes(latest), 'binary stripping must preserve latest text');

  let calls = 0;
  const retried = await requestWithContextRetry({
    prepare: (aggressive) => prepareContextBody({ system, messages: [...oversizedHistory.slice(0, 8), { role: 'user', content: latest }], aggressive, buildBody: body }),
    send: async (request) => { calls += 1; if (calls === 1) throw new Error('Input exceeds the 200000-character proxy limit.'); return request.system; },
  });
  assert(retried.retried && calls === 2, 'length error must retry exactly once with aggressive compaction');
  assert(retried.result.includes(system), 'retry must preserve the system prompt');
  assert(JSON.stringify(retried.prepared.messages).includes(latest), 'retry must preserve the latest turn');
}
