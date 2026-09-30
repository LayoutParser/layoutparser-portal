import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MappingDraftRequestError,
  mappingDraftService,
} from '../../services/api/mappingDraftService';
import type { MappingDraft } from '../../types/mappingDraft';
import MappingFiscalProfilePanel from './MappingFiscalProfilePanel';

vi.mock('../../services/api/mappingDraftService', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/mappingDraftService')>(
    '../../services/api/mappingDraftService'
  );
  return {
    MappingDraftRequestError: actual.MappingDraftRequestError,
    mappingDraftService: {
      setFiscalProfile: vi.fn(),
    },
  };
});

const draft: MappingDraft = {
  draftId: 'draft-1',
  workspaceId: 'workspace-1',
  packageId: 'package-1',
  revisionId: 'revision-1',
  engine: 'xslt',
  createdAt: '2026-08-31T19:00:00Z',
  rules: [],
  fiscalProfile: null,
  resolvedXsd: null,
};

describe('MappingFiscalProfilePanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('bloqueia o envio quando versão de schema ou operação estão vazias', () => {
    const onDraftChange = vi.fn();
    const { container } = render(
      <MappingFiscalProfilePanel
        workspaceId="workspace-1"
        draft={draft}
        onDraftChange={onDraftChange}
      />
    );

    // Dispara o submit diretamente para exercitar a validação client-side do componente, já
    // que os campos `required` bloqueariam o clique nativo do botão antes do handler rodar.
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    expect(screen.getByText('Versão do schema e operação são obrigatórias.')).toBeVisible();
    expect(mappingDraftService.setFiscalProfile).not.toHaveBeenCalled();
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it('salva o perfil fiscal e propaga o draft atualizado', async () => {
    const updatedDraft: MappingDraft = {
      ...draft,
      fiscalProfile: {
        documentType: 'nfe',
        schemaVersion: '4.00',
        operation: 'saida',
        jurisdiction: null,
      },
      resolvedXsd: {
        xsdVersion: 'PL_009_V4',
        namespace: 'http://www.portalfiscal.inf.br/nfe',
        rootElement: 'nfeProc',
      },
    };
    vi.mocked(mappingDraftService.setFiscalProfile).mockResolvedValue(updatedDraft);
    const onDraftChange = vi.fn();

    render(
      <MappingFiscalProfilePanel
        workspaceId="workspace-1"
        draft={draft}
        onDraftChange={onDraftChange}
      />
    );

    fireEvent.change(screen.getByLabelText('Versão do schema'), { target: { value: '4.00' } });
    fireEvent.change(screen.getByLabelText('Operação'), { target: { value: 'saida' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar perfil fiscal' }));

    await waitFor(() =>
      expect(mappingDraftService.setFiscalProfile).toHaveBeenCalledWith({
        workspaceId: 'workspace-1',
        draftId: 'draft-1',
        profile: { documentType: 'nfe', schemaVersion: '4.00', operation: 'saida' },
      })
    );
    expect(onDraftChange).toHaveBeenCalledWith(updatedDraft);
    expect(await screen.findByText('Perfil fiscal salvo.')).toBeVisible();
  });

  it('mostra mensagem específica quando o draft não é encontrado', async () => {
    vi.mocked(mappingDraftService.setFiscalProfile).mockRejectedValue(
      new MappingDraftRequestError('not_found', 'Draft não encontrado na API.')
    );

    render(
      <MappingFiscalProfilePanel workspaceId="workspace-1" draft={draft} onDraftChange={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText('Versão do schema'), { target: { value: '4.00' } });
    fireEvent.change(screen.getByLabelText('Operação'), { target: { value: 'saida' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar perfil fiscal' }));

    expect(
      await screen.findByText(
        'Este draft não foi encontrado — ele pode ter sido removido ou arquivado.'
      )
    ).toBeVisible();
  });

  it('exibe o resolvedXsd quando o draft já tem perfil fiscal', () => {
    const draftWithProfile: MappingDraft = {
      ...draft,
      fiscalProfile: {
        documentType: 'nfe',
        schemaVersion: '4.00',
        operation: 'saida',
        jurisdiction: null,
      },
      resolvedXsd: {
        xsdVersion: 'PL_009_V4',
        namespace: 'http://www.portalfiscal.inf.br/nfe',
        rootElement: 'nfeProc',
      },
    };

    render(
      <MappingFiscalProfilePanel
        workspaceId="workspace-1"
        draft={draftWithProfile}
        onDraftChange={vi.fn()}
      />
    );

    expect(screen.getByText('PL_009_V4')).toBeVisible();
    expect(screen.getByText('nfeProc')).toBeVisible();
  });
});
