import { useCallback, useEffect, useRef, useState } from 'react';
import { createProject, getProject, listProjects, updateProject, type Project } from '../lib/supabase';

export function useProject() {
  const [project, setProject] = useState<Project | null>(null); const [projects, setProjects] = useState<Project[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  // The live project, readable from long-running closures. A pipeline run
  // (Generate All, assembly) holds onto the `patch` it was invoked with for
  // MINUTES; reading through this ref keeps such a call anchored to the
  // project as it is NOW, not as it was when the run started.
  const projectRef = useRef<Project | null>(null);
  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(() => {
    const moveStage = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; status?: Project['status'] }>).detail;
      if (!detail?.projectId || !detail.status) return;
      setProject((current) => current?.id === detail.projectId ? { ...current, status: detail.status! } : current);
    };
    window.addEventListener('sceneforge:project-stage', moveStage);
    return () => window.removeEventListener('sceneforge:project-stage', moveStage);
  }, []);
  const refreshLibrary = useCallback(async () => { try { setProjects(await listProjects()); } catch (e: any) { setError(e.message); } }, []);
  useEffect(() => { void refreshLibrary(); }, [refreshLibrary]);
  const start = useCallback(async (input: Parameters<typeof createProject>[0]) => { setLoading(true); setError(''); try { const next = await createProject(input); setProject(next); return next; } catch (e: any) { setError(e.message); throw e; } finally { setLoading(false); } }, []);
  // MERGE INTO THE CURRENT PROJECT, never replace it with a stale snapshot.
  // The old `setProject({ ...project, ...changes })` closed over the project
  // as of the render that created this callback; when a minutes-long batch
  // run called patch at its end (e.g. to store the motion background), that
  // stale spread resurrected the OLD status ('scene_review') and the editor
  // silently navigated back to the planner — the "Generate All resets the
  // UI" bug. The functional update writes only the requested changes onto
  // whatever the project is now.
  const patch = useCallback(async (changes: Partial<Project>) => {
    const id = projectRef.current?.id;
    if (!id) return;
    await updateProject(id, changes);
    setProject((current) => current && current.id === id ? { ...current, ...changes } : current);
  }, []);
  const open = useCallback(async (id: string) => { setLoading(true); try { const next = await getProject(id); setProject(next); } finally { setLoading(false); } }, []);
  return { project, setProject, projects, loading, error, setError, start, patch, open, refreshLibrary };
}
