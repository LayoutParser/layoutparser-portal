import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api';
import { mappingDraftService } from './mappingDraftService';

vi.mock('../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const rule = {
  ruleId: 'rule-1',
  draftId: 'draft-1',
  sourceRefs: ['layout://LINHA004/CNPJ'],
  targetRefs: ['xsd:///NFe/infNFe/emit/CNPJ'],
  operation: 'copy',
  conditions: '[]',
  transformations: '["trim"]',
  cardinality: '1:1',
  evidence: [{ kind: 'xsd', reference: '/NFe/infNFe/emit/CNPJ' }],
  confidence: 'high',
  status: 'proposed',
  questions: [],
  createdAt: '2026-08-31T19:00:00Z',
  eTag: 'AAAAAAAAAAE=',
};

const draft = {
  draftId: 'draft-1',
  workspaceId: 'workspace-1',
  packageId: 'package-1',
  revisionId: 'revision-1',
  engine: 'tcl',
  createdAt: '2026-08-31T19:00:00Z',
  rules: [rule],
  fiscalProfile: null,
  resolvedXsd: null,
};

describe('mappingDraftService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cria um draft sobre a revisão exata e nunca aceita Sysmiddle', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: draft });

    await expect(
      mappingDraftService.createDraft({
        workspaceId: 'workspace-1',
        packageId: 'package-1',
        revisionId: 'revision-1',
        engine: 'tcl',
      })
    ).resolves.toEqual(draft);

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/mapping-packages/package-1/drafts',
      { revisionId: 'revision-1', engine: 'tcl' }
    );
  });

  it.each(['sysmiddle', ' sysmiddle ', ['xslt', 'sysmiddle'], { engine: 'xslt' }])(
    'não envia engine de autoria adulterado: %o',
    async engine => {
      await expect(
        mappingDraftService.createDraft({
          workspaceId: 'workspace-1',
          packageId: 'package-1',
          revisionId: 'revision-1',
          engine: engine as never,
        })
      ).rejects.toMatchObject({ kind: 'invalid_input' });

      expect(apiClient.post).not.toHaveBeenCalled();
    }
  );

  it('consulta o draft e valida que todas as regras pertencem a ele', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: draft });

    await expect(mappingDraftService.getDraft('workspace-1', 'draft-1')).resolves.toEqual(draft);
    expect(apiClient.get).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/mapping-drafts/draft-1'
    );

    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: { ...draft, rules: [{ ...rule, draftId: 'outro-draft' }] },
    });
    await expect(mappingDraftService.getDraft('workspace-1', 'draft-1')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('inicia, observa e cancela o job assíncrono de sugestão', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { jobId: 'job-1', status: 'queued' },
    });
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { jobId: 'job-1', status: 'completed', rulesCreated: 3, error: null },
    });
    vi.mocked(apiClient.delete).mockResolvedValue({ status: 202 });

    await expect(mappingDraftService.createSuggestion('workspace-1', 'draft-1')).resolves.toEqual({
      jobId: 'job-1',
      status: 'queued',
    });
    await expect(
      mappingDraftService.getSuggestion('workspace-1', 'draft-1', 'job-1')
    ).resolves.toEqual({ jobId: 'job-1', status: 'completed', rulesCreated: 3, error: null });
    await expect(
      mappingDraftService.cancelSuggestion('workspace-1', 'draft-1', 'job-1')
    ).resolves.toBeUndefined();
  });

  it('envia If-Match citado ao aceitar uma regra', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({
      data: { ...rule, status: 'accepted', eTag: 'AAAAAAAAAAI=' },
    });

    await expect(
      mappingDraftService.updateRule({
        workspaceId: 'workspace-1',
        draftId: 'draft-1',
        ruleId: 'rule-1',
        eTag: 'AAAAAAAAAAE=',
        status: 'accepted',
      })
    ).resolves.toMatchObject({ status: 'accepted', eTag: 'AAAAAAAAAAI=' });

    expect(apiClient.patch).toHaveBeenCalledWith(
      '/api/workspaces/workspace-1/mapping-drafts/draft-1/rules/rule-1',
      { status: 'accepted' },
      { headers: { 'If-Match': '"AAAAAAAAAAE="' } }
    );
  });

  it('preserva a regra atual devolvida em conflito 412', async () => {
    const conflict = {
      isAxiosError: true,
      response: {
        status: 412,
        data: {
          error: 'A regra foi alterada por outra operação.',
          current: { ...rule, status: 'edited', eTag: 'AAAAAAAAAAI=' },
        },
      },
    };
    vi.mocked(apiClient.patch).mockRejectedValue(conflict);
    vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

    const operation = mappingDraftService.updateRule({
      workspaceId: 'workspace-1',
      draftId: 'draft-1',
      ruleId: 'rule-1',
      eTag: 'AAAAAAAAAAE=',
      status: 'accepted',
    });

    await expect(operation).rejects.toMatchObject({
      kind: 'conflict',
      message: 'A regra foi alterada por outra operação.',
      currentRule: { status: 'edited', eTag: 'AAAAAAAAAAI=' },
    });
  });

  it('recusa payloads incompletos e respostas com status desconhecido', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { ...draft, rules: [{ ...rule, status: 'invented' }] },
    });

    await expect(mappingDraftService.getDraft('workspace-1', 'draft-1')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
    await expect(mappingDraftService.getDraft('', 'draft-1')).rejects.toMatchObject({
      kind: 'invalid_input',
    });
  });

  it.each(['sysmiddle', ' sysmiddle ', ['tcl', 'sysmiddle'], { value: 'tcl' }])(
    'recusa Draft devolvido com engine adulterado: %o',
    async engine => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: { ...draft, engine } });

      await expect(mappingDraftService.getDraft('workspace-1', 'draft-1')).rejects.toMatchObject({
        kind: 'invalid_response',
      });
    }
  );

  describe('setFiscalProfile (issue #198)', () => {
    const profile = {
      documentType: 'nfe' as const,
      schemaVersion: '4.00',
      operation: 'saida',
      jurisdiction: 'SP',
    };

    it('grava o perfil fiscal e devolve o draft com fiscalProfile/resolvedXsd', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({
        data: {
          ...draft,
          fiscalProfile: profile,
          resolvedXsd: {
            xsdVersion: 'PL_009_V4',
            namespace: 'http://www.portalfiscal.inf.br/nfe',
            rootElement: 'nfeProc',
          },
        },
      });

      const result = await mappingDraftService.setFiscalProfile({
        workspaceId: 'workspace-1',
        draftId: 'draft-1',
        profile,
      });

      expect(apiClient.put).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/mapping-drafts/draft-1/fiscal-profile',
        profile
      );
      expect(result.fiscalProfile).toEqual(profile);
      expect(result.resolvedXsd).toEqual({
        xsdVersion: 'PL_009_V4',
        namespace: 'http://www.portalfiscal.inf.br/nfe',
        rootElement: 'nfeProc',
      });
    });

    it('recusa perfil incompleto antes de chamar a API', async () => {
      await expect(
        mappingDraftService.setFiscalProfile({
          workspaceId: 'workspace-1',
          draftId: 'draft-1',
          profile: { ...profile, schemaVersion: '' },
        })
      ).rejects.toMatchObject({ kind: 'invalid_input' });
      expect(apiClient.put).not.toHaveBeenCalled();
    });

    it('mapeia 422 (documentType sem XSD configurado / schemaVersion não instalada) para rejected', async () => {
      vi.mocked(apiClient.put).mockRejectedValue({
        isAxiosError: true,
        response: {
          status: 422,
          data: { error: 'schemaVersion 4.00 não está instalada para nfe.' },
        },
      });
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        mappingDraftService.setFiscalProfile({
          workspaceId: 'workspace-1',
          draftId: 'draft-1',
          profile,
        })
      ).rejects.toMatchObject({
        kind: 'rejected',
        message: 'schemaVersion 4.00 não está instalada para nfe.',
      });
    });

    it('mapeia 404 (sem identidade/membership) para not_found', async () => {
      vi.mocked(apiClient.put).mockRejectedValue({
        isAxiosError: true,
        response: { status: 404, data: {} },
      });
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(
        mappingDraftService.setFiscalProfile({
          workspaceId: 'workspace-1',
          draftId: 'draft-1',
          profile,
        })
      ).rejects.toMatchObject({ kind: 'not_found' });
    });
  });

  describe('listDrafts', () => {
    it('lista drafts do workspace com paginação e filtro de engine', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({
        data: {
          items: [
            {
              draftId: 'draft-1',
              workspaceId: 'workspace-1',
              packageId: 'package-1',
              revisionId: 'revision-1',
              engine: 'tcl',
              createdAt: '2026-09-01T10:00:00Z',
              rulesCount: 5,
              fiscalProfile: null,
            },
          ],
          page: 1,
          pageSize: 20,
          totalCount: 1,
        },
      });

      await expect(mappingDraftService.listDrafts('workspace-1', 1, 20, 'tcl')).resolves.toEqual({
        items: [
          {
            draftId: 'draft-1',
            workspaceId: 'workspace-1',
            packageId: 'package-1',
            revisionId: 'revision-1',
            engine: 'tcl',
            createdAt: '2026-09-01T10:00:00Z',
            rulesCount: 5,
            fiscalProfile: null,
          },
        ],
        page: 1,
        pageSize: 20,
        totalCount: 1,
      });
      expect(apiClient.get).toHaveBeenCalledWith('/api/workspaces/workspace-1/mapping-drafts', {
        params: { page: 1, pageSize: 20, engine: 'tcl' },
      });
    });

    it('recusa page < 1', async () => {
      await expect(mappingDraftService.listDrafts('workspace-1', 0)).rejects.toMatchObject({
        kind: 'invalid_input',
      });
    });

    it('recusa pageSize fora de 1..100', async () => {
      await expect(mappingDraftService.listDrafts('workspace-1', 1, 101)).rejects.toMatchObject({
        kind: 'invalid_input',
      });
    });

    it('recusa engine fora de tcl/xslt', async () => {
      await expect(
        mappingDraftService.listDrafts('workspace-1', 1, 20, 'sysmiddle' as unknown as 'tcl')
      ).rejects.toMatchObject({ kind: 'invalid_input' });
    });

    it('mapeia 404 (workspace sem identidade) para not_found', async () => {
      vi.mocked(apiClient.get).mockRejectedValue({
        isAxiosError: true,
        response: { status: 404, data: {} },
      });
      vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      await expect(mappingDraftService.listDrafts('workspace-1')).rejects.toMatchObject({
        kind: 'not_found',
      });
    });
  });

  describe('respostas a perguntas abertas (LayoutParserApi#422, gap a2)', () => {
    const answer = {
      answerId: 'answer-1',
      draftId: 'draft-1',
      ruleId: 'rule-1',
      questionIndex: 0,
      question: 'O campo representa sempre o emitente?',
      answer: 'Sim, sempre.',
      answeredByUserId: 'user-1',
      answeredByName: 'user-1',
      answeredAt: '2026-09-16T10:00:00Z',
      version: 1,
    };

    it('envia PUT no endpoint dedicado com o texto normalizado', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({ data: answer });

      await expect(
        mappingDraftService.answerRuleQuestion({
          workspaceId: 'workspace-1',
          draftId: 'draft-1',
          ruleId: 'rule-1',
          questionIndex: 0,
          answer: '  Sim, sempre.  ',
        })
      ).resolves.toEqual(answer);

      expect(apiClient.put).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/mapping-drafts/draft-1/rules/rule-1/questions/0/answer',
        { answer: 'Sim, sempre.' }
      );
    });

    it('recusa resposta vazia ou maior que 4000 caracteres sem chamar a API', async () => {
      await expect(
        mappingDraftService.answerRuleQuestion({
          workspaceId: 'workspace-1',
          draftId: 'draft-1',
          ruleId: 'rule-1',
          questionIndex: 0,
          answer: '   ',
        })
      ).rejects.toMatchObject({ kind: 'invalid_input' });

      await expect(
        mappingDraftService.answerRuleQuestion({
          workspaceId: 'workspace-1',
          draftId: 'draft-1',
          ruleId: 'rule-1',
          questionIndex: 0,
          answer: 'a'.repeat(4001),
        })
      ).rejects.toMatchObject({ kind: 'invalid_input' });

      expect(apiClient.put).not.toHaveBeenCalled();
    });

    it('lista o histórico de respostas do draft e da regra com includeHistory', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [answer] });

      await expect(
        mappingDraftService.listDraftQuestionAnswers('workspace-1', 'draft-1', {
          includeHistory: true,
        })
      ).resolves.toEqual([answer]);
      expect(apiClient.get).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/mapping-drafts/draft-1/question-answers',
        { params: { includeHistory: true } }
      );

      await expect(
        mappingDraftService.listRuleQuestionAnswers('workspace-1', 'draft-1', 'rule-1')
      ).resolves.toEqual([answer]);
      expect(apiClient.get).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/mapping-drafts/draft-1/rules/rule-1/question-answers',
        undefined
      );
    });

    it('recusa payload de resposta inválido devolvido pela API', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [{ ...answer, version: 0 }] });

      await expect(
        mappingDraftService.listRuleQuestionAnswers('workspace-1', 'draft-1', 'rule-1')
      ).rejects.toMatchObject({ kind: 'invalid_response' });
    });
  });
});
