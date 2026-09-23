/**
 * ASSEMBLY LAYER — FFmpeg.wasm in the browser.
 *
 * Ready scenes are normalized to one H.264/AAC shape, with a real silent track
 * added to graphics/mockups, then concatenated. An optional second pass can
 * mix ElevenLabs narration and a music bed while preserving Veo's native sound,
 * and burn scene-timed captions. No Remotion or server renderer is involved.
 */

import { FFmpeg } from 'https://esm.sh/@ffmpeg/ffmpeg@0.12.10';
import { fetchFile, toBlobURL } from 'https://esm.sh/@ffmpeg/util@0.12.1';
import { Aspect, appId, uploadBlob, wsToken } from '../api';

// The ESM core build: the FFmpeg class always spawns a MODULE worker, and a
// module worker cannot importScripts() the UMD build — it dynamic-imports the
// core instead, which needs the ESM file's `export default createFFmpegCore`.
const CORE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
// The worker module the FFmpeg class runs. Left to itself the class does
// new Worker(new URL('./worker.js', import.meta.url)), which resolves to a
// CROSS-ORIGIN esm.sh URL — browsers refuse to construct a Worker from
// another origin (and esm.sh answers 404 on that path anyway), which is
// exactly the "Failed to construct 'Worker'" assembly failure. A same-origin
// blob that simply imports the real worker module IS allowed: the import
// inside the worker is a normal CORS module fetch, and the worker module's
// own relative imports resolve against unpkg.
const WORKER_ENTRY = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js';

let instance: any = null;

export async function loadFFmpeg(onLog?: (line: string) => void): Promise<any> {
  if (instance) return instance;
  const ff = new FFmpeg();
  if (onLog) ff.on('log', ({ message }: any) => onLog(String(message || '')));
  const classWorkerURL = URL.createObjectURL(new Blob([`import "${WORKER_ENTRY}";`], { type: 'text/javascript' }));
  try {
    await ff.load({
      coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, 'application/wasm'),
      classWorkerURL,
    } as any);
    instance = ff;
    return ff;
  } catch (e: any) {
    // Deliberately NOT cached as a permanent failure: a transient CDN or
    // network miss can succeed on the next attempt, and the platform joiner
    // covers this run either way.
    throw new Error(`FFmpeg could not start in this browser: ${String(e?.message || e).slice(0, 140)}`);
  } finally {
    URL.revokeObjectURL(classWorkerURL);
  }
}

/**
 * The platform joiner. The workspace-scoped stitch endpoint is the only real
 * one — a bare '/videos/stitch' does not exist on the space origin, so the
 * serving layer answers it HTTP 200 with an HTML page, which is why the old
 * fallback died with "Platform joiner: HTTP 200". The real endpoint answers
 * JSON: { success, stitchedUrl } on success and { error } on failure — both
 * are checked explicitly, including error bodies that arrive with HTTP 200.
 */
const WORKSPACE_UUID = 'f24710e5-7c6d-4db4-92b4-c2c235877575';
export async function platformStitch(urls: string[]): Promise<string> {
  const res = await fetch(`/api/workspaces/${WORKSPACE_UUID}/videos/stitch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Id': appId(),
      ...(wsToken() ? { 'X-Workspace-DB-Token': wsToken() } : {}),
    },
    body: JSON.stringify({ videoUrls: urls }),
  });
  const raw = await res.text();
  let data: any = null;
  try { data = JSON.parse(raw); } catch { /* non-JSON page */ }
  if (!data) throw new Error(`the joiner answered HTTP ${res.status} with a non-JSON page (${raw.slice(0, 80).replace(/\s+/g, ' ')})`);
  const url = data.stitchedUrl || data.videoUrl || data.url;
  if (!res.ok || data.success === false || typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    throw new Error(String(data.error || data.message || `HTTP ${res.status} without a stitched video URL`));
  }
  return String(url);
}

function assemblySize(aspect: Aspect): { W: number; H: number } {
  return aspect === '9:16' ? { W: 720, H: 1280 } : { W: 1280, H: 720 };
}

function videoExt(url: string): string {
  const m = /\.(mp4|webm|mov|m4v)(?:\?|#|$)/i.exec(url);
  return m ? m[1].toLowerCase() : 'mp4';
}

export interface AssemblyInput {
  sceneKey: string;
  url: string;
  /** ElevenLabs narration mixed over this scene. In the Final Assembly flow
   * this is the scene's AUTHORITATIVE voice (native audio drops to ambience
   * via nativeVolume); legacy captured scenes use it the old way. */
  narrationUrl?: string | null;
  /** Native clip audio level (0..1, default 1). Final Assembly passes ~0.16 on
   * narrated scenes so the clip's own sound becomes ambience under the voice —
   * exactly one authoritative voice per scene. Dialogue scenes pass 1. */
  nativeVolume?: number;
  /** Real clip duration (seconds) — needed to extend the scene when the
   * narration slightly overruns it. */
  durationS?: number;
  /** Extend the scene to this length by holding its last frame (capped at
   * +3s) when the narration needs the room. */
  targetDurationS?: number;
  /** Scene SFX dropped in at their offsets, subtle by design. */
  sfx?: { url: string; atS: number; volume: number; durationS?: number }[] | null;
  /** Final Assembly: a failed scene audio mix must FAIL the assembly (the
   * export must contain every audio layer), never silently ship silent. */
  strictAudio?: boolean;
}
export interface AssemblyFinish {
  durationS: number;
  narrationUrls?: string[];
  musicUrl?: string;
  /** Music bed level under the mix (0..1, default 0.22). Ducking under speech
   * is automatic on top of this. */
  musicVolume?: number;
  captionsSrt?: string;
}
export interface AssemblyResult { url: string; durationS: number; via: 'ffmpeg_wasm' | 'platform_stitch' }

async function writeNarration(ff: any, urls: string[], cleanup: string[]): Promise<string | null> {
  if (!urls.length) return null;
  const names: string[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    const name = `narration_${i}.mp3`;
    await ff.writeFile(name, await fetchFile(urls[i]));
    names.push(name);
    cleanup.push(name);
  }
  if (names.length === 1) return names[0];
  const listName = 'narration-list.txt';
  const output = 'narration-joined.mp3';
  await ff.writeFile(listName, new TextEncoder().encode(names.map((n) => `file '${n}'`).join('\n')));
  cleanup.push(listName, output);
  const rc = await ff.exec(['-y', '-f', 'concat', '-safe', '0', '-i', listName, '-c', 'copy', output]);
  if (rc !== 0) throw new Error('The narration segments could not be joined.');
  return output;
}

async function applyFinish(
  ff: any,
  joinedName: string,
  finish: AssemblyFinish,
  cleanup: string[],
  say: (note: string, fraction: number) => void,
): Promise<string> {
  const narration = await writeNarration(ff, (finish.narrationUrls || []).filter(Boolean), cleanup);
  let music: string | null = null;
  if (finish.musicUrl) {
    music = 'music.mp3';
    await ff.writeFile(music, await fetchFile(finish.musicUrl));
    cleanup.push(music);
  }
  let captions = '';
  if (finish.captionsSrt?.trim()) {
    captions = 'captions.srt';
    await ff.writeFile(captions, new TextEncoder().encode(finish.captionsSrt));
    cleanup.push(captions);
  }

  const duration = Math.max(0.25, Number(finish.durationS) || 0).toFixed(3);
  const args: string[] = ['-y', '-i', joinedName];
  let nextInput = 1;
  let narrationIndex = -1;
  let musicIndex = -1;
  if (narration) { narrationIndex = nextInput; nextInput += 1; args.push('-i', narration); }
  if (music) { musicIndex = nextInput; args.push('-i', music); }

  const filters: string[] = ['[0:a:0]aformat=sample_rates=44100:channel_layouts=stereo[native]'];
  if (narrationIndex >= 0) {
    filters.push(`[${narrationIndex}:a:0]aformat=sample_rates=44100:channel_layouts=stereo,apad,atrim=0:${duration},asetpts=N/SR/TB[narr]`);
    filters.push('[native][narr]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[spoken]');
  } else {
    filters.push('[native]anull[spoken]');
  }
  if (musicIndex >= 0) {
    // Music always SUPPORTS: base level from the plan, an automatic sidechain
    // duck under every spoken moment, and clean fade-in/fade-out edges.
    const musicVol = Math.min(0.5, Math.max(0.05, Number(finish.musicVolume) || 0.22));
    const fadeOutStart = Math.max(0, Number(duration) - 2.2).toFixed(3);
    filters.push('[spoken]asplit=2[spokenout][duckkey]');
    filters.push(`[${musicIndex}:a:0]aformat=sample_rates=44100:channel_layouts=stereo,volume=${musicVol.toFixed(2)},apad,atrim=0:${duration},afade=t=in:st=0:d=1.2,afade=t=out:st=${fadeOutStart}:d=2,asetpts=N/SR/TB[musicbed]`);
    filters.push('[musicbed][duckkey]sidechaincompress=threshold=0.035:ratio=10:attack=20:release=650[ducked]');
    filters.push('[spokenout][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[outa]');
  } else {
    filters.push('[spoken]alimiter=limit=0.95[outa]');
  }

  const output = 'final.mp4';
  args.push('-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[outa]');
  if (captions) {
    args.push('-vf', `subtitles=${captions}:force_style='FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=1,Outline=2,Shadow=0,MarginV=34'`);
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p');
  } else {
    args.push('-c:v', 'copy');
  }
  args.push('-c:a', 'aac', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', '-shortest', output);
  say(captions ? 'Mixing sound and burning captions…' : 'Mixing the finishing audio…', 0.95);
  const rc = await ff.exec(args);
  if (rc !== 0) throw new Error(captions ? 'FFmpeg could not burn the captions into this film.' : 'FFmpeg could not mix the finishing audio.');
  cleanup.push(output);
  return output;
}

export async function assembleFilm(
  clips: AssemblyInput[],
  aspect: Aspect,
  onProgress?: (note: string, fraction: number) => void,
  finish?: AssemblyFinish,
): Promise<AssemblyResult> {
  if (!clips.length) throw new Error('No scene clips to assemble.');
  const say = (note: string, f: number) => { try { onProgress?.(note, f); } catch { /* UI only */ } };
  // Per-scene audio work (narration / SFX / ambience ducking) only exists on
  // the FFmpeg path — the platform stitch fallback would silently drop it, so
  // any clip carrying audio layers makes FFmpeg mandatory.
  const sceneAudioRequested = clips.some((c) => c.narrationUrl || (c.sfx && c.sfx.length) || (typeof c.nativeVolume === 'number' && c.nativeVolume < 0.999) || c.strictAudio);
  const finishRequested = !!(finish && ((finish.narrationUrls?.length || 0) > 0 || finish.musicUrl || finish.captionsSrt)) || sceneAudioRequested;

  try {
    const ff = await loadFFmpeg();
    const { W, H } = assemblySize(aspect);
    const vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
    const names: string[] = [];
    const cleanup: string[] = [];

    for (let i = 0; i < clips.length; i += 1) {
      const clip = clips[i];
      say(`Preparing scene ${i + 1} of ${clips.length}…`, (i / (clips.length + 1)) * 0.88);
      const inName = `in_${i}.${videoExt(clip.url)}`;
      const outName = `seg_${i}.mp4`;
      await ff.writeFile(inName, await fetchFile(clip.url));
      cleanup.push(inName, outName);
      const common = ['-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2'];
      let rc = await ff.exec(['-y', '-i', inName, '-vf', vf, ...common, '-map', '0:v:0', '-map', '0:a:0', outName]);
      if (rc !== 0) {
        rc = await ff.exec(['-y', '-i', inName, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-vf', vf, ...common, '-map', '0:v:0', '-map', '1:a:0', '-shortest', outName]);
      }
      if (rc !== 0) throw new Error(`Scene ${i + 1} could not be normalized for assembly.`);
      // Per-scene audio mix: the authoritative ElevenLabs narration rides over
      // the clip with the native audio reduced to ambience, scene SFX drop in
      // at their offsets, and a narration that slightly overruns extends the
      // scene by holding its last frame (never by speeding the voice up).
      let segName = outName;
      const sfxList = (clip.sfx || []).filter((f) => f && /^https?:/.test(String(f.url || '')));
      const nativeVol = typeof clip.nativeVolume === 'number' ? Math.min(1, Math.max(0, clip.nativeVolume)) : 1;
      const clipDur = Math.max(0.25, Number(clip.durationS) || 0);
      const targetDur = clipDur
        ? Math.max(clipDur, Math.min(Number(clip.targetDurationS) || clipDur, clipDur + 3))
        : Math.max(0.25, Number(clip.targetDurationS) || 0);
      const pad = clipDur && targetDur > clipDur + 0.05 ? targetDur - clipDur : 0;
      const needsMix = !!clip.narrationUrl || sfxList.length > 0 || nativeVol < 0.999 || pad > 0;
      if (needsMix) {
        try {
          const mixName = `segmix_${i}.mp4`;
          const args2: string[] = ['-y', '-i', outName];
          let inputIdx = 1;
          let narrIdx = -1;
          if (clip.narrationUrl) {
            const narrName = `narr_${i}.mp3`;
            await ff.writeFile(narrName, await fetchFile(clip.narrationUrl));
            cleanup.push(narrName);
            narrIdx = inputIdx; inputIdx += 1;
            args2.push('-i', narrName);
          }
          const fxIdx: number[] = [];
          for (let k = 0; k < sfxList.length; k += 1) {
            const fxName = `sfx_${i}_${k}.mp3`;
            await ff.writeFile(fxName, await fetchFile(sfxList[k].url));
            cleanup.push(fxName);
            fxIdx.push(inputIdx); inputIdx += 1;
            args2.push('-i', fxName);
          }
          const T = (targetDur || clipDur || 6).toFixed(3);
          const f2: string[] = [];
          const mixIns: string[] = [];
          f2.push(`[0:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${nativeVol.toFixed(3)},apad,atrim=0:${T},asetpts=N/SR/TB[na]`);
          mixIns.push('[na]');
          if (narrIdx >= 0) {
            f2.push(`[${narrIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,apad,atrim=0:${T},asetpts=N/SR/TB[nr]`);
            mixIns.push('[nr]');
          }
          sfxList.forEach((fx, k) => {
            const delayMs = Math.max(0, Math.round((Number(fx.atS) || 0) * 1000));
            const vol = Math.min(1, Math.max(0.05, Number(fx.volume) || 0.25));
            const fxDur = Math.min(2.5, Math.max(0.2, Number(fx.durationS) || 2.5));
            f2.push(`[${fxIdx[k]}:a]aformat=sample_rates=44100:channel_layouts=stereo,atrim=0:${fxDur.toFixed(2)},afade=t=out:st=${Math.max(0, fxDur - 0.35).toFixed(2)}:d=0.35,volume=${vol.toFixed(2)},adelay=${delayMs}|${delayMs},apad,atrim=0:${T},asetpts=N/SR/TB[fx${k}]`);
            mixIns.push(`[fx${k}]`);
          });
          f2.push(`${mixIns.join('')}amix=inputs=${mixIns.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[a]`);
          let mapVideo = '0:v:0';
          if (pad > 0) {
            f2.push(`[0:v]tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}[v]`);
            mapVideo = '[v]';
          }
          args2.push('-filter_complex', f2.join(';'), '-map', mapVideo, '-map', '[a]');
          if (pad > 0) args2.push('-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p');
          else args2.push('-c:v', 'copy');
          args2.push('-c:a', 'aac', '-ar', '44100', '-ac', '2', '-t', T, mixName);
          cleanup.push(mixName);
          const mixRc = await ff.exec(args2);
          if (mixRc !== 0) throw new Error(`Scene ${i + 1}: the narration/SFX mix failed inside FFmpeg.`);
          segName = mixName;
        } catch (e: any) {
          // Final Assembly must never silently drop an audio layer.
          if (clip.strictAudio) throw e instanceof Error ? e : new Error(String(e));
          say(`Scene ${i + 1}: the scene audio could not be mixed — the scene ships with native sound only.`, (i / (clips.length + 1)) * 0.88);
        }
      }
      names.push(segName);
    }

    say('Joining scenes…', 0.90);
    const listName = 'scene-list.txt';
    const joinedName = 'joined.mp4';
    await ff.writeFile(listName, new TextEncoder().encode(names.map((n) => `file '${n}'`).join('\n')));
    cleanup.push(listName, joinedName);
    const joinRc = await ff.exec(['-y', '-f', 'concat', '-safe', '0', '-i', listName, '-c', 'copy', '-movflags', '+faststart', joinedName]);
    if (joinRc !== 0) throw new Error('The final join failed inside FFmpeg.');

    const finishLayers = !!(finish && ((finish.narrationUrls?.length || 0) > 0 || finish.musicUrl || finish.captionsSrt));
    const outputName = finishLayers ? await applyFinish(ff, joinedName, finish!, cleanup, say) : joinedName;
    const bytes = await ff.readFile(outputName);
    const blob = new Blob([bytes], { type: 'video/mp4' });
    for (const name of [...new Set(cleanup)]) { try { await ff.deleteFile(name); } catch { /* fs cleanup */ } }
    if (!blob.size) throw new Error('FFmpeg produced an empty film.');

    say('Publishing the film…', 0.98);
    const url = await uploadBlob(blob, `s2v-film-${Date.now()}.mp4`);
    return { url, durationS: Number(finish?.durationS) || 0, via: 'ffmpeg_wasm' };
  } catch (wasmError: any) {
    // Finishing cannot silently disappear. The stitch fallback has no audio or
    // caption mixer, so an opted-in finish must fail clearly and preserve the
    // previously assembled film.
    if (finishRequested) throw wasmError;
    say('FFmpeg unavailable — using the platform joiner…', 0.5);
    let url: string;
    try {
      url = await platformStitch(clips.map((c) => c.url));
    } catch (stitchError: any) {
      throw new Error(`Assembly failed. In-browser FFmpeg: ${String(wasmError?.message || wasmError).slice(0, 160)}. Platform joiner: ${String(stitchError?.message || stitchError).slice(0, 200)}`);
    }
    return { url, durationS: 0, via: 'platform_stitch' };
  }
}
