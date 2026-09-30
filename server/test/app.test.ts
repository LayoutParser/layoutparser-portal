import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { OidcClient, OidcExchangeRequest, OidcTransaction } from '../src/oidc.js';

interface CapturedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

interface UpstreamHarness {
  readonly url: string;
  readonly requests: CapturedRequest[];
  close(): Promise<void>;
}

const apps: FastifyInstance[] = [];
const upstreams: UpstreamHarness[] = [];
const testClientId = '9ff4c9ba-1bab-414a-a6df-39ddce8f7425';
const testClientSecret = 'test-secret-with-more-than-sixteen-characters';

async function createUpstream(): Promise<UpstreamHarness> {
  const requests: CapturedRequest[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const captured: CapturedRequest = {
        method: request.method ?? 'UNKNOWN',
        url: request.url ?? '/',
        headers: request.headers,
        body: Buffer.concat(chunks),
      };
      requests.push(captured);
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.setHeader('server', 'integration-upstream');
      response.setHeader('x-powered-by', 'integration-upstream');
      response.end(
        JSON.stringify({
          method: captured.method,
          url: captured.url,
          correlationId: captured.headers['x-correlation-id'] ?? null,
        })
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))),
  };
}

async function createApp(
  overrides: NodeJS.ProcessEnv = {},
  options: Parameters<typeof buildApp>[1] = {}
): Promise<{ app: FastifyInstance; upstream: UpstreamHarness }> {
  const upstream = await createUpstream();
  const config = loadConfig({
    NODE_ENV: 'test',
    LAYOUTPARSER_API_URL: upstream.url,
    BFF_DEV_AUTH_ENABLED: 'true',
    BFF_ADMIN_USERS: 'admin.user',
    BFF_ADMIN_ROLES: 'LayoutParserAdmins',
    ...overrides,
  });
  const appOptions =
    options.logStream || options.logger !== undefined ? options : { ...options, logger: false };
  const app = await buildApp(config, appOptions);
  await app.ready();
  apps.push(app);
  upstreams.push(upstream);
  return { app, upstream };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  await Promise.all(upstreams.splice(0).map(upstream => upstream.close()));
});

describe('LayoutParser BFF', () => {
  it('expõe health sem autenticação, com Helmet e correlation id', async () => {
    const { app } = await createApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'layout-parser-bff' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['ratelimit-limit']).toBeUndefined();
  }, 15_000);

  it('reserva GET /api/session no BFF e devolve o contrato determinístico', async () => {
    const { app, upstream } = await createApp();

    const anonymous = await app.inject({ method: 'GET', url: '/api/session' });
    expect(anonymous.json()).toEqual({
      authenticated: false,
      user: { name: '' },
      roles: [],
      isAdmin: false,
    });

    const authenticated = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { 'x-dev-user': 'student.user', 'x-dev-roles': 'Users,LayoutParserAdmins' },
    });
    expect(authenticated.json()).toEqual({
      authenticated: true,
      user: { name: 'student.user' },
      roles: ['Users', 'LayoutParserAdmins'],
      isAdmin: true,
    });
    expect(upstream.requests).toHaveLength(0);
  });

  it('em produção aceita somente a sessão OIDC criptografada e ignora headers forjados', async () => {
    const upstream = await createUpstream();
    let transaction: OidcTransaction | undefined;
    const oidcClient: OidcClient = {
      async getAuthorizationUrl(value) {
        transaction = value;
        return `https://login.example/authorize?state=${value.state}`;
      },
      async exchangeAuthorizationCode() {
        return {
          provider: 'entra',
          name: 'domain.user@example.test',
          roles: ['LayoutParserAdmins'],
          subject: 'subject-12345678901234567890',
          tenantId: 'tenant-12345678901234567890',
        };
      },
    };
    const config = loadConfig({
      NODE_ENV: 'production',
      LAYOUTPARSER_API_URL: upstream.url,
      BFF_PUBLIC_ORIGIN: 'https://layoutparser.example',
      ENTRA_TENANT_ID: 'common',
      ENTRA_CLIENT_ID: testClientId,
      ENTRA_CLIENT_SECRET: testClientSecret,
      BFF_TRUSTED_USER_HEADER: 'x-iis-user',
      BFF_TRUSTED_ROLES_HEADER: 'x-iis-roles',
      BFF_ADMIN_ROLES: 'LayoutParserAdmins',
    });
    const app = await buildApp(config, { logger: false, oidcClient });
    await app.ready();
    apps.push(app);
    upstreams.push(upstream);

    const login = await app.inject({ method: 'GET', url: '/auth/login' });
    const loginCookie = String(login.headers['set-cookie']).split(';', 1)[0];
    const callback = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=test-code&state=${transaction?.state}`,
      headers: { cookie: loginCookie },
    });
    const sessionCookie = String(callback.headers['set-cookie']).split(';', 1)[0];
    const authenticated = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { cookie: sessionCookie },
    });
    const proxied = await app.inject({
      method: 'GET',
      url: '/api/layouts',
      headers: {
        cookie: sessionCookie,
        'x-layoutparser-identity-provider': 'google',
        'x-layoutparser-identity-subject': 'spoofed-subject',
        'x-layoutparser-identity-tenant': 'spoofed-tenant',
      },
    });
    const spoofedHeaders = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: {
        'x-iis-user': 'spoofed.user',
        'x-iis-roles': 'LayoutParserAdmins',
        'x-dev-user': 'spoofed.dev',
      },
    });

    expect(authenticated.json()).toEqual({
      authenticated: true,
      user: { name: 'domain.user@example.test' },
      roles: ['LayoutParserAdmins'],
      isAdmin: true,
    });
    expect(authenticated.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(spoofedHeaders.json()).toMatchObject({ authenticated: false, isAdmin: false });
    expect(proxied.statusCode).toBe(200);
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]?.headers['x-layoutparser-identity-provider']).toBe('entra');
    expect(upstream.requests[0]?.headers['x-layoutparser-identity-subject']).toBe(
      'subject-12345678901234567890'
    );
    expect(upstream.requests[0]?.headers['x-layoutparser-identity-tenant']).toBe(
      'tenant-12345678901234567890'
    );
  });

  it('envia o nome do usuário à API somente em ASCII (nome com acento não pode gerar 400)', async () => {
    const upstream = await createUpstream();
    let transaction: OidcTransaction | undefined;
    const oidcClient: OidcClient = {
      async getAuthorizationUrl(value) {
        transaction = value;
        return `https://login.example/authorize?state=${value.state}`;
      },
      async exchangeAuthorizationCode() {
        return {
          provider: 'google',
          name: 'Elson Vinícius',
          roles: [],
          subject: '123456789012345678901',
        };
      },
    };
    const config = loadConfig({
      NODE_ENV: 'production',
      LAYOUTPARSER_API_URL: upstream.url,
      BFF_PUBLIC_ORIGIN: 'https://layoutparser.example',
      ENTRA_TENANT_ID: 'common',
      ENTRA_CLIENT_ID: testClientId,
      ENTRA_CLIENT_SECRET: testClientSecret,
      BFF_TRUSTED_USER_HEADER: 'x-iis-user',
      BFF_ADMIN_USERS: 'admin@example.test',
    });
    const app = await buildApp(config, { logger: false, oidcClient });
    await app.ready();
    apps.push(app);
    upstreams.push(upstream);

    const login = await app.inject({ method: 'GET', url: '/auth/login' });
    const loginCookie = String(login.headers['set-cookie']).split(';', 1)[0];
    const callback = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=test-code&state=${transaction?.state}`,
      headers: { cookie: loginCookie },
    });
    const sessionCookie = String(callback.headers['set-cookie']).split(';', 1)[0];
    const session = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { cookie: sessionCookie },
    });
    const proxied = await app.inject({
      method: 'GET',
      url: '/api/layouts',
      headers: { cookie: sessionCookie },
    });

    expect(proxied.statusCode).toBe(200);
    expect(upstream.requests[0]?.headers['x-iis-user']).toBe('Elson Vinicius');
    expect(session.json()).toMatchObject({ user: { name: 'Elson Vinícius' } });
  });

  it.each([
    {
      caso: 'display name do Google igual ao admin, sem e-mail verificado, não é admin',
      identity: { name: 'admin@example.test' },
      isAdmin: false,
    },
    {
      caso: 'e-mail verificado do Google na lista de admins é admin',
      identity: { name: 'Fulano de Tal', email: 'admin@example.test' },
      isAdmin: true,
    },
  ])('Google: $caso', async ({ identity, isAdmin }) => {
    const upstream = await createUpstream();
    let transaction: OidcTransaction | undefined;
    const oidcClient: OidcClient = {
      async getAuthorizationUrl(value) {
        transaction = value;
        return `https://login.example/authorize?state=${value.state}`;
      },
      async exchangeAuthorizationCode() {
        return {
          provider: 'google',
          roles: [],
          subject: '123456789012345678901',
          ...identity,
        };
      },
    };
    const config = loadConfig({
      NODE_ENV: 'production',
      LAYOUTPARSER_API_URL: upstream.url,
      BFF_PUBLIC_ORIGIN: 'https://layoutparser.example',
      ENTRA_TENANT_ID: 'common',
      ENTRA_CLIENT_ID: testClientId,
      ENTRA_CLIENT_SECRET: testClientSecret,
      BFF_ADMIN_USERS: 'admin@example.test',
    });
    const app = await buildApp(config, { logger: false, oidcClient });
    await app.ready();
    apps.push(app);
    upstreams.push(upstream);

    const login = await app.inject({ method: 'GET', url: '/auth/login' });
    const loginCookie = String(login.headers['set-cookie']).split(';', 1)[0];
    const callback = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=test-code&state=${transaction?.state}`,
      headers: { cookie: loginCookie },
    });
    const sessionCookie = String(callback.headers['set-cookie']).split(';', 1)[0];
    const session = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { cookie: sessionCookie },
    });

    expect(session.json()).toMatchObject({ authenticated: true, isAdmin });
  });

  it('conclui login OIDC com state, nonce e PKCE e permite logout local', async () => {
    let authorizationTransaction: OidcTransaction | undefined;
    let exchangeRequest: OidcExchangeRequest | undefined;
    const oidcClient: OidcClient = {
      async getAuthorizationUrl(transaction) {
        authorizationTransaction = transaction;
        return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=${transaction.state}`;
      },
      async exchangeAuthorizationCode(request) {
        exchangeRequest = request;
        return {
          provider: 'entra',
          name: 'student@example.edu',
          roles: ['LayoutParserAdmins'],
          subject: 'subject-12345678901234567890',
          tenantId: 'tenant-12345678901234567890',
        };
      },
    };
    const { app } = await createApp(
      {
        BFF_PUBLIC_ORIGIN: 'https://layoutparser.example',
        ENTRA_TENANT_ID: 'common',
        ENTRA_CLIENT_ID: testClientId,
        ENTRA_CLIENT_SECRET: testClientSecret,
      },
      { oidcClient }
    );

    const login = await app.inject({
      method: 'GET',
      url: '/auth/login?returnTo=%2Fadmin%3Ftab%3Dmetrics',
    });
    const loginCookie = String(login.headers['set-cookie']).split(';', 1)[0];

    expect(login.statusCode).toBe(302);
    expect(login.headers.location).toContain(authorizationTransaction?.state);
    expect(authorizationTransaction).toMatchObject({ returnTo: '/admin?tab=metrics' });
    expect(authorizationTransaction?.codeChallenge).not.toBe(
      authorizationTransaction?.codeVerifier
    );

    const callback = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=test-code&state=${authorizationTransaction?.state}&iss=https%3A%2F%2Faccounts.google.com`,
      headers: { cookie: loginCookie },
    });
    const authenticatedCookie = String(callback.headers['set-cookie']).split(';', 1)[0];

    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe('/admin?tab=metrics');
    expect(exchangeRequest).toMatchObject({
      code: 'test-code',
      state: authorizationTransaction?.state,
      nonce: authorizationTransaction?.nonce,
      codeVerifier: authorizationTransaction?.codeVerifier,
      // Regressão: o `iss` (RFC 9207) do callback precisa chegar ao cliente OIDC; sem ele o
      // openid-client recusa a resposta do Google.
      issuer: 'https://accounts.google.com',
    });

    const session = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { cookie: authenticatedCookie },
    });
    expect(session.json()).toMatchObject({
      authenticated: true,
      user: { name: 'student@example.edu' },
      isAdmin: true,
    });

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: authenticatedCookie },
    });
    expect(logout.statusCode).toBe(303);
    expect(logout.headers.location).toBe('/');
    expect(logout.headers['set-cookie']).toContain('Max-Age=0');
  });

  it('preserva o returnTo original (não hardcoded em /upload) quando o callback OIDC falha', async () => {
    // Regressão: o redirect de erro caía sempre em "/upload", perdendo o destino original da
    // tentativa de login. Como o MainLayout só mostra a home pública em "/", uma falha vinda da
    // home derrubava o usuário no AuthenticationGate genérico em vez de mostrar o erro na própria
    // home — parecendo um "loop" de volta para uma tela de login diferente da que ele conhecia.
    let transaction: OidcTransaction | undefined;
    const failingExchangeClient: OidcClient = {
      async getAuthorizationUrl(value) {
        transaction = value;
        return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=${value.state}`;
      },
      async exchangeAuthorizationCode() {
        throw new Error('token rejeitado');
      },
    };
    const { app } = await createApp(
      {
        BFF_PUBLIC_ORIGIN: 'https://layoutparser.example',
        ENTRA_TENANT_ID: 'common',
        ENTRA_CLIENT_ID: testClientId,
        ENTRA_CLIENT_SECRET: testClientSecret,
      },
      { oidcClient: failingExchangeClient }
    );

    const login = await app.inject({
      method: 'GET',
      url: '/auth/login?returnTo=%2Fadmin%3Ftab%3Dmetrics',
    });
    const loginCookie = String(login.headers['set-cookie']).split(';', 1)[0];

    const rejected = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=test-code&state=${transaction?.state}`,
      headers: { cookie: loginCookie },
    });

    expect(rejected.statusCode).toBe(303);
    expect(rejected.headers.location).toBe('/admin?tab=metrics&authError=login_failed');
  });

  it('aceita POST /auth/logout com Content-Type application/x-www-form-urlencoded e corpo vazio', async () => {
    // Regressão: o form HTML nativo de logout (antes de trocarmos por fetch no front) sempre
    // envia esse content-type, mesmo sem campos. Sem um parser registrado, o Fastify rejeitava
    // com 415 (FST_ERR_CTP_INVALID_MEDIA_TYPE) antes mesmo de a rota rodar.
    const { app } = await createApp();
    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(logout.statusCode).toBe(303);
    expect(logout.headers.location).toBe('/');
  });

  it('conclui login Google OIDC como provedor alternativo ao Entra, sem afetar o Entra', async () => {
    let googleTransaction: OidcTransaction | undefined;
    let googleExchangeRequest: OidcExchangeRequest | undefined;
    const googleOidcClient: OidcClient = {
      async getAuthorizationUrl(transaction) {
        googleTransaction = transaction;
        return `https://accounts.google.com/o/oauth2/v2/auth?state=${transaction.state}`;
      },
      async exchangeAuthorizationCode(request) {
        googleExchangeRequest = request;
        return {
          provider: 'google',
          name: 'student@gmail.com',
          roles: [],
          subject: 'google-subject-12345678901234567890',
        };
      },
    };
    let entraCalled = false;
    const entraOidcClient: OidcClient = {
      async getAuthorizationUrl(transaction) {
        entraCalled = true;
        return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=${transaction.state}`;
      },
      async exchangeAuthorizationCode() {
        entraCalled = true;
        throw new Error('não deveria ser chamado pelo fluxo Google');
      },
    };
    const { app } = await createApp(
      {
        BFF_PUBLIC_ORIGIN: 'https://layoutparser.example',
        ENTRA_TENANT_ID: 'common',
        ENTRA_CLIENT_ID: testClientId,
        ENTRA_CLIENT_SECRET: testClientSecret,
        GOOGLE_CLIENT_ID: '1234567890-abc123def456.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'test-google-secret-with-enough-length',
      },
      { oidcClient: entraOidcClient, googleOidcClient }
    );

    const login = await app.inject({
      method: 'GET',
      url: '/auth/google/login?returnTo=%2Fadmin%3Ftab%3Dmetrics',
    });
    const loginCookie = String(login.headers['set-cookie']).split(';', 1)[0];

    expect(login.statusCode).toBe(302);
    expect(login.headers.location).toContain(googleTransaction?.state);
    expect(googleTransaction).toMatchObject({ provider: 'google', returnTo: '/admin?tab=metrics' });

    const callback = await app.inject({
      method: 'GET',
      url: `/auth/google/callback?code=test-code&state=${googleTransaction?.state}`,
      headers: { cookie: loginCookie },
    });
    const authenticatedCookie = String(callback.headers['set-cookie']).split(';', 1)[0];

    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe('/admin?tab=metrics');
    expect(googleExchangeRequest).toMatchObject({
      code: 'test-code',
      state: googleTransaction?.state,
      nonce: googleTransaction?.nonce,
    });
    expect(entraCalled).toBe(false);

    const session = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { cookie: authenticatedCookie },
    });
    expect(session.json()).toMatchObject({
      authenticated: true,
      user: { name: 'student@gmail.com' },
    });
  });

  it('recusa callback do Google com transação de login iniciada pelo Entra (e vice-versa)', async () => {
    let entraTransaction: OidcTransaction | undefined;
    const entraOidcClient: OidcClient = {
      async getAuthorizationUrl(transaction) {
        entraTransaction = transaction;
        return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=${transaction.state}`;
      },
      async exchangeAuthorizationCode() {
        throw new Error('não deveria trocar o código');
      },
    };
    const googleOidcClient: OidcClient = {
      async getAuthorizationUrl(transaction) {
        return `https://accounts.google.com/o/oauth2/v2/auth?state=${transaction.state}`;
      },
      async exchangeAuthorizationCode() {
        throw new Error('não deveria trocar o código');
      },
    };
    const { app } = await createApp(
      {
        BFF_PUBLIC_ORIGIN: 'https://layoutparser.example',
        ENTRA_TENANT_ID: 'common',
        ENTRA_CLIENT_ID: testClientId,
        ENTRA_CLIENT_SECRET: testClientSecret,
        GOOGLE_CLIENT_ID: '1234567890-abc123def456.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'test-google-secret-with-enough-length',
      },
      { oidcClient: entraOidcClient, googleOidcClient }
    );

    const login = await app.inject({ method: 'GET', url: '/auth/login' });
    const loginCookie = String(login.headers['set-cookie']).split(';', 1)[0];
    const crossProviderCallback = await app.inject({
      method: 'GET',
      url: `/auth/google/callback?code=test-code&state=${entraTransaction?.state}`,
      headers: { cookie: loginCookie },
    });

    expect(crossProviderCallback.statusCode).toBe(303);
    expect(crossProviderCallback.headers.location).toBe('/?authError=invalid_callback');
  });

  it('responde 503 em /auth/google/login quando o Google não está configurado, sem afetar o Entra', async () => {
    const entraOidcClient: OidcClient = {
      async getAuthorizationUrl(transaction) {
        return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=${transaction.state}`;
      },
      async exchangeAuthorizationCode() {
        throw new Error('não chamado neste teste');
      },
    };
    const { app } = await createApp(
      {
        BFF_PUBLIC_ORIGIN: 'https://layoutparser.example',
        ENTRA_TENANT_ID: 'common',
        ENTRA_CLIENT_ID: testClientId,
        ENTRA_CLIENT_SECRET: testClientSecret,
      },
      { oidcClient: entraOidcClient }
    );

    const googleUnavailable = await app.inject({ method: 'GET', url: '/auth/google/login' });
    expect(googleUnavailable.statusCode).toBe(503);

    const entraLogin = await app.inject({ method: 'GET', url: '/auth/login' });
    expect(entraLogin.statusCode).toBe(302);
  });

  it('rejeita callback OIDC sem vínculo com a sessão e bloqueia open redirect', async () => {
    let exchanged = false;
    const oidcClient: OidcClient = {
      async getAuthorizationUrl(transaction) {
        return `https://login.example/authorize?state=${transaction.state}`;
      },
      async exchangeAuthorizationCode() {
        exchanged = true;
        throw new Error('não deveria trocar o código');
      },
    };
    const { app } = await createApp(
      {
        BFF_PUBLIC_ORIGIN: 'https://layoutparser.example',
        ENTRA_TENANT_ID: 'common',
        ENTRA_CLIENT_ID: testClientId,
        ENTRA_CLIENT_SECRET: testClientSecret,
      },
      { oidcClient }
    );

    const login = await app.inject({
      method: 'GET',
      url: '/auth/login?returnTo=%2F%2Fevil.example%2Fsteal',
    });
    const loginCookie = String(login.headers['set-cookie']).split(';', 1)[0];
    const rejected = await app.inject({
      method: 'GET',
      url: '/auth/callback?code=test-code&state=forged-state-12345678901234567890',
      headers: { cookie: loginCookie },
    });

    expect(rejected.statusCode).toBe(303);
    expect(rejected.headers.location).toBe('/?authError=invalid_callback');
    expect(exchanged).toBe(false);
  });

  it('trata ambiente sem OIDC, início indisponível, cancelamento e troca de código rejeitada', async () => {
    const withoutOidc = await createApp();
    const unavailable = await withoutOidc.app.inject({ method: 'GET', url: '/auth/login' });
    expect(unavailable.statusCode).toBe(503);

    const failingStartClient: OidcClient = {
      async getAuthorizationUrl() {
        throw new Error('discovery indisponível');
      },
      async exchangeAuthorizationCode() {
        throw new Error('não chamado');
      },
    };
    const failingStart = await createApp(
      {
        BFF_PUBLIC_ORIGIN: 'https://layoutparser.example',
        ENTRA_TENANT_ID: 'common',
        ENTRA_CLIENT_ID: testClientId,
        ENTRA_CLIENT_SECRET: testClientSecret,
      },
      { oidcClient: failingStartClient }
    );
    const startResponse = await failingStart.app.inject({ method: 'GET', url: '/auth/login' });
    expect(startResponse.statusCode).toBe(303);
    expect(startResponse.headers.location).toBe('/?authError=temporarily_unavailable');

    let transaction: OidcTransaction | undefined;
    const failingExchangeClient: OidcClient = {
      async getAuthorizationUrl(value) {
        transaction = value;
        return `https://login.example/authorize?state=${value.state}`;
      },
      async exchangeAuthorizationCode() {
        throw new Error('token rejeitado');
      },
    };
    const failingExchange = await createApp(
      {
        BFF_PUBLIC_ORIGIN: 'https://layoutparser.example',
        ENTRA_TENANT_ID: 'common',
        ENTRA_CLIENT_ID: testClientId,
        ENTRA_CLIENT_SECRET: testClientSecret,
      },
      { oidcClient: failingExchangeClient }
    );
    const login = await failingExchange.app.inject({ method: 'GET', url: '/auth/login' });
    const loginCookie = String(login.headers['set-cookie']).split(';', 1)[0];
    const canceled = await failingExchange.app.inject({
      method: 'GET',
      url: `/auth/callback?error=access_denied&state=${transaction?.state}`,
      headers: { cookie: loginCookie },
    });
    expect(canceled.headers.location).toBe('/?authError=access_denied');

    const secondLogin = await failingExchange.app.inject({ method: 'GET', url: '/auth/login' });
    const secondCookie = String(secondLogin.headers['set-cookie']).split(';', 1)[0];
    const rejected = await failingExchange.app.inject({
      method: 'GET',
      url: `/auth/callback?code=test-code&state=${transaction?.state}`,
      headers: { cookie: secondCookie },
    });
    expect(rejected.headers.location).toBe('/?authError=login_failed');
  });

  it('limita explicitamente tentativas de início de autenticação por minuto', async () => {
    const { app } = await createApp();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await app.inject({ method: 'GET', url: '/auth/login' });
      expect(response.statusCode).toBe(503);
    }

    const blocked = await app.inject({ method: 'GET', url: '/auth/login' });
    expect(blocked.statusCode, blocked.body).toBe(429);
    expect(blocked.json()).toMatchObject({ message: 'Limite de requisições excedido.' });
  });

  it('preserva correlation id válido e substitui valor inseguro', async () => {
    const { app } = await createApp();

    const valid = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-correlation-id': 'academic-request-123' },
    });
    const invalid = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-correlation-id': 'bad id' },
    });

    expect(valid.headers['x-correlation-id']).toBe('academic-request-123');
    expect(invalid.headers['x-correlation-id']).not.toBe('bad id');
  });

  it('exige autenticação e preserva path, query, método e identidade no proxy', async () => {
    const { app, upstream } = await createApp();

    const unauthorized = await app.inject({ method: 'GET', url: '/api/layouts?page=1' });
    expect(unauthorized.statusCode).toBe(401);
    expect(upstream.requests).toHaveLength(0);

    const response = await app.inject({
      method: 'POST',
      url: '/api/layouts?page=1',
      headers: {
        'content-type': 'text/plain',
        'x-dev-user': 'student.user',
        'x-dev-roles': 'Users',
        'x-layoutparser-identity-provider': 'google',
        'x-layoutparser-identity-subject': 'spoofed-subject',
        'x-layoutparser-identity-tenant': 'spoofed-tenant',
        authorization: 'Bearer browser-token-must-not-leak',
        cookie: 'browser-cookie-must-not-leak=yes',
      },
      payload: 'document body',
    });

    expect(response.statusCode).toBe(200);
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/layouts?page=1',
    });
    expect(upstream.requests[0]?.body.toString()).toBe('document body');
    expect(upstream.requests[0]?.headers['x-iis-user']).toBe('student.user');
    expect(upstream.requests[0]?.headers['x-iis-roles']).toBe('Users');
    expect(upstream.requests[0]?.headers['x-layoutparser-identity-provider']).toBe('development');
    expect(upstream.requests[0]?.headers['x-layoutparser-identity-subject']).toBe('student.user');
    expect(upstream.requests[0]?.headers['x-layoutparser-identity-tenant']).toBeUndefined();
    expect(upstream.requests[0]?.headers['x-dev-user']).toBeUndefined();
    expect(upstream.requests[0]?.headers.authorization).toBeUndefined();
    expect(upstream.requests[0]?.headers.cookie).toBeUndefined();
    expect(upstream.requests[0]?.headers['x-correlation-id']).toBe(
      response.headers['x-correlation-id']
    );
    expect(response.headers.server).toBeUndefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('protege endpoints administrativos por allowlist de usuário ou role', async () => {
    const { app, upstream } = await createApp();

    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/monitoring/layouts-analysis',
      headers: { 'x-dev-user': 'student.user', 'x-dev-roles': 'Users' },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(upstream.requests).toHaveLength(0);

    const allowed = await app.inject({
      method: 'GET',
      url: '/API/MONITORING/layouts-analysis',
      headers: { 'x-dev-user': 'admin.user' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(upstream.requests).toHaveLength(1);
  });

  it('protege também caminhos administrativos com encoding repetido', async () => {
    const { app, upstream } = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/%256donitoring/layouts-analysis',
      headers: { 'x-dev-user': 'student.user' },
    });

    expect(response.statusCode).toBe(403);
    expect(upstream.requests).toHaveLength(0);
  });

  it('aplica rate limiting por identidade', async () => {
    const { app } = await createApp({ BFF_RATE_LIMIT_MAX: '1' });
    const request = {
      method: 'GET' as const,
      url: '/api/session',
      headers: { 'x-dev-user': 'student.user' },
    };

    expect((await app.inject(request)).statusCode).toBe(200);
    const blocked = await app.inject(request);
    expect(blocked.statusCode, blocked.body).toBe(429);
    expect(blocked.json()).toMatchObject({ message: 'Limite de requisições excedido.' });
  });

  it('rejeita request total acima do limite antes de chamar o upstream', async () => {
    const { app, upstream } = await createApp({
      BFF_REQUEST_LIMIT_MIB: '1',
      BFF_DOCUMENT_LIMIT_MIB: '1',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'content-type': 'application/octet-stream', 'x-dev-user': 'student.user' },
      payload: Buffer.alloc(1024 * 1024 + 1),
    });

    expect(response.statusCode, response.body).toBe(413);
    expect(response.json()).toMatchObject({ message: 'A requisição excede o limite permitido.' });
    expect(upstream.requests).toHaveLength(0);
  });

  it('rejeita txtFile acima do limite de documento mesmo abaixo do limite total', async () => {
    const { app, upstream } = await createApp({
      BFF_REQUEST_LIMIT_MIB: '2',
      BFF_DOCUMENT_LIMIT_MIB: '1',
    });
    const form = new FormData();
    form.append('txtFile', new Blob([Buffer.alloc(1024 * 1024 + 1)]), 'document.txt');
    const encoded = new Request('http://bff.local/api/parse', { method: 'POST', body: form });
    const response = await app.inject({
      method: 'POST',
      url: '/api/parse',
      headers: {
        'content-type': encoded.headers.get('content-type') ?? '',
        'x-dev-user': 'student.user',
      },
      payload: Buffer.from(await encoded.arrayBuffer()),
    });

    expect(response.statusCode, response.body).toBe(413);
    expect(response.json()).toMatchObject({ message: 'O documento excede o limite permitido.' });
    expect(upstream.requests).toHaveLength(0);
  });

  it('gera logs JSON estruturados sem registrar corpo TXT ou XML', async () => {
    let logs = '';
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        logs += chunk.toString();
        callback();
      },
    });
    const { app } = await createApp({}, { logStream });
    const sensitiveBody = '<document>CONFIDENTIAL-TXT-XML-CONTENT</document>';

    const response = await app.inject({
      method: 'POST',
      url: '/api/log-test',
      headers: { 'content-type': 'application/xml', 'x-dev-user': 'student.user' },
      payload: sensitiveBody,
    });

    expect(response.statusCode).toBe(200);
    expect(logs).toContain('http.request.completed');
    expect(logs).not.toContain(sensitiveBody);
    expect(logs).not.toContain('CONFIDENTIAL-TXT-XML-CONTENT');
    for (const line of logs.trim().split('\n')) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

describe('e-mail verificado repassado à API', () => {
  async function loginAndProxy(
    identity: Awaited<ReturnType<OidcClient['exchangeAuthorizationCode']>>,
    spoofedEmail?: string
  ): Promise<CapturedRequest | undefined> {
    const upstream = await createUpstream();
    let transaction: OidcTransaction | undefined;
    const oidcClient: OidcClient = {
      async getAuthorizationUrl(value) {
        transaction = value;
        return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=${value.state}`;
      },
      async exchangeAuthorizationCode() {
        return identity;
      },
    };
    const config = loadConfig({
      NODE_ENV: 'production',
      LAYOUTPARSER_API_URL: upstream.url,
      BFF_PUBLIC_ORIGIN: 'https://layoutparser.example',
      ENTRA_TENANT_ID: 'common',
      ENTRA_CLIENT_ID: testClientId,
      ENTRA_CLIENT_SECRET: testClientSecret,
      BFF_ADMIN_ROLES: 'LayoutParserAdmins',
    });
    const app = await buildApp(config, { logger: false, oidcClient });
    await app.ready();
    apps.push(app);
    upstreams.push(upstream);

    const login = await app.inject({ method: 'GET', url: '/auth/login' });
    const loginCookie = String(login.headers['set-cookie']).split(';', 1)[0];
    const callback = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=test-code&state=${transaction?.state}`,
      headers: { cookie: loginCookie },
    });
    const sessionCookie = String(callback.headers['set-cookie']).split(';', 1)[0];
    await app.inject({
      method: 'GET',
      url: '/api/layouts',
      headers: {
        cookie: sessionCookie,
        ...(spoofedEmail ? { 'x-layoutparser-identity-email': spoofedEmail } : {}),
      },
    });
    return upstream.requests[0];
  }

  const base = {
    provider: 'google' as const,
    name: 'Ana',
    roles: [],
    subject: 'subject-12345678901234567890',
  };

  it('envia o e-mail verificado da sessão no header de identidade', async () => {
    const request = await loginAndProxy({ ...base, email: 'ana@example.com' });
    expect(request?.headers['x-layoutparser-identity-email']).toBe('ana@example.com');
  });

  it('não envia header quando a sessão não tem e-mail verificado', async () => {
    const request = await loginAndProxy(base);
    expect(request?.headers['x-layoutparser-identity-email']).toBeUndefined();
  });

  it('remove o header de e-mail forjado pelo cliente', async () => {
    const request = await loginAndProxy(base, 'vitima@example.com');
    expect(request?.headers['x-layoutparser-identity-email']).toBeUndefined();
  });

  it('a sessão com e-mail cabe no cookie criptografado (< 4096 bytes)', async () => {
    const upstream = await createUpstream();
    let transaction: OidcTransaction | undefined;
    const oidcClient: OidcClient = {
      async getAuthorizationUrl(value) {
        transaction = value;
        return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=${value.state}`;
      },
      async exchangeAuthorizationCode() {
        return {
          ...base,
          provider: 'entra',
          tenantId: 'tenant-12345678901234567890',
          email: `${'a'.repeat(300)}@example.com`.slice(-320),
          roles: ['LayoutParserAdmins'],
        };
      },
    };
    const config = loadConfig({
      NODE_ENV: 'production',
      LAYOUTPARSER_API_URL: upstream.url,
      BFF_PUBLIC_ORIGIN: 'https://layoutparser.example',
      ENTRA_TENANT_ID: 'common',
      ENTRA_CLIENT_ID: testClientId,
      ENTRA_CLIENT_SECRET: testClientSecret,
      BFF_ADMIN_ROLES: 'LayoutParserAdmins',
    });
    const app = await buildApp(config, { logger: false, oidcClient });
    await app.ready();
    apps.push(app);
    upstreams.push(upstream);
    const login = await app.inject({ method: 'GET', url: '/auth/login' });
    const loginCookie = String(login.headers['set-cookie']).split(';', 1)[0];
    const callback = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=test-code&state=${transaction?.state}`,
      headers: { cookie: loginCookie },
    });
    expect(String(callback.headers['set-cookie']).split(';', 1)[0]?.length).toBeLessThan(4096);
  });

  it('protege /api/admin exigindo admin do BFF', async () => {
    const { app, upstream } = await createApp();
    const denied = await app.inject({
      method: 'GET',
      url: '/api/admin/workspaces?take=1',
      headers: { 'x-dev-user': 'student.user' },
    });
    expect(denied.statusCode).toBe(403);
    expect(upstream.requests).toHaveLength(0);
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/admin/workspaces?take=1',
      headers: { 'x-dev-user': 'admin.user' },
    });
    expect(allowed.statusCode).toBe(200);
  });
});
