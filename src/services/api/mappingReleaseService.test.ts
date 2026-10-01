import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api';
import { mappingReleaseService } from './mappingReleaseService';

vi.mock('../api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const release = {
  releaseId: 'release-1',
  workspaceId: 'workspace-1',
  draftId: 'draft-1',
  engine: 'xslt',
  artifacts: [
    {
      kind: 'xslt',
      content: '<xsl:stylesheet version="1.0"/>',
      hash: 'sha256-release',
      generatedAt: '2026-08-31T22:00:00Z',
    },
  ],
  sourceRuleIds: ['rule-1'],
  compileDiagnostics: [],
  rulesSnapshotHash: 'snapshot-hash',
  testRunSummary: null,
  status: 'draft_compiled',
  correlationId: 'correlation-1',
  createdAt: '2026-08-31T22:00:00Z',
  eTag: 'AAAAAAAAAAE=',
};

const governanceSnapshot = {
  releaseId: 'release-1',
  workspaceId: 'workspace-1',
  draftId: 'draft-1',
  engine: 'xslt',
  status: 'approved',
  environment: 'development',
  approvedByUserId: 'reviewer-1',
  approvedAt: '2026-09-01T10:00:00Z',
  approvalJustification: 'Revisão fiscal concluída.',
  publishedByUserId: null,
  publishedAt: null,
  previousPublishedReleaseId: null,
  correlationId: 'correlation-1',
  eTag: 'AAAAAAAAAAI=',
};

describe('mappingReleaseService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('inicia e observa a compilação assíncrona', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { jobId: 'compile-job-1', status: 'queued' },
    });
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        jobId: 'compile-job-1',
        status: 'completed',
        releaseId: 'release-1',
        error: null,
        durationMs: 42,
      },
    });

    await expect(mappingReleaseService.compileDraft('workspace-1', 'draft-1')).resolves.toEqual({
      jobId: 'compile-job-1',
      status: 'queued',
      releaseId: null,
      error: null,
      durationMs: null,
    });
    await expect(
      mappingReleaseService.getCompileJob('workspace-1', 'draft-1', 'compile-job-1')
    ).resolves.toMatchObject({ status: 'completed', releaseId: 'release-1' });
  });

  it('aceita release cujos campos nulos foram omitidos pela API (WhenWritingNull)', async () => {
    const withoutNulls: Partial<typeof release> = { ...release };
    delete withoutNulls.testRunSummary;
    vi.mocked(apiClient.get).mockResolvedValue({ data: withoutNulls });

    await expect(
      mappingReleaseService.getRelease('workspace-1', 'draft-1', 'release-1')
    ).resolves.toMatchObject({ releaseId: 'release-1', testRunSummary: null });
  });

  it('consulta release e valida o snapshot compilado', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: release });

    await expect(
      mappingReleaseService.getRelease('workspace-1', 'draft-1', 'release-1')
    ).resolves.toEqual({
      ...release,
      environment: null,
      approvedByUserId: null,
      approvedAt: null,
      approvalJustification: null,
      publishedByUserId: null,
      publishedAt: null,
      previousPublishedReleaseId: null,
      fiscalProfile: null,
      resolvedXsd: null,
      requiredCoverage: null,
      artifactSource: 'generated',
      derivedFromReleaseId: null,
      manualEditReason: null,
      manuallyEditedArtifactKinds: [],
    });
    expect(apiClient.get).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/mapping-drafts/draft-1/releases/release-1'
    );
  });

  it('envia a fixture ad-hoc sem persistir ou transformar o XML no front', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { jobId: 'test-job-1', status: 'queued' },
    });
    const inputXml = '<source><CNPJ>123</CNPJ></source>';
    const expectedXml = '<NFe><emit><CNPJ>123</CNPJ></emit></NFe>';

    await expect(
      mappingReleaseService.createTestRun({
        workspaceId: 'workspace-1',
        draftId: 'draft-1',
        releaseId: 'release-1',
        inputXml,
        expectedXml,
        xsdVersion: '4.00',
      })
    ).resolves.toEqual({
      jobId: 'test-job-1',
      status: 'queued',
      releaseId: 'release-1',
      requiredGatesPassed: null,
      error: null,
      durationMs: null,
    });
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/mapping-drafts/draft-1/test-runs',
      { releaseId: 'release-1', inputXml, expectedXml, xsdVersion: '4.00' }
    );
    expect(window.localStorage).toHaveLength(0);
  });

  it('observa o resultado dos gates do Test Lab', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        jobId: 'test-job-1',
        status: 'completed',
        releaseId: 'release-1',
        requiredGatesPassed: false,
        error: null,
        durationMs: 91,
      },
    });

    await expect(
      mappingReleaseService.getTestRunJob('workspace-1', 'draft-1', 'test-job-1')
    ).resolves.toMatchObject({ status: 'completed', requiredGatesPassed: false });
  });

  it('recusa release com percentual de cobertura impossível', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        ...release,
        status: 'test_passed',
        testRunSummary: {
          passed: 1,
          failed: 0,
          coveragePercent: 120,
          requiredGatesPassed: true,
          xsdValid: true,
          xsdErrors: [],
          divergences: [],
        },
      },
    });

    await expect(
      mappingReleaseService.getRelease('workspace-1', 'draft-1', 'release-1')
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it.each(['sysmiddle', ' sysmiddle ', ['xslt', 'sysmiddle'], { value: 'xslt' }])(
    'recusa release devolvida com engine adulterado: %o',
    async engine => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: { ...release, engine } });

      await expect(
        mappingReleaseService.getRelease('workspace-1', 'draft-1', 'release-1')
      ).rejects.toMatchObject({ kind: 'invalid_response' });
    }
  );

  it('recusa estado test_passed contraditório com gates reprovados', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        ...release,
        status: 'test_passed',
        testRunSummary: {
          passed: 0,
          failed: 1,
          coveragePercent: 50,
          requiredGatesPassed: false,
          xsdValid: false,
          xsdErrors: ['XML inválido.'],
          divergences: [],
        },
      },
    });

    await expect(
      mappingReleaseService.getRelease('workspace-1', 'draft-1', 'release-1')
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('aceita status governado no GET completo sem inventar metadados omitidos pela API', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        ...release,
        status: 'published',
        testRunSummary: {
          passed: 1,
          failed: 0,
          coveragePercent: 100,
          requiredGatesPassed: true,
          xsdValid: true,
          xsdErrors: ['Validação XSD indisponível — não considerada no gate.'],
          divergences: [],
        },
      },
    });

    await expect(
      mappingReleaseService.getRelease('workspace-1', 'draft-1', 'release-1')
    ).resolves.toMatchObject({ status: 'published', environment: null });
  });

  it('aprova somente com justificativa e valida a resposta parcial', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: governanceSnapshot });

    await expect(
      mappingReleaseService.approveRelease(
        'workspace-1',
        'release-1',
        '  Revisão fiscal concluída.  '
      )
    ).resolves.toEqual(governanceSnapshot);
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/mapping-releases/release-1/approve',
      { justification: 'Revisão fiscal concluída.' }
    );
    await expect(
      mappingReleaseService.approveRelease('workspace-1', 'release-1', '   ')
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('publica apenas nos ambientes suportados pela interface', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: {
        ...governanceSnapshot,
        status: 'published',
        environment: 'production',
        publishedByUserId: 'admin-1',
        publishedAt: '2026-09-01T10:05:00Z',
      },
    });

    await expect(
      mappingReleaseService.publishRelease('workspace-1', 'release-1', 'production')
    ).resolves.toMatchObject({ status: 'published', environment: 'production' });
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/mapping-releases/release-1/publish',
      { environment: 'production' }
    );
  });

  it('executa rollback sem corpo e mantém o retorno idempotente autoritativo', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: {
        ...governanceSnapshot,
        status: 'deprecated',
        environment: 'production',
        publishedByUserId: 'admin-1',
        publishedAt: '2026-09-01T10:05:00Z',
        previousPublishedReleaseId: 'release-0',
      },
    });

    await expect(
      mappingReleaseService.rollbackRelease('workspace-1', 'release-1')
    ).resolves.toMatchObject({ status: 'deprecated' });
    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/mapping-releases/release-1/rollback'
    );
  });

  it('recusa mutação que tenta trocar a identidade do recurso', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { ...governanceSnapshot, releaseId: 'release-alheia' },
    });

    await expect(
      mappingReleaseService.approveRelease('workspace-1', 'release-1', 'Revisão concluída.')
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('lista releases paginadas do workspace (issue #198)', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        items: [
          {
            releaseId: 'release-1',
            workspaceId: 'workspace-1',
            draftId: 'draft-1',
            engine: 'xslt',
            status: 'draft_compiled',
            environment: 'development',
            approvedByUserId: null,
            approvedAt: null,
            approvalJustification: null,
            publishedByUserId: null,
            publishedAt: null,
            previousPublishedReleaseId: null,
            correlationId: 'correlation-1',
            eTag: 'AAAAAAAAAAE=',
          },
        ],
        page: 1,
        pageSize: 20,
        totalCount: 1,
      },
    });

    await expect(mappingReleaseService.listReleases('workspace-1')).resolves.toEqual({
      items: [
        expect.objectContaining({
          origin: 'draft_compile',
          releaseId: 'release-1',
          status: 'draft_compiled',
        }),
      ],
      page: 1,
      pageSize: 20,
      totalCount: 1,
      autoGeneratedUnavailable: false,
    });
    expect(apiClient.get).toHaveBeenCalledWith('/api/workspaces/workspace-1/mapping-releases', {
      params: { page: 1, pageSize: 20 },
    });
  });

  it('lista mapeadores gerados automaticamente (origin: auto_generated) misturados com releases reais', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        items: [
          {
            origin: 'draft_compile',
            releaseId: 'release-1',
            workspaceId: 'workspace-1',
            draftId: 'draft-1',
            engine: 'xslt',
            status: 'draft_compiled',
            environment: 'development',
            approvedByUserId: null,
            approvedAt: null,
            approvalJustification: null,
            publishedByUserId: null,
            publishedAt: null,
            previousPublishedReleaseId: null,
            correlationId: 'correlation-1',
            eTag: 'AAAAAAAAAAE=',
          },
          {
            origin: 'auto_generated',
            mapperGuid: 'mapper-guid-1',
            mapperName: 'MAP_CNHI_MQSERIES_SEND_ENV_TXT_XML_NFE',
            status: 'ready',
            validationBasis: 'declared_dsl',
            coverage: { percent: 92, uncovered: ['NFe/infNFe/dest/CNPJ'] },
            generatedAt: '2026-09-20T12:00:00Z',
            correlationId: 'correlation-2',
            detailUrl:
              '/api/workspaces/workspace-1/mappings/mapper-guid-1/generated-transformation',
          },
        ],
        page: 1,
        pageSize: 20,
        totalCount: 2,
        autoGeneratedUnavailable: false,
      },
    });

    const response = await mappingReleaseService.listReleases('workspace-1');

    expect(response.items).toHaveLength(2);
    expect(response.items[1]).toEqual({
      origin: 'auto_generated',
      mapperGuid: 'mapper-guid-1',
      mapperName: 'MAP_CNHI_MQSERIES_SEND_ENV_TXT_XML_NFE',
      status: 'ready',
      validationBasis: 'declared_dsl',
      coverage: { percent: 92, uncovered: ['NFe/infNFe/dest/CNPJ'] },
      generatedCoverage: null,
      generatedAt: '2026-09-20T12:00:00Z',
      correlationId: 'correlation-2',
      detailUrl: '/api/workspaces/workspace-1/mappings/mapper-guid-1/generated-transformation',
    });
  });

  it('aceita cobertura do gerador v2 (linkPct/rulePct, sem percent/uncovered)', async () => {
    const autoItem = (index: number, coverage: Record<string, unknown>) => ({
      origin: 'auto_generated',
      mapperGuid: `mapper-guid-${index}`,
      mapperName: `MAP_SINTETICO_${index}`,
      status: 'ready',
      validationBasis: 'declared_dsl',
      coverage,
      generatedAt: '2026-09-20T12:00:00Z',
      correlationId: `correlation-${index}`,
      detailUrl: `/api/workspaces/workspace-1/mappings/mapper-guid-${index}/generated-transformation`,
    });
    const v2 = {
      generatorVersion: '2',
      shell: { rootElement: 'Root', attributes: [] },
      limitations: ['limitação sintética'],
      compiles: true,
      linksCovered: 244,
      linksTotal: 244,
      linkPct: '100%',
      rulesCovered: 46,
      rulesTotal: 47,
      rulePct: '97.9%',
      provenanceEntries: 317,
      linkMappingsSemFolha: 0,
    };
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        items: Array.from({ length: 20 }, (_, i) => autoItem(i, v2)).concat(autoItem(99, {})),
        page: 1,
        pageSize: 20,
        totalCount: 21,
      },
    });

    const response = await mappingReleaseService.listReleases('workspace-1');

    expect(response.items).toHaveLength(21);
    expect(response.items[0]).toMatchObject({
      coverage: null,
      generatedCoverage: {
        generatorVersion: '2',
        compiles: true,
        compileError: null,
        linkPct: '100%',
        rulePct: '97.9%',
        rulesCovered: 46,
        limitations: ['limitação sintética'],
      },
    });
    expect(response.items[20]).toMatchObject({ coverage: null });
  });

  it('recusa item auto_generated com status fora do enum conhecido', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        items: [
          {
            origin: 'auto_generated',
            mapperGuid: 'mapper-guid-1',
            mapperName: 'MAP_CNHI',
            status: 'unknown_status',
            validationBasis: 'declared_dsl',
            coverage: null,
            generatedAt: '2026-09-20T12:00:00Z',
            correlationId: 'correlation-2',
            detailUrl:
              '/api/workspaces/workspace-1/mappings/mapper-guid-1/generated-transformation',
          },
        ],
        page: 1,
        pageSize: 20,
        totalCount: 1,
        autoGeneratedUnavailable: false,
      },
    });

    await expect(mappingReleaseService.listReleases('workspace-1')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('recusa paginação fora dos limites antes de chamar a API', async () => {
    await expect(mappingReleaseService.listReleases('workspace-1', 0)).rejects.toMatchObject({
      kind: 'invalid_input',
    });
    await expect(mappingReleaseService.listReleases('workspace-1', 1, 101)).rejects.toMatchObject({
      kind: 'invalid_input',
    });
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('não descarta divergencesByRuleId ao consultar a release (issue #228)', async () => {
    const divergence = {
      kind: 'value_mismatch',
      xpath: '/NFe/infNFe/emit/CNPJ',
      expected: '123',
      actual: '456',
      ruleId: 'rule-1',
      sourceRefs: ['layout://CNPJ'],
      evidence: null,
    };
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        ...release,
        status: 'test_failed',
        testRunSummary: {
          passed: 0,
          failed: 1,
          coveragePercent: 80,
          requiredGatesPassed: false,
          xsdValid: true,
          xsdErrors: [],
          divergences: [divergence],
          divergencesByRuleId: { 'rule-1': [divergence] },
        },
      },
    });

    const result = await mappingReleaseService.getRelease('workspace-1', 'draft-1', 'release-1');
    expect(result.testRunSummary?.divergencesByRuleId).toEqual({ 'rule-1': [divergence] });
  });

  it('trata divergencesByRuleId ausente como null, não como erro', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: {
        ...release,
        status: 'test_passed',
        testRunSummary: {
          passed: 1,
          failed: 0,
          coveragePercent: 100,
          requiredGatesPassed: true,
          xsdValid: true,
          xsdErrors: [],
          divergences: [],
        },
      },
    });

    const result = await mappingReleaseService.getRelease('workspace-1', 'draft-1', 'release-1');
    expect(result.testRunSummary?.divergencesByRuleId).toBeNull();
  });

  describe('editArtifact (issue #226)', () => {
    it('envia If-Match citado e devolve a release derivada', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue({
        data: {
          ...release,
          releaseId: 'release-2',
          artifactSource: 'manual_edit',
          derivedFromReleaseId: 'release-1',
          manualEditReason: 'Ajuste pontual de namespace.',
          manuallyEditedArtifactKinds: ['xslt'],
        },
      });

      const result = await mappingReleaseService.editArtifact({
        workspaceId: 'workspace-1',
        draftId: 'draft-1',
        engine: 'xslt',
        baseArtifactHash: 'sha256-release',
        content: '<xsl:stylesheet version="1.0"><!-- ajustado --></xsl:stylesheet>',
        justification: 'Ajuste pontual de namespace.',
      });

      expect(apiClient.patch).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/mapping-drafts/draft-1/artifacts/xslt',
        {
          content: '<xsl:stylesheet version="1.0"><!-- ajustado --></xsl:stylesheet>',
          justification: 'Ajuste pontual de namespace.',
        },
        { headers: { 'If-Match': '"sha256-release"' } }
      );
      expect(result).toMatchObject({
        releaseId: 'release-2',
        artifactSource: 'manual_edit',
        derivedFromReleaseId: 'release-1',
        manualEditReason: 'Ajuste pontual de namespace.',
        manuallyEditedArtifactKinds: ['xslt'],
      });
    });

    it('recusa entrada sem hash base, conteúdo ou justificativa antes de chamar a API', async () => {
      const baseInput = {
        workspaceId: 'workspace-1',
        draftId: 'draft-1',
        engine: 'xslt' as const,
        baseArtifactHash: 'sha256-release',
        content: '<xsl:stylesheet/>',
        justification: 'Correção pontual.',
      };

      await expect(
        mappingReleaseService.editArtifact({ ...baseInput, baseArtifactHash: '  ' })
      ).rejects.toMatchObject({ kind: 'invalid_input' });
      await expect(
        mappingReleaseService.editArtifact({ ...baseInput, content: '   ' })
      ).rejects.toMatchObject({ kind: 'invalid_input' });
      await expect(
        mappingReleaseService.editArtifact({ ...baseInput, justification: '   ' })
      ).rejects.toMatchObject({ kind: 'invalid_input' });
      expect(apiClient.patch).not.toHaveBeenCalled();
    });

    it('devolve o artefato atual em conflito 412', async () => {
      vi.mocked(apiClient.patch).mockRejectedValue({
        isAxiosError: true,
        response: {
          status: 412,
          data: {
            error: 'O artefato mudou em outra sessão.',
            current: release.artifacts[0],
          },
        },
      });
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        mappingReleaseService.editArtifact({
          workspaceId: 'workspace-1',
          draftId: 'draft-1',
          engine: 'xslt',
          baseArtifactHash: 'hash-desatualizado',
          content: '<xsl:stylesheet/>',
          justification: 'Correção pontual.',
        })
      ).rejects.toMatchObject({
        kind: 'conflict',
        currentArtifact: release.artifacts[0],
      });
    });

    it('mapeia 428 (sem If-Match) para precondition', async () => {
      vi.mocked(apiClient.patch).mockRejectedValue({
        isAxiosError: true,
        response: { status: 428, data: {} },
      });
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        mappingReleaseService.editArtifact({
          workspaceId: 'workspace-1',
          draftId: 'draft-1',
          engine: 'xslt',
          baseArtifactHash: 'sha256-release',
          content: '<xsl:stylesheet/>',
          justification: 'Correção pontual.',
        })
      ).rejects.toMatchObject({ kind: 'precondition' });
    });

    it('mapeia 422 (conteúdo sintaticamente inválido) para rejected', async () => {
      vi.mocked(apiClient.patch).mockRejectedValue({
        isAxiosError: true,
        response: { status: 422, data: { error: 'XSLT inválido: tag não fechada.' } },
      });
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        mappingReleaseService.editArtifact({
          workspaceId: 'workspace-1',
          draftId: 'draft-1',
          engine: 'xslt',
          baseArtifactHash: 'sha256-release',
          content: '<xsl:stylesheet>',
          justification: 'Correção pontual.',
        })
      ).rejects.toMatchObject({ kind: 'rejected', message: 'XSLT inválido: tag não fechada.' });
    });

    it('mapeia 404 (sem identidade/membership) para not_found', async () => {
      vi.mocked(apiClient.patch).mockRejectedValue({
        isAxiosError: true,
        response: { status: 404, data: {} },
      });
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        mappingReleaseService.editArtifact({
          workspaceId: 'workspace-1',
          draftId: 'draft-1',
          engine: 'xslt',
          baseArtifactHash: 'sha256-release',
          content: '<xsl:stylesheet/>',
          justification: 'Correção pontual.',
        })
      ).rejects.toMatchObject({ kind: 'not_found' });
    });
  });

  describe('getReleasesDiff (issue #228, diff A×B)', () => {
    it('busca o diff agregado por elemento de schema', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: {
          fromReleaseId: 'release-1',
          toReleaseId: 'release-2',
          changes: [
            {
              element: '/NFe/infNFe/emit/CNPJ',
              changeKind: 'modified',
              fromValue: '123',
              toValue: '456',
            },
          ],
        },
      });

      const diff = await mappingReleaseService.getReleasesDiff(
        'workspace-1',
        'draft-1',
        'release-1',
        'release-2'
      );

      expect(apiClient.get).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/mapping-drafts/draft-1/releases/diff',
        { params: { fromReleaseId: 'release-1', toReleaseId: 'release-2' } }
      );
      expect(diff.changes).toEqual([
        {
          element: '/NFe/infNFe/emit/CNPJ',
          changeKind: 'modified',
          fromValue: '123',
          toValue: '456',
        },
      ]);
    });

    it('recusa releaseIds vazios antes de chamar a API', async () => {
      await expect(
        mappingReleaseService.getReleasesDiff('workspace-1', 'draft-1', '', 'release-2')
      ).rejects.toMatchObject({ kind: 'invalid_input' });
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it('mapeia 404 (releases de workspace/draft diferentes) para not_found', async () => {
      vi.mocked(apiClient.get).mockRejectedValue({
        isAxiosError: true,
        response: { status: 404, data: {} },
      });
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        mappingReleaseService.getReleasesDiff('workspace-1', 'draft-1', 'release-1', 'release-9')
      ).rejects.toMatchObject({ kind: 'not_found' });
    });

    it('mapeia 422 (release sem test-run rodado) para rejected', async () => {
      vi.mocked(apiClient.get).mockRejectedValue({
        isAxiosError: true,
        response: { status: 422, data: { error: 'Release sem test-run executado.' } },
      });
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        mappingReleaseService.getReleasesDiff('workspace-1', 'draft-1', 'release-1', 'release-2')
      ).rejects.toMatchObject({ kind: 'rejected', message: 'Release sem test-run executado.' });
    });
  });
});
