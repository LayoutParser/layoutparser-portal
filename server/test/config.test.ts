import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../src/config.js';

const productionEnvironment = {
  NODE_ENV: 'production',
  LAYOUTPARSER_API_URL: 'https://layout-parser.internal',
  BFF_PUBLIC_ORIGIN: 'https://layoutparser.example',
  ENTRA_TENANT_ID: 'common',
  ENTRA_CLIENT_ID: '9ff4c9ba-1bab-414a-a6df-39ddce8f7425',
  ENTRA_CLIENT_SECRET: 'test-secret-with-more-than-sixteen-characters',
  BFF_ADMIN_ROLES: 'LayoutParserAdmins',
} satisfies NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('aplica defaults seguros de desenvolvimento', () => {
    const config = loadConfig({ NODE_ENV: 'development' });

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3100);
    expect(config.upstreamUrl).toBe('http://127.0.0.1:5000');
    expect(config.requestLimitBytes).toBe(32 * 1024 * 1024);
    expect(config.documentLimitBytes).toBe(25 * 1024 * 1024);
    expect(config.developmentAuthEnabled).toBe(false);
    expect(config.publicOrigin).toBe('http://localhost:3000');
    expect(config.entra).toBeNull();
  });

  it('carrega uma configuração de produção segura', () => {
    const config = loadConfig({ ...productionEnvironment, BFF_TRUSTED_USER_HEADER: 'X-User' });

    expect(config.isProduction).toBe(true);
    expect(config.publicOrigin).toBe('https://layoutparser.example');
    expect(config.entra).toMatchObject({
      tenantId: 'common',
      clientId: '9ff4c9ba-1bab-414a-a6df-39ddce8f7425',
      redirectUri: 'https://layoutparser.example/auth/callback',
    });
    expect(config.trustedUserHeader).toBe('x-user');
    expect(config.trustedIdentityProviderHeader).toBe('x-layoutparser-identity-provider');
    expect(config.trustedIdentitySubjectHeader).toBe('x-layoutparser-identity-subject');
    expect(config.trustedIdentityTenantHeader).toBe('x-layoutparser-identity-tenant');
    expect(config.trustedIdentityEmailHeader).toBe('x-layoutparser-identity-email');
    expect(config.trustedEmailTenants.size).toBe(0);
    expect(config.adminPaths).toContain('/api/admin/*');
    expect(config.adminRoles.has('layoutparseradmins')).toBe(true);
  });

  it.each([
    [{ NODE_ENV: 'production' }, 'LAYOUTPARSER_API_URL'],
    [{ ...productionEnvironment, BFF_PUBLIC_ORIGIN: '' }, 'BFF_PUBLIC_ORIGIN'],
    [{ ...productionEnvironment, ENTRA_TENANT_ID: '' }, 'ENTRA_TENANT_ID'],
    [{ ...productionEnvironment, ENTRA_CLIENT_ID: '' }, 'ENTRA_CLIENT_ID'],
    [{ ...productionEnvironment, ENTRA_CLIENT_SECRET: '' }, 'ENTRA_CLIENT_SECRET'],
    [{ ...productionEnvironment, BFF_ADMIN_ROLES: '' }, 'BFF_ADMIN_USERS'],
  ])('falha em produção sem configuração obrigatória: %s', (environment, expectedMessage) => {
    expect(() => loadConfig(environment)).toThrowError(expectedMessage);
  });

  it('proíbe autenticação de desenvolvimento em produção', () => {
    expect(() =>
      loadConfig({ ...productionEnvironment, BFF_DEV_AUTH_ENABLED: 'true' })
    ).toThrowError('BFF_DEV_AUTH_ENABLED');
  });

  it('proíbe bind não local e upstream HTTP remoto em produção', () => {
    const base = productionEnvironment;

    expect(() =>
      loadConfig({ ...base, BFF_HOST: '0.0.0.0', LAYOUTPARSER_API_URL: 'https://api.internal' })
    ).toThrowError('loopback');
    expect(() => loadConfig({ ...base, LAYOUTPARSER_API_URL: 'http://api.internal' })).toThrowError(
      'HTTPS'
    );
  });

  it('aceita HTTP local em produção sem incluir credenciais na URL', () => {
    const base = productionEnvironment;

    expect(loadConfig({ ...base, LAYOUTPARSER_API_URL: 'http://127.0.0.1:5000' }).upstreamUrl).toBe(
      'http://127.0.0.1:5000'
    );
    expect(() =>
      loadConfig({ ...base, LAYOUTPARSER_API_URL: 'https://user:secret@api.internal' })
    ).toThrowError('credenciais');
  });

  it('trata o Google como provedor alternativo opcional, inclusive em produção', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).google).toBeNull();
    expect(loadConfig(productionEnvironment).google).toBeNull();

    const withGoogle = loadConfig({
      ...productionEnvironment,
      GOOGLE_CLIENT_ID: '1234567890-abc123def456.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'test-google-secret-with-enough-length',
    });
    expect(withGoogle.google).toMatchObject({
      clientId: '1234567890-abc123def456.apps.googleusercontent.com',
      redirectUri: 'https://layoutparser.example/auth/google/callback',
    });
    // Entra continua configurado normalmente; nenhum provedor substitui o outro.
    expect(withGoogle.entra).not.toBeNull();
  });

  it.each([
    [
      {
        GOOGLE_CLIENT_ID: 'not-a-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-secret-with-enough-length',
      },
      'GOOGLE_CLIENT_ID',
    ],
    [
      {
        GOOGLE_CLIENT_ID: '1234567890-abc123def456.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'short',
      },
      'GOOGLE_CLIENT_SECRET',
    ],
  ])('recusa configuração Google malformada: %s', (environment, expectedMessage) => {
    expect(() => loadConfig(environment)).toThrowError(expectedMessage);
  });

  it('valida limites, tipos e padrões administrativos', () => {
    expect(() =>
      loadConfig({ BFF_REQUEST_LIMIT_MIB: '10', BFF_DOCUMENT_LIMIT_MIB: '11' })
    ).toThrowError(ConfigError);
    expect(() => loadConfig({ BFF_DEV_AUTH_ENABLED: 'yes' })).toThrowError('true ou false');
    expect(() => loadConfig({ BFF_ADMIN_PATHS: '/api/admin/*/nested' })).toThrowError(
      'padrão inválido'
    );
    expect(() => loadConfig({ BFF_TRUSTED_IDENTITY_SUBJECT_HEADER: 'x-iis-user' })).toThrowError(
      'nomes distintos'
    );
  });

  it.each([
    [{ NODE_ENV: 'staging' }, 'NODE_ENV'],
    [{ BFF_PORT: '3.14' }, 'número inteiro'],
    [{ BFF_PORT: '70000' }, 'entre 1 e 65535'],
    [{ BFF_TRUSTED_USER_HEADER: 'bad header' }, 'header inválido'],
    [{ BFF_TRUSTED_IDENTITY_SUBJECT_HEADER: 'bad header' }, 'header inválido'],
    [{ BFF_DOCUMENT_FIELD: 'bad field!' }, 'campo inválido'],
    [{ BFF_SESSION_TTL_SECONDS: '299' }, 'entre 300 e 86400'],
    [{ BFF_PUBLIC_ORIGIN: 'https://example.test/path' }, 'somente a origem'],
    [
      {
        ENTRA_TENANT_ID: 'common/path',
        ENTRA_CLIENT_ID: '9ff4c9ba-1bab-414a-a6df-39ddce8f7425',
        ENTRA_CLIENT_SECRET: 'test-secret-with-more-than-sixteen-characters',
      },
      'ENTRA_TENANT_ID',
    ],
    [{ LAYOUTPARSER_API_URL: 'ftp://api.internal' }, 'HTTP ou HTTPS'],
    [{ LAYOUTPARSER_API_URL: 'https://api.internal/base' }, 'sem path'],
    [{ BFF_LOG_LEVEL: 'verbose' }, 'BFF_LOG_LEVEL'],
  ])('recusa configuração malformada: %s', (environment, expectedMessage) => {
    expect(() => loadConfig(environment)).toThrowError(expectedMessage);
  });
});
