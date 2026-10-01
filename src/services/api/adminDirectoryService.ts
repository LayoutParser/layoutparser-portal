import axios from 'axios';
import type {
  AdminPageParams,
  AdminUserSummary,
  AdminWorkspaceSummary,
  WorkspaceMember,
} from '../../types/member';
import apiClient from '../api';
import { isMember, isOptionalString } from './workspaceMemberService';

export type AdminRequestErrorKind = 'unavailable' | 'failed';

export class AdminRequestError extends Error {
  readonly kind: AdminRequestErrorKind;

  constructor(kind: AdminRequestErrorKind, message: string) {
    super(message);
    this.name = 'AdminRequestError';
    this.kind = kind;
  }
}

export const ADMIN_UNAVAILABLE_MESSAGE = 'Recurso ainda indisponível. Tente novamente mais tarde.';

function toAdminError(error: unknown, notFoundMessage?: string): AdminRequestError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 404 && notFoundMessage) return new AdminRequestError('failed', notFoundMessage);
    if (status === 404 || status === 503) {
      return new AdminRequestError('unavailable', ADMIN_UNAVAILABLE_MESSAGE);
    }
  }
  return new AdminRequestError('failed', 'Não foi possível carregar os dados administrativos.');
}

function isAdminWorkspace(value: unknown): value is AdminWorkspaceSummary {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.workspaceId === 'string' &&
    typeof item.name === 'string' &&
    typeof item.kind === 'string' &&
    typeof item.memberCount === 'number'
  );
}

function isAdminUser(value: unknown): value is AdminUserSummary {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.userId === 'string' &&
    isOptionalString(item.email) &&
    typeof item.workspaceCount === 'number'
  );
}

// O `request` recebe a chamada com o caminho literal: o contract:check só enxerga endpoints
// escritos literalmente em `apiClient.<verbo>(...)`.
async function getList<T>(
  request: () => Promise<{ data: unknown }>,
  guard: (value: unknown) => value is T,
  notFoundMessage?: string
): Promise<T[]> {
  let data: unknown;
  try {
    data = (await request()).data;
  } catch (error) {
    throw toAdminError(error, notFoundMessage);
  }
  if (!Array.isArray(data) || !data.every(guard)) {
    throw new AdminRequestError('failed', 'Resposta inválida da API administrativa.');
  }
  return data;
}

/** Visão sudo (somente leitura). Não-sudo recebe 404 de corpo vazio em /api/admin/*. */
export const adminDirectoryService = {
  /** 200 = sudo; qualquer outra resposta (404, 401, rede) = não sudo. */
  async probeSudo(): Promise<boolean> {
    try {
      await apiClient.get('/api/admin/workspaces', { params: { take: 1 } });
      return true;
    } catch {
      return false;
    }
  },

  listWorkspaces(params: AdminPageParams = { take: 200 }): Promise<AdminWorkspaceSummary[]> {
    return getList(
      () => apiClient.get<unknown>('/api/admin/workspaces', { params }),
      isAdminWorkspace
    );
  },

  listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    return getList(
      () =>
        apiClient.get<unknown>(`/api/admin/workspaces/${encodeURIComponent(workspaceId)}/members`),
      isMember,
      'Workspace não encontrado.'
    );
  },

  /** Promove workspace pessoal a time (204). Só sudo; nunca rebaixa. */
  async promoteWorkspace(workspaceId: string, body: { name: string }): Promise<void> {
    try {
      await apiClient.patch(`/api/admin/workspaces/${encodeURIComponent(workspaceId)}`, {
        kind: 'team',
        name: body.name,
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 400) {
          const detail = (error.response?.data as { error?: unknown } | undefined)?.error;
          throw new AdminRequestError(
            'failed',
            typeof detail === 'string' && detail.trim()
              ? detail
              : 'Dados inválidos para a promoção.'
          );
        }
        if (status === 404) {
          throw new AdminRequestError(
            'unavailable',
            'Recurso ainda indisponível ou sem permissão.'
          );
        }
        if (status === 503) {
          throw new AdminRequestError('unavailable', 'Serviço indisponível. Tente novamente.');
        }
      }
      throw new AdminRequestError('failed', 'Não foi possível promover o workspace.');
    }
  },

  listUsers(params: AdminPageParams): Promise<AdminUserSummary[]> {
    return getList(() => apiClient.get<unknown>('/api/admin/users', { params }), isAdminUser);
  },
};
