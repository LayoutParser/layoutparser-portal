import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api';
import { MemberRequestError, workspaceMemberService } from './workspaceMemberService';

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const member = {
  userId: 'u1',
  displayName: null,
  email: 'ana@example.com',
  role: 'viewer',
  status: 'active',
  createdAt: '2026-09-30T00:00:00Z',
};

function httpError(status: number, data?: unknown) {
  return new AxiosError('falha', 'ERR', undefined, undefined, {
    status,
    data,
    statusText: '',
    headers: {},
    config: { headers: {} } as never,
  });
}

describe('workspaceMemberService', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.post).mockReset();
    vi.mocked(apiClient.patch).mockReset();
    vi.mocked(apiClient.delete).mockReset();
  });

  it('lista membros do workspace informado', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [member] });
    await expect(workspaceMemberService.listMembers('w 1')).resolves.toEqual([member]);
    expect(apiClient.get).toHaveBeenCalledWith('/api/workspaces/w%201/members');
  });

  it('rejeita resposta fora do contrato', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: [{ userId: 1 }] });
    await expect(workspaceMemberService.listMembers('w1')).rejects.toMatchObject({
      kind: 'failed',
    });
  });

  it.each([404, 503])('mapeia %s da listagem para recurso indisponível', async status => {
    vi.mocked(apiClient.get).mockRejectedValue(httpError(status));
    await expect(workspaceMemberService.listMembers('w1')).rejects.toMatchObject({
      kind: 'unavailable',
      message: expect.stringContaining('indisponível'),
    });
  });

  it('mapeia 409 da listagem para workspace pessoal', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(httpError(409, { error: 'x' }));
    await expect(workspaceMemberService.listMembers('w1')).rejects.toMatchObject({
      kind: 'personal',
    });
  });

  it('adiciona membro e propaga mensagens 400/409 da API', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: member });
    await expect(
      workspaceMemberService.addMember('w1', { email: 'ana@example.com', role: 'viewer' })
    ).resolves.toEqual(member);
    expect(apiClient.post).toHaveBeenCalledWith('/api/workspaces/w1/members', {
      email: 'ana@example.com',
      role: 'viewer',
    });

    vi.mocked(apiClient.post).mockRejectedValueOnce(httpError(409, { error: 'Já é membro.' }));
    await expect(
      workspaceMemberService.addMember('w1', { email: 'a@b.co', role: 'viewer' })
    ).rejects.toMatchObject({ kind: 'conflict', message: 'Já é membro.' });

    vi.mocked(apiClient.post).mockRejectedValueOnce(httpError(400, { error: 'E-mail inválido.' }));
    await expect(
      workspaceMemberService.addMember('w1', { email: 'a@b.co', role: 'viewer' })
    ).rejects.toBeInstanceOf(MemberRequestError);
  });

  it('altera papel e remove pelo id (convite ou membro)', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({});
    vi.mocked(apiClient.delete).mockResolvedValue({});
    await workspaceMemberService.updateRole('w1', 'u1', 'mapper');
    await workspaceMemberService.removeMember('w1', 'u1');
    expect(apiClient.patch).toHaveBeenCalledWith('/api/workspaces/w1/members/u1', {
      role: 'mapper',
    });
    expect(apiClient.delete).toHaveBeenCalledWith('/api/workspaces/w1/members/u1');
  });
});
