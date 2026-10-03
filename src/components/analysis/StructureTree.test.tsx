import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getFieldPhysicalId } from '../../utils/fieldIdentity';
import { useAppStore } from '../../store/useAppStore';
import { useFieldStore } from '../../store/useFieldStore';
import { useStructureStore } from '../../store/useStructureStore';
import type { Field } from '../../types/field';
import StructureTree from './StructureTree';

const fields: Field[] = [
  { lineName: 'HEADER', fieldName: 'Tipo', value: '001', sequence: 1 },
  { lineName: 'HEADER', fieldName: 'Data', value: '20260810', sequence: 2 },
];

describe('StructureTree', () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    useStructureStore.setState({
      treeData: [],
      expandedNodes: new Set<string>(),
      selectedNodeId: null,
    });
    useFieldStore.setState({
      fields: [],
      fieldGroups: [],
      selectedField: null,
      highlightedFields: new Set<string>(),
    });
    useAppStore.getState().setParseResult({ success: true, fields });
    useAppStore.getState().setFields(fields);
  });

  // Timeout ampliado (padrão do projeto é 5000ms): localmente este teste roda em
  // 200-1000ms mesmo sob carga da suíte completa, mas em runners de CI com CPU
  // limitada a sequência de render + múltiplos fireEvent + waitFor por vezes
  // ultrapassa o default. Não é lógica quebrada nem condição que nunca resolve
  // (ver StructureTree.test.tsx execuções repetidas), só menos margem sob
  // contenção de recursos do runner.
  it('expõe árvore semântica e permite expandir e navegar pelo teclado', async () => {
    render(<StructureTree />);

    const tree = await screen.findByRole('tree', { name: 'Estrutura do documento' });
    expect(tree).toBeInTheDocument();

    const lineItem = screen.getByRole('treeitem', { name: /HEADER/i });
    expect(lineItem).toHaveAttribute('aria-expanded', 'false');
    lineItem.focus();
    fireEvent.keyDown(lineItem, { key: 'ArrowRight' });

    await waitFor(() => expect(lineItem).toHaveAttribute('aria-expanded', 'true'));
    const typeItem = screen.getByRole('treeitem', { name: /Tipo/i });
    fireEvent.keyDown(lineItem, { key: 'ArrowDown' });
    expect(typeItem).toHaveFocus();

    fireEvent.keyDown(typeItem, { key: 'End' });
    expect(screen.getByRole('treeitem', { name: /Data/i })).toHaveFocus();
  }, 10000);

  it('seleciona e alterna a expansão ao ativar a linha', async () => {
    render(<StructureTree />);
    const lineItem = await screen.findByRole('treeitem', { name: /HEADER/i });

    fireEvent.click(lineItem);

    expect(lineItem).toHaveAttribute('aria-selected', 'true');
    expect(lineItem).toHaveAttribute('aria-expanded', 'true');
  });

  it('apresenta layouts SAP como hierarquia expansível de segmentos', async () => {
    const sapFields: Field[] = [
      { lineName: 'LINHA_EMIT', fieldName: 'CNPJ', value: '02990605001174', sequence: 1 },
    ];
    useAppStore.getState().setParseResult({
      success: true,
      fields: sapFields,
      layout: {
        layoutGuid: 'LAY_sap',
        layoutType: 'TextPositional',
        name: 'LAY_MARELLI_TXT_SAP_ENVNFE_4.00_NFe',
        description: 'Layout IDoc SAP NFe',
        limitOfCaracters: 0,
        elements: [
          {
            type: 'LineElementVO',
            elementGuid: 'LIN_control',
            name: 'LINHA000',
            description: '',
            sequence: 1,
            isRequired: true,
            initialValue: 'EDI_DC40',
            elements: [],
          },
          {
            type: 'LineElementVO',
            elementGuid: 'LIN_ide',
            name: 'LINHA_IDE',
            description: '',
            sequence: 2,
            isRequired: false,
            initialValue: 'ZRSDM_NFE_400_IDE000',
            elements: [],
          },
          {
            type: 'LineElementVO',
            elementGuid: 'LIN_emit',
            name: 'LINHA_EMIT',
            description: '',
            sequence: 3,
            isRequired: false,
            initialValue: 'ZRSDM_NFE_400_EMIT000',
            elements: [
              JSON.stringify({
                Type: 'FieldElementVO',
                ElementGuid: 'FLD_cnpj',
                Name: 'CNPJ',
                Sequence: 1,
              }),
              JSON.stringify({
                Type: 'LineElementVO',
                ElementGuid: 'LIN_enderemit',
                Name: 'LINHA_ENDEMIT',
                Sequence: 2,
                InitialValue: 'ZRSDM_NFE_400_ENDEREMIT000',
                Elements: [],
              }),
            ],
          },
        ],
      },
    });
    useAppStore.getState().setFields(sapFields);

    render(<StructureTree />);

    expect(await screen.findByText('Hierarquia de segmentos')).toBeInTheDocument();
    expect(screen.getByText('4 segmentos')).toBeInTheDocument();

    const control = screen.getByRole('treeitem', { name: /EDI_DC40/i });
    expect(control).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(control);

    const emit = await screen.findByRole('treeitem', { name: /ZRSDM_NFE_400_EMIT/i });
    expect(emit).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('treeitem', { name: /CNPJ/i })).not.toBeInTheDocument();

    fireEvent.click(emit);
    expect(
      await screen.findByRole('treeitem', { name: /ZRSDM_NFE_400_ENDEREMIT/i })
    ).toBeInTheDocument();
    expect(useFieldStore.getState().highlightedFields).toContain(getFieldPhysicalId(sapFields[0]));
  });

  it('não aplica a hierarquia de segmentos SAP a um layout MQSeries', async () => {
    const mqFields: Field[] = [
      { lineName: 'LINHA_MQ', fieldName: 'Codigo', value: '001', sequence: 1 },
    ];
    useAppStore.getState().setParseResult({
      success: true,
      detectedType: 'mqseries',
      fields: mqFields,
      layout: {
        layoutGuid: 'LAY_mq',
        layoutType: 'TextPositional',
        name: 'LAY_CNHI_TXT_MQSERIES_ENVNFE_4.00_NFe',
        description: 'Layout MQSeries',
        limitOfCaracters: 0,
        elements: [
          {
            type: 'LineElementVO',
            elementGuid: 'LIN_mq',
            name: 'LINHA_MQ',
            description: '',
            sequence: 1,
            isRequired: true,
            initialValue: 'LINHA000',
            elements: [
              JSON.stringify({
                Type: 'FieldElementVO',
                ElementGuid: 'FLD_codigo',
                Name: 'Codigo',
                Sequence: 1,
              }),
            ],
          },
        ],
      },
    });
    useAppStore.getState().setFields(mqFields);

    render(<StructureTree />);

    await screen.findByRole('tree', { name: 'Estrutura do documento' });
    expect(screen.queryByText('Hierarquia de segmentos')).not.toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /LINHA_MQ/i })).toBeInTheDocument();
  });

  it('aplica a hierarquia mesmo com nome de layout genérico quando detectedType é idoc', async () => {
    const sapFields: Field[] = [
      { lineName: 'LINHA_EMIT', fieldName: 'CNPJ', value: '02990605001174', sequence: 1 },
    ];
    useAppStore.getState().setParseResult({
      success: true,
      detectedType: 'idoc',
      fields: sapFields,
      layout: {
        layoutGuid: 'LAY_sap_generico',
        layoutType: 'TextPositional',
        name: 'LAY_QUALQUER_NOME_SEM_SUFIXO_SAP',
        description: 'Layout IDoc detectado pelo back-end',
        limitOfCaracters: 0,
        elements: [
          {
            type: 'LineElementVO',
            elementGuid: 'LIN_control',
            name: 'LINHA000',
            description: '',
            sequence: 1,
            isRequired: true,
            initialValue: 'EDI_DC40',
            elements: [],
          },
          {
            type: 'LineElementVO',
            elementGuid: 'LIN_emit',
            name: 'LINHA_EMIT',
            description: '',
            sequence: 2,
            isRequired: false,
            initialValue: 'ZRSDM_NFE_400_EMIT000',
            elements: [],
          },
        ],
      },
    });
    useAppStore.getState().setFields(sapFields);

    render(<StructureTree />);

    expect(await screen.findByText('Hierarquia de segmentos')).toBeInTheDocument();
  });

  it('destaca o campo com a identidade física ao clicar na linha e depois no campo', async () => {
    render(<StructureTree />);
    const lineItem = await screen.findByRole('treeitem', { name: /HEADER/i });
    fireEvent.click(lineItem);
    expect(useFieldStore.getState().highlightedFields).toEqual(
      new Set([getFieldPhysicalId(fields[0])])
    );

    fireEvent.click(await screen.findByRole('treeitem', { name: /Data/i }));
    expect(useFieldStore.getState().highlightedFields).toEqual(
      new Set([getFieldPhysicalId(fields[1])])
    );
  });

  it('não exibe rótulo de tipo para nós de linha e campo', async () => {
    render(<StructureTree />);
    fireEvent.click(await screen.findByRole('treeitem', { name: /HEADER/i }));
    expect(screen.queryByText('LineElement')).not.toBeInTheDocument();
    expect(screen.queryByText('FieldElement')).not.toBeInTheDocument();
  });
});
