import { useCallback, useEffect, useState } from 'react';
import { insertScene, listScenes, removeScene, savePlan, updateScene, type Scene } from '../lib/supabase';

export function useScenes(projectId?: string) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const refresh = useCallback(async () => { if (projectId) setScenes(await listScenes(projectId)); else setScenes([]); }, [projectId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; scenes?: Scene[] }>).detail;
      if (detail?.projectId === projectId && Array.isArray(detail.scenes)) setScenes(detail.scenes);
    };
    window.addEventListener('sceneforge:scenes-changed', receive);
    return () => window.removeEventListener('sceneforge:scenes-changed', receive);
  }, [projectId]);

  // The plan is saved in ONE server call that matches the new scenes onto the
  // rows already at each scene_index. Nothing is deleted and re-inserted, so
  // the unique index on (project_id, scene_index) can no longer be raced into
  // a duplicate-key crash the way the old delete-all-then-insert did.
  const replaceFromPlan = useCallback(async (planned: any[]) => {
    if (!projectId) return;
    setScenes(await savePlan(projectId, planned));
  }, [projectId]);

  const patchScene = useCallback(async (id: string, patch: Partial<Scene>) => {
    setScenes((all) => all.map((scene) => scene.id === id ? { ...scene, ...patch } : scene));
    await updateScene(id, patch, projectId);
  }, [projectId]);

  const remove = useCallback(async (id: string) => {
    await removeScene(id, projectId);
    setScenes((all) => all.filter((scene) => scene.id !== id));
  }, [projectId]);

  const add = useCallback(async (scene: Omit<Scene, 'id'>) => {
    const made = await insertScene(scene);
    setScenes((all) => [...all.filter((item) => item.id !== made.id), made].sort((a, b) => a.scene_index - b.scene_index));
  }, []);

  return { scenes, setScenes, refresh, replaceFromPlan, patchScene, remove, add };
}
