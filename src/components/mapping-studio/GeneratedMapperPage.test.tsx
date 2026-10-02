import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mappingReleaseService } from '../../services/api/mappingReleaseService';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import GeneratedMapperPage from './GeneratedMapperPage';

vi.mock('../../services/api/mappingReleaseService', () => ({
  mappingReleaseService: { getGeneratedTransformation: vi.fn() },
}));

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/workspace/mapping-studio/mapper-guid-1/generated']}>
      <Routes>
        <Route
          path="/workspace/mapping-studio/:mapperGuid/generated"
          element={<GeneratedMapperPage />}
        />
      </Routes>
    </MemoryRouter>
  );

describe('GeneratedMapperPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ activeWorkspaceId: 'workspace-1' });
  });

  it('exibe o conteúdo TCL/XSLT gerado e a cobertura', async () => {
    vi.mocked(mappingReleaseService.getGeneratedTransformation).mockResolvedValue({
      mapperGuid: 'mapper-guid-1',
      status: 'ready',
      content: '<xsl:stylesheet version="1.0"/>',
      validationBasis: 'declared_dsl',
      generatedAt: '2026-10-01T10:00:00Z',
      generatedCoverage: {
        generatorVersion: '2',
        compiles: true,
        compileError: null,
        linksCovered: null,
        linksTotal: null,
        linkPct: '100%',
        rulesCovered: null,
        rulesTotal: null,
        rulePct: '97.9%',
        provenanceEntries: null,
        linkMappingsSemFolha: null,
        limitations: [],
      },
    });

    renderPage();

    expect(await screen.findByText('<xsl:stylesheet version="1.0"/>')).toBeVisible();
    expect(screen.getByText('declared_dsl')).toBeVisible();
    expect(screen.getByText(/regras 97.9%/)).toBeVisible();
    expect(mappingReleaseService.getGeneratedTransformation).toHaveBeenCalledWith(
      'workspace-1',
      'mapper-guid-1'
    );
  });

  it('mostra o erro quando a API falha', async () => {
    vi.mocked(mappingReleaseService.getGeneratedTransformation).mockRejectedValue(
      new Error('Mapeador não encontrado.')
    );

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Mapeador não encontrado.');
  });
});
