import { create } from 'zustand';
import { MemberRequestError, workspaceMemberService } from '../services/api/workspaceMemberService';
import type { AddMemberRequest, AssignableMemberRole, WorkspaceMember } from '../types/member';

export type MembersLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface WorkspaceMembersState {
  workspaceId: string | null;
  status: MembersLoadStatus;
  members: WorkspaceMember[];
  /** Erro de carga da lista. */
  error: string | null;
  /** true quando 404/503: recurso ainda não publicado na API. */
  unavailable: boolean;
  /** Erro da última mutação (adicionar, alterar papel, remover). */
  actionError: string | null;
  /** Mensagem de sucesso da última mutação. */
  notice: string | null;
  busy: boolean;
  loadMembers: (workspaceId: string) => Promise<void>;
  addMember: (workspaceId: string, request: AddMemberRequest) => Promise<boolean>;
  updateRole: (workspaceId: string, userId: string, role: AssignableMemberRole) => Promise<boolean>;
  removeMember: (workspaceId: string, member: WorkspaceMember) => Promise<boolean>;
  clearFeedback: () => void;
  reset: () => void;
}

const initialState = {
  workspaceId: null as string | null,
  status: 'idle' as MembersLoadStatus,
  members: [] as WorkspaceMember[],
  error: null as string | null,
  unavailable: false,
  actionError: null as string | null,
  notice: null as string | null,
  busy: false,
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

export const useWorkspaceMembersStore = create<WorkspaceMembersState>((set, get) => {
  // Recarrega após mutação preservando o feedback recém-definido.
  const refresh = async (workspaceId: string) => {
    try {
      const members = await workspaceMemberService.listMembers(workspaceId);
      if (get().workspaceId === workspaceId) set({ members });
    } catch {
      // A mutação já teve sucesso; a lista será atualizada no próximo carregamento.
    }
  };

  return {
    ...initialState,

    loadMembers: async workspaceId => {
      set({
        ...initialState,
        workspaceId,
        status: 'loading',
      });
      try {
        const members = await workspaceMemberService.listMembers(workspaceId);
        if (get().workspaceId !== workspaceId) return;
        set({ status: 'ready', members });
      } catch (error) {
        if (get().workspaceId !== workspaceId) return;
        set({
          status: 'error',
          error: messageOf(error),
          unavailable: error instanceof MemberRequestError && error.kind === 'unavailable',
        });
      }
    },

    addMember: async (workspaceId, request) => {
      set({ busy: true, actionError: null, notice: null });
      try {
        const member = await workspaceMemberService.addMember(workspaceId, request);
        set({
          busy: false,
          notice:
            member.status === 'pending'
              ? `Convite criado para ${member.email}`
              : 'Pessoa adicionada',
        });
        await refresh(workspaceId);
        return true;
      } catch (error) {
        set({ busy: false, actionError: messageOf(error) });
        return false;
      }
    },

    updateRole: async (workspaceId, userId, role) => {
      set({ busy: true, actionError: null, notice: null });
      try {
        await workspaceMemberService.updateRole(workspaceId, userId, role);
        set({ busy: false, notice: 'Papel atualizado' });
        await refresh(workspaceId);
        return true;
      } catch (error) {
        set({ busy: false, actionError: messageOf(error) });
        await refresh(workspaceId);
        return false;
      }
    },

    removeMember: async (workspaceId, member) => {
      set({ busy: true, actionError: null, notice: null });
      try {
        await workspaceMemberService.removeMember(workspaceId, member.userId);
        set({
          busy: false,
          notice: member.status === 'pending' ? 'Convite cancelado' : 'Pessoa removida',
        });
        await refresh(workspaceId);
        return true;
      } catch (error) {
        set({ busy: false, actionError: messageOf(error) });
        return false;
      }
    },

    clearFeedback: () => set({ actionError: null, notice: null }),

    reset: () => set(initialState),
  };
});
