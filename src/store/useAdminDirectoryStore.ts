import { create } from 'zustand';
import { adminDirectoryService, AdminRequestError } from '../services/api/adminDirectoryService';
import type { AdminUserSummary, AdminWorkspaceSummary } from '../types/member';

export const ADMIN_USERS_PAGE_SIZE = 50;

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AdminDirectoryState {
  /** 'unknown' até a sondagem terminar. */
  sudo: 'unknown' | 'checking' | 'yes' | 'no';
  workspacesStatus: LoadStatus;
  workspaces: AdminWorkspaceSummary[];
  workspacesError: string | null;
  /** Escolha explícita do sudo; a UI deriva o padrão quando for null. */
  selectedWorkspaceId: string | null;
  usersStatus: LoadStatus;
  users: AdminUserSummary[];
  usersSkip: number;
  usersHasNext: boolean;
  usersError: string | null;
  usersUnavailable: boolean;
  detectSudo: () => Promise<void>;
  selectWorkspace: (workspaceId: string) => void;
  loadWorkspaces: () => Promise<void>;
  loadUsers: (skip: number) => Promise<void>;
  reset: () => void;
}

const initialState = {
  sudo: 'unknown' as AdminDirectoryState['sudo'],
  workspacesStatus: 'idle' as LoadStatus,
  workspaces: [] as AdminWorkspaceSummary[],
  workspacesError: null as string | null,
  selectedWorkspaceId: null as string | null,
  usersStatus: 'idle' as LoadStatus,
  users: [] as AdminUserSummary[],
  usersSkip: 0,
  usersHasNext: false,
  usersError: null as string | null,
  usersUnavailable: false,
};

export const useAdminDirectoryStore = create<AdminDirectoryState>((set, get) => ({
  ...initialState,

  detectSudo: async () => {
    if (get().sudo !== 'unknown') return;
    set({ sudo: 'checking' });
    const isSudo = await adminDirectoryService.probeSudo();
    set({ sudo: isSudo ? 'yes' : 'no' });
  },

  selectWorkspace: workspaceId => set({ selectedWorkspaceId: workspaceId }),

  loadWorkspaces: async () => {
    set({ workspacesStatus: 'loading', workspacesError: null });
    try {
      const workspaces = await adminDirectoryService.listWorkspaces();
      set({ workspacesStatus: 'ready', workspaces });
    } catch (error) {
      set({
        workspacesStatus: 'error',
        workspacesError:
          error instanceof Error ? error.message : 'Não foi possível carregar os workspaces.',
      });
    }
  },

  loadUsers: async skip => {
    set({ usersStatus: 'loading', usersError: null, usersUnavailable: false });
    try {
      const users = await adminDirectoryService.listUsers({ skip, take: ADMIN_USERS_PAGE_SIZE });
      set({
        usersStatus: 'ready',
        users,
        usersSkip: skip,
        usersHasNext: users.length === ADMIN_USERS_PAGE_SIZE,
      });
    } catch (error) {
      set({
        usersStatus: 'error',
        usersError:
          error instanceof Error ? error.message : 'Não foi possível carregar os usuários.',
        usersUnavailable: error instanceof AdminRequestError && error.kind === 'unavailable',
      });
    }
  },

  reset: () => set(initialState),
}));
