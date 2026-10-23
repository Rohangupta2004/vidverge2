import { directPrompt, validatePromptDirectorOutput } from './promptDirector';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

export function runPromptDirectorTests(): void {
  for (const modelId of ['openrouter/bytedance/seedance-2.5', 'kling-3.0-omni', 'gemini-omni-1.1-flash']) {
    const output = directPrompt({
      modelId,
      duration: modelId.includes('seedance') ? 15 : 8,
      sceneIndex: 1,
      anchor: 'MAYA — short black hair, amber jacket, brass compass; rain-blue station platform',
      beats: modelId.includes('seedance')
        ? [{ start: 0, end: 4, text: 'Medium shot; MAYA lifts the compass; slow push-in; warm practical light.' }, { start: 4, end: 9, text: 'Close shot; MAYA turns toward the train; tracking camera; platform stays stable.' }, { start: 9, end: 15, text: 'Wide shot; MAYA boards; camera freezes at the door; rain remains steady.' }]
        : [{ start: 0, end: 4, text: 'Medium shot; MAYA lifts the compass; slow push-in.' }, { start: 4, end: 8, text: 'Wide shot; MAYA boards; camera locks off.' }],
      references: ['maya-cast-sheet'],
      previousFinalState: 'MAYA at frame left, compass raised, cool rain backlight',
    });
    assert(validatePromptDirectorOutput(output, modelId.includes('seedance') ? 15 : 8).length === 0, `${modelId} prompt must validate`);
    assert(output.prompt.includes('0-4s:'), `${modelId} prompt must expose editable timecodes`);
    assert(output.prompt.includes('MAYA — short black hair'), `${modelId} prompt must repeat the fixed anchor`);
    assert(Boolean(output.why), `${modelId} prompt must explain why it is structured this way`);
  }
}
