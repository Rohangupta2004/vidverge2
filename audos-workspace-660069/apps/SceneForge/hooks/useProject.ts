import { useCallback, useEffect, useState } from 'react';
import { createProject, getProject, listProjects, updateProject, type Project } from '../lib/supabase';

export function useProject() {
  const [project, setProject] = useState<Project | null>(null); const [projects, setProjects] = useState<Project[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const refreshLibrary = useCallback(async () => { try { setProjects(await listProjects()); } catch (e: any) { setError(e.message); } }, []);
  useEffect(() => { void refreshLibrary(); }, [refreshLibrary]);
  const start = useCallback(async (input: Parameters<typeof createProject>[0]) => { setLoading(true); setError(''); try { const next = await createProject(input); setProject(next); return next; } catch (e: any) { setError(e.message); throw e; } finally { setLoading(false); } }, []);
  const patch = useCallback(async (changes: Partial<Project>) => { if (!project) return; await updateProject(project.id, changes); setProject({ ...project, ...changes }); }, [project]);
  const open = useCallback(async (id: string) => { setLoading(true); try { const next = await getProject(id); setProject(next); } finally { setLoading(false); } }, []);
  return { project, setProject, projects, loading, error, setError, start, patch, open, refreshLibrary };
}
