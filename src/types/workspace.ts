/** Tipos fiscais suportados pelo posicionamento inicial do produto. */
export type FiscalDocumentType = 'nfe' | 'cte' | 'mdfe' | 'nfse' | 'nfcom';

// `team` é o valor que a API devolve para workspaces de time (WorkspaceKind.Team);
// `organization` permanece por compatibilidade com o contrato anterior.
export type WorkspaceKind = 'personal' | 'team' | 'organization';
export type WorkspaceRole =
  'owner' | 'fiscal_admin' | 'mapper' | 'reviewer' | 'operator' | 'viewer';

export type DocumentFormat = 'fixed_width' | 'mqseries' | 'idoc' | 'xml' | 'json';
export type AnalysisStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'expired';
export type MappingEngine = 'tcl' | 'xslt' | 'sysmiddle';
export type MappingSupportLevel = 'authoritative' | 'best_effort' | 'opaque' | 'unsupported';

export interface FiscalWorkspaceSummary {
  workspaceId: string;
  name: string;
  kind: WorkspaceKind;
  role: WorkspaceRole;
  createdAt: string;
}

export interface CurrentWorkspacesResponse {
  activeWorkspaceId: string;
  workspaces: FiscalWorkspaceSummary[];
  /** Aditivo: ausente em API antiga; quando presente indica o perfil sudo do usuário. */
  isSudo?: boolean;
}

export type WorkspaceLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface FiscalProfile {
  documentType: FiscalDocumentType;
  schemaVersion: string;
  operation: string;
  jurisdiction?: string | null;
}

/**
 * XSD resolvido pela API para o `fiscalProfile` de um draft/release. Confirmado pela API
 * (mensagem do hub, 2026-09-30): a API não expõe caminho físico, apenas versão/namespace/raiz.
 */
export interface ResolvedXsdReference {
  xsdVersion: string;
  namespace: string;
  rootElement: string;
}

export interface FiscalProjectSummary {
  projectId: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  defaultFiscalDocumentType?: FiscalDocumentType | null;
  updatedAt: string;
}

export interface DocumentAnalysisSummary {
  analysisId: string;
  projectId: string;
  fileName: string;
  format: DocumentFormat;
  fiscalProfile: FiscalProfile;
  status: AnalysisStatus;
  layoutGuid?: string | null;
  correlationId: string;
  createdAt: string;
  completedAt?: string | null;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AnalysisFilters {
  cursor?: string;
  documentType?: FiscalDocumentType;
  status?: AnalysisStatus;
  from?: string;
  to?: string;
  layoutGuid?: string;
}

export interface MappingEngineCapabilities {
  execute: boolean;
  explain: boolean;
  author: boolean;
  compile: boolean;
  publish: boolean;
}

export interface MappingSchemaReference {
  layoutGuid: string | null;
  description: string | null;
}

export interface MappingEvidenceReference {
  kind: string;
  reference: string;
}

export interface MappingRuleExplanation {
  ruleId: string;
  sourceRefs: string[];
  targetRefs: string[];
  condition: string | null;
  operations: string[];
  cardinality: string;
  evidence: MappingEvidenceReference[];
  humanDescription: string;
  technicalDetail: string | null;
  supportLevel: MappingSupportLevel;
}

export interface MappingExplanation {
  mappingId: string;
  version: string;
  engine: MappingEngine;
  capabilities: MappingEngineCapabilities;
  sourceSchema: MappingSchemaReference | null;
  targetSchema: MappingSchemaReference | null;
  rules: MappingRuleExplanation[];
  description: string | null;
  opaqueRuleCount: number;
  limitations: string[];
}

/**
 * Árvore dupla do Mapping Studio (issue #267, contrato LayoutParserApi#425/PR #427).
 * `roots` é sempre lista — o layout pode ter mais de um elemento raiz real; o front nunca
 * assume raiz única. Cardinalidade confirmada pela API como sempre numérica ou `null`.
 */
export type LayoutTreeNodeKind = 'element' | 'attribute' | 'group';

export interface LayoutTreeCardinality {
  min: number | null;
  max: number | null;
}

/**
 * `guid` mapeia o campo `elementGuid` do payload real da API (confirmado por captura de rede
 * de produção contra `GET .../layout-tree`, mapper MAP_f1a6453f-1b2a-44db-b58d-fad5be74bba7).
 * O contrato JSON usa `elementGuid`; mantemos a propriedade do tipo como `guid` para não
 * propagar o rename por todo `MappingLayoutTreeView.tsx` — a tradução acontece só no parser
 * (`parseLayoutTreeNode`, workspaceService.ts).
 */
export interface LayoutTreeNode {
  guid: string;
  name: string;
  kind: LayoutTreeNodeKind;
  cardinality: LayoutTreeCardinality;
  children: LayoutTreeNode[];
}

export interface LayoutTreeSide {
  roots: LayoutTreeNode[];
}

/**
 * Vínculo direto campo→campo por GUID. Regras derivadas de DSL (branches condicionais) não
 * aparecem aqui hoje — ver `MappingExplanation.rules` + `opaqueRuleCount` para o total bruto e
 * o cálculo de regras não representáveis na árvore (issue #267, fora de escopo cobrir DSL aqui).
 */
export interface LayoutTreeRuleLink {
  ruleId: string;
  sourceElementGuid: string;
  targetElementGuid: string;
}

export interface LayoutTreeResponse {
  source: LayoutTreeSide;
  target: LayoutTreeSide;
  rules: LayoutTreeRuleLink[];
  /**
   * Texto pronto da API descrevendo regras condicionais/DSL que não aparecem em `rules[]`
   * (origem/destino não são GUIDs de nó resolvíveis). Confirmado por captura de rede real
   * (`GET .../layout-tree`) — substitui o cálculo por `ruleId` compartilhado com
   * `MappingExplanation.rules`, que nunca foi confirmado contra o contrato real.
   */
  limitations: string[];
}
