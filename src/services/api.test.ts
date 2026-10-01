import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseService, ParseRequestError } from './api';
import { SESSION_EXPIRED_EVENT } from '../types/session';

const server = setupServer();

const createRequest = () => ({
  layoutFile: new File(['<layout />'], 'layout.xml', { type: 'application/xml' }),
  txtFile: new File(['001CONTEUDO'], 'documento.txt', { type: 'text/plain' }),
  layoutName: 'Layout seguro',
});

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('parseService', () => {
  it('envia multipart e correlation id na mesma origem', async () => {
    server.use(
      http.post('*/api/parse/upload', ({ request }) => {
        expect(request.headers.get('x-correlation-id')).toBeTruthy();
        expect(request.headers.get('content-type')).toContain('multipart/form-data');

        return HttpResponse.json({
          success: true,
          detectedType: 'mqseries',
          text: '001CONTEUDO',
          fields: [],
        });
      })
    );

    await expect(parseService.parseFiles(createRequest())).resolves.toMatchObject({
      success: true,
      detectedType: 'mqseries',
    });
  });

  it('preserva a taxonomia e o correlation id de um 422', async () => {
    server.use(
      http.post('*/api/parse/upload', () =>
        HttpResponse.json(
          {
            success: false,
            message: 'Documento incompatível com o layout.',
            detectedType: 'idoc',
            failureCause: 'document_malformed',
          },
          { status: 422, headers: { 'X-Correlation-ID': 'corr-422' } }
        )
      )
    );

    const error = await parseService.parseFiles(createRequest()).catch(reason => reason);

    expect(error).toBeInstanceOf(ParseRequestError);
    expect(error).toMatchObject({
      kind: 'parse_error',
      httpStatus: 422,
      detectedType: 'idoc',
      correlationId: 'corr-422',
      failureCause: 'document_malformed',
    });
  });

  it('classifica uma falha 500 como erro de servidor', async () => {
    server.use(
      http.post('*/api/parse/upload', () =>
        HttpResponse.json(
          { message: 'Falha controlada.', failureCause: 'parser_defect' },
          { status: 500 }
        )
      )
    );

    const error = await parseService.parseFiles(createRequest()).catch(reason => reason);

    expect(error).toMatchObject({
      kind: 'server_error',
      httpStatus: 500,
      failureCause: 'parser_defect',
      message: 'O servidor encontrou uma falha ao processar o documento.',
    });
    expect(error.message).not.toContain('Falha controlada');
  });

  it('classifica indisponibilidade de rede sem inventar status HTTP', async () => {
    server.use(http.post('*/api/parse/upload', () => HttpResponse.error()));

    const error = await parseService.parseFiles(createRequest()).catch(reason => reason);

    expect(error).toMatchObject({
      kind: 'network_error',
      httpStatus: undefined,
    });
  });

  it('notifica a aplicação quando a sessão expira durante uma chamada protegida', async () => {
    const listener = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);
    server.use(http.post('*/api/parse/upload', () => HttpResponse.json({}, { status: 401 })));

    await parseService.parseFiles(createRequest()).catch(() => undefined);

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });

  it('envia apenas o documento e o override explícito para a detecção automática', async () => {
    server.use(
      http.post('*/api/parse/auto', async ({ request }) => {
        const multipartBody = await request.text();
        expect(request.headers.get('content-type')).toContain('multipart/form-data');
        expect(multipartBody).toContain('name="documentFile"');
        expect(multipartBody).toContain('name="layoutGuidOverride"');
        expect(multipartBody).toContain('layout-guid-2');
        expect(multipartBody).not.toContain('name="layoutFile"');

        return HttpResponse.json(
          {
            success: true,
            correlationId: '',
            detection: {
              status: 'ambiguous',
              detectedType: 'mqseries',
              algorithmVersion: 'layout-probe-v1',
              catalogVersion: 'sha256:catalogo',
              totalCandidates: 2,
              truncated: false,
              selectedLayout: {
                rank: 2,
                layoutGuid: 'layout-guid-2',
                name: 'Layout escolhido',
                matchScore: 98,
                isTied: false,
                evidence: [],
                conflicts: [],
                limitations: [],
              },
              candidates: [],
            },
            parseResult: { success: true, text: '001CONTEUDO', fields: [] },
          },
          { headers: { 'X-Correlation-ID': 'corr-auto' } }
        );
      })
    );

    const response = await parseService.parseAutomatically({
      documentFile: createRequest().txtFile,
      layoutGuidOverride: 'layout-guid-2',
    });

    expect(response).toMatchObject({
      success: true,
      correlationId: 'corr-auto',
      parseResult: { success: true, correlationId: 'corr-auto' },
    });
  });

  it('preserva a recusa 422 de um override fora do ranking atual', async () => {
    server.use(
      http.post('*/api/parse/auto', () =>
        HttpResponse.json(
          { message: 'O layout informado não pertence aos candidatos compatíveis.' },
          { status: 422, headers: { 'X-Correlation-ID': 'corr-override' } }
        )
      )
    );

    const error = await parseService
      .parseAutomatically({
        documentFile: createRequest().txtFile,
        layoutGuidOverride: 'layout-adulterado',
      })
      .catch(reason => reason);

    expect(error).toMatchObject({
      kind: 'parse_error',
      httpStatus: 422,
      correlationId: 'corr-override',
      message: 'O layout informado não pertence aos candidatos compatíveis.',
    });
  });
});
