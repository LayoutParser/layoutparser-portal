import axios from 'axios';
import type {
  CurrentWorkspacesResponse,
  FiscalWorkspaceSummary,
  LayoutTreeCardinality,
  LayoutTreeNode,
  LayoutTreeNodeKind,
  LayoutTreeResponse,
  LayoutTreeRuleLink,
  LayoutTreeSide,
  MappingEngine,
  MappingEngineCapabilities,
  MappingEvidenceReference,
  MappingExplanation,
  MappingRuleExplanation,
  MappingSchemaReference,
  MappingSupportLevel,
} from '../../types/workspace';
import apiClient from '../api';

type WorkspaceRequestErrorKind =
  'unauthorized' | 'unavailable' | 'invalid_response' | 'request_failed';

export class WorkspaceRequestError extends Error {
  readonly kind: WorkspaceRequestErrorKind;

  constructor(kind: WorkspaceRequestErrorKind, message: string) {
    super(message);
    this.name = 'WorkspaceRequestError';
    this.kind = kind;
  }
}

const workspaceKinds = new Set(['personal', 'team', 'organization']);
const workspaceRoles = new Set([
  'owner',
  'fiscal_admin',
  'mapper',
  'reviewer',
  'operator',
  'viewer',
]);
const mappingEngines = new Set<MappingEngine>(['tcl', 'xslt', 'sysmiddle']);
const layoutTreeNodeKinds = new Set<LayoutTreeNodeKind>(['element', 'attribute', 'group']);
const mappingSupportLevels = new Set<MappingSupportLevel>([
  'authoritative',
  'best_effort',
  'opaque',
  'unsupported',
]);

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

function isNullableInteger(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value));
}

function invalidExplanation(): WorkspaceRequestError {
  return new WorkspaceRequestError(
    'invalid_response',
    'A API devolveu uma explicação de mapping inválida.'
  );
}

function invalidLayoutTree(): WorkspaceRequestError {
  return new WorkspaceRequestError(
    'invalid_response',
    'A API devolveu uma árvore de layout inválida.'
  );
}

function parseCapabilities(value: unknown): MappingEngineCapabilities {
  if (
    !isRecord(value) ||
    typeof value.execute !== 'boolean' ||
    typeof value.explain !== 'boolean' ||
    typeof value.author !== 'boolean' ||
    typeof value.compile !== 'boolean' ||
    typeof value.publish !== 'boolean'
  ) {
    throw invalidExplanation();
  }

  return value as unknown as MappingEngineCapabilities;
}

function parseSchema(value: unknown): MappingSchemaReference | null {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !isNullableString(value.layoutGuid) ||
    !isNullableString(value.description)
  ) {
    throw invalidExplanation();
  }
  return value as unknown as MappingSchemaReference;
}

function parseEvidence(value: unknown): MappingEvidenceReference {
  if (!isRecord(value) || !isNonEmptyString(value.kind) || !isNonEmptyString(value.reference)) {
    throw invalidExplanation();
  }
  return value as unknown as MappingEvidenceReference;
}

function parseExplainedRule(value: unknown): MappingRuleExplanation {
  if (!isRecord(value)) {
    throw invalidExplanation();
  }

  // A API pode omitir totalmente a chave `condition`/`technicalDetail` quando não há valor
  // (em vez de enviar `null` explícito). Tratamos ausência de chave como equivalente a `null`
  // apenas para esses dois campos — os demais continuam exigindo o formato original.
  const condition = value.condition ?? null;
  const technicalDetail = value.technicalDetail ?? null;

  if (
    !isNonEmptyString(value.ruleId) ||
    !isStringArray(value.sourceRefs) ||
    !isStringArray(value.targetRefs) ||
    !isNullableString(condition) ||
    !isStringArray(value.operations) ||
    !isNonEmptyString(value.cardinality) ||
    !Array.isArray(value.evidence) ||
    !isNonEmptyString(value.humanDescription) ||
    !isNullableString(technicalDetail) ||
    !isNonEmptyString(value.supportLevel) ||
    !mappingSupportLevels.has(value.supportLevel as MappingSupportLevel)
  ) {
    throw invalidExplanation();
  }

  return {
    ruleId: value.ruleId,
    sourceRefs: value.sourceRefs,
    targetRefs: value.targetRefs,
    condition,
    operations: value.operations,
    cardinality: value.cardinality,
    evidence: value.evidence.map(parseEvidence),
    humanDescription: value.humanDescription,
    technicalDetail,
    supportLevel: value.supportLevel as MappingSupportLevel,
  };
}

function parseMappingExplanation(value: unknown): MappingExplanation {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.mappingId) ||
    !isNonEmptyString(value.version) ||
    !isNonEmptyString(value.engine) ||
    !mappingEngines.has(value.engine as MappingEngine) ||
    !Array.isArray(value.rules) ||
    !isNullableString(value.description) ||
    !isStringArray(value.limitations) ||
    typeof value.opaqueRuleCount !== 'number' ||
    !Number.isSafeInteger(value.opaqueRuleCount) ||
    value.opaqueRuleCount < 0
  ) {
    throw invalidExplanation();
  }

  const engine = value.engine as MappingEngine;
  const capabilities = parseCapabilities(value.capabilities);

  // O cliente não confia em capabilities mutáveis para Sysmiddle. Além de esconder controles,
  // recusamos o payload inteiro para que uma resposta adulterada não seja exibida como capacidade
  // legítima em deep link, cache intermediário ou estado reidratado.
  if (
    engine === 'sysmiddle' &&
    (capabilities.author || capabilities.compile || capabilities.publish)
  ) {
    throw invalidExplanation();
  }

  return {
    mappingId: value.mappingId,
    version: value.version,
    engine,
    capabilities,
    sourceSchema: parseSchema(value.sourceSchema),
    targetSchema: parseSchema(value.targetSchema),
    rules: value.rules.map(parseExplainedRule),
    description: value.description,
    limitations: value.limitations,
    opaqueRuleCount: value.opaqueRuleCount,
  };
}

function parseLayoutTreeCardinality(value: unknown): LayoutTreeCardinality {
  // A API pode omitir totalmente a chave `cardinality` em nós folha (elementos simples sem
  // repetição declarada), em vez de enviar `{ min: null, max: null }` explícito — confirmado por
  // captura de rede real de produção (964 de 1034 nós sem a chave). Ausência de chave equivale
  // semanticamente a "sem cardinalidade informada". Quando a chave VEM presente, o conteúdo
  // continua validado normalmente — valores inválidos permanecem erro real.
  if (value === undefined) {
    return { min: null, max: null };
  }
  if (!isRecord(value) || !isNullableInteger(value.min) || !isNullableInteger(value.max)) {
    throw invalidLayoutTree();
  }
  return { min: value.min, max: value.max };
}

function parseLayoutTreeNode(value: unknown): LayoutTreeNode {
  // A API devolve o identificador do nó como `elementGuid` (confirmado por captura de rede
  // real de produção), não `guid`. Mantemos `guid` como nome da propriedade no tipo/domínio do
  // front (ver comentário em `LayoutTreeNode`), mas a leitura do payload é `elementGuid`.
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.elementGuid) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.kind) ||
    !layoutTreeNodeKinds.has(value.kind as LayoutTreeNodeKind) ||
    !Array.isArray(value.children)
  ) {
    throw invalidLayoutTree();
  }

  return {
    guid: value.elementGuid,
    name: value.name,
    kind: value.kind as LayoutTreeNodeKind,
    cardinality: parseLayoutTreeCardinality(value.cardinality),
    children: value.children.map(parseLayoutTreeNode),
  };
}

function parseLayoutTreeSide(value: unknown): LayoutTreeSide {
  if (!isRecord(value) || !Array.isArray(value.roots)) {
    throw invalidLayoutTree();
  }
  return { roots: value.roots.map(parseLayoutTreeNode) };
}

function parseLayoutTreeRuleLink(value: unknown): LayoutTreeRuleLink {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.ruleId) ||
    !isNonEmptyString(value.sourceElementGuid) ||
    !isNonEmptyString(value.targetElementGuid)
  ) {
    throw invalidLayoutTree();
  }
  return {
    ruleId: value.ruleId,
    sourceElementGuid: value.sourceElementGuid,
    targetElementGuid: value.targetElementGuid,
  };
}

function parseLayoutTreeResponse(value: unknown): LayoutTreeResponse {
  if (!isRecord(value) || !Array.isArray(value.rules) || !isStringArray(value.limitations)) {
    throw invalidLayoutTree();
  }
  return {
    source: parseLayoutTreeSide(value.source),
    target: parseLayoutTreeSide(value.target),
    rules: value.rules.map(parseLayoutTreeRuleLink),
    limitations: value.limitations,
  };
}

function parseCurrentWorkspaces(data: unknown): CurrentWorkspacesResponse {
  if (typeof data !== 'object' || data === null) {
    throw new WorkspaceRequestError('invalid_response', 'A API devolveu um workspace inválido.');
  }

  const candidate = data as Record<string, unknown>;
  if (!isNonEmptyString(candidate.activeWorkspaceId) || !Array.isArray(candidate.workspaces)) {
    throw new WorkspaceRequestError('invalid_response', 'A API devolveu um workspace inválido.');
  }

  const workspaces: FiscalWorkspaceSummary[] = candidate.workspaces.map(item => {
    if (typeof item !== 'object' || item === null) {
      throw new WorkspaceRequestError('invalid_response', 'A API devolveu um workspace inválido.');
    }

    const workspace = item as Record<string, unknown>;
    if (
      !isNonEmptyString(workspace.workspaceId) ||
      !isNonEmptyString(workspace.name) ||
      !isNonEmptyString(workspace.kind) ||
      !workspaceKinds.has(workspace.kind) ||
      !isNonEmptyString(workspace.role) ||
      !workspaceRoles.has(workspace.role) ||
      !isNonEmptyString(workspace.createdAt) ||
      Number.isNaN(Date.parse(workspace.createdAt))
    ) {
      throw new WorkspaceRequestError('invalid_response', 'A API devolveu um workspace inválido.');
    }

    return workspace as unknown as FiscalWorkspaceSummary;
  });

  const uniqueIds = new Set(workspaces.map(workspace => workspace.workspaceId));
  if (
    workspaces.length === 0 ||
    uniqueIds.size !== workspaces.length ||
    !uniqueIds.has(candidate.activeWorkspaceId)
  ) {
    throw new WorkspaceRequestError('invalid_response', 'A API devolveu um workspace inválido.');
  }

  // `isSudo` é aditivo: ausente é aceito (API antiga); presente e não-boolean invalida a resposta.
  if (candidate.isSudo !== undefined && typeof candidate.isSudo !== 'boolean') {
    throw new WorkspaceRequestError('invalid_response', 'A API devolveu um workspace inválido.');
  }

  return {
    activeWorkspaceId: candidate.activeWorkspaceId,
    workspaces,
    ...(candidate.isSudo !== undefined ? { isSudo: candidate.isSudo } : {}),
  };
}

function resourceSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} é obrigatório.`);
  }
  return encodeURIComponent(normalized);
}

/**
 * Contrato P0 do workspace fiscal. A API continua sendo a fonte da verdade; este service não
 * persiste histórico ou documento no navegador.
 */
export const workspaceService = {
  async getCurrentWorkspaces(): Promise<CurrentWorkspacesResponse> {
    try {
      const response = await apiClient.get<unknown>('/api/workspaces/me');
      return parseCurrentWorkspaces(response.data);
    } catch (error) {
      if (error instanceof WorkspaceRequestError) {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
          throw new WorkspaceRequestError(
            'unauthorized',
            'Sua sessão não permite acessar este workspace.'
          );
        }
        if (!error.response || status === 503 || (status !== undefined && status >= 500)) {
          throw new WorkspaceRequestError(
            'unavailable',
            'O serviço de workspaces está temporariamente indisponível.'
          );
        }
      }

      throw new WorkspaceRequestError(
        'request_failed',
        'Não foi possível carregar seu workspace fiscal.'
      );
    }
  },

  async getMappingExplanation(
    workspaceId: string,
    mappingId: string,
    version: string
  ): Promise<MappingExplanation> {
    const workspace = resourceSegment(workspaceId, 'Workspace');
    const mapping = resourceSegment(mappingId, 'Mapping');
    const mappingVersion = resourceSegment(version, 'Versão do mapping');
    const response = await apiClient.get<unknown>(
      `/api/workspaces/${workspace}/mappings/${mapping}/versions/${mappingVersion}/explanation`
    );
    return parseMappingExplanation(response.data);
  },

  /**
   * Árvore dupla origem/destino com GUID estável por nó (issue #267,
   * LayoutParserApi#425/PR #427). `rules[]` cobre hoje apenas o vínculo direto campo→campo —
   * regras derivadas de DSL não aparecem aqui, o consumidor precisa contabilizá-las à parte.
   */
  async getMappingLayoutTree(workspaceId: string, mappingId: string): Promise<LayoutTreeResponse> {
    const workspace = resourceSegment(workspaceId, 'Workspace');
    const mapping = resourceSegment(mappingId, 'Mapping');
    try {
      const response = await apiClient.get<unknown>(
        `/api/workspaces/${workspace}/mappings/${mapping}/layout-tree`
      );
      return parseLayoutTreeResponse(response.data);
    } catch (error) {
      if (error instanceof WorkspaceRequestError) {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
          throw new WorkspaceRequestError(
            'unauthorized',
            'Sua sessão não permite acessar a árvore deste mapping.'
          );
        }
        if (!error.response || status === 503 || (status !== undefined && status >= 500)) {
          throw new WorkspaceRequestError(
            'unavailable',
            'A árvore de layout está temporariamente indisponível.'
          );
        }
      }

      throw new WorkspaceRequestError(
        'request_failed',
        'Não foi possível carregar a árvore deste mapping.'
      );
    }
  },
};
