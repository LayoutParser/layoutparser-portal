import { useMemo, useRef, useState } from 'react';
import { buildVinculos, formatNodeCardinality } from '../../utils/connectUsTree';
import type { ConnectUsDiagnostic } from '../../utils/connectUsTree';
import Modal from '../shared/Modal';
import type {
  LayoutTreeNode,
  LayoutTreeNodeKind,
  LayoutTreeRuleLink,
  LayoutTreeSide,
  MappingRuleExplanation,
} from '../../types/workspace';
import './MappingLayoutTreeView.css';

interface MappingLayoutTreeViewProps {
  source: LayoutTreeSide;
  target: LayoutTreeSide;
  rules: LayoutTreeRuleLink[];
  /** Texto pronto da API (`LayoutTreeResponse.limitations`) descrevendo regras
   * condicionais/DSL que não aparecem em `rules` — substitui o cálculo por `ruleId`
   * compartilhado com `MappingExplanation.rules`, que nunca foi confirmado contra o contrato
   * real (issue #267). */
  limitations: string[];
  /** Regras explicáveis do contrato canônico (`MappingExplanation.rules`), cruzadas por
   * `ruleId` com `rules[]` (mesma correlação já usada nos badges/contadores existentes) para
   * exibir o detalhe DSL/condicional do nó selecionado sob demanda. Opcional: telas que ainda
   * não carregaram a explicação continuam funcionando com o botão de detalhe desabilitado. */
  explanationRules?: MappingRuleExplanation[];
}

type Side = 'source' | 'target';

const kindIcons: Record<LayoutTreeNodeKind, string> = {
  element: '▤',
  attribute: '@',
  group: '▦',
};

const diagnosticLabels: Record<ConnectUsDiagnostic['code'], string> = {
  ORPHAN_LINK: 'Vínculo órfão: aponta para um nó que não existe no layout',
  TARGET_HAS_MULTIPLE_LINKS: 'Destino com mais de uma ligação',
  TARGET_HAS_LINK_AND_RULE: 'Destino com ligação e regra ao mesmo tempo',
  SOURCE_LAYOUT_UNAVAILABLE:
    'Layout de origem indisponível: a API não devolveu os nós; as ligações não podem ser verificadas',
  TARGET_LAYOUT_UNAVAILABLE:
    'Layout de destino indisponível: a API não devolveu os nós; as ligações não podem ser verificadas',
};

const unavailableReasonLabels: Record<string, string> = {
  'layout-not-found': 'o layout não foi encontrado na API',
  'layout-unreadable': 'o layout está ilegível ou não possui elementos',
  'unsupported-kind': 'o tipo de layout não é suportado',
  'xsd-unresolved': 'o XSD não pôde ser resolvido',
};

const kindLabels: Record<LayoutTreeNodeKind, string> = {
  element: 'Elemento',
  attribute: 'Atributo',
  group: 'Grupo',
};

function formatCardinality(node: LayoutTreeNode): string {
  const { min, max } = node.cardinality;
  // `{ min: null, max: null }` cobre tanto o `cardinality` ausente no payload (comum em nós
  // folha) quanto o valor nulo explícito — a API não distingue os dois casos, então o front
  // também não deve fingir que distingue. "—" é neutro e não afirma nada sobre repetição.
  if (min === null && max === null) return '—';
  const minLabel = min === null ? '0' : String(min);
  const maxLabel = max === null ? 'ilimitado' : String(max);
  return `${minLabel}..${maxLabel}`;
}

function nodeKey(side: Side, guid: string): string {
  return `${side}:${guid}`;
}

function collectAllKeys(side: Side, nodes: LayoutTreeNode[], into: Set<string>): void {
  nodes.forEach(node => {
    into.add(nodeKey(side, node.guid));
    collectAllKeys(side, node.children, into);
  });
}

function collectDefaultExpandedKeys(side: Side, nodes: LayoutTreeNode[], depth: number): string[] {
  if (depth > 1) return [];
  return nodes.flatMap(node => [
    nodeKey(side, node.guid),
    ...collectDefaultExpandedKeys(side, node.children, depth + 1),
  ]);
}

function findNode(nodes: LayoutTreeNode[], guid: string): LayoutTreeNode | null {
  for (const node of nodes) {
    if (node.guid === guid) return node;
    const found = findNode(node.children, guid);
    if (found) return found;
  }
  return null;
}

function collectMatches(
  nodes: LayoutTreeNode[],
  term: string,
  ancestry: LayoutTreeNode[],
  visible: Set<string>,
  side: Side
): void {
  nodes.forEach(node => {
    const isMatch = node.name.toLowerCase().includes(term);
    if (isMatch) {
      visible.add(nodeKey(side, node.guid));
      ancestry.forEach(ancestor => visible.add(nodeKey(side, ancestor.guid)));
    }
    collectMatches(node.children, term, [...ancestry, node], visible, side);
    if (node.children.some(child => visible.has(nodeKey(side, child.guid)))) {
      visible.add(nodeKey(side, node.guid));
      ancestry.forEach(ancestor => visible.add(nodeKey(side, ancestor.guid)));
    }
  });
}

const MappingLayoutTreeView = ({
  source,
  target,
  rules,
  limitations,
  explanationRules = [],
}: MappingLayoutTreeViewProps) => {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    collectDefaultExpandedKeys('source', source.roots, 0).forEach(key => initial.add(key));
    collectDefaultExpandedKeys('target', target.roots, 0).forEach(key => initial.add(key));
    return initial;
  });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ side: Side; guid: string } | null>(null);
  const [hovered, setHovered] = useState<{ side: Side; guid: string } | null>(null);
  const [ruleDetailOpen, setRuleDetailOpen] = useState(false);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  const explanationRuleById = useMemo(() => {
    const map = new Map<string, MappingRuleExplanation>();
    explanationRules.forEach(rule => map.set(rule.ruleId, rule));
    return map;
  }, [explanationRules]);

  const sourceRuleGuids = useMemo(
    () => new Set(rules.map(rule => rule.sourceElementGuid)),
    [rules]
  );
  const targetRuleGuids = useMemo(
    () => new Set(rules.map(rule => rule.targetElementGuid)),
    [rules]
  );
  const rulesBySourceGuid = useMemo(() => {
    const map = new Map<string, LayoutTreeRuleLink[]>();
    rules.forEach(rule => {
      const list = map.get(rule.sourceElementGuid) ?? [];
      list.push(rule);
      map.set(rule.sourceElementGuid, list);
    });
    return map;
  }, [rules]);
  const rulesByTargetGuid = useMemo(() => {
    const map = new Map<string, LayoutTreeRuleLink[]>();
    rules.forEach(rule => {
      const list = map.get(rule.targetElementGuid) ?? [];
      list.push(rule);
      map.set(rule.targetElementGuid, list);
    });
    return map;
  }, [rules]);

  const activeCorrelation = selected ?? hovered;
  // GUIDs do lado oposto que devem ser destacados por causa do nó ativo (selecionado ou em
  // hover), calculados a partir do vínculo direto campo→campo do próprio layout-tree.
  const highlightedGuids = useMemo(() => {
    if (!activeCorrelation) return new Set<string>();
    const links =
      activeCorrelation.side === 'source'
        ? rulesBySourceGuid.get(activeCorrelation.guid)
        : rulesByTargetGuid.get(activeCorrelation.guid);
    if (!links) return new Set<string>();
    const guids =
      activeCorrelation.side === 'source'
        ? links.map(link => link.targetElementGuid)
        : links.map(link => link.sourceElementGuid);
    return new Set(guids);
  }, [activeCorrelation, rulesBySourceGuid, rulesByTargetGuid]);

  // Como no ConnectUs: ligações e regras são nós filhos do elemento de DESTINO.
  const { byTarget: vinculosByTarget, diagnostics } = useMemo(
    () => buildVinculos(source, target, rules),
    [source, target, rules]
  );
  const linkedSourceGuids = useMemo(
    () => new Set(rules.map(rule => rule.sourceElementGuid).filter(Boolean)),
    [rules]
  );

  const normalizedSearch = search.trim().toLowerCase();
  const visibleKeys = useMemo(() => {
    if (!normalizedSearch) return null;
    const visible = new Set<string>();
    collectMatches(source.roots, normalizedSearch, [], visible, 'source');
    collectMatches(target.roots, normalizedSearch, [], visible, 'target');
    return visible;
  }, [normalizedSearch, source.roots, target.roots]);

  const toggle = (key: string) => {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => {
    const all = new Set<string>();
    collectAllKeys('source', source.roots, all);
    collectAllKeys('target', target.roots, all);
    setExpanded(all);
  };

  const collapseAll = () => setExpanded(new Set());

  const focusItem = (side: Side, guid: string) => {
    requestAnimationFrame(() => itemRefs.current.get(nodeKey(side, guid))?.focus());
  };

  const moveVisibleFocus = (
    currentItem: HTMLButtonElement,
    destination: 'previous' | 'next' | 'first' | 'last'
  ) => {
    const tree = currentItem.closest('[role="tree"]');
    if (!tree) return;
    const items = Array.from(tree.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'));
    const currentIndex = items.indexOf(currentItem);
    if (currentIndex < 0) return;
    const destinationIndex =
      destination === 'first'
        ? 0
        : destination === 'last'
          ? items.length - 1
          : destination === 'previous'
            ? Math.max(0, currentIndex - 1)
            : Math.min(items.length - 1, currentIndex + 1);
    items[destinationIndex]?.focus();
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    side: Side,
    node: LayoutTreeNode,
    key: string,
    isExpanded: boolean
  ) => {
    const hasChildren = node.children.length > 0;
    if (event.key === 'ArrowRight' && hasChildren) {
      event.preventDefault();
      if (!isExpanded) toggle(key);
      else focusItem(side, node.children[0].guid);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (hasChildren && isExpanded) toggle(key);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveVisibleFocus(event.currentTarget, 'next');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveVisibleFocus(event.currentTarget, 'previous');
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveVisibleFocus(event.currentTarget, 'first');
    } else if (event.key === 'End') {
      event.preventDefault();
      moveVisibleFocus(event.currentTarget, 'last');
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelected({ side, guid: node.guid });
    }
  };

  const renderNode = (side: Side, node: LayoutTreeNode, level: number): React.ReactNode => {
    const key = nodeKey(side, node.guid);
    if (visibleKeys && !visibleKeys.has(key)) return null;

    const vinculos = side === 'target' ? (vinculosByTarget.get(node.guid) ?? []) : [];
    const hasChildren = node.children.length > 0 || vinculos.length > 0;
    const isExpanded = hasChildren && (Boolean(visibleKeys) || expanded.has(key));
    const isSelected = selected?.side === side && selected.guid === node.guid;
    const hasRule =
      side === 'source' ? sourceRuleGuids.has(node.guid) : targetRuleGuids.has(node.guid);
    const isHighlighted = highlightedGuids.has(node.guid);
    const isLinked =
      side === 'source' ? linkedSourceGuids.has(node.guid) : vinculosByTarget.has(node.guid);
    const ruleLinks =
      side === 'source'
        ? (rulesBySourceGuid.get(node.guid) ?? [])
        : (rulesByTargetGuid.get(node.guid) ?? []);

    return (
      <li key={node.guid} className="mapping-layout-tree-node" role="none">
        <button
          ref={element => {
            if (element) itemRefs.current.set(key, element);
            else itemRefs.current.delete(key);
          }}
          type="button"
          role="treeitem"
          aria-expanded={hasChildren ? isExpanded : undefined}
          aria-selected={isSelected}
          aria-level={level}
          tabIndex={isSelected ? 0 : -1}
          className={[
            'mapping-layout-tree-item',
            isSelected ? 'mapping-layout-tree-item--selected' : '',
            isHighlighted ? 'mapping-layout-tree-item--highlighted' : '',
            isLinked ? 'mapping-layout-tree-item--linked' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => setSelected({ side, guid: node.guid })}
          onMouseEnter={() => setHovered({ side, guid: node.guid })}
          onMouseLeave={() => setHovered(null)}
          onFocus={() => setHovered({ side, guid: node.guid })}
          onKeyDown={event => handleKeyDown(event, side, node, key, isExpanded)}
        >
          {hasChildren ? (
            <span
              className="mapping-layout-tree-toggle"
              aria-hidden="true"
              onClick={event => {
                event.stopPropagation();
                toggle(key);
              }}
            >
              {isExpanded ? '−' : '+'}
            </span>
          ) : (
            <span className="mapping-layout-tree-spacer" aria-hidden="true" />
          )}
          <span
            className="mapping-layout-tree-icon"
            aria-hidden="true"
            title={kindLabels[node.kind]}
          >
            {kindIcons[node.kind]}
          </span>
          <span className="mapping-layout-tree-name">{node.name}</span>
          <span className="mapping-layout-tree-cardinality">{formatNodeCardinality(node)}</span>
          {side === 'source' && hasRule && (
            <span className="mapping-layout-tree-rule-badges">
              {ruleLinks.map(rule => (
                <span key={rule.ruleId} className="mapping-layout-tree-rule-badge">
                  Regra {rule.ruleId}
                </span>
              ))}
            </span>
          )}
        </button>
        {hasChildren && isExpanded && (
          <ul className="mapping-layout-tree-children" role="group">
            {node.children.map(child => renderNode(side, child, level + 1))}
            {vinculos.map(vinculo => (
              <li key={vinculo.id} className="mapping-layout-tree-node" role="none">
                <div
                  role="treeitem"
                  aria-level={level + 1}
                  aria-selected={false}
                  className={`mapping-layout-tree-item mapping-layout-tree-vinculo mapping-layout-tree-vinculo--${vinculo.kind}`}
                >
                  <span className="mapping-layout-tree-spacer" aria-hidden="true" />
                  <span
                    className="mapping-layout-tree-icon"
                    aria-hidden="true"
                    title={vinculo.kind === 'rule' ? 'Regra' : 'Ligação'}
                  >
                    {vinculo.kind === 'rule' ? '⚙' : '🔗'}
                  </span>
                  <span className="mapping-layout-tree-name">{vinculo.text}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  const selectedNode = selected
    ? findNode(selected.side === 'source' ? source.roots : target.roots, selected.guid)
    : null;
  const selectedRuleLinks = selected
    ? ((selected.side === 'source'
        ? rulesBySourceGuid.get(selected.guid)
        : rulesByTargetGuid.get(selected.guid)) ?? [])
    : [];
  // Regras explicáveis (contrato canônico) vinculadas ao nó selecionado, cruzadas por `ruleId`
  // com `selectedRuleLinks`. Pode ficar vazio mesmo com `selectedRuleLinks` não vazio, se a
  // explicação ainda não carregou ou não reconhece a regra — o botão trata esse caso.
  const selectedExplanationRules = selectedRuleLinks
    .map(link => explanationRuleById.get(link.ruleId))
    .filter((rule): rule is MappingRuleExplanation => Boolean(rule));
  const canShowRuleDetail = selectedExplanationRules.length > 0;

  return (
    <div className="mapping-layout-tree-view">
      <div className="mapping-layout-tree-toolbar">
        <input
          type="search"
          className="mapping-layout-tree-search"
          placeholder="Buscar nó em ambas as árvores…"
          value={search}
          onChange={event => setSearch(event.target.value)}
          aria-label="Buscar nó nas árvores de origem e destino"
        />
        <button type="button" className="mapping-layout-tree-control-btn" onClick={expandAll}>
          Expandir tudo
        </button>
        <button type="button" className="mapping-layout-tree-control-btn" onClick={collapseAll}>
          Recolher tudo
        </button>
        <button
          type="button"
          className="mapping-layout-tree-control-btn"
          disabled={!canShowRuleDetail}
          aria-disabled={!canShowRuleDetail}
          onClick={() => setRuleDetailOpen(true)}
        >
          Ver regra
        </button>
      </div>

      {limitations.length > 0 && (
        <ul className="mapping-layout-tree-unrepresented" role="status">
          {limitations.map(limitation => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      )}

      {diagnostics.length > 0 && (
        <ul className="mapping-layout-tree-unrepresented" role="status">
          {diagnostics.map(diagnostic => (
            <li key={`${diagnostic.code}:${diagnostic.id}`}>
              {diagnostic.reason && unavailableReasonLabels[diagnostic.reason]
                ? `${diagnostic.code === 'SOURCE_LAYOUT_UNAVAILABLE' ? 'Layout de origem' : 'Layout de destino'} indisponível: ${unavailableReasonLabels[diagnostic.reason]}; as ligações não podem ser verificadas`
                : diagnosticLabels[diagnostic.code]}{' '}
              (<code>{diagnostic.id}</code>
              {diagnostic.reason && (
                <>
                  {' · '}
                  <code data-testid="unavailable-reason">{diagnostic.reason}</code>
                </>
              )}
              )
            </li>
          ))}
        </ul>
      )}

      <div className="mapping-layout-tree-columns">
        <section
          className="mapping-layout-tree-column"
          aria-labelledby="mapping-layout-tree-source-title"
        >
          <h3 id="mapping-layout-tree-source-title">Layout de origem</h3>
          {source.roots.length === 0 ? (
            <p className="mapping-layout-tree-empty">Nenhum nó de origem disponível.</p>
          ) : (
            <ul
              className="mapping-layout-tree-root"
              role="tree"
              aria-label="Árvore do layout de origem"
            >
              {source.roots.map(node => renderNode('source', node, 1))}
            </ul>
          )}
        </section>
        <section
          className="mapping-layout-tree-column"
          aria-labelledby="mapping-layout-tree-target-title"
        >
          <h3 id="mapping-layout-tree-target-title">Layout de destino</h3>
          {target.roots.length === 0 ? (
            <p className="mapping-layout-tree-empty">Nenhum nó de destino disponível.</p>
          ) : (
            <ul
              className="mapping-layout-tree-root"
              role="tree"
              aria-label="Árvore do layout de destino"
            >
              {target.roots.map(node => renderNode('target', node, 1))}
            </ul>
          )}
        </section>
      </div>

      {selectedNode && (
        <section
          className="mapping-layout-tree-properties"
          aria-labelledby="mapping-layout-tree-properties-title"
        >
          <h3 id="mapping-layout-tree-properties-title">Propriedades do nó selecionado</h3>
          <dl>
            <div>
              <dt>Tipo</dt>
              <dd>{kindLabels[selectedNode.kind]}</dd>
            </div>
            <div>
              <dt>Identificador</dt>
              <dd>
                <code>{selectedNode.guid}</code>
              </dd>
            </div>
            <div>
              <dt>Nome</dt>
              <dd>{selectedNode.name}</dd>
            </div>
            <div>
              <dt>Cardinalidade</dt>
              <dd>{formatCardinality(selectedNode)}</dd>
            </div>
            <div>
              <dt>Descrição</dt>
              <dd>Não informada pelo contrato desta versão.</dd>
            </div>
            <div>
              <dt>Pacote</dt>
              <dd>Não informado pelo contrato desta versão.</dd>
            </div>
          </dl>
          <div className="mapping-layout-tree-properties-rules">
            <strong>Regras:</strong>
            {selectedRuleLinks.length === 0 ? (
              <p>Nenhuma regra vinculada a este nó.</p>
            ) : (
              <ul>
                {selectedRuleLinks.map(rule => (
                  <li key={rule.ruleId}>Regra {rule.ruleId}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <Modal
        isOpen={ruleDetailOpen && canShowRuleDetail}
        onClose={() => setRuleDetailOpen(false)}
        title={selectedNode ? `Detalhe da regra · ${selectedNode.name}` : 'Detalhe da regra'}
        size="large"
      >
        <div className="mapping-layout-tree-rule-detail">
          {selectedExplanationRules.map(rule => (
            <article key={rule.ruleId} className="mapping-layout-tree-rule-detail-item">
              <h4>Regra {rule.ruleId}</h4>
              <p>{rule.humanDescription}</p>
              {rule.technicalDetail && (
                <pre className="mapping-layout-tree-rule-detail-code">
                  <code>{rule.technicalDetail}</code>
                </pre>
              )}
            </article>
          ))}
        </div>
      </Modal>
    </div>
  );
};

export default MappingLayoutTreeView;
