import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ParseRequestError, parseService } from '../../services/api';
import { layoutService } from '../../services/api/layoutService';
import { useAppStore } from '../../store/useAppStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { workspaceService } from '../../services/api/workspaceService';
import { useTransformationStore } from '../../store/useTransformationStore';
import LayoutParserPage from './LayoutParserPage';

vi.mock('../../services/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    parseService: { parseFiles: vi.fn(), parseAutomatically: vi.fn() },
  };
});

vi.mock('../../services/api/layoutService', () => ({
  layoutService: {
    searchLayouts: vi.fn(),
    refreshCache: vi.fn(),
  },
}));

vi.mock('../../services/api/workspaceService', () => ({
  workspaceService: { getCurrentWorkspaces: vi.fn() },
}));

vi.mock('../../services/api/logService', () => ({
  logService: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../analysis/AnalysisModeTabs', () => ({
  default: () => <div>Resultado de análise carregado</div>,
}));

const layout = {
  layoutGuid: 'layout-guid-1',
  name: 'Layout Faculdade',
  decryptedContent: '<layout />',
};

const alternateLayout = {
  layoutGuid: 'layout-guid-2',
  name: 'Layout Alternativo',
  decryptedContent: '<layout />',
};

const automaticCandidate = {
  rank: 1,
  layoutGuid: 'ad4fb6f4-9ff5-44fd-988b-3da5ed56b22c',
  name: 'LAY_TXT_MQSERIES_ENVNFE_4.00_NFe',
  matchScore: 100,
  isTied: true,
  evidence: ['records_matched:59/59'],
  conflicts: [],
  limitations: [],
};

const attachDocument = () => {
  const fileInput = document.querySelector<HTMLInputElement>('#txtFile');
  if (!fileInput) throw new Error('Input de arquivo não encontrado.');
  fireEvent.change(fileInput, {
    target: { files: [new File(['001CONTEUDO'], 'documento.txt', { type: 'text/plain' })] },
  });
};

const selectLayoutAndFile = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Buscar Layout' }));
  await screen.findByRole('combobox', { name: 'Selecionar Layout' });

  fireEvent.click(screen.getByRole('combobox', { name: 'Selecionar Layout' }));
  fireEvent.click(screen.getByRole('option', { name: /Layout Faculdade/ }));

  attachDocument();
};

describe('LayoutParserPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAppStore.getState().reset();
    useSessionStore.getState().reset();
    useTransformationStore.getState().reset();
    useWorkspaceStore.getState().reset();
    vi.mocked(layoutService.searchLayouts).mockResolvedValue({
      success: true,
      layouts: [layout],
    });
  });

  it('não renderiza "Atualizar Layout" para sessão sem função admin', () => {
    render(
      <MemoryRouter>
        <LayoutParserPage />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: /Atualizar Layout/ })).not.toBeInTheDocument();
  });

  it('renderiza "Atualizar Layout" desabilitado para admin até haver busca bem-sucedida', async () => {
    useSessionStore.setState({ isAdmin: true });
    render(
      <MemoryRouter>
        <LayoutParserPage />
      </MemoryRouter>
    );

    const refreshButton = screen.getByRole('button', { name: 'Atualizar Layout' });
    expect(refreshButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Buscar Layout' }));
    await screen.findByRole('combobox', { name: 'Selecionar Layout' });

    expect(refreshButton).toBeEnabled();
  });

  it('executa o fluxo de catálogo, upload e parse com sucesso', async () => {
    vi.mocked(parseService.parseFiles).mockResolvedValue({
      success: true,
      text: '001CONTEUDO',
      fields: [
        {
          lineName: 'LINHA001',
          fieldName: 'Tipo',
          value: '001',
          lineSequence: '001',
        },
      ],
    });

    render(
      <MemoryRouter>
        <LayoutParserPage />
      </MemoryRouter>
    );
    await selectLayoutAndFile();
    fireEvent.click(screen.getByRole('button', { name: 'Processar Documento' }));

    await waitFor(() => expect(parseService.parseFiles).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Resultado de análise carregado')).toBeInTheDocument();
    expect(useAppStore.getState()).toMatchObject({
      txtContent: '001CONTEUDO',
      uploadError: null,
      parseError: null,
      parsedDocumentProvenance: {
        document: { name: 'documento.txt' },
        layout: { layoutGuid: 'layout-guid-1', name: 'Layout Faculdade' },
      },
    });
    expect(screen.getByText(/Resultado vinculado a/)).toHaveTextContent(
      'documento.txt · 11 bytes · layout Layout Faculdade'
    );
  });

  it('identifica e processa um layout único sem baixar o XML do catálogo', async () => {
    vi.mocked(parseService.parseAutomatically).mockResolvedValue({
      success: true,
      correlationId: 'corr-auto-unique',
      detection: {
        status: 'unique',
        detectedType: 'mqseries',
        algorithmVersion: 'layout-probe-v1',
        catalogVersion: 'sha256:catalogo',
        totalCandidates: 1,
        truncated: false,
        selectedLayout: automaticCandidate,
        candidates: [automaticCandidate],
      },
      parseResult: {
        success: true,
        text: '001CONTEUDO',
        layout: {
          layoutGuid: automaticCandidate.layoutGuid,
          layoutType: 'TextPositional',
          name: automaticCandidate.name,
          description: '',
          limitOfCaracters: 600,
          elements: [],
        },
        fields: [],
      },
    });

    render(
      <MemoryRouter>
        <LayoutParserPage />
      </MemoryRouter>
    );
    attachDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Processar Documento' }));

    await waitFor(() => expect(parseService.parseAutomatically).toHaveBeenCalledTimes(1));
    expect(parseService.parseFiles).not.toHaveBeenCalled();
    expect(layoutService.searchLayouts).not.toHaveBeenCalled();
    expect(await screen.findByText('Resultado de análise carregado')).toBeInTheDocument();
    expect(useAppStore.getState()).toMatchObject({
      selectedLayout: {
        layoutGuid: automaticCandidate.layoutGuid,
        name: automaticCandidate.name,
      },
      selectedLayoutSource: 'auto_unique',
      parsedDocumentProvenance: {
        detection: {
          selectionSource: 'auto_unique',
          correlationId: 'corr-auto-unique',
          algorithmVersion: 'layout-probe-v1',
          catalogVersion: 'sha256:catalogo',
        },
      },
    });
    expect(useAppStore.getState().selectedLayout).not.toHaveProperty('decryptedContent');
  });

  it('falha fechado quando unique não informa o layout autoritativo selecionado', async () => {
    vi.mocked(parseService.parseAutomatically).mockResolvedValue({
      success: true,
      correlationId: 'corr-invalid-unique',
      detection: {
        status: 'unique',
        detectedType: 'mqseries',
        algorithmVersion: 'layout-probe-v1',
        catalogVersion: 'sha256:catalogo',
        totalCandidates: 1,
        truncated: false,
        candidates: [automaticCandidate],
      },
      parseResult: {
        success: true,
        text: '001CONTEUDO',
        fields: [],
      },
    });

    render(
      <MemoryRouter>
        <LayoutParserPage />
      </MemoryRouter>
    );
    attachDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Processar Documento' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A API não informou qual layout produziu o parse automático.'
    );
    expect(useAppStore.getState().parseResult).toBeNull();
    expect(useAppStore.getState().selectedLayout).toBeNull();
  });

  it('não pré-seleciona equivalências e só processa após a escolha explícita', async () => {
    const secondCandidate = {
      ...automaticCandidate,
      rank: 2,
      layoutGuid: 'bd4fb6f4-9ff5-44fd-988b-3da5ed56b22c',
      name: 'LAY_FIAT_TXT_MQSERIES_ENVNFE_4.00_NFe',
      matchScore: 99,
    };
    vi.mocked(parseService.parseAutomatically)
      .mockResolvedValueOnce({
        success: true,
        correlationId: 'corr-detect',
        detection: {
          status: 'ambiguous',
          detectedType: 'mqseries',
          algorithmVersion: 'layout-probe-v1',
          catalogVersion: 'sha256:catalogo',
          totalCandidates: 2,
          truncated: false,
          candidates: [automaticCandidate, secondCandidate],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        correlationId: 'corr-select',
        detection: {
          status: 'ambiguous',
          detectedType: 'mqseries',
          algorithmVersion: 'layout-probe-v1',
          catalogVersion: 'sha256:catalogo',
          totalCandidates: 2,
          truncated: false,
          selectedLayout: secondCandidate,
          candidates: [automaticCandidate, secondCandidate],
        },
        parseResult: {
          success: true,
          text: '001CONTEUDO',
          layout: {
            layoutGuid: secondCandidate.layoutGuid,
            layoutType: 'TextPositional',
            name: secondCandidate.name,
            description: '',
            limitOfCaracters: 600,
            elements: [],
          },
          fields: [],
        },
      });

    render(
      <MemoryRouter>
        <LayoutParserPage />
      </MemoryRouter>
    );
    attachDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Processar Documento' }));

    expect(await screen.findByText('Escolha entre os layouts equivalentes')).toBeInTheDocument();
    expect(useAppStore.getState().parseResult).toBeNull();
    expect(useAppStore.getState().selectedLayout).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Usar este layout' })[1]!);

    await waitFor(() => expect(parseService.parseAutomatically).toHaveBeenCalledTimes(2));
    expect(parseService.parseAutomatically).toHaveBeenLastCalledWith(
      expect.objectContaining({ layoutGuidOverride: secondCandidate.layoutGuid }),
      expect.any(Object)
    );
    expect(await screen.findByText('Resultado de análise carregado')).toBeInTheDocument();
    expect(useAppStore.getState()).toMatchObject({
      selectedLayoutSource: 'ranked_candidate',
      parsedDocumentProvenance: {
        detection: {
          selectionSource: 'ranked_candidate',
          correlationId: 'corr-select',
          candidateRank: 2,
          matchScore: 99,
        },
      },
    });
    expect(screen.getByRole('button', { name: 'Layout em uso' })).toBeDisabled();
  });

  it('invalida resultado e transformação ao trocar o layout processado', async () => {
    vi.mocked(layoutService.searchLayouts).mockResolvedValue({
      success: true,
      layouts: [layout, alternateLayout],
    });
    vi.mocked(parseService.parseFiles).mockResolvedValue({
      success: true,
      text: '001CONTEUDO',
      fields: [],
    });

    render(
      <MemoryRouter>
        <LayoutParserPage />
      </MemoryRouter>
    );
    await selectLayoutAndFile();
    fireEvent.click(screen.getByRole('button', { name: 'Processar Documento' }));
    await screen.findByText('Resultado de análise carregado');
    useTransformationStore.setState({
      hasEvaluatedCandidates: true,
      candidates: [
        {
          candidateId: 'tclxsl-1',
          pathway: 'tcl-xsl',
          transformedXml: '<root />',
          score: null,
          segmentMappings: {},
          validation: null,
          failureReason: null,
        },
      ],
    });

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: /Layout Alternativo/ }));

    expect(useAppStore.getState()).toMatchObject({
      selectedLayout: alternateLayout,
      parseResult: null,
      parsedDocumentProvenance: null,
    });
    expect(useTransformationStore.getState()).toMatchObject({
      hasEvaluatedCandidates: false,
      candidates: [],
    });
    expect(screen.queryByText('Resultado de análise carregado')).not.toBeInTheDocument();
  });

  it('preserva edições até confirmação explícita da troca de arquivo', async () => {
    vi.mocked(parseService.parseFiles).mockResolvedValue({
      success: true,
      text: '001CONTEUDO',
      fields: [],
    });

    render(
      <MemoryRouter>
        <LayoutParserPage />
      </MemoryRouter>
    );
    await selectLayoutAndFile();
    fireEvent.click(screen.getByRole('button', { name: 'Processar Documento' }));
    await screen.findByText('Resultado de análise carregado');
    act(() => {
      useAppStore.setState({
        editHistory: [
          {
            fieldIndex: 0,
            lineIndex: 0,
            previousField: { lineName: 'LINHA001', fieldName: 'CNPJ', value: '1' },
            previousValue: '1',
            nextValue: '2',
          },
        ],
      });
    });

    const fileInput = document.querySelector<HTMLInputElement>('#txtFile');
    if (!fileInput) throw new Error('Input de arquivo não encontrado.');
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['OUTRO'], 'outro.txt', {
            type: 'text/plain',
            lastModified: 456,
          }),
        ],
      },
    });

    expect(screen.getByRole('dialog', { name: 'Descartar alterações pendentes?' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Manter documento atual' }));
    expect(useAppStore.getState().parseResult).not.toBeNull();
    expect(screen.getByText('Resultado de análise carregado')).toBeInTheDocument();

    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['OUTRO'], 'outro.txt', {
            type: 'text/plain',
            lastModified: 456,
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Descartar e trocar' }));

    expect(useAppStore.getState()).toMatchObject({
      parseResult: null,
      parsedDocumentProvenance: null,
      editHistory: [],
    });
    expect(screen.getByText(/Arquivo selecionado: outro.txt/)).toBeInTheDocument();
  });

  it('remove o resultado anterior quando o documento seguinte falha', async () => {
    useAppStore.setState({
      parseResult: { success: true, text: 'ANTERIOR' },
      txtContent: 'ANTERIOR',
      fields: [{ lineName: 'A', fieldName: 'B', value: 'C' }],
    });
    vi.mocked(parseService.parseFiles).mockRejectedValue(
      new ParseRequestError({
        kind: 'parse_error',
        message: 'Documento inválido.',
        httpStatus: 422,
        failureCause: 'document_malformed',
      })
    );

    render(
      <MemoryRouter>
        <LayoutParserPage />
      </MemoryRouter>
    );
    await selectLayoutAndFile();
    fireEvent.click(screen.getByRole('button', { name: 'Processar Documento' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Documento inválido.');
    expect(useAppStore.getState()).toMatchObject({
      parseResult: null,
      txtContent: '',
      fields: [],
    });
  });

  it('cancela o upload em andamento sem aplicar resultado novo', async () => {
    vi.mocked(parseService.parseFiles).mockImplementation(
      (_request, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Upload cancelado.', 'AbortError'));
          });
        })
    );

    render(
      <MemoryRouter>
        <LayoutParserPage />
      </MemoryRouter>
    );
    await selectLayoutAndFile();
    fireEvent.click(screen.getByRole('button', { name: 'Processar Documento' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar processamento' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Processamento cancelado');
    expect(useAppStore.getState()).toMatchObject({
      parseResult: null,
      isUploading: false,
    });
  });

  it('pré-seleciona o layout de uma reabertura (#197) sem disparar parse automático', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/upload',
            state: {
              reopenLayout: {
                mode: 'upload',
                layoutGuid: 'layout-guid-1',
                layoutName: 'Layout Faculdade',
                fileId: null,
              },
            },
          },
        ]}
      >
        <LayoutParserPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Buscar Layout' }));

    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Layout selecionado: Layout Faculdade' })
      ).toBeInTheDocument()
    );
    expect(parseService.parseFiles).not.toHaveBeenCalled();
    expect(parseService.parseAutomatically).not.toHaveBeenCalled();
  });

  it('avisa quando a reabertura (#197) veio de detecção automática, sem pré-selecionar layout', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/upload',
            state: {
              reopenLayout: {
                mode: 'auto',
                layoutGuid: null,
                layoutName: 'Layout Detectado Automaticamente',
                fileId: null,
              },
            },
          },
        ]}
      >
        <LayoutParserPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Layout Detectado Automaticamente/)).toBeInTheDocument();
    expect(parseService.parseFiles).not.toHaveBeenCalled();
    expect(parseService.parseAutomatically).not.toHaveBeenCalled();
  });

  describe('Arquivo de análises', () => {
    const okParse = { success: true, text: '001CONTEUDO', fields: [] };
    const processManual = async () => {
      render(
        <MemoryRouter>
          <LayoutParserPage />
        </MemoryRouter>
      );
      await selectLayoutAndFile();
      fireEvent.click(screen.getByRole('button', { name: 'Processar Documento' }));
      await waitFor(() => expect(parseService.parseFiles).toHaveBeenCalledTimes(1));
    };

    it('aguarda o carregamento dos workspaces e envia workspaceId', async () => {
      vi.mocked(workspaceService.getCurrentWorkspaces).mockResolvedValue({
        activeWorkspaceId: 'ws-1',
        workspaces: [],
      });
      vi.mocked(parseService.parseFiles).mockResolvedValue({
        ...okParse,
        historyRegistered: true,
        analysisId: 'an-1',
      });

      await processManual();

      expect(vi.mocked(parseService.parseFiles).mock.calls[0][0]).toMatchObject({
        workspaceId: 'ws-1',
      });
      const status = await screen.findByText(/Arquivos salvos no/);
      expect(status.closest('[role="status"]')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Arquivo de análises' })).toHaveAttribute(
        'href',
        '/workspace/analysis-archive/an-1'
      );
    });

    it('segue sem workspaceId quando o carregamento falha e avisa que não arquivou', async () => {
      vi.mocked(workspaceService.getCurrentWorkspaces).mockRejectedValue(new Error('falha'));
      vi.mocked(parseService.parseFiles).mockResolvedValue(okParse);

      await processManual();

      expect(vi.mocked(parseService.parseFiles).mock.calls[0][0]).not.toHaveProperty('workspaceId');
      expect(await screen.findByText('Esta análise não foi arquivada.')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('avisa quando a API respondeu historyRegistered false', async () => {
      useWorkspaceStore.setState({ status: 'ready', activeWorkspaceId: 'ws-1' });
      vi.mocked(parseService.parseFiles).mockResolvedValue({
        ...okParse,
        historyRegistered: false,
      });

      await processManual();

      expect(await screen.findByText('Esta análise não foi arquivada.')).toBeInTheDocument();
    });

    it('não mostra nada quando a API antiga não envia o campo', async () => {
      useWorkspaceStore.setState({ status: 'ready', activeWorkspaceId: 'ws-1' });
      vi.mocked(parseService.parseFiles).mockResolvedValue(okParse);

      await processManual();
      await screen.findByText('Resultado de análise carregado');

      expect(screen.queryByText(/Arquivos salvos/)).not.toBeInTheDocument();
      expect(screen.queryByText(/não foi arquivada/)).not.toBeInTheDocument();
    });
  });
});
