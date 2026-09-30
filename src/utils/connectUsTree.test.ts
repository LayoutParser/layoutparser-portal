import { describe, expect, it } from 'vitest';
import type { LayoutTreeNode } from '../types/workspace';
import { buildVinculos, formatNodeCardinality } from './connectUsTree';

const node = (guid: string, name: string, children: LayoutTreeNode[] = []): LayoutTreeNode => ({
  guid,
  name,
  kind: 'element',
  cardinality: { min: null, max: null },
  children,
});

const source = { roots: [node('S1', 'NumeroPedido'), node('S2', 'Quantidade')] };
const target = { roots: [node('T1', 'numero'), node('T2', 'qtd')] };

describe('connectUsTree', () => {
  it('nomeia ligação Origem_Destino e regra Rule_Destino, penduradas no destino', () => {
    const { byTarget, diagnostics } = buildVinculos(source, target, [
      { ruleId: 'LKM_1', sourceElementGuid: 'S1', targetElementGuid: 'T1' },
      { ruleId: 'RUL_1', sourceElementGuid: '', targetElementGuid: 'T2' },
    ]);
    expect(byTarget.get('T1')?.[0]).toMatchObject({ kind: 'link', text: 'NumeroPedido_numero' });
    expect(byTarget.get('T2')?.[0]).toMatchObject({ kind: 'rule', text: 'Rule_qtd' });
    expect(diagnostics).toEqual([]);
  });

  it('mantém vínculos órfãos como diagnóstico em vez de descartá-los', () => {
    const { byTarget, diagnostics } = buildVinculos(source, target, [
      { ruleId: 'LKM_X', sourceElementGuid: 'nao-existe', targetElementGuid: 'T1' },
      { ruleId: 'LKM_Y', sourceElementGuid: 'S1', targetElementGuid: 'nao-existe' },
    ]);
    expect(byTarget.size).toBe(0);
    expect(diagnostics).toEqual([
      { code: 'ORPHAN_LINK', id: 'LKM_X' },
      { code: 'ORPHAN_LINK', id: 'LKM_Y' },
    ]);
  });

  it('sinaliza destino com ligação e regra ou com mais de uma ligação', () => {
    const { diagnostics } = buildVinculos(source, target, [
      { ruleId: 'A', sourceElementGuid: 'S1', targetElementGuid: 'T1' },
      { ruleId: 'B', sourceElementGuid: '', targetElementGuid: 'T1' },
      { ruleId: 'C', sourceElementGuid: 'S1', targetElementGuid: 'T2' },
      { ruleId: 'D', sourceElementGuid: 'S2', targetElementGuid: 'T2' },
    ]);
    expect(diagnostics).toContainEqual({ code: 'TARGET_HAS_LINK_AND_RULE', id: 'T1' });
    expect(diagnostics).toContainEqual({ code: 'TARGET_HAS_MULTIPLE_LINKS', id: 'T2' });
  });

  it('formata a cardinalidade como (mín, máx) e usa (—) quando desconhecida', () => {
    const item = { ...node('g', 'LINHA_ITEM'), cardinality: { min: 1, max: 999 } };
    expect(formatNodeCardinality(item)).toBe('(1, 999)');
    expect(formatNodeCardinality({ ...item, cardinality: { min: 0, max: null } })).toBe(
      '(0, ilimitado)'
    );
    expect(formatNodeCardinality(node('g', 'x'))).toBe('(—)');
  });
});
