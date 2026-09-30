/**
 * Histórico de análises fiscais (LayoutParserApi#366): os arquivos que o usuário anexou junto
 * com o layout ao processar um documento, agrupados sob um `analysisId` durável (Arquivo de
 * análises, retenção de 90 dias).
 *
 * Ainda em `develop` na API, não em produção (falta definir pasta de armazenamento no servidor).
 */

export type AnalysisHistorySource = 'upload' | 'auto';

export interface AnalysisHistorySummary {
  analysisId: string;
  createdAt: string;
  expiresAt: string;
  source: AnalysisHistorySource;
  layoutName: string;
  /** `null` quando o layout não veio do catálogo (ex.: upload manual sem GUID resolvido). */
  layoutGuid: string | null;
  detectedType: string | null;
  fileCount: number;
  totalSizeBytes: number;
}

export interface AnalysisHistoryListResponse {
  page: number;
  pageSize: number;
  total: number;
  items: AnalysisHistorySummary[];
}

export interface AnalysisHistoryLayoutRef {
  mode: AnalysisHistorySource;
  layoutGuid: string | null;
  layoutName: string;
  /** `null` quando o layout não foi copiado para o histórico (ex.: veio do catálogo em `/auto`). */
  fileId: string | null;
}

export interface AnalysisHistoryFile {
  fileId: string;
  role: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
}

export interface AnalysisHistoryDetail {
  analysisId: string;
  createdAt: string;
  expiresAt: string;
  layout: AnalysisHistoryLayoutRef;
  files: AnalysisHistoryFile[];
}
