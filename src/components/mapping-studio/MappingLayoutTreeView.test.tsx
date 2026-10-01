import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  LayoutTreeNode,
  LayoutTreeRuleLink,
  LayoutTreeSide,
  MappingRuleExplanation,
} from '../../types/workspace';
import MappingLayoutTreeView from './MappingLayoutTreeView';

const leafSource: LayoutTreeNode = {
  guid: 'src-leaf-1',
  name: 'CampoOrigem',
  kind: 'attribute',
  cardinality: { min: 0, max: 1 },
  children: [],
};

const rootSource1: LayoutTreeNode = {
  guid: 'src-root-1',
  name: 'RaizOrigemA',
  kind: 'element',
  cardinality: { min: 1, max: 1 },
  children: [leafSource],
};

const rootSource2: LayoutTreeNode = {
  guid: 'src-root-2',
  name: 'RaizOrigemB',
  kind: 'group',
  cardinality: { min: null, max: null },
  children: [],
};

const leafTarget: LayoutTreeNode = {
  guid: 'tgt-leaf-1',
  name: 'CampoDestino',
  kind: 'attribute',
  cardinality: { min: 1, max: null },
  children: [],
};

const rootTarget: LayoutTreeNode = {
  guid: 'tgt-root-1',
  name: 'RaizDestino',
  kind: 'element',
  cardinality: { min: 1, max: 1 },
  children: [leafTarget],
};

const source: LayoutTreeSide = { roots: [rootSource1, rootSource2] };
const target: LayoutTreeSide = { roots: [rootTarget] };

const rules: LayoutTreeRuleLink[] = [
  { ruleId: 'RULE-1', sourceElementGuid: 'src-leaf-1', targetElementGuid: 'tgt-leaf-1' },
];

const explanationRules: MappingRuleExplanation[] = [
  {
    ruleId: 'RULE-1',
    sourceRefs: ['CampoOrigem'],
    targetRefs: ['CampoDestino'],
    condition: 'valor != null',
    operations: ['copy'],
    cardinality: '1..1',
    evidence: [],
    humanDescription: 'Copia CampoOrigem para CampoDestino quando preenchido.',
    technicalDetail: 'if (origem != null) {\n  destino = origem;\n} else {\n  destino = "";\n}',
    supportLevel: 'authoritative',
  },
];

describe('MappingLayoutTreeView', () => {
  it('renderiza múltiplas raízes de origem e a raiz de destino', () => {
    render(
      <MappingLayoutTreeView source={source} target={target} rules={rules} limitations={[]} />
    );

    expect(screen.getByText('RaizOrigemA')).toBeVisible();
    expect(screen.getByText('RaizOrigemB')).toBeVisible();
    expect(screen.getByText('RaizDestino')).toBeVisible();
  });

  it('mostra cardinalidade formatada, incluindo min/max nulos como "—"/ilimitado', () => {
    render(
      <MappingLayoutTreeView source={source} target={target} rules={rules} limitations={[]} />
    );

    const cardinalities = Array.from(
      document.querySelectorAll('.mapping-layout-tree-cardinality')
    ).map(node => node.textContent);
    expect(cardinalities).toContain('(1, 1)');
    expect(cardinalities).toContain('(—)');
  });

  it('exibe o badge de regra inline no nó de origem vinculado', () => {
    render(
      <MappingLayoutTreeView source={source} target={target} rules={rules} limitations={[]} />
    );

    expect(screen.getAllByText('Regra RULE-1').length).toBeGreaterThan(0);
  });

  it('exibe as limitações vindas da API quando há regras não representadas na árvore', () => {
    const limitations = [
      'Mapper tem 107 regra(s) condicional(is)/DSL que não aparecem em Rules[].',
    ];
    render(
      <MappingLayoutTreeView
        source={source}
        target={target}
        rules={rules}
        limitations={limitations}
      />
    );

    expect(screen.getByText(limitations[0])).toBeVisible();
  });

  it('não mostra o aviso de limitações quando a API não reporta nenhuma', () => {
    render(
      <MappingLayoutTreeView source={source} target={target} rules={rules} limitations={[]} />
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('destaca o nó correspondente do outro lado ao selecionar um nó com regra', () => {
    render(
      <MappingLayoutTreeView source={source} target={target} rules={rules} limitations={[]} />
    );

    fireEvent.click(screen.getByText('CampoOrigem'));
    const targetItem = screen.getByText('CampoDestino').closest('[role="treeitem"]');
    expect(targetItem).toHaveClass('mapping-layout-tree-item--highlighted');
  });

  it('mostra o painel de propriedades do nó selecionado', () => {
    render(
      <MappingLayoutTreeView source={source} target={target} rules={rules} limitations={[]} />
    );

    fireEvent.click(screen.getByText('RaizOrigemA'));
    const panel = screen.getByText('Propriedades do nó selecionado').closest('section');
    expect(panel).not.toBeNull();
    expect(within(panel as HTMLElement).getByText('RaizOrigemA')).toBeVisible();
    expect(within(panel as HTMLElement).getByText('Elemento')).toBeVisible();
  });

  it('filtra nós por nome em ambas as árvores via busca', () => {
    render(
      <MappingLayoutTreeView source={source} target={target} rules={rules} limitations={[]} />
    );

    fireEvent.change(screen.getByLabelText('Buscar nó nas árvores de origem e destino'), {
      target: { value: 'CampoOrigem' },
    });

    expect(screen.getByText('CampoOrigem')).toBeVisible();
    expect(screen.queryByText('RaizOrigemB')).not.toBeInTheDocument();
    expect(screen.queryByText('RaizDestino')).not.toBeInTheDocument();
    expect(screen.queryByText('CampoDestino')).not.toBeInTheDocument();
  });

  it('expande e recolhe tudo via toolbar', () => {
    render(
      <MappingLayoutTreeView source={source} target={target} rules={rules} limitations={[]} />
    );

    expect(screen.queryByText('CampoOrigem')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Recolher tudo' }));
    expect(screen.queryByText('CampoOrigem')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expandir tudo' }));
    expect(screen.getByText('CampoOrigem')).toBeVisible();
  });

  it('mostra estado vazio quando um lado não tem raízes (target.roots = [] é dado real, não erro)', () => {
    render(
      <MappingLayoutTreeView source={source} target={{ roots: [] }} rules={[]} limitations={[]} />
    );

    expect(screen.getByText('Nenhum nó de destino disponível.')).toBeVisible();
  });

  it('mantém o botão "Ver regra" desabilitado sem nó selecionado', () => {
    render(
      <MappingLayoutTreeView
        source={source}
        target={target}
        rules={rules}
        limitations={[]}
        explanationRules={explanationRules}
      />
    );

    expect(screen.getByRole('button', { name: 'Ver regra' })).toBeDisabled();
  });

  it('mantém o botão "Ver regra" desabilitado ao selecionar nó sem regra vinculada', () => {
    render(
      <MappingLayoutTreeView
        source={source}
        target={target}
        rules={rules}
        limitations={[]}
        explanationRules={explanationRules}
      />
    );

    fireEvent.click(screen.getByText('RaizOrigemB'));
    expect(screen.getByRole('button', { name: 'Ver regra' })).toBeDisabled();
  });

  it('habilita o botão "Ver regra" ao selecionar nó com regra vinculada e explicação carregada', () => {
    render(
      <MappingLayoutTreeView
        source={source}
        target={target}
        rules={rules}
        limitations={[]}
        explanationRules={explanationRules}
      />
    );

    fireEvent.click(screen.getByText('CampoOrigem'));
    expect(screen.getByRole('button', { name: 'Ver regra' })).toBeEnabled();
  });

  it('mantém o botão "Ver regra" desabilitado quando a explicação ainda não foi carregada', () => {
    render(
      <MappingLayoutTreeView source={source} target={target} rules={rules} limitations={[]} />
    );

    fireEvent.click(screen.getByText('CampoOrigem'));
    expect(screen.getByRole('button', { name: 'Ver regra' })).toBeDisabled();
  });

  it('abre o painel de detalhe da regra com humanDescription e technicalDetail preservando quebras de linha', () => {
    render(
      <MappingLayoutTreeView
        source={source}
        target={target}
        rules={rules}
        limitations={[]}
        explanationRules={explanationRules}
      />
    );

    fireEvent.click(screen.getByText('CampoOrigem'));
    fireEvent.click(screen.getByRole('button', { name: 'Ver regra' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Regra RULE-1')).toBeVisible();
    expect(
      within(dialog).getByText('Copia CampoOrigem para CampoDestino quando preenchido.')
    ).toBeVisible();
    const codeBlock = dialog.querySelector('.mapping-layout-tree-rule-detail-code code');
    expect(codeBlock?.textContent).toBe(
      'if (origem != null) {\n  destino = origem;\n} else {\n  destino = "";\n}'
    );
  });

  it('fecha o painel de detalhe da regra pelo botão de fechar e por Esc', () => {
    render(
      <MappingLayoutTreeView
        source={source}
        target={target}
        rules={rules}
        limitations={[]}
        explanationRules={explanationRules}
      />
    );

    fireEvent.click(screen.getByText('CampoOrigem'));
    fireEvent.click(screen.getByRole('button', { name: 'Ver regra' }));
    expect(screen.getByRole('dialog')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Fechar janela' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Seleção do nó persiste após fechar o modal; reabrir não exige nova seleção.
    fireEvent.click(screen.getByRole('button', { name: 'Ver regra' }));
    expect(screen.getByRole('dialog')).toBeVisible();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('pendura a ligação como filho do nó de destino, como no ConnectUs', () => {
    render(
      <MappingLayoutTreeView source={source} target={target} rules={rules} limitations={[]} />
    );

    const items = screen.getAllByRole('treeitem');
    const vinculos = items.filter(item =>
      item.classList.contains('mapping-layout-tree-vinculo--link')
    );
    expect(vinculos.length).toBeGreaterThan(0);
    expect(vinculos[0].textContent).toMatch(/^.*\S+_\S+$/);
  });

  it('marca com o clipe roxo o nó de destino que possui vínculo', () => {
    render(
      <MappingLayoutTreeView source={source} target={target} rules={rules} limitations={[]} />
    );

    const clips = screen.getAllByTestId('vinculo-clip');
    expect(clips.length).toBeGreaterThan(0);
    expect(clips[0]).toHaveAccessibleName(/Possui \d* ?vínculos?/);
  });

  describe('unavailableReason', () => {
    const cases: [string, RegExp][] = [
      ['layout-not-found', /não foi encontrado na API/],
      ['layout-unreadable', /ilegível ou não possui elementos/],
      ['unsupported-kind', /tipo de layout não é suportado/],
      ['xsd-unresolved', /XSD não pôde ser resolvido/],
    ];

    it.each(cases)('mostra mensagem específica e o código para %s', (reason, message) => {
      render(
        <MappingLayoutTreeView
          source={source}
          target={{ roots: [], unavailableReason: reason }}
          rules={[]}
          limitations={[]}
        />
      );
      expect(screen.getByRole('status')).toHaveTextContent(message);
      expect(screen.getByRole('status')).toHaveTextContent('Layout de destino indisponível');
      expect(screen.getByTestId('unavailable-reason')).toHaveTextContent(reason);
    });

    it('usa a mensagem genérica para razão desconhecida ou ausente', () => {
      render(
        <MappingLayoutTreeView
          source={{ roots: [], unavailableReason: 'nova-razao' }}
          target={{ roots: [] }}
          rules={[]}
          limitations={[]}
        />
      );
      const items = screen.getAllByText(/a API não devolveu os nós/);
      expect(items).toHaveLength(2);
      expect(screen.getAllByTestId('unavailable-reason')).toHaveLength(1);
    });
  });
});
