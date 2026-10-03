import axios from 'axios';
import type {
  FieldCorrectionCurationErrorInfo,
  FieldCorrectionCurationErrorKind,
  FieldCorrectionDecision,
  FieldCorrectionPendingResponse,
  FieldCorrectionReport,
  FieldCorrectionReviewResponse,
} from '../../types/fieldCorrectionCuration';
import apiClient from '../api';

/**
 * Erro tipado da curadoria de correções de campo : carrega a causa classificada em vez de achatar tudo em
 * `new Error(string)`.
 */
export class FieldCorrectionCurationError
  extends Error
  implements FieldCorrectionCurationErrorInfo
{
  readonly kind: FieldCorrectionCurationErrorKind;
  readonly httpStatus?: number;

  constructor(info: FieldCorrectionCurationErrorInfo) {
    super(info.message);
    this.name = 'FieldCorrectionCurationError';
    this.kind = info.kind;
    this.httpStatus = info.httpStatus;
  }
}

const convertFieldCorrectionCurationError = (error: unknown): FieldCorrectionCurationError => {
  if (!axios.isAxiosError(error)) {
    return new FieldCorrectionCurationError({
      kind: 'server_error',
      message: 'Não foi possível concluir a operação de curadoria. Tente novamente.',
    });
  }

  const response = error.response;

  if (!response) {
    const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
    return new FieldCorrectionCurationError({
      kind: 'network_error',
      message: isTimeout
        ? 'A requisição excedeu o tempo limite. Tente novamente em instantes.'
        : 'Não foi possível se comunicar com a API. Verifique sua conexão e se o serviço está no ar.',
    });
  }

  if (response.status === 404) {
    return new FieldCorrectionCurationError({
      kind: 'not_found',
      message: 'Este relatório de correção não existe mais ou já foi removido da fila.',
      httpStatus: 404,
    });
  }

  if (response.status === 409) {
    return new FieldCorrectionCurationError({
      kind: 'conflict',
      message:
        'Este relatório já foi revisado por outro curador — apenas itens pendentes podem ser decididos.',
      httpStatus: 409,
    });
  }

  return new FieldCorrectionCurationError({
    kind: 'server_error',
    message: 'O servidor encontrou uma falha ao processar a curadoria de correção de campo.',
    httpStatus: response.status,
  });
};

export const fieldCorrectionCurationService = {
  /**
   * Busca a fila de correções de campo pendentes de revisão, via
   * GET /api/transformation/field-correction/pending (issue #346).
   */
  async getPending(): Promise<FieldCorrectionReport[]> {
    try {
      const response = await apiClient.get<FieldCorrectionPendingResponse>(
        '/api/transformation/field-correction/pending'
      );
      return response.data.reports;
    } catch (error) {
      throw convertFieldCorrectionCurationError(error);
    }
  },

  /**
   * Registra a decisão do curador (aceitar/rejeitar) sobre um relatório, via
   * POST /api/transformation/field-correction/{reportId}/review. A resposta é mínima
   * (`{ reportId, status }`), não o relatório completo — a API só transiciona o status.
   * Um segundo review do mesmo reporte responde 409 (não é idempotente/no-op).
   */
  async review(
    reportId: string,
    decision: FieldCorrectionDecision
  ): Promise<FieldCorrectionReviewResponse> {
    try {
      const response = await apiClient.post<FieldCorrectionReviewResponse>(
        `/api/transformation/field-correction/${encodeURIComponent(reportId)}/review`,
        { decision }
      );
      return response.data;
    } catch (error) {
      throw convertFieldCorrectionCurationError(error);
    }
  },
};
