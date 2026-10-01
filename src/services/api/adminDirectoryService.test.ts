import { AxiosError, type AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api';
import { adminDirectoryService } from './adminDirectoryService';

function httpError(status: number, data?: unknown) {
  return new AxiosError('x', String(status), undefined, undefined, {
    status,
    data,
  } as AxiosResponse);
}

describe('adminDirectoryService.promoteWorkspace', () => {
  afterEach(() => vi.restoreAllMocks());

  it('envia PATCH com kind team e nome', async () => {
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ status: 204 });
    await adminDirectoryService.promoteWorkspace('a/b', { name: 'Time' });
    expect(patch).toHaveBeenCalledWith('/api/admin/workspaces/a%2Fb', {
      kind: 'team',
      name: 'Time',
    });
  });

  it.each([
    [400, { error: 'Nome inválido.' }, 'Nome inválido.'],
    [404, undefined, 'Recurso ainda indisponível ou sem permissão.'],
    [503, undefined, 'Serviço indisponível. Tente novamente.'],
  ])('mapeia %s', async (status, data, message) => {
    vi.spyOn(apiClient, 'patch').mockRejectedValue(httpError(status, data));
    await expect(adminDirectoryService.promoteWorkspace('w', { name: 'x' })).rejects.toThrow(
      message
    );
  });
});

describe('adminDirectoryService payload com campos nulos ausentes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('aceita usuário sem email em /api/admin/users', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: [
        { userId: 'u-1', workspaceCount: 1, createdAt: '2026-09-01T10:00:00Z' },
        { userId: 'u-2', email: 'pessoa@exemplo.test', workspaceCount: 2, createdAt: '2026-09-02' },
      ],
    });
    const users = await adminDirectoryService.listUsers({ take: 50 });
    expect(users).toHaveLength(2);
    expect(users[0].email).toBeUndefined();
  });

  it('rejeita email com tipo inválido', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: [{ userId: 'u-1', email: 42, workspaceCount: 1, createdAt: 'x' }],
    });
    await expect(adminDirectoryService.listUsers({ take: 50 })).rejects.toThrow(
      'Resposta inválida da API administrativa.'
    );
  });

  it('aceita membro sem displayName e sem email', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: [{ userId: 'u-1', role: 'viewer', status: 'active', createdAt: '2026-09-01' }],
    });
    await expect(adminDirectoryService.listMembers('w-1')).resolves.toHaveLength(1);
  });
});
