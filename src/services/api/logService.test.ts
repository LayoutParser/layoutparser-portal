import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api';
import { logService } from './logService';

vi.mock('../api', () => ({
  default: { post: vi.fn() },
}));

describe('logService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.post).mockResolvedValue({ data: {} });
  });

  it.each([
    ['info', 'Information'],
    ['warn', 'Warning'],
    ['error', 'Error'],
  ] as const)('envia o nível %s como %s, aceito pela API', (method, apiLevel) => {
    logService[method]('evento de teste');

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/logs/client',
      expect.objectContaining({ level: apiLevel, message: 'evento de teste' })
    );
  });

  it('não propaga falha de rede ao chamador', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('offline'));

    expect(() => logService.error('falha')).not.toThrow();
    await Promise.resolve();
  });
});
