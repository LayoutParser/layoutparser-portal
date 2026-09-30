import axios from 'axios';
import type {
  AnswerMappingDraftRuleQuestionInput,
  CreateMappingDraftInput,
  MappingAuthoringEngine,
  MappingDraft,
  MappingDraftEvidence,
  MappingDraftListResponse,
  MappingDraftRule,
  MappingDraftRuleQuestionAnswer,
  MappingDraftRuleStatus,
  MappingDraftSummary,
  MappingSuggestionJob,
  MappingSuggestionJobStatus,
  SetFiscalProfileInput,
  UpdateMappingDraftRuleInput,
} from '../../types/mappingDraft';
import { MAPPING_DRAFT_RULE_ANSWER_MAX_LENGTH } from '../../types/mappingDraft';
import type {
  FiscalDocumentType,
  FiscalProfile,
  ResolvedXsdReference,
} from '../../types/workspace';
import apiClient from '../api';

const fiscalDocumentTypes = new Set<FiscalDocumentType>(['nfe', 'cte', 'mdfe', 'nfse', 'nfcom']);

const authoringEngines = new Set<MappingAuthoringEngine>(['tcl', 'xslt']);
const ruleStatuses = new Set<MappingDraftRuleStatus>([
  'proposed',
  'accepted',
  'edited',
  'rejected',
  'needs_input',
  'validated',
  'superseded',
]);
const jobStatuses = new Set<MappingSuggestionJobStatus>([
  'queued',
  'running',
  'completed',
  'failed',
  'canceled',
]);

export type MappingDraftRequestErrorKind =
  | 'invalid_input'
  | 'invalid_response'
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'precondition'
  | 'rejected'
  | 'unavailable'
  | 'request_failed';

export class MappingDraftRequestError extends Error {
  readonly kind: MappingDraftRequestErrorKind;
  readonly currentRule: MappingDraftRule | null;

  constructor(
    kind: MappingDraftRequestErrorKind,
    message: string,
    currentRule: MappingDraftRule | null = null
  ) {
    super(message);
    this.name = 'MappingDraftRequestError';
    this.kind = kind;
    this.currentRule = currentRule;
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
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
    throw new MappingDraftRequestError('invalid_input', `${label} é obrigatório.`);
  }
  return encodeURIComponent(normalized);
}

function invalidResponse(): MappingDraftRequestError {
  return new MappingDraftRequestError(
    'invalid_response',
    'A API devolveu um rascunho de mapping inválido.'
  );
}

function parseEvidence(value: unknown): MappingDraftEvidence {
  if (!isRecord(value) || !isNonEmptyString(value.kind) || !isNonEmptyString(value.reference)) {
    throw invalidResponse();
  }
  return value as unknown as MappingDraftEvidence;
}

function parseRule(value: unknown): MappingDraftRule {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.ruleId) ||
    !isNonEmptyString(value.draftId) ||
    !isStringArray(value.sourceRefs) ||
    !isStringArray(value.targetRefs) ||
    !isNonEmptyString(value.operation) ||
    typeof value.conditions !== 'string' ||
    typeof value.transformations !== 'string' ||
    !isNonEmptyString(value.cardinality) ||
    !Array.isArray(value.evidence) ||
    !isNonEmptyString(value.confidence) ||
    !isNonEmptyString(value.status) ||
    !ruleStatuses.has(value.status as MappingDraftRuleStatus) ||
    !isStringArray(value.questions) ||
    !isValidDate(value.createdAt) ||
    !isNonEmptyString(value.eTag)
  ) {
    throw invalidResponse();
  }

  return {
    ruleId: value.ruleId,
    draftId: value.draftId,
    sourceRefs: value.sourceRefs,
    targetRefs: value.targetRefs,
    operation: value.operation,
    conditions: value.conditions,
    transformations: value.transformations,
    cardinality: value.cardinality,
    evidence: value.evidence.map(parseEvidence),
    confidence: value.confidence,
    status: value.status as MappingDraftRuleStatus,
    questions: value.questions,
    createdAt: value.createdAt,
    eTag: value.eTag,
  };
}

function parseFiscalProfile(value: unknown): FiscalProfile {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.documentType) ||
    !fiscalDocumentTypes.has(value.documentType as FiscalDocumentType) ||
    !isNonEmptyString(value.schemaVersion) ||
    !isNonEmptyString(value.operation) ||
    (value.jurisdiction !== undefined && !isNullableString(value.jurisdiction))
  ) {
    throw invalidResponse();
  }
  return {
    documentType: value.documentType as FiscalDocumentType,
    schemaVersion: value.schemaVersion,
    operation: value.operation,
    ...(value.jurisdiction === undefined
      ? {}
      : { jurisdiction: value.jurisdiction as string | null }),
  };
}

function parseResolvedXsd(value: unknown): ResolvedXsdReference {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.xsdVersion) ||
    !isNonEmptyString(value.namespace) ||
    !isNonEmptyString(value.rootElement)
  ) {
    throw invalidResponse();
  }
  return {
    xsdVersion: value.xsdVersion,
    namespace: value.namespace,
    rootElement: value.rootElement,
  };
}

function parseQuestionAnswer(value: unknown): MappingDraftRuleQuestionAnswer {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.answerId) ||
    !isNonEmptyString(value.draftId) ||
    !isNonEmptyString(value.ruleId) ||
    typeof value.questionIndex !== 'number' ||
    !Number.isSafeInteger(value.questionIndex) ||
    value.questionIndex < 0 ||
    !isNonEmptyString(value.question) ||
    typeof value.answer !== 'string' ||
    !isNonEmptyString(value.answeredByUserId) ||
    !isNonEmptyString(value.answeredByName) ||
    !isValidDate(value.answeredAt) ||
    typeof value.version !== 'number' ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1
  ) {
    throw invalidResponse();
  }

  return {
    answerId: value.answerId,
    draftId: value.draftId,
    ruleId: value.ruleId,
    questionIndex: value.questionIndex,
    question: value.question,
    answer: value.answer,
    answeredByUserId: value.answeredByUserId,
    answeredByName: value.answeredByName,
    answeredAt: value.answeredAt,
    version: value.version,
  };
}

function parseQuestionAnswerList(value: unknown): MappingDraftRuleQuestionAnswer[] {
  if (!Array.isArray(value)) {
    throw invalidResponse();
  }
  return value.map(parseQuestionAnswer);
}

function parseNullableFiscalProfile(value: unknown): FiscalProfile | null {
  return value === undefined || value === null ? null : parseFiscalProfile(value);
}

function parseNullableResolvedXsd(value: unknown): ResolvedXsdReference | null {
  return value === undefined || value === null ? null : parseResolvedXsd(value);
}

function parseDraft(value: unknown): MappingDraft {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.draftId) ||
    !isNonEmptyString(value.workspaceId) ||
    !isNonEmptyString(value.packageId) ||
    !isNonEmptyString(value.revisionId) ||
    !isNonEmptyString(value.engine) ||
    !authoringEngines.has(value.engine as MappingAuthoringEngine) ||
    !isValidDate(value.createdAt) ||
    !Array.isArray(value.rules)
  ) {
    throw invalidResponse();
  }

  const rules = value.rules.map(parseRule);
  if (rules.some(rule => rule.draftId !== value.draftId)) {
    throw invalidResponse();
  }

  return {
    draftId: value.draftId,
    workspaceId: value.workspaceId,
    packageId: value.packageId,
    revisionId: value.revisionId,
    engine: value.engine as MappingAuthoringEngine,
    createdAt: value.createdAt,
    rules,
    fiscalProfile: parseNullableFiscalProfile(value.fiscalProfile),
    resolvedXsd: parseNullableResolvedXsd(value.resolvedXsd),
  };
}

/**
 * Item do catálogo de drafts (issue #198, parte 1) — GET .../mapping-drafts. Confirmado por
 * @lp-contract-qa em 2026-09-22 (LayoutParserApi#416/PR#420): sem `layoutGuid`/`status`/
 * `updatedAt` no item.
 */
function parseDraftSummary(value: unknown): MappingDraftSummary {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.draftId) ||
    !isNonEmptyString(value.workspaceId) ||
    !isNonEmptyString(value.packageId) ||
    !isNonEmptyString(value.revisionId) ||
    !isNonEmptyString(value.engine) ||
    !authoringEngines.has(value.engine as MappingAuthoringEngine) ||
    !isValidDate(value.createdAt) ||
    !isNonNegativeInteger(value.rulesCount)
  ) {
    throw invalidResponse();
  }

  return {
    draftId: value.draftId,
    workspaceId: value.workspaceId,
    packageId: value.packageId,
    revisionId: value.revisionId,
    engine: value.engine as MappingAuthoringEngine,
    createdAt: value.createdAt,
    rulesCount: value.rulesCount,
    fiscalProfile: parseNullableFiscalProfile(value.fiscalProfile),
  };
}

function parseDraftListResponse(value: unknown): MappingDraftListResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !isNonNegativeInteger(value.page) ||
    !isNonNegativeInteger(value.pageSize) ||
    !isNonNegativeInteger(value.totalCount)
  ) {
    throw invalidResponse();
  }

  return {
    items: value.items.map(parseDraftSummary),
    page: value.page,
    pageSize: value.pageSize,
    totalCount: value.totalCount,
  };
}

function parseJob(value: unknown): MappingSuggestionJob {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.jobId) ||
    !isNonEmptyString(value.status) ||
    !jobStatuses.has(value.status as MappingSuggestionJobStatus) ||
    (value.rulesCreated !== undefined &&
      (typeof value.rulesCreated !== 'number' ||
        !Number.isSafeInteger(value.rulesCreated) ||
        value.rulesCreated < 0)) ||
    (value.error !== undefined && !isNullableString(value.error))
  ) {
    throw invalidResponse();
  }

  return {
    jobId: value.jobId,
    status: value.status as MappingSuggestionJobStatus,
    ...(value.rulesCreated === undefined ? {} : { rulesCreated: value.rulesCreated as number }),
    ...(value.error === undefined ? {} : { error: value.error as string | null }),
  };
}

function responseMessage(data: unknown): string | null {
  return isRecord(data) && isNonEmptyString(data.error) ? data.error : null;
}

function mapRequestError(error: unknown): never {
  if (error instanceof MappingDraftRequestError) {
    throw error;
  }

  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const message = responseMessage(error.response?.data);
    if (status === 401 || status === 403) {
      throw new MappingDraftRequestError(
        'unauthorized',
        'Sua sessão não permite revisar mappings neste workspace.'
      );
    }
    if (status === 404) {
      throw new MappingDraftRequestError(
        'not_found',
        'O draft, pacote ou workspace não foi encontrado para esta identidade.'
      );
    }
    if (status === 412) {
      const current = isRecord(error.response?.data) ? error.response.data.current : null;
      let currentRule: MappingDraftRule | null = null;
      if (current !== null && current !== undefined) {
        try {
          currentRule = parseRule(current);
        } catch {
          currentRule = null;
        }
      }
      throw new MappingDraftRequestError(
        'conflict',
        message ?? 'A regra mudou em outra sessão. O estado atual foi recarregado.',
        currentRule
      );
    }
    if (status === 428) {
      throw new MappingDraftRequestError(
        'precondition',
        message ?? 'A API exigiu uma versão atual da regra para salvar.'
      );
    }
    if (status === 400 || status === 422) {
      throw new MappingDraftRequestError(
        'rejected',
        message ?? 'A API recusou a alteração proposta para o mapping.'
      );
    }
    if (!error.response || status === 503 || (status !== undefined && status >= 500)) {
      throw new MappingDraftRequestError(
        'unavailable',
        'O serviço de revisão de mappings está temporariamente indisponível.'
      );
    }
  }

  throw new MappingDraftRequestError(
    'request_failed',
    'Não foi possível concluir a operação no Mapping Studio.'
  );
}

export const mappingDraftService = {
  /**
   * Lista drafts TCL/XSLT do workspace (issue #198, parte 1) —
   * GET /api/workspaces/{workspaceId}/mapping-drafts. Contrato confirmado por @lp-contract-qa
   * em 2026-09-22 (LayoutParserApi#416/PR#420), sem drift contra origin/develop.
   */
  async listDrafts(
    workspaceId: string,
    page = 1,
    pageSize = 20,
    engine?: MappingAuthoringEngine
  ): Promise<MappingDraftListResponse> {
    const workspace = resourceSegment(workspaceId, 'Workspace');
    if (!Number.isInteger(page) || page < 1) {
      throw new MappingDraftRequestError('invalid_input', '"page" deve ser >= 1.');
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new MappingDraftRequestError('invalid_input', '"pageSize" deve estar entre 1 e 100.');
    }
    if (engine !== undefined && !authoringEngines.has(engine)) {
      throw new MappingDraftRequestError(
        'invalid_input',
        'O filtro de engine só aceita TCL ou XSLT.'
      );
    }

    try {
      const response = await apiClient.get<unknown>(`/api/workspaces/${workspace}/mapping-drafts`, {
        params: { page, pageSize, ...(engine ? { engine } : {}) },
      });
      return parseDraftListResponse(response.data);
    } catch (error) {
      return mapRequestError(error);
    }
  },

  async createDraft(input: CreateMappingDraftInput): Promise<MappingDraft> {
    const workspace = resourceSegment(input.workspaceId, 'Workspace');
    const packageId = resourceSegment(input.packageId, 'Pacote');
    const revisionId = resourceSegment(input.revisionId, 'Revisão');
    if (!authoringEngines.has(input.engine)) {
      throw new MappingDraftRequestError(
        'invalid_input',
        'Somente TCL e XSLT podem possuir drafts de autoria.'
      );
    }

    try {
      const response = await apiClient.post<unknown>(
        `/api/workspaces/${workspace}/mapping-packages/${packageId}/drafts`,
        { revisionId: decodeURIComponent(revisionId), engine: input.engine }
      );
      return parseDraft(response.data);
    } catch (error) {
      return mapRequestError(error);
    }
  },

  async getDraft(workspaceId: string, draftId: string): Promise<MappingDraft> {
    const workspace = resourceSegment(workspaceId, 'Workspace');
    const draft = resourceSegment(draftId, 'Draft');
    try {
      const response = await apiClient.get<unknown>(
        `/api/workspaces/${workspace}/mapping-drafts/${draft}`
      );
      return parseDraft(response.data);
    } catch (error) {
      return mapRequestError(error);
    }
  },

  async createSuggestion(workspaceId: string, draftId: string): Promise<MappingSuggestionJob> {
    const workspace = resourceSegment(workspaceId, 'Workspace');
    const draft = resourceSegment(draftId, 'Draft');
    try {
      const response = await apiClient.post<unknown>(
        `/api/workspaces/${workspace}/mapping-drafts/${draft}/suggestions`
      );
      return parseJob(response.data);
    } catch (error) {
      return mapRequestError(error);
    }
  },

  async getSuggestion(
    workspaceId: string,
    draftId: string,
    jobId: string
  ): Promise<MappingSuggestionJob> {
    const workspace = resourceSegment(workspaceId, 'Workspace');
    const draft = resourceSegment(draftId, 'Draft');
    const job = resourceSegment(jobId, 'Job');
    try {
      const response = await apiClient.get<unknown>(
        `/api/workspaces/${workspace}/mapping-drafts/${draft}/suggestions/${job}`
      );
      return parseJob(response.data);
    } catch (error) {
      return mapRequestError(error);
    }
  },

  async cancelSuggestion(workspaceId: string, draftId: string, jobId: string): Promise<void> {
    const workspace = resourceSegment(workspaceId, 'Workspace');
    const draft = resourceSegment(draftId, 'Draft');
    const job = resourceSegment(jobId, 'Job');
    try {
      await apiClient.delete(
        `/api/workspaces/${workspace}/mapping-drafts/${draft}/suggestions/${job}`
      );
    } catch (error) {
      return mapRequestError(error);
    }
  },

  async updateRule(input: UpdateMappingDraftRuleInput): Promise<MappingDraftRule> {
    const workspace = resourceSegment(input.workspaceId, 'Workspace');
    const draft = resourceSegment(input.draftId, 'Draft');
    const rule = resourceSegment(input.ruleId, 'Regra');
    if (!isNonEmptyString(input.eTag)) {
      throw new MappingDraftRequestError(
        'invalid_input',
        'A versão atual da regra é obrigatória para salvar.'
      );
    }

    const body = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.justification?.trim() ? { justification: input.justification.trim() } : {}),
      ...(input.sourceRefs ? { sourceRefs: input.sourceRefs } : {}),
      ...(input.targetRefs ? { targetRefs: input.targetRefs } : {}),
      ...(input.operation?.trim() ? { operation: input.operation.trim() } : {}),
      ...(input.answer?.trim() ? { answer: input.answer.trim() } : {}),
    };

    try {
      const response = await apiClient.patch<unknown>(
        `/api/workspaces/${workspace}/mapping-drafts/${draft}/rules/${rule}`,
        body,
        { headers: { 'If-Match': `\"${input.eTag.trim().replace(/^\"|\"$/g, '')}\"` } }
      );
      return parseRule(response.data);
    } catch (error) {
      return mapRequestError(error);
    }
  },

  /**
   * Persiste a resposta a uma pergunta aberta (`MappingDraftRule.questions[questionIndex]`) via
   * `PUT .../rules/{ruleId}/questions/{questionIndex}/answer` (LayoutParserApi#422). Idempotente
   * para o mesmo texto; texto diferente cria versão nova no histórico append-only.
   */
  async answerRuleQuestion(
    input: AnswerMappingDraftRuleQuestionInput
  ): Promise<MappingDraftRuleQuestionAnswer> {
    const workspace = resourceSegment(input.workspaceId, 'Workspace');
    const draft = resourceSegment(input.draftId, 'Draft');
    const rule = resourceSegment(input.ruleId, 'Regra');
    if (!Number.isSafeInteger(input.questionIndex) || input.questionIndex < 0) {
      throw new MappingDraftRequestError('invalid_input', 'Índice de pergunta inválido.');
    }
    const answer = input.answer.trim();
    if (!answer) {
      throw new MappingDraftRequestError('invalid_input', 'A resposta não pode ficar em branco.');
    }
    if (answer.length > MAPPING_DRAFT_RULE_ANSWER_MAX_LENGTH) {
      throw new MappingDraftRequestError(
        'invalid_input',
        `A resposta não pode ter mais de ${MAPPING_DRAFT_RULE_ANSWER_MAX_LENGTH} caracteres.`
      );
    }

    try {
      const response = await apiClient.put<unknown>(
        `/api/workspaces/${workspace}/mapping-drafts/${draft}/rules/${rule}/questions/${input.questionIndex}/answer`,
        { answer }
      );
      return parseQuestionAnswer(response.data);
    } catch (error) {
      return mapRequestError(error);
    }
  },

  /** Lista todas as respostas de perguntas abertas do draft. */
  async listDraftQuestionAnswers(
    workspaceId: string,
    draftId: string,
    options?: { includeHistory?: boolean }
  ): Promise<MappingDraftRuleQuestionAnswer[]> {
    const workspace = resourceSegment(workspaceId, 'Workspace');
    const draft = resourceSegment(draftId, 'Draft');
    try {
      const response = await apiClient.get<unknown>(
        `/api/workspaces/${workspace}/mapping-drafts/${draft}/question-answers`,
        options?.includeHistory ? { params: { includeHistory: true } } : undefined
      );
      return parseQuestionAnswerList(response.data);
    } catch (error) {
      return mapRequestError(error);
    }
  },

  /** Lista as respostas de perguntas abertas de uma regra específica. */
  async listRuleQuestionAnswers(
    workspaceId: string,
    draftId: string,
    ruleId: string,
    options?: { includeHistory?: boolean }
  ): Promise<MappingDraftRuleQuestionAnswer[]> {
    const workspace = resourceSegment(workspaceId, 'Workspace');
    const draft = resourceSegment(draftId, 'Draft');
    const rule = resourceSegment(ruleId, 'Regra');
    try {
      const response = await apiClient.get<unknown>(
        `/api/workspaces/${workspace}/mapping-drafts/${draft}/rules/${rule}/question-answers`,
        options?.includeHistory ? { params: { includeHistory: true } } : undefined
      );
      return parseQuestionAnswerList(response.data);
    } catch (error) {
      return mapRequestError(error);
    }
  },

  /**
   * Grava o perfil fiscal do draft (issue #198). PUT idempotente — não retroage releases já
   * emitidas. A API pode recusar com 422 (ex.: documentType sem XSD configurado, schemaVersion
   * não instalada); isso mapeia para `MappingDraftRequestError('rejected', ...)`.
   */
  async setFiscalProfile(input: SetFiscalProfileInput): Promise<MappingDraft> {
    const workspace = resourceSegment(input.workspaceId, 'Workspace');
    const draft = resourceSegment(input.draftId, 'Draft');
    if (
      !isNonEmptyString(input.profile.documentType) ||
      !fiscalDocumentTypes.has(input.profile.documentType) ||
      !isNonEmptyString(input.profile.schemaVersion) ||
      !isNonEmptyString(input.profile.operation)
    ) {
      throw new MappingDraftRequestError(
        'invalid_input',
        'Tipo de documento, versão de schema e operação são obrigatórios para o perfil fiscal.'
      );
    }

    try {
      const response = await apiClient.put<unknown>(
        `/api/workspaces/${workspace}/mapping-drafts/${draft}/fiscal-profile`,
        {
          documentType: input.profile.documentType,
          schemaVersion: input.profile.schemaVersion,
          operation: input.profile.operation,
          ...(input.profile.jurisdiction !== undefined
            ? { jurisdiction: input.profile.jurisdiction }
            : {}),
        }
      );
      return parseDraft(response.data);
    } catch (error) {
      return mapRequestError(error);
    }
  },
};
