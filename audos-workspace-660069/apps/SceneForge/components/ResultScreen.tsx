import { Download, RotateCcw } from 'lucide-react';

export default function ResultScreen({ videoUrl, onNew }: { videoUrl: string; onNew: () => void }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] bg-[#FFFFFF] shadow-2xl shadow-[rgba(120,80,0,0.12)]">
      <div className="border-b border-[color-mix(in_srgb,#B4780A_14%,transparent)] p-6"><p className="text-xs font-bold uppercase tracking-[.18em] text-[#C8920A]">Render complete</p><h2 className="mt-2 text-2xl font-semibold text-[#1A1000]">Your edited video is ready</h2></div>
      <div className="bg-black p-3"><video src={videoUrl} controls autoPlay className="aspect-video w-full rounded-2xl object-contain" /></div>
      <div className="flex flex-col gap-3 p-6 sm:flex-row"><a href={videoUrl} download="sceneforge-final.mp4" className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#C8920A] px-5 py-4 font-bold text-white transition hover:bg-[#B4720A]"><Download size={18} /> Download MP4</a><button onClick={onNew} className="flex items-center justify-center gap-2 rounded-2xl border border-[color-mix(in_srgb,#B4780A_14%,transparent)] px-5 py-4 font-semibold text-[#3D2800] transition hover:border-[color-mix(in_srgb,#B4780A_30%,transparent)] hover:text-[#1A1000]"><RotateCcw size={17} /> Back to SceneForge</button></div>
    </section>
  );
}
