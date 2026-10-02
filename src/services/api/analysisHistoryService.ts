import axios from 'axios';
import type {
  AnalysisHistoryDetail,
  AnalysisHistoryFile,
  AnalysisHistoryLayoutRef,
  AnalysisHistoryListResponse,
  AnalysisHistorySource,
  AnalysisHistorySummary,
} from '../../types/analysisHistory';
import apiClient from '../api';

const sources = new Set<AnalysisHistorySource>(['upload', 'auto']);

export type AnalysisHistoryRequestErrorKind =
  | 'invalid_input'
  | 'invalid_response'
  | 'unauthorized'
  | 'not_found'
  | 'unavailable'
  | 'request_failed';

export class AnalysisHistoryRequestError extends Error {
  readonly kind: AnalysisHistoryRequestErrorKind;

  constructor(kind: AnalysisHistoryRequestErrorKind, message: string) {
    super(message);
    this.name = 'AnalysisHistoryRequestError';
    this.kind = kind;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isValidDate(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function resourceSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AnalysisHistoryRequestError('invalid_input', `${label} é obrigatório.`);
  }
  return encodeURIComponent(normalized);
}

function invalidResponse(): AnalysisHistoryRequestError {
  return new AnalysisHistoryRequestError(
    'invalid_response',
    'A API devolveu um histórico de análise inválido.'
  );
}

const missingLayoutName = 'Layout não informado';

// A API grava LayoutName como NULL-able (tbLpFiscalAnalysis); sem nome, mostra um rótulo em vez de
// invalidar a lista inteira.
function parseLayoutName(value: unknown): string | null {
  if (value === null || value === undefined) return missingLayoutName;
  if (typeof value !== 'string') return null;
  return value.trim() ? value : missingLayoutName;
}

function parseSummary(value: unknown): AnalysisHistorySummary {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.analysisId) ||
    !isValidDate(value.createdAt) ||
    !isValidDate(value.expiresAt) ||
    !isNonEmptyString(value.source) ||
    !sources.has(value.source as AnalysisHistorySource) ||
    parseLayoutName(value.layoutName) === null ||
    !isNullableString(value.layoutGuid) ||
    !isNullableString(value.detectedType) ||
    !isNonNegativeInteger(value.fileCount) ||
    !isNonNegativeInteger(value.totalSizeBytes)
  ) {
    throw invalidResponse();
  }

  return {
    analysisId: value.analysisId,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    source: value.source as AnalysisHistorySource,
    layoutName: parseLayoutName(value.layoutName) as string,
    layoutGuid: value.layoutGuid,
    detectedType: value.detectedType,
    fileCount: value.fileCount,
    totalSizeBytes: value.totalSizeBytes,
  };
}

function parseListResponse(value: unknown): AnalysisHistoryListResponse {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.page) ||
    !isNonNegativeInteger(value.pageSize) ||
    !isNonNegativeInteger(value.total) ||
    !Array.isArray(value.items)
  ) {
    throw invalidResponse();
  }

  return {
    page: value.page,
    pageSize: value.pageSize,
    total: value.total,
    items: value.items.map(parseSummary),
  };
}

function parseLayoutRef(value: unknown): AnalysisHistoryLayoutRef {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.mode) ||
    !sources.has(value.mode as AnalysisHistorySource) ||
    !isNullableString(value.layoutGuid) ||
    parseLayoutName(value.layoutName) === null ||
    !isNullableString(value.fileId)
  ) {
    throw invalidResponse();
  }

  return {
    mode: value.mode as AnalysisHistorySource,
    layoutGuid: value.layoutGuid,
    layoutName: parseLayoutName(value.layoutName) as string,
    fileId: value.fileId,
  };
}

function parseFile(value: unknown): AnalysisHistoryFile {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.fileId) ||
    !isNonEmptyString(value.role) ||
    !isNonEmptyString(value.fileName) ||
    !isNonNegativeInteger(value.sizeBytes) ||
    !isNonEmptyString(value.sha256) ||
    !isNonEmptyString(value.downloadUrl)
  ) {
    throw invalidResponse();
  }

  return {
    fileId: value.fileId,
    role: value.role,
    fileName: value.fileName,
    sizeBytes: value.sizeBytes,
    sha256: value.sha256,
    downloadUrl: value.downloadUrl,
  };
}

function parseDetail(value: unknown): AnalysisHistoryDetail {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.analysisId) ||
    !isValidDate(value.createdAt) ||
    !isValidDate(value.expiresAt) ||
    !isRecord(value.layout) ||
    !Array.isArray(value.files)
  ) {
    throw invalidResponse();
  }

  return {
    analysisId: value.analysisId,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    layout: parseLayoutRef(value.layout),
    files: value.files.map(parseFile),
  };
}

function mapRequestError(error: unknown): never {
  if (error instanceof AnalysisHistoryRequestError) throw error;
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      throw new AnalysisHistoryRequestError(
        'unauthorized',
        'Sua sessão não permite acessar o histórico de análises deste workspace.'
      );
    }
    if (status === 404) {
      throw new AnalysisHistoryRequestError(
        'not_found',
        'Esta análise não existe, expirou ou pertence a outro usuário.'
      );
    }
    if (status === 503) {
      throw new AnalysisHistoryRequestError(
        'unavailable',
        'O histórico de análises está temporariamente indisponível.'
      );
    }
    if (!error.response || (status !== undefined && status >= 500)) {
      throw new AnalysisHistoryRequestError(
        'unavailable',
        'O histórico de análises está temporariamente indisponível.'
      );
    }
  }
  throw new AnalysisHistoryRequestError(
    'request_failed',
    'Não foi possível concluir a operação no histórico de análises.'
  );
}

export const analysisHistoryService = {
  /** GET /api/workspaces/{workspaceId}/analyses (issue #366) — LayoutParserApi#366. */
  async listAnalyses(
    workspaceId: string,
    page = 1,
    pageSize = 20
  ): Promise<AnalysisHistoryListResponse> {
    const workspace = resourceSegment(workspaceId, 'Workspace');
    if (!Number.isInteger(page) || page < 1) {
      throw new AnalysisHistoryRequestError('invalid_input', '"page" deve ser >= 1.');
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new AnalysisHistoryRequestError(
        'invalid_input',
        '"pageSize" deve estar entre 1 e 100.'
      );
    }
    try {
      const response = await apiClient.get<unknown>(`/api/workspaces/${workspace}/analyses`, {
        params: { page, pageSize },
      });
      return parseListResponse(response.data);
    } catch (error) {
      return mapRequestError(error);
    }
  },

  async getAnalysis(workspaceId: string, analysisId: string): Promise<AnalysisHistoryDetail> {
    const workspace = resourceSegment(workspaceId, 'Workspace');
    const analysis = resourceSegment(analysisId, 'Análise');
    try {
      const response = await apiClient.get<unknown>(
        `/api/workspaces/${workspace}/analyses/${analysis}`
      );
      return parseDetail(response.data);
    } catch (error) {
      return mapRequestError(error);
    }
  },

  /** Baixa o arquivo como Blob — o chamador decide como entregá-lo (ex.: link temporário). */
  async downloadFile(workspaceId: string, analysisId: string, fileId: string): Promise<Blob> {
    const workspace = resourceSegment(workspaceId, 'Workspace');
    const analysis = resourceSegment(analysisId, 'Análise');
    const file = resourceSegment(fileId, 'Arquivo');
    try {
      const response = await apiClient.get<Blob>(
        `/api/workspaces/${workspace}/analyses/${analysis}/files/${file}`,
        { responseType: 'blob' }
      );
      return response.data;
    } catch (error) {
      return mapRequestError(error);
    }
  },

  async deleteAnalysis(workspaceId: string, analysisId: string): Promise<void> {
    const workspace = resourceSegment(workspaceId, 'Workspace');
    const analysis = resourceSegment(analysisId, 'Análise');
    try {
      await apiClient.delete(`/api/workspaces/${workspace}/analyses/${analysis}`);
    } catch (error) {
      mapRequestError(error);
    }
  },
};
