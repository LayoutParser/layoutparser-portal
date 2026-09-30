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
