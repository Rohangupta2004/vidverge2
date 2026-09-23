/**
 * FINAL COMPOSITION — FFmpeg.wasm in the browser.
 *
 * Timeline model (every layer stays independently stored and regenerable —
 * scene rows keep clip + narration + captions + motion overlay separate;
 * merging happens only here, at the end):
 *
 *   VIDEO      the scene clip (Omni Flash MP4 with native audio, or a silent
 *              captured WebM), normalized to one geometry/fps/codec pair
 *   MOTION     the motion-design overlay (recorded on black) — blend=screen
 *   TEXT       the deterministic exact-text overlay (recorded on black) —
 *              colorkey + overlay; precise information (numbers, prices,
 *              product names, CTA) never depends on the generative model
 *   CAPTIONS   the caption overlay (recorded on black) — colorkey + overlay,
 *              so the pill + typography survive on any footage
 *   VOICE      the scene's OWN narration audio, mixed into ITS segment at
 *              full level; a clip's native audio ducks underneath
 *   MUSIC      the ElevenLabs bed under the whole ad, looped + ducked
 *   SFX        an optional subtle effects bed, mixed low under everything
 *
 * Scene durations arrive ALREADY voice-derived. Every composite attempt
 * degrades gracefully: overlay fails → plain clip; captions fail → no
 * captions; music fails → voice-only ad; FFmpeg.wasm cannot start → the
 * platform stitch endpoint joins the clips so the ad still ships.
 */

import { FFmpeg } from 'https://esm.sh/@ffmpeg/ffmpeg@0.12.10';
import { fetchFile, toBlobURL } from 'https://esm.sh/@ffmpeg/util@0.12.1';
import { platformStitch } from '../../ScriptToVideo/pipeline/assemble';
import { Aspect, uploadBlob } from './api';

// The ESM core build: the FFmpeg class always spawns a MODULE worker, and a
// module worker cannot importScripts() the UMD build — it dynamic-imports the
// core instead, which needs the ESM file's `export default createFFmpegCore`.
const CORE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
// Same-origin worker bootstrap: the FFmpeg class's own worker URL resolves to
// a cross-origin esm.sh address every browser refuses (see the identical fix
// in ScriptToVideo/pipeline/assemble.ts).
const WORKER_ENTRY = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js';

let instance: any = null;

async function loadFFmpeg(): Promise<any> {
  if (instance) return instance;
  const ff = new FFmpeg();
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
    // Deliberately not cached as a permanent failure — a transient CDN or
    // network miss can succeed on the next attempt.
    throw new Error(`FFmpeg could not start in this browser: ${String(e?.message || e).slice(0, 140)}`);
  } finally {
    URL.revokeObjectURL(classWorkerURL);
  }
}

function composeSize(aspect: Aspect): { W: number; H: number } {
  // 720p keeps browser encoding fast and the wasm heap bounded.
  return aspect === '9:16' ? { W: 720, H: 1280 } : { W: 1280, H: 720 };
}

function extOf(url: string): string {
  const m = /\.(mp4|webm|mov|m4v|mp3|m4a|wav|aac)(?:\?|#|$)/i.exec(url);
  return m ? m[1].toLowerCase() : 'mp4';
}

export interface ComposeInput {
  sceneKey: string;
  url: string;
  /** Motion-design overlay WebM recorded on black — screen-blended over the clip. */
  motionOverlayUrl?: string | null;
  /** 0..1 blend opacity for the motion overlay. */
  motionOpacity?: number;
  /** Deterministic EXACT-TEXT overlay WebM recorded on black — colorkeyed +
   * overlaid above the footage/motion layer, below the captions. */
  textOverlayUrl?: string | null;
  /** Caption overlay WebM recorded on black — colorkeyed + overlaid. */
  captionOverlayUrl?: string | null;
  /** This scene's own narration audio — mixed into ITS segment at full level. */
  narrationUrl?: string | null;
  /** Duck the clip's native audio under the narration (Omni clips carry sound). */
  duckNative?: boolean;
  /** Voice-derived segment duration — bounds the composite and times the fade-out. */
  durationS?: number | null;
  fadeIn?: boolean;
  fadeOut?: boolean;
}

export interface ComposeResult { url: string; via: 'ffmpeg_wasm' | 'platform_stitch'; note?: string }

export async function composeFilm(
  clips: ComposeInput[],
  aspect: Aspect,
  opts: {
    musicUrl?: string | null;
    musicVolume?: number;
    sfxUrl?: string | null;
    onProgress?: (note: string, fraction: number) => void;
  } = {},
): Promise<ComposeResult> {
  if (!clips.length) throw new Error('No scene clips to compose.');
  const say = (note: string, f: number) => { try { opts.onProgress?.(note, f); } catch { /* UI only */ } };

  try {
    const ff = await loadFFmpeg();
    const { W, H } = composeSize(aspect);
    const names: string[] = [];
    const notes: string[] = [];
    let anyNarration = false;

    for (let i = 0; i < clips.length; i += 1) {
      const clip = clips[i];
      say(`Compositing scene ${i + 1} of ${clips.length}…`, (i / (clips.length + 2)) * 0.85);
      const inName = `in_${i}.${extOf(clip.url)}`;
      const outName = `seg_${i}.mp4`;
      await ff.writeFile(inName, await fetchFile(clip.url));

      // Base video chain: normalize + intentional fades.
      const dur = Number(clip.durationS) || 0;
      let vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
      if (clip.fadeIn) vf += ',fade=t=in:st=0:d=0.45';
      if (clip.fadeOut && dur > 1.2) vf += `,fade=t=out:st=${Math.max(0.2, dur - 0.5).toFixed(2)}:d=0.5`;

      const common = ['-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '2'];
      const bound = dur > 0 ? ['-t', dur.toFixed(2)] : [];

      // Optional layer files — each degrades independently.
      let ovName = '';
      if (clip.motionOverlayUrl) {
        try { ovName = `ov_${i}.${extOf(clip.motionOverlayUrl)}`; await ff.writeFile(ovName, await fetchFile(clip.motionOverlayUrl)); }
        catch { ovName = ''; notes.push(`Scene ${i + 1}: the motion layer could not be fetched — shipped without it.`); }
      }
      let txtName = '';
      if (clip.textOverlayUrl) {
        try { txtName = `txt_${i}.${extOf(clip.textOverlayUrl)}`; await ff.writeFile(txtName, await fetchFile(clip.textOverlayUrl)); }
        catch { txtName = ''; notes.push(`Scene ${i + 1}: the exact-text overlay could not be fetched — shipped without it.`); }
      }
      let capName = '';
      if (clip.captionOverlayUrl) {
        try { capName = `cap_${i}.${extOf(clip.captionOverlayUrl)}`; await ff.writeFile(capName, await fetchFile(clip.captionOverlayUrl)); }
        catch { capName = ''; notes.push(`Scene ${i + 1}: the captions could not be fetched — shipped without them.`); }
      }
      let narrName = '';
      if (clip.narrationUrl) {
        try { narrName = `voice_${i}.${extOf(clip.narrationUrl)}`; await ff.writeFile(narrName, await fetchFile(clip.narrationUrl)); anyNarration = true; }
        catch { narrName = ''; notes.push(`Scene ${i + 1}: the narration audio could not be fetched — the scene plays silent.`); }
      }

      /**
       * One segment attempt. Layer toggles let the retry ladder drop the
       * pieces that failed:  full → no captions → no overlays → plain clip.
       * `nativeAudio` false pulls silence instead of mapping 0:a (captured
       * WebMs have no audio track at all).
       */
      const attempt = async (useOv: boolean, useTxt: boolean, useCap: boolean, nativeAudio: boolean): Promise<number> => {
        const args: string[] = ['-i', inName];
        let idx = 1;
        let ovIdx = -1; let txtIdx = -1; let capIdx = -1; let narrIdx = -1; let silIdx = -1;
        if (useOv && ovName) { args.push('-i', ovName); ovIdx = idx; idx += 1; }
        if (useTxt && txtName) { args.push('-i', txtName); txtIdx = idx; idx += 1; }
        if (useCap && capName) { args.push('-i', capName); capIdx = idx; idx += 1; }
        if (narrName) { args.push('-i', narrName); narrIdx = idx; idx += 1; }
        if (!nativeAudio) { args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'); silIdx = idx; idx += 1; }

        const parts: string[] = [`[0:v]${vf}[v0]`];
        let v = 'v0';
        if (ovIdx > 0) {
          const op = Math.min(1, Math.max(0.05, Number(clip.motionOpacity) || 0.25));
          parts.push(`[${ovIdx}:v]scale=${W}:${H},setsar=1,fps=30,format=yuv420p[mo]`);
          parts.push(`[${v}][mo]blend=all_mode=screen:all_opacity=${op.toFixed(2)}[v1]`);
          v = 'v1';
        }
        if (txtIdx > 0) {
          // Exact-text overlay — recorded on pure black; colorkey the black out
          // so the pill + exact typography sit ABOVE the footage/motion layer.
          parts.push(`[${txtIdx}:v]scale=${W}:${H},setsar=1,fps=30,format=rgba,colorkey=0x000000:0.11:0.05[tk]`);
          parts.push(`[${v}][tk]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[vtx]`);
          v = 'vtx';
        }
        if (capIdx > 0) {
          // The caption layer was recorded on pure black — key the black out and
          // overlay what survives (pill + typography).
          parts.push(`[${capIdx}:v]scale=${W}:${H},setsar=1,fps=30,format=rgba,colorkey=0x000000:0.11:0.05[ck]`);
          parts.push(`[${v}][ck]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[v2]`);
          v = 'v2';
        }

        const nativeSrc = nativeAudio ? '[0:a]' : `[${silIdx}:a]`;
        if (narrIdx > 0) {
          const nv = clip.duckNative && nativeAudio ? 0.22 : 1.0;
          parts.push(`${nativeSrc}aformat=sample_rates=44100:channel_layouts=stereo,volume=${nv.toFixed(2)}[nat]`);
          parts.push(`[${narrIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,apad[voice]`);
          parts.push('[nat][voice]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]');
        } else {
          parts.push(`${nativeSrc}aformat=sample_rates=44100:channel_layouts=stereo[a]`);
        }

        return ff.exec([...args, '-filter_complex', parts.join(';'), ...common, ...bound, '-map', `[${v}]`, '-map', '[a]', '-shortest', outName]);
      };

      let rc = await attempt(true, true, true, true);
      if (rc !== 0) rc = await attempt(true, true, true, false);
      if (rc !== 0 && capName) { rc = await attempt(true, true, false, true); if (rc !== 0) rc = await attempt(true, true, false, false); if (rc === 0) notes.push(`Scene ${i + 1}: the caption composite failed — shipped without captions.`); }
      if (rc !== 0 && txtName) { rc = await attempt(true, false, false, true); if (rc !== 0) rc = await attempt(true, false, false, false); if (rc === 0) notes.push(`Scene ${i + 1}: the exact-text overlay composite failed — shipped without it. QA will flag the missing text.`); }
      if (rc !== 0 && ovName) { rc = await attempt(false, false, false, true); if (rc !== 0) rc = await attempt(false, false, false, false); if (rc === 0) notes.push(`Scene ${i + 1}: the overlay composite failed — shipped the plain clip.`); }
      if (rc !== 0) throw new Error(`Scene ${i + 1} could not be composited.`);

      for (const n of [inName, ovName, txtName, capName, narrName].filter(Boolean)) { try { await ff.deleteFile(n); } catch { /* fs cleanup */ } }
      names.push(outName);
    }

    say('Joining scenes…', 0.88);
    const list = names.map((n) => `file '${n}'`).join('\n');
    await ff.writeFile('list.txt', new TextEncoder().encode(list));
    let rc = await ff.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', 'joined.mp4']);
    if (rc !== 0) throw new Error('The final join failed inside FFmpeg.');

    // Finishing audio — the music bed loops under the whole ad, ducked beneath
    // the per-scene narration; an optional subtle SFX bed sits even lower.
    let finalName = 'joined.mp4';
    const wantMusic = !!opts.musicUrl;
    const wantSfx = !!opts.sfxUrl;
    if (wantMusic || wantSfx) {
      say('Laying the music bed…', 0.93);
      try {
        const args: string[] = ['-i', 'joined.mp4'];
        const cleanup: string[] = [];
        let idx = 1; let musicIdx = -1; let sfxIdx = -1;
        if (wantMusic) {
          const mName = `music.${extOf(String(opts.musicUrl))}`;
          await ff.writeFile(mName, await fetchFile(String(opts.musicUrl)));
          args.push('-stream_loop', '-1', '-i', mName); cleanup.push(mName); musicIdx = idx; idx += 1;
        }
        if (wantSfx) {
          const sName = `sfx.${extOf(String(opts.sfxUrl))}`;
          await ff.writeFile(sName, await fetchFile(String(opts.sfxUrl)));
          args.push('-i', sName); cleanup.push(sName); sfxIdx = idx; idx += 1;
        }
        // Music auto-ducks under narration; SFX stays subtle underneath both.
        const vol = Math.min(1, Math.max(0.05, Number(opts.musicVolume) || (anyNarration ? 0.13 : 0.22)));
        const filters: string[] = ['[0:a]aformat=sample_rates=44100:channel_layouts=stereo[spoken]'];
        const mixIns: string[] = ['[spoken]'];
        if (musicIdx > 0) { filters.push(`[${musicIdx}:a]volume=${vol.toFixed(2)}[m]`); mixIns.push('[m]'); }
        if (sfxIdx > 0) { filters.push(`[${sfxIdx}:a]volume=0.15,apad[s]`); mixIns.push('[s]'); }
        filters.push(`${mixIns.join('')}amix=inputs=${mixIns.length}:duration=first:dropout_transition=2:normalize=0[a]`);
        rc = await ff.exec([
          ...args,
          '-filter_complex', filters.join(';'),
          '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', 'final.mp4',
        ]);
        if (rc === 0) finalName = 'final.mp4';
        else notes.push('The music bed could not be mixed — shipped with voice and scene audio only.');
        for (const n of cleanup) { try { await ff.deleteFile(n); } catch { /* fs cleanup */ } }
      } catch { notes.push('The finishing audio could not be fetched — shipped with voice and scene audio only.'); }
    }

    const bytes = await ff.readFile(finalName);
    const blob = new Blob([bytes], { type: 'video/mp4' });
    for (const n of [...names, 'list.txt', 'joined.mp4', 'final.mp4']) { try { await ff.deleteFile(n); } catch { /* fs cleanup */ } }
    if (!blob.size) throw new Error('FFmpeg produced an empty ad.');

    say('Publishing the ad…', 0.97);
    const url = await uploadBlob(blob, `product-ad-${Date.now()}.mp4`);
    return { url, via: 'ffmpeg_wasm', note: notes.join(' ') || undefined };
  } catch (wasmError: any) {
    // Fallback: the platform stitch endpoint (hard cuts, no overlays/audio layers).
    say('FFmpeg unavailable — using the platform joiner…', 0.5);
    let url: string;
    try {
      url = await platformStitch(clips.map((c) => c.url));
    } catch (stitchError: any) {
      throw new Error(`Composition failed. In-browser FFmpeg: ${String(wasmError?.message || wasmError).slice(0, 160)}. Platform joiner: ${String(stitchError?.message || stitchError).slice(0, 200)}`);
    }
    return { url, via: 'platform_stitch', note: 'Composed with the platform joiner — narration, captions, overlays and music were skipped in this fallback.' };
  }
}
