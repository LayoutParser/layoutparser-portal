import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useStructureStore } from '../../store/useStructureStore';
import { useFieldStore } from '../../store/useFieldStore';
import {
  buildSapIdocTree,
  buildTreeFromFields,
  buildTreeFromLayout,
  isSapIdocLayout,
} from '../../utils/treeBuilder';
import { findFirstDesyncLineIndex } from '../../utils/documentHealth';
import { getFieldPhysicalId } from '../../utils/fieldIdentity';
import type { Field } from '../../types/field';
import type { TreeNode } from '../../types/structure';
import './StructureTree.css';

const StructureTree: React.FC = () => {
  const { parseResult, fields, selectedLayout } = useAppStore();
  const {
    treeData,
    selectedNodeId,
    setTreeData,
    toggleNode,
    expandAll,
    collapseAll,
    selectNode,
    isExpanded,
  } = useStructureStore();
  const { setFields } = useFieldStore();
  const fieldStoreFields = useFieldStore(s => s.fields);

  // Guarda o timer de scroll pendente para poder cancelá-lo se o componente
  // desmontar antes dele disparar (evita "document is not defined" após unmount em testes).
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current !== null) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Construir árvore quando parseResult mudar
  useEffect(() => {
    if (!parseResult || !parseResult.success) {
      setTreeData([]);
      return;
    }

    // Usar campos do parseResult se fields estiver vazio
    const actualFields = fields.length > 0 ? fields : parseResult.fields || [];

    // ✅ Erro de TAMANHO de linha desalinha o documento posicional a partir dali, então a
    // árvore só pode ir até a primeira linha nessa condição (inclusive).
    //
    // O critério é a classe do erro, não a existência dele: erro de conteúdo (sequência
    // inválida etc.) não move offset nenhum e não pode podar a árvore — ver
    // `isDesyncingValidationError`. Mantido em sincronia com o corte do FieldDisplay: as duas
    // views mostram o mesmo documento e divergir aqui deixaria a árvore menor que a lista.
    const validationErrors = parseResult.validationErrors || [];
    const firstDesyncLineIndex = findFirstDesyncLineIndex(validationErrors);
    const isTruncated = firstDesyncLineIndex >= 0;

    const cleanText = (parseResult.text || '').replace(/\r/g, '').replace(/\n/g, '');
    const allowedLineSequences = new Set<string>();
    if (isTruncated && cleanText.length >= 6) {
      for (let i = 0; i <= firstDesyncLineIndex; i++) {
        const start = i * 600;
        if (start + 6 <= cleanText.length) {
          allowedLineSequences.add(cleanText.substring(start, start + 6));
        }
      }
    }

    const fieldsForTree =
      isTruncated && allowedLineSequences.size > 0
        ? actualFields.filter(f => {
            const seq = String(f.lineSequence || '').trim();
            return allowedLineSequences.has(seq);
          })
        : actualFields;

    // Verificar se elements é um array de strings JSON ou objetos
    const layoutElements = parseResult.layout?.elements;
    const hasLayoutElements =
      layoutElements && Array.isArray(layoutElements) && layoutElements.length > 0;

    // Se tiver layout com elementos, usar buildTreeFromLayout
    // Senão, usar buildTreeFromFields (mais simples, agrupa por linha)
    let tree: TreeNode[];

    // Prioriza o `detectedType` que a API devolve para o documento; o nome do layout é só
    // fallback (catálogo pode ter cadastro desatualizado). Ver `isSapIdocLayout`.
    const isSapIdoc = isSapIdocLayout(
      parseResult.detectedType,
      parseResult.layout?.name || selectedLayout?.name
    );

    if (isSapIdoc && hasLayoutElements) {
      // O layout SAP já declara a hierarquia de segmentos em LineElementVO aninhados. Esta
      // visão apresenta o esquema do IDoc, não afirma que todos os segmentos existem no TXT.
      const sapTree = buildSapIdocTree(layoutElements);
      tree = sapTree.length > 0 ? sapTree : buildTreeFromLayout(layoutElements);
    } else if (isTruncated) {
      // ✅ Em caso de erro de TAMANHO, NÃO exibir estrutura completa do layout, pois ela
      // induz o usuário ao erro (as linhas seguintes não são confiáveis). Com defeitos que
      // não dessincronizam, a árvore do layout continua válida e é a mais informativa.
      tree = buildTreeFromFields(fieldsForTree);
    } else if (hasLayoutElements) {
      tree = buildTreeFromLayout(layoutElements);
    } else if (fieldsForTree && fieldsForTree.length > 0) {
      tree = buildTreeFromFields(fieldsForTree);
    } else {
      // Anomalia real: parse com sucesso mas sem layout e sem campos para montar a árvore.
      if (import.meta.env.DEV) {
        console.warn('⚠️ StructureTree: nenhum dado disponível para construir árvore');
      }
      tree = [];
    }

    setTreeData(tree);
    setFields(fieldsForTree);
  }, [parseResult, fields, selectedLayout, setTreeData, setFields]);

  // Função auxiliar para encontrar a linha pai de um nó
  const findParentLine = (node: TreeNode, nodes: TreeNode[]): TreeNode | null => {
    // Se o nó já é uma linha, retornar ele mesmo
    if (node.type === 'LineElementVO' || node.type.includes('Line')) {
      return node;
    }

    // Buscar recursivamente na árvore
    const searchInTree = (
      treeNodes: TreeNode[],
      targetId: string,
      currentParent: TreeNode | null
    ): TreeNode | null => {
      for (const n of treeNodes) {
        if (n.id === targetId) {
          return currentParent;
        }
        if (n.children.length > 0) {
          const found = searchInTree(n.children, targetId, n);
          if (found) return found;
        }
      }
      return null;
    };

    return searchInTree(nodes, node.id, null);
  };

  // Destaca e rola até o campo usando a MESMA identidade física que o FieldDisplay grava em
  // `data-field-id` e lê em `highlightedFields` (`getFieldPhysicalId`). Usar outro formato de id
  // (ex.: `${lineName}_${fieldName}`) nunca casa e o destaque some silenciosamente.
  const highlightAndScroll = (field: Field) => {
    const fieldId = getFieldPhysicalId(field);
    useFieldStore.getState().highlightField(fieldId);

    if (scrollTimeoutRef.current !== null) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      const fieldElement = Array.from(document.querySelectorAll('[data-field-id]')).find(
        el => el.getAttribute('data-field-id') === fieldId
      );
      fieldElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  const handleNodeClick = (node: TreeNode) => {
    selectNode(node.id);

    // `fields` do app pode estar vazio (o parse guarda os campos em parseResult): a árvore já
    // normaliza essa origem em `fieldStoreFields`, que é a fonte usada nos dois cliques.
    const sourceFields = fieldStoreFields.length > 0 ? fieldStoreFields : fields;

    if (node.type === 'LineElementVO' || node.type.includes('Line')) {
      const lineName = node.sourceLineName || node.name;
      const firstField = sourceFields.find(f => f.lineName === lineName);
      if (firstField) highlightAndScroll(firstField);
    } else if (node.type === 'FieldElementVO' || node.type.includes('Field')) {
      const parentLine = findParentLine(node, treeData);

      if (!parentLine) {
        if (import.meta.env.DEV) {
          console.warn('⚠️ Não foi possível encontrar a linha pai do campo:', node.name);
        }
        return;
      }

      // Mesmo critério do clique na linha (nome de origem do layout, não o rótulo da árvore).
      const lineName = parentLine.sourceLineName || parentLine.name;
      const fieldName = node.name || node.element?.name;

      if (!fieldName) {
        if (import.meta.env.DEV) {
          console.warn('⚠️ Nó de campo sem nome utilizável.');
        }
        return;
      }

      const field = sourceFields.find(f => f.lineName === lineName && f.fieldName === fieldName);

      if (field) {
        highlightAndScroll(field);
      } else if (import.meta.env.DEV) {
        console.warn('⚠️ Campo selecionado na árvore não existe no resultado do parse.');
      }
    }
  };

  const moveTreeItemFocus = (
    currentItem: HTMLButtonElement,
    destination: 'previous' | 'next' | 'first' | 'last'
  ) => {
    const tree = currentItem.closest('[role="tree"]');
    if (!tree) return;

    const visibleItems = Array.from(tree.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'));
    const currentIndex = visibleItems.indexOf(currentItem);
    if (currentIndex < 0) return;

    const destinationIndex =
      destination === 'first'
        ? 0
        : destination === 'last'
          ? visibleItems.length - 1
          : destination === 'previous'
            ? Math.max(0, currentIndex - 1)
            : Math.min(visibleItems.length - 1, currentIndex + 1);

    visibleItems[destinationIndex]?.focus();
  };

  const handleTreeItemKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    node: TreeNode,
    hasChildren: boolean,
    expanded: boolean
  ) => {
    if (event.key === 'ArrowRight' && hasChildren && !expanded) {
      event.preventDefault();
      toggleNode(node.id);
    } else if (event.key === 'ArrowLeft' && hasChildren && expanded) {
      event.preventDefault();
      toggleNode(node.id);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveTreeItemFocus(event.currentTarget, 'next');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveTreeItemFocus(event.currentTarget, 'previous');
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveTreeItemFocus(event.currentTarget, 'first');
    } else if (event.key === 'End') {
      event.preventDefault();
      moveTreeItemFocus(event.currentTarget, 'last');
    }
  };

  const renderTreeNode = (node: TreeNode): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const expanded = isExpanded(node.id);
    const selected = selectedNodeId === node.id;

    return (
      <li
        key={node.id}
        className={`tree-node ${node.variant ? `tree-node--${node.variant}` : ''} ${selected ? 'selected' : ''}`}
        role="none"
      >
        <button
          type="button"
          role="treeitem"
          className="tree-node-header"
          aria-expanded={hasChildren ? expanded : undefined}
          aria-selected={selected}
          aria-level={node.level + 1}
          onClick={() => {
            handleNodeClick(node);
            if (hasChildren) {
              toggleNode(node.id);
            }
          }}
          onKeyDown={event => handleTreeItemKeyDown(event, node, hasChildren, expanded)}
        >
          {hasChildren && (
            <span className="tree-toggle" aria-hidden="true">
              {expanded ? '−' : '+'}
            </span>
          )}
          {!hasChildren && <span className="tree-spacer" />}
          <span className="tree-node-name">{node.name}</span>
          {node.variant === 'sap-segment' && (
            <span className="tree-node-type">
              {node.name === 'EDI_DC40' ? 'Controle' : 'Segmento'}
            </span>
          )}
        </button>
        {hasChildren && expanded && (
          <ul className="tree-children" role="group">
            {node.children.map(child => renderTreeNode(child))}
          </ul>
        )}
      </li>
    );
  };

  if (!parseResult || !parseResult.success || treeData.length === 0) {
    return (
      <div className="structure-tree-empty">
        <p>Nenhuma estrutura disponível. Processe um documento primeiro.</p>
      </div>
    );
  }

  const isSapHierarchy = treeData[0]?.variant === 'sap-segment';
  const countNodes = (nodes: TreeNode[]): number =>
    nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
  const totalNodes = countNodes(treeData);

  return (
    <div className="structure-tree">
      {isSapHierarchy && (
        <div className="tree-summary">
          <div>
            <span className="tree-summary-eyebrow">IDoc SAP</span>
            <h3>Hierarquia de segmentos</h3>
            <p>EDI_DC40 é a raiz. Use os controles + para percorrer a estrutura do layout.</p>
          </div>
          <span className="tree-summary-count">{totalNodes} segmentos</span>
        </div>
      )}

      <div className="tree-controls">
        <button type="button" onClick={expandAll} className="tree-control-btn">
          Expandir tudo
        </button>
        <button type="button" onClick={collapseAll} className="tree-control-btn">
          Recolher tudo
        </button>
      </div>

      <ul className="tree-root" role="tree" aria-label="Estrutura do documento">
        {treeData.map(node => renderTreeNode(node))}
      </ul>
    </div>
  );
};

export default StructureTree;
