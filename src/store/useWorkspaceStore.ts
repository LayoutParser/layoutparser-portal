import { create } from 'zustand';
import { workspaceService } from '../services/api/workspaceService';
import type { FiscalWorkspaceSummary, WorkspaceLoadStatus } from '../types/workspace';

interface WorkspaceState {
  status: WorkspaceLoadStatus;
  workspaces: FiscalWorkspaceSummary[];
  activeWorkspaceId: string | null;
  error: string | null;
  /** Vem de GET /api/workspaces/me; undefined = API antiga (cair no probe administrativo). */
  isSudo: boolean | undefined;
  loadWorkspaces: (force?: boolean) => Promise<void>;
  selectWorkspace: (workspaceId: string) => void;
  reset: () => void;
}

const initialWorkspaceState = {
  status: 'idle' as const,
  workspaces: [] as FiscalWorkspaceSummary[],
  activeWorkspaceId: null as string | null,
  error: null as string | null,
  isSudo: undefined as boolean | undefined,
};

// Promise da carga em andamento: permite que chamadores concorrentes (ex.: o upload) aguardem
// a mesma requisição em vez de retornar antes de o workspace ativo estar disponível.
let inflightLoad: Promise<void> | null = null;

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...initialWorkspaceState,

  loadWorkspaces: async (force = false) => {
    const currentStatus = get().status;
    if (currentStatus === 'loading' && inflightLoad) {
      return inflightLoad;
    }
    if (currentStatus === 'loading' || (!force && currentStatus === 'ready')) {
      return;
    }

    set({ status: 'loading', error: null });
    inflightLoad = (async () => {
      try {
        const response = await workspaceService.getCurrentWorkspaces();
        set({
          status: 'ready',
          workspaces: response.workspaces,
          activeWorkspaceId: response.activeWorkspaceId,
          isSudo: response.isSudo,
          error: null,
        });
      } catch (error) {
        set({
          status: 'error',
          workspaces: [],
          activeWorkspaceId: null,
          isSudo: undefined,
          error:
            error instanceof Error
              ? error.message
              : 'Não foi possível carregar seu workspace fiscal.',
        });
      } finally {
        inflightLoad = null;
      }
    })();
    return inflightLoad;
  },

  selectWorkspace: workspaceId => {
    if (get().workspaces.some(workspace => workspace.workspaceId === workspaceId)) {
      set({ activeWorkspaceId: workspaceId });
    }
  },

  reset: () => set(initialWorkspaceState),
}));
