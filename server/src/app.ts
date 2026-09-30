import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';

import helmet from '@fastify/helmet';
import httpProxy from '@fastify/http-proxy';
import rateLimit from '@fastify/rate-limit';
import secureSession from '@fastify/secure-session';
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
  type RawServerBase,
  type RequestGenericInterface,
  type FastifyRequest,
  LogController,
} from 'fastify';

import { authorizeProxyRequest, canonicalizePath, resolveIdentity } from './auth.js';
import type { AppConfig } from './config.js';
import { MultipartPayloadError, PayloadLimitError, PayloadLimitTransform } from './limits.js';
import {
  createOidcClients,
  deriveSessionKey,
  registerAuthenticationRoutes,
  type OidcClient,
} from './oidc.js';

const ACCEPTED_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;

export interface BuildAppOptions {
  readonly logger?: NonNullable<FastifyServerOptions['logger']>;
  readonly logStream?: Writable;
  // Override do cliente OIDC do Entra, usado em teste. `undefined` mantém o cliente real
  // derivado da config; `null` desabilita o provedor mesmo com config presente.
  readonly oidcClient?: OidcClient | null;
  // Override equivalente para o provedor Google, independente do Entra.
  readonly googleOidcClient?: OidcClient | null;
}

function createRequestId(request: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const incoming = request.headers['x-correlation-id'];
  if (typeof incoming === 'string' && ACCEPTED_CORRELATION_ID.test(incoming)) {
    return incoming;
  }

  return randomUUID();
}

function createLogger(
  config: AppConfig,
  stream: Writable | undefined
): NonNullable<FastifyServerOptions['logger']> {
  return {
    level: config.logLevel,
    ...(stream ? { stream } : {}),
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.set-cookie',
        'res.headers.set-cookie',
        'headers.authorization',
        'headers.cookie',
        'body',
        'req.body',
        'request.body',
        'response.body',
        '*.txt',
        '*.xml',
        '*.decryptedContent',
      ],
      censor: '[REDACTED]',
    },
  };
}

function safeErrorStatus(error: Error): number {
  if (error instanceof PayloadLimitError) {
    return 413;
  }

  if (error instanceof MultipartPayloadError) {
    return 400;
  }

  const statusCode = 'statusCode' in error ? error.statusCode : undefined;
  return typeof statusCode === 'number' && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500;
}

function safeErrorMessage(statusCode: number, error: Error): string {
  if (error instanceof PayloadLimitError) {
    return error.limitKind === 'document'
      ? 'O documento excede o limite permitido.'
      : 'A requisição excede o limite permitido.';
  }

  if (error instanceof MultipartPayloadError) {
    return 'O conteúdo multipart é inválido.';
  }

  if (statusCode === 429) {
    return 'Limite de requisições excedido.';
  }

  if (statusCode === 413) {
    return 'A requisição excede o limite permitido.';
  }

  if (statusCode >= 500) {
    return 'Falha interna no BFF.';
  }

  return 'A requisição não pôde ser processada.';
}

// O Kestrel da API responde 400 vazio para header com byte não-ASCII, e o Node envia "í" como o
// byte Latin-1 0xED (UTF-8 inválido). Nome com acento derrubava toda chamada autenticada
// (ex.: GET /api/workspaces/me). O header leva só uma versão ASCII do nome, apenas para exibição
// e auditoria; a sessão do BFF mantém o nome original.
function toAsciiHeaderValue(value: string): string {
  const ascii = value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\x20-\x7e]/g, '?')
    .trim();
  return ascii || 'usuario';
}

function rewriteProxyHeaders(
  request: FastifyRequest<RequestGenericInterface, RawServerBase>,
  headers: Record<string, string | string[] | undefined>,
  config: AppConfig
): Record<string, string | string[] | undefined> {
  const rewritten = { ...headers };

  delete rewritten[config.trustedUserHeader];
  delete rewritten[config.trustedRolesHeader];
  delete rewritten[config.trustedIdentityProviderHeader];
  delete rewritten[config.trustedIdentitySubjectHeader];
  delete rewritten[config.trustedIdentityTenantHeader];
  // Anti-spoof: o e-mail só pode vir da sessão verificada, nunca do cliente.
  delete rewritten[config.trustedIdentityEmailHeader];
  delete rewritten[config.developmentUserHeader];
  delete rewritten[config.developmentRolesHeader];
  delete rewritten.authorization;
  delete rewritten.cookie;

  rewritten['x-correlation-id'] = request.id;
  if (request.identity) {
    rewritten[config.trustedUserHeader] = toAsciiHeaderValue(request.identity.name);
    rewritten[config.trustedIdentityProviderHeader] = request.identity.provider;
    rewritten[config.trustedIdentitySubjectHeader] = request.identity.subject;
    if (request.identity.tenantId) {
      rewritten[config.trustedIdentityTenantHeader] = request.identity.tenantId;
    }
    if (request.identity.email) {
      rewritten[config.trustedIdentityEmailHeader] = request.identity.email;
    }
    if (request.identity.roles.length > 0) {
      rewritten[config.trustedRolesHeader] = request.identity.roles.join(',');
    }
  }

  return rewritten;
}

function rewriteProxyResponseHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> {
  const rewritten = { ...headers };
  delete rewritten.server;
  delete rewritten['x-powered-by'];
  delete rewritten.via;
  return rewritten;
}

export async function buildApp(
  config: AppConfig,
  options: BuildAppOptions = {}
): Promise<FastifyInstance> {
  const logger: NonNullable<FastifyServerOptions['logger']> =
    options.logger ?? createLogger(config, options.logStream);
  const serverOptions: FastifyServerOptions = {
    logger,
    bodyLimit: config.requestLimitBytes,
    // O BFF usa a conexão TCP real para validar o IIS; headers X-Forwarded-* nunca decidem
    // identidade nem rate limit e, portanto, não precisam ser tratados como confiáveis.
    trustProxy: false,
    requestIdHeader: false,
    genReqId: createRequestId,
    logController: new LogController({ disableRequestLogging: true }),
    routerOptions: { caseSensitive: false },
  };
  const app: FastifyInstance = Fastify(serverOptions);
  // Logger repassado só para instrumentação de diagnóstico (timing/classificação de erro do
  // fluxo OIDC); não altera nenhuma decisão de autenticação/autorização.
  const defaultOidcClients = createOidcClients(config, app.log);
  const entraOidcClient =
    options.oidcClient === undefined ? defaultOidcClients.entra : options.oidcClient;
  const googleOidcClient =
    options.googleOidcClient === undefined ? defaultOidcClients.google : options.googleOidcClient;

  app.decorateRequest('identity', null);
  app.decorateRequest('payloadLimitKind', null);

  // Decisão (bug fix): o form nativo de logout (`<form method="post" action="/auth/logout">`)
  // sempre envia Content-Type application/x-www-form-urlencoded, mesmo sem nenhum campo. O
  // front já foi corrigido para chamar /auth/logout via fetch sem Content-Type (fonte da
  // verdade, evita o problema na origem), mas mantemos este parser tolerante como
  // defesa-em-profundidade: nenhuma rota atual lê corpo urlencoded, então ignorar o corpo é
  // seguro hoje. Se uma rota futura precisar realmente ler esse content-type, este parser
  // silencioso vai mascarar o problema — troque por um parser real nesse momento.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, _body, done) => done(null, undefined)
  );

  await app.register(secureSession, {
    key: deriveSessionKey(config),
    cookieName: config.isProduction ? '__Host-layoutparser_session' : 'layoutparser_session',
    expiry: config.sessionTtlSeconds,
    cookie: {
      path: '/',
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'lax',
      maxAge: config.sessionTtlSeconds,
    },
  });

  app.setErrorHandler(async (error, request, reply) => {
    const normalizedError = error instanceof Error ? error : new Error('Unknown request error.');
    const statusCode = safeErrorStatus(normalizedError);
    const logPayload = {
      event: 'http.request.failed',
      errorType: normalizedError.name,
      errorCode: 'code' in normalizedError ? normalizedError.code : undefined,
      method: request.method,
      path: canonicalizePath(request.raw.url ?? request.url),
      statusCode,
    };

    if (statusCode >= 500) {
      request.log.error(logPayload, 'Falha ao processar requisição.');
    } else {
      request.log.warn(logPayload, 'Requisição rejeitada.');
    }

    await reply.code(statusCode).send({
      statusCode,
      error: statusCode >= 500 ? 'Internal Server Error' : 'Request Rejected',
      message: safeErrorMessage(statusCode, normalizedError),
      correlationId: request.id,
    });
  });

  await app.register(helmet, {
    global: true,
    strictTransportSecurity: config.isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-correlation-id', request.id);
    request.identity = resolveIdentity(request, config);

    const contentLength = request.headers['content-length'];
    if (typeof contentLength === 'string' && /^\d+$/.test(contentLength)) {
      if (Number(contentLength) > config.requestLimitBytes) {
        throw new PayloadLimitError('request');
      }
    }
  });

  await app.register(rateLimit, {
    global: true,
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    enableDraftSpec: true,
    errorResponseBuilder: () =>
      Object.assign(new Error('Rate limit exceeded.'), {
        statusCode: 429,
      }),
    keyGenerator: request =>
      request.identity
        ? `user:${request.identity.name.toLocaleLowerCase('en-US')}`
        : `peer:${request.raw.socket.remoteAddress ?? 'unknown'}`,
  });

  app.addHook('preParsing', async (request, _reply, payload) => {
    return payload.pipe(
      new PayloadLimitTransform({
        contentType:
          typeof request.headers['content-type'] === 'string'
            ? request.headers['content-type']
            : undefined,
        requestLimitBytes: config.requestLimitBytes,
        documentLimitBytes: config.documentLimitBytes,
        documentField: config.documentField,
        // O upload legado usa `txtFile`; a detecção automática usa `documentFile`.
        // Ambos representam o mesmo documento e precisam passar pelo mesmo limite específico.
        documentFieldAliases: ['documentFile'],
        onLimit: kind => {
          request.payloadLimitKind = kind;
        },
      })
    );
  });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        event: 'http.request.completed',
        method: request.method,
        path: canonicalizePath(request.raw.url ?? request.url),
        statusCode: reply.statusCode,
        responseTimeMs: Math.round(reply.elapsedTime * 100) / 100,
        authenticated: request.identity !== null,
        admin: request.identity?.isAdmin ?? false,
      },
      'Requisição concluída.'
    );
  });

  app.get('/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    service: 'layout-parser-bff',
  }));

  registerAuthenticationRoutes(app, config, {
    entra: entraOidcClient,
    google: googleOidcClient,
  });

  app.get('/api/session', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    return {
      authenticated: request.identity !== null,
      user: { name: request.identity?.name ?? '' },
      roles: request.identity ? [...request.identity.roles] : [],
      isAdmin: request.identity?.isAdmin ?? false,
    };
  });

  await app.register(httpProxy, {
    upstream: config.upstreamUrl,
    disableRequestLogging: true,
    prefix: '/api',
    rewritePrefix: '/api',
    websocket: false,
    preHandler: async (request, reply) => {
      await authorizeProxyRequest(request, reply, config);
    },
    replyOptions: {
      rewriteRequestHeaders: (request, headers) => rewriteProxyHeaders(request, headers, config),
      rewriteHeaders: headers => rewriteProxyResponseHeaders(headers),
      onError: (reply, { error }) => {
        const limitKind = reply.request.payloadLimitKind;
        if (limitKind) {
          void reply.code(413).send({
            statusCode: 413,
            error: 'Request Rejected',
            message:
              limitKind === 'document'
                ? 'O documento excede o limite permitido.'
                : 'A requisição excede o limite permitido.',
            correlationId: reply.request.id,
          });
          return;
        }

        void reply.send(error);
      },
    },
  });

  app.setNotFoundHandler(async (request, reply) => {
    await reply.code(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: 'Rota não encontrada.',
      correlationId: request.id,
    });
  });

  return app;
}
