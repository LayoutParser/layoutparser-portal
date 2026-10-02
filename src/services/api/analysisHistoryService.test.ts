import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api';
import { analysisHistoryService } from './analysisHistoryService';

vi.mock('../api', () => ({
  default: { get: vi.fn(), delete: vi.fn() },
}));

const summary = {
  analysisId: 'analysis-1',
  createdAt: '2026-09-20T12:00:00Z',
  expiresAt: '2026-12-19T12:00:00Z',
  source: 'upload',
  layoutName: 'LAY_TXT_MQSERIES_ENVNFE_4.00_NFe',
  layoutGuid: 'layout-guid-1',
  detectedType: 'nfe',
  fileCount: 2,
  totalSizeBytes: 4096,
};

describe('analysisHistoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lista análises paginadas do workspace (issue #366)', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { page: 1, pageSize: 20, total: 1, items: [summary] },
    });

    await expect(analysisHistoryService.listAnalyses('workspace-1')).resolves.toEqual({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [summary],
    });
    expect(apiClient.get).toHaveBeenCalledWith('/api/workspaces/workspace-1/analyses', {
      params: { page: 1, pageSize: 20 },
    });
  });

  it('aceita layoutGuid e detectedType nulos (layout fora do catálogo)', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        page: 1,
        pageSize: 20,
        total: 1,
        items: [{ ...summary, layoutGuid: null, detectedType: null }],
      },
    });

    await expect(analysisHistoryService.listAnalyses('workspace-1')).resolves.toMatchObject({
      items: [{ layoutGuid: null, detectedType: null }],
    });
  });

  it('aceita layoutName nulo ou vazio com rótulo padrão (coluna NULL-able na API)', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        page: 1,
        pageSize: 20,
        total: 2,
        items: [
          { ...summary, layoutName: null },
          { ...summary, analysisId: 'analysis-2', layoutName: '  ' },
        ],
      },
    });

    await expect(analysisHistoryService.listAnalyses('workspace-1')).resolves.toMatchObject({
      items: [{ layoutName: 'Layout não informado' }, { layoutName: 'Layout não informado' }],
    });
  });

  it('recusa paginação fora dos limites antes de chamar a API', async () => {
    await expect(analysisHistoryService.listAnalyses('workspace-1', 0)).rejects.toMatchObject({
      kind: 'invalid_input',
    });
    await expect(analysisHistoryService.listAnalyses('workspace-1', 1, 101)).rejects.toMatchObject({
      kind: 'invalid_input',
    });
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('recusa item com source fora do enum conhecido', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { page: 1, pageSize: 20, total: 1, items: [{ ...summary, source: 'manual' }] },
    });

    await expect(analysisHistoryService.listAnalyses('workspace-1')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('busca o detalhe de uma análise com layout e arquivos', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        analysisId: 'analysis-1',
        createdAt: '2026-09-20T12:00:00Z',
        expiresAt: '2026-12-19T12:00:00Z',
        layout: {
          mode: 'auto',
          layoutGuid: 'layout-guid-1',
          layoutName: 'LAY_TXT_MQSERIES_ENVNFE_4.00_NFe',
          fileId: null,
        },
        files: [
          {
            fileId: 'file-1',
            role: 'document',
            fileName: 'documento.txt',
            sizeBytes: 2048,
            sha256: 'abc123',
            downloadUrl: '/api/workspaces/workspace-1/analyses/analysis-1/files/file-1',
          },
        ],
      },
    });

    const detail = await analysisHistoryService.getAnalysis('workspace-1', 'analysis-1');
    expect(detail.layout.fileId).toBeNull();
    expect(detail.files).toHaveLength(1);
    expect(apiClient.get).toHaveBeenCalledWith('/api/workspaces/workspace-1/analyses/analysis-1');
  });

  it('trata 404 como "não existe" (dono diferente ou expirada), não como erro de permissão', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(
      Object.assign(new Error('not found'), {
        isAxiosError: true,
        response: { status: 404, data: {} },
      })
    );
    vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    await expect(
      analysisHistoryService.getAnalysis('workspace-1', 'analysis-1')
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('mapeia 503 para indisponibilidade temporária do histórico', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(
      Object.assign(new Error('unavailable'), {
        isAxiosError: true,
        response: { status: 503, data: {} },
      })
    );
    vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    await expect(analysisHistoryService.listAnalyses('workspace-1')).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('baixa o arquivo como blob', async () => {
    const blob = new Blob(['conteudo']);
    vi.mocked(apiClient.get).mockResolvedValue({ data: blob });

    await expect(
      analysisHistoryService.downloadFile('workspace-1', 'analysis-1', 'file-1')
    ).resolves.toBe(blob);
    expect(apiClient.get).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/analyses/analysis-1/files/file-1',
      { responseType: 'blob' }
    );
  });

  it('exclui a análise (204)', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ data: undefined });

    await expect(
      analysisHistoryService.deleteAnalysis('workspace-1', 'analysis-1')
    ).resolves.toBeUndefined();
    expect(apiClient.delete).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/analyses/analysis-1'
    );
  });
});
