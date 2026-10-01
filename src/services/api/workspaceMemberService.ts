import axios from 'axios';
import type { AddMemberRequest, AssignableMemberRole, WorkspaceMember } from '../../types/member';
import apiClient from '../api';

export type MemberRequestErrorKind =
  'unavailable' | 'forbidden' | 'personal' | 'conflict' | 'invalid' | 'failed';

export class MemberRequestError extends Error {
  readonly kind: MemberRequestErrorKind;

  constructor(kind: MemberRequestErrorKind, message: string) {
    super(message);
    this.name = 'MemberRequestError';
    this.kind = kind;
  }
}

const UNAVAILABLE_MESSAGE = 'Recurso ainda indisponível. Tente novamente mais tarde.';
export const PERSONAL_MESSAGE =
  'Este workspace ainda não aceita membros. Aguarde a liberação pela API.';

function apiMessage(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const data: unknown = error.response?.data;
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const message = (data as { error: unknown }).error;
    return typeof message === 'string' && message.trim() ? message : null;
  }
  return null;
}

function toMemberError(error: unknown, listing = false): MemberRequestError {
  if (!axios.isAxiosError(error)) {
    return new MemberRequestError('failed', 'Não foi possível concluir a operação.');
  }
  const status = error.response?.status;
  switch (status) {
    case 400:
      return new MemberRequestError('invalid', apiMessage(error) ?? 'E-mail ou papel inválido.');
    case 403:
      return new MemberRequestError('forbidden', 'Você não tem permissão para gerenciar membros.');
    case 404:
    case 503:
      return new MemberRequestError('unavailable', UNAVAILABLE_MESSAGE);
    case 409:
      // Na listagem, 409 significa workspace pessoal; nas mutações, conflito de regra.
      return listing
        ? new MemberRequestError('personal', PERSONAL_MESSAGE)
        : new MemberRequestError('conflict', apiMessage(error) ?? 'A operação entrou em conflito.');
    default:
      return new MemberRequestError('failed', 'Não foi possível concluir a operação.');
  }
}

/** A API serializa com WhenWritingNull: campo anulável chega ausente, null ou string. */
export function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

export function isMember(value: unknown): value is WorkspaceMember {
  if (typeof value !== 'object' || value === null) return false;
  const member = value as Record<string, unknown>;
  return (
    typeof member.userId === 'string' &&
    isOptionalString(member.email) &&
    typeof member.role === 'string' &&
    (member.status === 'active' || member.status === 'pending') &&
    isOptionalString(member.displayName)
  );
}

export const workspaceMemberService = {
  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    let data: unknown;
    try {
      data = (
        await apiClient.get<unknown>(`/api/workspaces/${encodeURIComponent(workspaceId)}/members`)
      ).data;
    } catch (error) {
      throw toMemberError(error, true);
    }
    if (!Array.isArray(data) || !data.every(isMember)) {
      throw new MemberRequestError('failed', 'Resposta inválida da lista de membros.');
    }
    return data;
  },

  async addMember(workspaceId: string, request: AddMemberRequest): Promise<WorkspaceMember> {
    try {
      const response = await apiClient.post<unknown>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/members`,
        request
      );
      if (!isMember(response.data)) {
        throw new MemberRequestError('failed', 'Resposta inválida ao adicionar a pessoa.');
      }
      return response.data;
    } catch (error) {
      throw error instanceof MemberRequestError ? error : toMemberError(error);
    }
  },

  async updateRole(workspaceId: string, userId: string, role: AssignableMemberRole): Promise<void> {
    try {
      await apiClient.patch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
        { role }
      );
    } catch (error) {
      throw toMemberError(error);
    }
  },

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    try {
      await apiClient.delete(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`
      );
    } catch (error) {
      throw toMemberError(error);
    }
  },
};
