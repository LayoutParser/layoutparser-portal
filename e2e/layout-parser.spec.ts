import { expect, test, type Page } from '@playwright/test';

const layoutGuid = '11111111-1111-1111-1111-111111111111';
const syntheticTxt = `000001001ABC${' '.repeat(588)}`;
const sapLayoutName = 'LAY_MARELLI_TXT_SAP_ENVNFE_4.00_NFe';

const mockAuthenticatedGateway = async (
  page: Page,
  isAdmin = true,
  workspaceRole: 'owner' | 'fiscal_admin' = 'owner'
) => {
  await page.route('**/api/session', route =>
    route.fulfill({
      json: {
        authenticated: true,
        user: { name: 'FACULDADE\\aluno' },
        roles: isAdmin ? ['admin'] : ['user'],
        isAdmin,
      },
    })
  );

  await page.route('**/api/workspaces/me', route =>
    route.fulfill({
      json: {
        activeWorkspaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        workspaces: [
          {
            workspaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            name: 'Workspace fiscal E2E',
            kind: 'personal',
            role: workspaceRole,
            createdAt: '2026-08-31T12:00:00Z',
          },
        ],
      },
    })
  );

  await page.route('**/api/logs/client', route => route.fulfill({ status: 204 }));
};

const mappingDraftId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const mappingRuleId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const mappingReleaseId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const mockMappingStudioApis = async (page: Page) => {
  let releaseStatus: 'draft_compiled' | 'test_passed' | 'approved' | 'published' | 'deprecated' =
    'draft_compiled';

  const governanceResponse = () => ({
    releaseId: mappingReleaseId,
    workspaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    draftId: mappingDraftId,
    engine: 'xslt',
    status: releaseStatus,
    environment:
      releaseStatus === 'published' || releaseStatus === 'deprecated'
        ? 'production'
        : 'development',
    approvedByUserId:
      releaseStatus === 'draft_compiled' || releaseStatus === 'test_passed' ? null : 'reviewer-e2e',
    approvedAt:
      releaseStatus === 'draft_compiled' || releaseStatus === 'test_passed'
        ? null
        : '2026-09-01T10:00:00Z',
    approvalJustification:
      releaseStatus === 'draft_compiled' || releaseStatus === 'test_passed'
        ? null
        : 'Aprovada pelo cenário E2E.',
    publishedByUserId:
      releaseStatus === 'published' || releaseStatus === 'deprecated' ? 'admin-e2e' : null,
    publishedAt:
      releaseStatus === 'published' || releaseStatus === 'deprecated'
        ? '2026-09-01T10:05:00Z'
        : null,
    previousPublishedReleaseId:
      releaseStatus === 'published' || releaseStatus === 'deprecated'
        ? 'release-anterior-e2e'
        : null,
    correlationId: 'mapping-e2e-correlation',
    eTag: 'AAAAAAAAAAM=',
  });

  await page.route('**/api/workspaces/*/mappings/*/versions/draft/explanation', route =>
    route.fulfill({
      json: {
        mappingId: mappingDraftId,
        version: 'draft',
        engine: 'xslt',
        capabilities: {
          execute: true,
          explain: true,
          author: true,
          compile: true,
          publish: false,
        },
        sourceSchema: { layoutGuid: layoutGuid, description: 'Layout MQSeries NF-e 4.00' },
        targetSchema: { layoutGuid: null, description: 'XSD NF-e 4.00' },
        rules: [
          {
            ruleId: mappingRuleId,
            sourceRefs: ['layout://LINHA004/CNPJ'],
            targetRefs: ['xsd:///NFe/infNFe/emit/CNPJ'],
            condition: null,
            operations: ['copy'],
            cardinality: '1:1',
            evidence: [{ kind: 'xsd', reference: '/NFe/infNFe/emit/CNPJ' }],
            humanDescription: 'Copia o CNPJ do emitente para a NF-e.',
            technicalDetail: '["copy"]',
            supportLevel: 'authoritative',
          },
        ],
        description: 'Mapping fiscal de homologação.',
        limitations: [],
        opaqueRuleCount: 0,
      },
    })
  );

  await page.route('**/api/workspaces/*/mappings/*/layout-tree', route =>
    route.fulfill({
      json: {
        source: {
          roots: [
            {
              elementGuid: 'src-linha004',
              name: 'LINHA004',
              kind: 'element',
              cardinality: { min: 1, max: 1 },
              children: [
                {
                  elementGuid: 'src-cnpj',
                  name: 'CNPJ',
                  kind: 'attribute',
                  cardinality: { min: 1, max: 1 },
                  children: [],
                },
              ],
            },
          ],
        },
        target: {
          roots: [
            {
              elementGuid: 'tgt-emit',
              name: 'emit',
              kind: 'group',
              cardinality: { min: 1, max: 1 },
              children: [
                {
                  elementGuid: 'tgt-cnpj',
                  name: 'CNPJ',
                  kind: 'element',
                  cardinality: { min: 1, max: 1 },
                  children: [],
                },
              ],
            },
          ],
        },
        rules: [
          {
            ruleId: mappingRuleId,
            sourceElementGuid: 'src-cnpj',
            targetElementGuid: 'tgt-cnpj',
          },
        ],
        limitations: [],
      },
    })
  );

  await page.route('**/api/workspaces/*/mapping-drafts/*', async route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.includes('/compile/') || requestUrl.pathname.includes('/releases/')) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      json: {
        draftId: mappingDraftId,
        workspaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        packageId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        revisionId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        engine: 'xslt',
        createdAt: '2026-08-31T20:00:00Z',
        rules: [
          {
            ruleId: mappingRuleId,
            draftId: mappingDraftId,
            sourceRefs: ['layout://LINHA004/CNPJ'],
            targetRefs: ['xsd:///NFe/infNFe/emit/CNPJ'],
            operation: 'copy',
            conditions: '[]',
            transformations: '[]',
            cardinality: '1:1',
            evidence: [{ kind: 'xsd', reference: '/NFe/infNFe/emit/CNPJ' }],
            confidence: 'high',
            status: 'accepted',
            questions: [],
            createdAt: '2026-08-31T20:01:00Z',
            eTag: 'AAAAAAAAAAE=',
          },
        ],
      },
    });
  });

  await page.route('**/api/workspaces/*/mapping-drafts/*/compile', route =>
    route.fulfill({ json: { jobId: 'compile-job-e2e', status: 'queued' } })
  );
  await page.route('**/api/workspaces/*/mapping-drafts/*/compile/*', route =>
    route.fulfill({
      json: {
        jobId: 'compile-job-e2e',
        status: 'completed',
        releaseId: mappingReleaseId,
        error: null,
        durationMs: 14,
      },
    })
  );
  await page.route('**/api/workspaces/*/mapping-drafts/*/releases/*', route =>
    route.fulfill({
      json: {
        releaseId: mappingReleaseId,
        workspaceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        draftId: mappingDraftId,
        engine: 'xslt',
        artifacts: [
          {
            kind: 'xslt',
            content: '<xsl:stylesheet version="1.0"/>',
            hash: 'xslt-e2e-hash',
            generatedAt: '2026-08-31T20:02:00Z',
          },
        ],
        sourceRuleIds: [mappingRuleId],
        compileDiagnostics: [],
        rulesSnapshotHash: 'rules-e2e-hash',
        testRunSummary:
          releaseStatus === 'draft_compiled'
            ? null
            : {
                passed: 1,
                failed: 0,
                coveragePercent: 100,
                requiredGatesPassed: true,
                xsdValid: true,
                xsdErrors: [],
                divergences: [],
              },
        status: releaseStatus,
        correlationId: 'mapping-e2e-correlation',
        createdAt: '2026-08-31T20:02:00Z',
        eTag: 'AAAAAAAAAAI=',
      },
    })
  );
  await page.route('**/api/workspaces/*/mapping-drafts/*/test-runs', route =>
    route.fulfill({ json: { jobId: 'test-job-e2e', status: 'queued' } })
  );
  await page.route('**/api/workspaces/*/mapping-drafts/*/test-runs/*', route => {
    releaseStatus = 'test_passed';
    return route.fulfill({
      json: {
        jobId: 'test-job-e2e',
        status: 'completed',
        releaseId: mappingReleaseId,
        requiredGatesPassed: true,
        error: null,
        durationMs: 21,
      },
    });
  });
  await page.route('**/api/workspaces/*/mapping-releases/*/approve', async route => {
    expect(route.request().postDataJSON()).toEqual({
      justification: 'Revisão fiscal aprovada no E2E.',
    });
    releaseStatus = 'approved';
    return route.fulfill({ json: governanceResponse() });
  });
  await page.route('**/api/workspaces/*/mapping-releases/*/publish', async route => {
    expect(route.request().postDataJSON()).toEqual({ environment: 'production' });
    releaseStatus = 'published';
    return route.fulfill({ json: governanceResponse() });
  });
  await page.route('**/api/workspaces/*/mapping-releases/*/rollback', route => {
    releaseStatus = 'deprecated';
    return route.fulfill({ json: governanceResponse() });
  });
};

const mockProcessingApis = async (page: Page, withoutCandidates = false) => {
  await page.route('**/api/layoutdatabase/mqseries-nfe', route =>
    route.fulfill({
      json: {
        success: true,
        layouts: [
          {
            layoutGuid,
            name: 'Layout Demonstração',
            description: 'Fixture sintética para E2E',
            decryptedContent: '<layout />',
          },
        ],
      },
    })
  );

  await page.route('**/api/parse/upload', route =>
    route.fulfill({
      headers: { 'X-Correlation-ID': 'e2e-correlation' },
      json: {
        success: true,
        detectedType: 'mqseries',
        text: syntheticTxt,
        layout: {
          layoutGuid,
          layoutType: '2',
          name: 'Layout Demonstração',
          description: 'Fixture sintética',
          limitOfCaracters: 600,
          elements: [
            {
              type: 'LineElementVO',
              elementGuid: 'line-guid-001',
              description: 'Linha sintética',
              sequence: 1,
              name: 'LINHA001',
              isRequired: true,
              elements: [
                JSON.stringify({
                  Type: 'FieldElementVO',
                  ElementGuid: 'field-guid-codigo',
                  Name: 'Código',
                  Sequence: 1,
                  LengthField: 3,
                }),
                JSON.stringify({
                  Type: 'FieldElementVO',
                  ElementGuid: 'field-guid-filler',
                  Name: 'Filler',
                  Sequence: 2,
                  LengthField: 588,
                }),
              ],
            },
          ],
        },
        fields: [
          {
            lineName: 'LINHA001',
            fieldName: 'Código',
            value: 'ABC',
            start: 10,
            length: 3,
            lineSequence: '000001',
            sequence: 1,
            occurrence: 1,
            isValid: true,
          },
          {
            lineName: 'LINHA001',
            fieldName: 'Filler',
            value: '',
            start: 13,
            length: 0,
            lineSequence: '000001',
            sequence: 2,
            occurrence: 1,
            isValid: true,
          },
        ],
        lineValidations: [
          {
            lineName: 'LINHA001',
            initialValue: '001',
            initialValueLength: 3,
            sequenceFromPreviousLine: 6,
            fieldsLength: 591,
            sequenciaLength: 6,
            totalLength: 600,
            isValid: true,
            hasChildren: true,
            fieldCount: 2,
            calculatedPositions: { 'Código#1': 10, 'Filler#2': 13 },
          },
        ],
        transformationsStatus: withoutCandidates ? 'processing' : 'completed',
        transformationsReason: withoutCandidates ? 'timeout_sync' : undefined,
      },
    })
  );

  await page.route('**/api/transformationexecution/execute-candidates', route => {
    const request = route.request().postDataJSON() as { inputContent?: string } | null;
    const code = request?.inputContent?.slice(9, 12) || 'ABC';
    return route.fulfill({
      json: {
        success: true,
        candidates: withoutCandidates
          ? []
          : [
              {
                candidateId: 'sysmiddle-mapper-1',
                pathway: 'sysmiddle',
                transformedXml: `<documento><codigo>${code}</codigo></documento>`,
                score: null,
                segmentMappings: {},
                fieldMappings: [
                  {
                    mappingId: 'mapping-codigo',
                    sources: [
                      {
                        lineGuid: 'line-guid-001',
                        lineName: 'LINHA001',
                        fieldGuid: 'field-guid-codigo',
                        fieldName: 'Código',
                        lineOccurrence: 1,
                        startPosition: 10,
                        length: 3,
                      },
                    ],
                    targets: [
                      {
                        xpath: '/documento/codigo',
                        nodeKind: 'Text',
                        xmlOccurrence: null,
                      },
                    ],
                    kind: 'Direct',
                    confidence: 'Authoritative',
                    limitations: null,
                  },
                ],
                sectionMappings: [],
                xmlNamespaces: null,
                validation: null,
                failureReason: null,
              },
            ],
        recommendedCandidateId: withoutCandidates ? null : 'sysmiddle-mapper-1',
        warnings: withoutCandidates
          ? [
              'Nenhum mapeador low-code encontrado para o layout Layout Demonstração (pathway sysmiddle)',
              'Candidato tcl-xsl falhou: XSL não encontrado para o layout',
              'Nenhum candidato de transformação encontrado para o layout Layout Demonstração',
            ]
          : [],
      },
    });
  });
};

const processSyntheticDocument = async (page: Page) => {
  await page.goto('/upload');

  await page.getByRole('button', { name: 'Buscar Layout' }).click();
  await page.getByRole('combobox', { name: 'Selecionar Layout' }).click();
  await page.getByRole('option', { name: /Layout Demonstração/ }).click();
  await page.locator('#txtFile').setInputFiles({
    name: 'documento.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(syntheticTxt),
  });
  await page.getByRole('button', { name: 'Processar Documento' }).click();
};

const mockSapProcessingApis = async (page: Page) => {
  const field = (elementGuid: string, name: string, sequence: number) => ({
    elementGuid,
    name,
    sequence,
    type: 'FieldElementVO',
    isRequired: false,
  });
  const line = (
    elementGuid: string,
    name: string,
    initialValue: string,
    sequence: number,
    elements: unknown[] = []
  ) => ({
    elementGuid,
    name,
    initialValue,
    sequence,
    type: 'LineElementVO',
    isRequired: false,
    elements,
  });
  const layoutElements = [
    line('edi', 'LINHA000', 'EDI_DC40', 1),
    line('ide', 'LINHA_IDE', 'ZRSDM_NFE_400_IDE000', 2),
    line('emit', 'LINHA_EMIT', 'ZRSDM_NFE_400_EMIT000', 3, [
      field('cnpj', 'CNPJ', 1),
      line('enderemit', 'LINHA_ENDEMIT', 'ZRSDM_NFE_400_ENDEREMIT000', 2),
    ]),
  ];

  await page.route('**/api/layoutdatabase/mqseries-nfe', route =>
    route.fulfill({
      json: {
        success: true,
        layouts: [
          {
            layoutGuid,
            name: sapLayoutName,
            description: 'Fixture SAP IDoc para E2E',
            decryptedContent: '<layout />',
          },
        ],
      },
    })
  );

  await page.route('**/api/parse/upload', route =>
    route.fulfill({
      headers: { 'X-Correlation-ID': 'sap-e2e-correlation' },
      json: {
        success: true,
        detectedType: 'idoc',
        text: syntheticTxt,
        layout: {
          layoutGuid,
          layoutType: '2',
          name: sapLayoutName,
          description: 'Fixture SAP IDoc para E2E',
          limitOfCaracters: 600,
          elements: layoutElements,
        },
        fields: [
          {
            lineName: 'LINHA_EMIT',
            fieldName: 'CNPJ',
            value: '12345678901234',
            startPosition: 10,
            length: 14,
            lineSequence: '000001',
            sequence: 1,
            isValid: true,
          },
        ],
        transformationsStatus: 'completed',
      },
    })
  );
};

const processSapDocument = async (page: Page) => {
  await page.goto('/upload');

  await page.getByRole('button', { name: 'Buscar Layout' }).click();
  await page.getByRole('combobox', { name: 'Selecionar Layout' }).click();
  await page.getByRole('option', { name: new RegExp(sapLayoutName) }).click();
  await page.locator('#txtFile').setInputFiles({
    name: 'documento.idoc',
    mimeType: 'text/plain',
    buffer: Buffer.from(syntheticTxt),
  });
  await page.getByRole('button', { name: 'Processar Documento' }).click();
};

test('vincula a sessão autenticada ao workspace fiscal', async ({ page }) => {
  await mockAuthenticatedGateway(page);
  await page.goto('/workspace');

  await expect(page.getByRole('heading', { name: 'Workspace fiscal E2E' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Workspace ativo' })).toHaveValue(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  );
  await expect(page.getByRole('link', { name: 'Abrir processamento' })).toHaveAttribute(
    'href',
    '/upload'
  );
});

test('compila o snapshot revisado e executa uma fixture no Fiscal Test Lab', async ({ page }) => {
  await mockAuthenticatedGateway(page, true, 'fiscal_admin');
  await mockMappingStudioApis(page);
  await page.goto(`/workspace/mapping-studio/${mappingDraftId}/draft`);

  await expect(page.getByRole('heading', { name: 'Mapping fiscal de homologação.' })).toBeVisible();

  const sourceTree = page.getByRole('tree', { name: 'Árvore do layout de origem' });
  await sourceTree.getByRole('treeitem', { name: 'CNPJ' }).click();
  await page.getByRole('button', { name: 'Ver regra' }).click();
  const ruleDetailDialog = page.getByRole('dialog', { name: /Detalhe da regra/ });
  await expect(ruleDetailDialog.getByText('Copia o CNPJ do emitente para a NF-e.')).toBeVisible();
  await ruleDetailDialog.getByRole('button', { name: 'Fechar janela' }).click();

  await page.getByRole('button', { name: 'Compilar snapshot' }).click();

  await expect(page.getByRole('heading', { name: 'Compilada, aguardando testes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Revisão, publicação e rollback' })).toBeVisible();
  await expect(page.getByText('Aguardando Test Lab')).toBeVisible();
  await page.getByLabel('XML de entrada').fill('<origem><CNPJ>12345678000199</CNPJ></origem>');
  await page.getByLabel('XML esperado').fill('<NFe><emit><CNPJ>12345678000199</CNPJ></emit></NFe>');
  await page.getByRole('button', { name: 'Executar Test Lab' }).click();

  await expect(page.getByRole('heading', { name: 'Gates aprovados' })).toBeVisible();
  await expect(page.getByText('100.0% de cobertura')).toBeVisible();
  await expect(page.getByText('Gates técnicos aprovados', { exact: true })).toBeVisible();
  await page.getByLabel('Justificativa da revisão').fill('Revisão fiscal aprovada no E2E.');
  await page.getByRole('button', { name: 'Aprovar release' }).click();
  await expect(page.getByRole('heading', { name: 'Aprovada para publicação' })).toBeVisible();

  await page.getByLabel('Ambiente de ativação').selectOption('production');
  await page.getByRole('button', { name: 'Publicar release' }).click();
  await expect(page.getByRole('heading', { name: 'Publicada' })).toBeVisible();
  await expect(page.getByText('release-anterior-e2e')).toBeVisible();

  await page.getByRole('button', { name: 'Reverter para a versão anterior' }).click();
  await expect(page.getByRole('heading', { name: 'Descontinuada' })).toBeVisible();
  await expect(page.getByText(/Rollback concluído/i)).toBeVisible();
  await expect(page.getByText('mapping-e2e-correlation')).toBeVisible();
});

test('falha fechado quando Sysmiddle anuncia capabilities de mutação adulteradas', async ({
  page,
}) => {
  await mockAuthenticatedGateway(page);
  await page.route('**/api/workspaces/*/mappings/*/versions/current/explanation', route =>
    route.fulfill({
      json: {
        mappingId: 'mapper-sysmiddle-adulterado',
        version: 'current',
        engine: 'sysmiddle',
        capabilities: {
          execute: true,
          explain: true,
          author: true,
          compile: true,
          publish: true,
        },
        sourceSchema: null,
        targetSchema: null,
        rules: [],
        description: 'Payload que deve ser recusado',
        limitations: [],
        opaqueRuleCount: 0,
      },
    })
  );

  await page.goto('/workspace/mapping-studio/mapper-sysmiddle-adulterado/current');

  await expect(
    page.getByRole('heading', { name: 'Não foi possível abrir esta transformação' })
  ).toBeVisible();
  await expect(page.getByText(/explicação de mapping inválida/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gerar sugestões' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Compilar snapshot' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /publicar/i })).toHaveCount(0);
});

test('processa TXT e entrega o XML transformado para download', async ({ page }) => {
  await mockAuthenticatedGateway(page);
  await mockProcessingApis(page);
  await processSyntheticDocument(page);

  await expect(page.getByRole('tab', { name: 'XML Transformação Final' })).toBeVisible();
  await page.getByRole('tab', { name: 'XML Transformação Final' }).click();
  await page.getByRole('button', { name: 'Gerar Transformação XML' }).click();

  await page.getByRole('tab', { name: 'TXT Posicional' }).click();
  await page.getByRole('button', { name: /Selecionar campo Código.*ABC/ }).click();
  await expect(page.getByText('Declarado no mapeador', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Selecionar campo Filler.*vazio/ })
  ).toHaveAttribute('title', /Len: 588/);
  await page.getByRole('button', { name: 'Ver no XML' }).click();

  const xmlTree = page.getByRole('tree', { name: 'Árvore do XML transformado' });
  const xmlValue = xmlTree.getByRole('treeitem', { name: /#text.*ABC/ });
  await expect(xmlValue).toBeVisible();
  await expect(xmlValue).toBeFocused();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar XML' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xml$/);
});

test('edita somente o intervalo da tag e transforma o TXT atualizado', async ({ page }) => {
  await mockAuthenticatedGateway(page);
  await mockProcessingApis(page);
  await processSyntheticDocument(page);

  await page.getByRole('button', { name: /Selecionar campo Código.*ABC/ }).click();
  await page.getByRole('button', { name: 'Editar valor' }).click();
  const input = page.getByLabel('Novo valor');
  const save = page.getByRole('button', { name: 'Aplicar no TXT' });

  await input.fill('XY');
  await expect(save).toBeDisabled();
  await expect(page.getByText('2/3')).toBeVisible();

  await input.fill('XYZ');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole('button', { name: /Selecionar campo Código.*XYZ/ })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar TXT editado' }).click();
  const editedDownload = await downloadPromise;
  expect(editedDownload.suggestedFilename()).toBe('documento-editado.txt');

  await page.getByRole('tab', { name: 'XML Transformação Final' }).click();
  await page.getByRole('button', { name: 'Gerar Transformação XML' }).click();

  const xmlTree = page.getByRole('tree', { name: 'Árvore do XML transformado' });
  await xmlTree.getByRole('treeitem', { name: /documento/ }).press('ArrowRight');
  await xmlTree.getByRole('treeitem', { name: /codigo/ }).press('ArrowRight');
  await expect(xmlTree.getByRole('treeitem', { name: /#text.*XYZ/ })).toBeVisible();
});

test('permite ao usuário escolher o tamanho dos painéis de análise', async ({ page }) => {
  await mockAuthenticatedGateway(page);
  await mockProcessingApis(page);
  await processSyntheticDocument(page);

  const verticalSplit = page.getByRole('separator', {
    name: 'Redimensionar TXT posicional e árvore de estrutura',
  });
  const txtPanel = page.locator('[aria-label="Visualização e edição do TXT posicional"]');
  await expect(verticalSplit).toBeVisible();
  await expect(verticalSplit).toHaveAttribute('aria-valuenow', '62');
  const txtBeforeResize = await txtPanel.boundingBox();

  await verticalSplit.focus();
  await page.keyboard.press('ArrowDown');
  await expect(verticalSplit).toHaveAttribute('aria-valuenow', '67');
  await expect
    .poll(async () => (await txtPanel.boundingBox())?.height ?? 0)
    .toBeGreaterThan(txtBeforeResize?.height ?? 0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('layoutParser.panelSize.txt-structure')))
    .toBe('67');

  const inspectorSplit = page.getByRole('separator', {
    name: 'Redimensionar área de análise e inspetor de rastreabilidade',
  });
  if ((page.viewportSize()?.width ?? 0) > 900) {
    const analysisPanel = page.locator('[aria-label="Área principal de análise"]');
    const analysisBeforeResize = await analysisPanel.boundingBox();
    await expect(inspectorSplit).toBeVisible();
    await inspectorSplit.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(inspectorSplit).toHaveAttribute('aria-valuenow', '63');
    const analysisAfterResize = await analysisPanel.boundingBox();
    expect(analysisAfterResize?.width).toBeLessThan(analysisBeforeResize?.width ?? Infinity);
  } else {
    await expect(inspectorSplit).toBeHidden();
    await expect(txtPanel).toBeVisible();
  }
});

test('edita campo vazio usando a largura fixa declarada no layout', async ({ page }) => {
  await mockAuthenticatedGateway(page);
  await mockProcessingApis(page);
  await processSyntheticDocument(page);

  await page.getByRole('button', { name: /Selecionar campo Filler.*vazio/ }).click();
  await expect(page.getByText('Posições 13–600 · 588 caracteres')).toBeVisible();
  await page.getByRole('button', { name: 'Editar valor' }).click();

  const dialog = page.getByRole('dialog', { name: 'Editar Filler' });
  await expect(dialog).toContainText('Linha física 1');
  await expect(dialog).toContainText('Posições 13–600');
  await expect(dialog).toContainText('588 posições');

  await dialog.getByLabel('Novo valor').fill('X'.padEnd(588, ' '));
  await dialog.getByRole('button', { name: 'Aplicar no TXT' }).click();

  await expect(page.getByRole('region', { name: 'Ações do TXT editado' })).toContainText(
    '1 alteração(ões) nesta sessão'
  );
});

test('desfaz e revalida o TXT editado pela API', async ({ page }) => {
  await mockAuthenticatedGateway(page);
  await mockProcessingApis(page);
  await processSyntheticDocument(page);

  await page.getByRole('button', { name: /Selecionar campo Código.*ABC/ }).click();
  await page.getByRole('button', { name: 'Editar valor' }).click();
  await page.getByLabel('Novo valor').fill('XYZ');
  await page.getByRole('button', { name: 'Aplicar no TXT' }).click();

  const actions = page.getByRole('region', { name: 'Ações do TXT editado' });
  await expect(actions).toContainText('1 alteração(ões) nesta sessão');
  await actions.getByRole('button', { name: 'Desfazer última alteração' }).click();
  await expect(actions.getByRole('status')).toContainText('Alteração de Código desfeita');
  await expect(page.getByRole('button', { name: /Selecionar campo Código.*ABC/ })).toBeVisible();

  await page.getByRole('button', { name: /Selecionar campo Código.*ABC/ }).click();
  await page.getByRole('button', { name: 'Editar valor' }).click();
  await page.getByLabel('Novo valor').fill('XYZ');
  await page.getByRole('button', { name: 'Aplicar no TXT' }).click();
  await actions.getByRole('button', { name: 'Reprocessar e revalidar' }).click();

  await expect(actions.getByRole('status')).toContainText(
    'Documento reprocessado e revalidado sem erros posicionais'
  );
  await expect(actions).toContainText('Nenhuma alteração pendente');
  await expect(page.getByRole('button', { name: /Selecionar campo Código.*ABC/ })).toBeVisible();
});

test('navega pela hierarquia SAP IDoc declarada no layout', async ({ page }) => {
  await mockAuthenticatedGateway(page);
  await mockSapProcessingApis(page);
  await processSapDocument(page);

  await expect(page.getByRole('heading', { name: 'Hierarquia de segmentos' })).toBeVisible();
  await expect(page.getByText('4 segmentos')).toBeVisible();

  const tree = page.getByRole('tree', { name: 'Estrutura do documento' });
  const controlRecord = tree.getByRole('treeitem', { name: /EDI_DC40/ });
  await expect(controlRecord).toHaveAttribute('aria-expanded', 'false');
  await controlRecord.click();

  const emit = tree.getByRole('treeitem', { name: /ZRSDM_NFE_400_EMIT/ });
  await expect(emit).toBeVisible();
  await expect(emit).toHaveAttribute('aria-expanded', 'false');
  await expect(tree.getByRole('treeitem', { name: /CNPJ/ })).toHaveCount(0);
  await emit.click();

  await expect(tree.getByRole('treeitem', { name: /ZRSDM_NFE_400_ENDEREMIT/ })).toBeVisible();
});

test('explica a ausência de candidatos Sysmiddle e TCL/XSL sem mensagem de background', async ({
  page,
}) => {
  await mockAuthenticatedGateway(page);
  await mockProcessingApis(page, true);
  await processSyntheticDocument(page);

  await expect(page.getByText(/continua sendo processada em segundo plano/i)).toHaveCount(0);
  await page.getByRole('tab', { name: 'XML Transformação Final' }).click();
  await page.getByRole('button', { name: 'Gerar Transformação XML' }).click();

  const diagnostic = page.getByRole('region', { name: 'Nenhum candidato foi encontrado' });
  await expect(diagnostic).toBeVisible();
  await expect(diagnostic.getByRole('region', { name: 'Diagnóstico Sysmiddle' })).toContainText(
    'Nenhum mapeador low-code encontrado'
  );
  await expect(diagnostic.getByRole('region', { name: 'Diagnóstico TCL/XSL' })).toContainText(
    'Candidato tcl-xsl falhou: XSL não encontrado'
  );
});

test('não renderiza o painel administrativo sem a função admin', async ({ page }) => {
  await mockAuthenticatedGateway(page, false);
  await page.goto('/admin');

  await expect(page.getByRole('alert')).toContainText('Acesso restrito');
  await expect(page.getByText('Painel Administrativo')).toHaveCount(0);
});

test('bloqueia o conteúdo anônimo e oferece entrada Microsoft', async ({ page }) => {
  await page.route('**/api/session', route =>
    route.fulfill({
      json: {
        authenticated: false,
        user: { name: '' },
        roles: [],
        isAdmin: false,
      },
    })
  );

  await page.goto('/upload');

  const login = page.getByRole('link', { name: 'Entrar com Microsoft' });
  await expect(login).toBeVisible();
  await expect(login).toHaveAttribute('href', '/auth/login?returnTo=%2Fupload');
  await expect(page.getByRole('button', { name: 'Processar Documento' })).toHaveCount(0);
});
