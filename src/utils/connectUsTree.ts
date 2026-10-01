import type { LayoutTreeNode, LayoutTreeRuleLink, LayoutTreeSide } from '../types/workspace';

/**
 * Comportamento do formulário do ConnectUs (análise Sysmiddle, seções 1.2–1.4): duas árvores,
 * com ligações e regras como filhos do nó de DESTINO, no máximo um vínculo por destino e
 * órfãos exibidos como diagnóstico. A fonte é o XML autoritário (LayoutVO/MapperVO) servido
 * pela API via layout-tree; o ConnectUs não usa TCL/XSLT.
 */

export type ConnectUsVinculoKind = 'link' | 'rule';

export interface ConnectUsVinculo {
  id: string;
  kind: ConnectUsVinculoKind;
  /** Texto exibido: `Origem_Destino` (ligação) ou `Rule_Destino` (regra). */
  text: string;
  sourceGuid: string | null;
  targetGuid: string;
}

export type ConnectUsDiagnosticCode =
  | 'ORPHAN_LINK'
  | 'TARGET_HAS_MULTIPLE_LINKS'
  | 'TARGET_HAS_LINK_AND_RULE'
  | 'SOURCE_LAYOUT_UNAVAILABLE'
  | 'TARGET_LAYOUT_UNAVAILABLE';

export interface ConnectUsDiagnostic {
  code: ConnectUsDiagnosticCode;
  /** GUID do destino (ou do vínculo órfão). */
  id: string;
  /** Razão informada pela API para o lado indisponível (apenas diagnósticos *_LAYOUT_UNAVAILABLE). */
  reason?: string;
}

/** Cardinalidade como no texto do nó do ConnectUs: `(mín, máx)`. `±` não vem no contrato. */
export function formatNodeCardinality(node: LayoutTreeNode): string {
  const { min, max } = node.cardinality;
  if (min === null && max === null) return '(—)';
  return `(${min ?? 0}, ${max === null ? 'ilimitado' : max})`;
}

function indexNodes(nodes: LayoutTreeNode[], into = new Map<string, LayoutTreeNode>()) {
  nodes.forEach(node => {
    into.set(node.guid, node);
    indexNodes(node.children, into);
  });
  return into;
}

/**
 * Monta os vínculos pendurados no destino e os diagnósticos. Ligações sem nó de origem ou de
 * destino na árvore são mantidas como órfãs (o desktop as descarta ao salvar; o portal mostra).
 */
export function buildVinculos(
  source: LayoutTreeSide,
  target: LayoutTreeSide,
  links: LayoutTreeRuleLink[]
): { byTarget: Map<string, ConnectUsVinculo[]>; diagnostics: ConnectUsDiagnostic[] } {
  const sourceIndex = indexNodes(source.roots);
  const targetIndex = indexNodes(target.roots);
  const byTarget = new Map<string, ConnectUsVinculo[]>();
  const diagnostics: ConnectUsDiagnostic[] = [];

  // Lado sem nós = layout não servido pela API (ex.: destino XML NF-e/SEFAZ, `kind: "unknown"`).
  // Sem a árvore não dá para dizer que a ligação é órfã: um único aviso, sem falso positivo.
  if (sourceIndex.size === 0 || targetIndex.size === 0) {
    if (sourceIndex.size === 0) {
      diagnostics.push({
        code: 'SOURCE_LAYOUT_UNAVAILABLE',
        id: 'origem',
        ...(source.unavailableReason ? { reason: source.unavailableReason } : {}),
      });
    }
    if (targetIndex.size === 0) {
      diagnostics.push({
        code: 'TARGET_LAYOUT_UNAVAILABLE',
        id: 'destino',
        ...(target.unavailableReason ? { reason: target.unavailableReason } : {}),
      });
    }
    return { byTarget, diagnostics };
  }

  links.forEach(link => {
    const sourceNode = sourceIndex.get(link.sourceElementGuid);
    const targetNode = targetIndex.get(link.targetElementGuid);
    if (!targetNode || (!sourceNode && link.sourceElementGuid !== '')) {
      diagnostics.push({ code: 'ORPHAN_LINK', id: link.ruleId });
      return;
    }
    const isRule = link.sourceElementGuid === '';
    const vinculo: ConnectUsVinculo = {
      id: link.ruleId,
      kind: isRule ? 'rule' : 'link',
      text: isRule ? `Rule_${targetNode.name}` : `${sourceNode?.name ?? ''}_${targetNode.name}`,
      sourceGuid: isRule ? null : link.sourceElementGuid,
      targetGuid: link.targetElementGuid,
    };
    byTarget.set(link.targetElementGuid, [
      ...(byTarget.get(link.targetElementGuid) ?? []),
      vinculo,
    ]);
  });

  byTarget.forEach((list, targetGuid) => {
    if (list.length < 2) return;
    const hasRule = list.some(item => item.kind === 'rule');
    const hasLink = list.some(item => item.kind === 'link');
    diagnostics.push({
      code: hasRule && hasLink ? 'TARGET_HAS_LINK_AND_RULE' : 'TARGET_HAS_MULTIPLE_LINKS',
      id: targetGuid,
    });
  });

  return { byTarget, diagnostics };
}
