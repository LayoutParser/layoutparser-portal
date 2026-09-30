import { beforeEach, describe, expect, it, vi } from 'vitest';

const discovery = vi.fn();
const buildAuthorizationUrl = vi.fn();
const authorizationCodeGrant = vi.fn();

vi.mock('openid-client', () => ({
  discovery: (...args: unknown[]) => discovery(...args),
  buildAuthorizationUrl: (...args: unknown[]) => buildAuthorizationUrl(...args),
  authorizationCodeGrant: (...args: unknown[]) => authorizationCodeGrant(...args),
}));

const { createOidcClients, identityFromEntraClaims, identityFromGoogleClaims } =
  await import('../src/oidc.js');
const { loadConfig } = await import('../src/config.js');

const googleConfig = {
  GOOGLE_CLIENT_ID: '1234567890-abc123def456.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-google-secret-with-enough-length',
  BFF_PUBLIC_ORIGIN: 'https://layoutparser.example',
} satisfies NodeJS.ProcessEnv;

const sampleTransaction = {
  provider: 'google' as const,
  state: 'state-value-1234567890123456',
  nonce: 'nonce-value-1234567890123456',
  codeVerifier: 'verifier-value-1234567890123456',
  codeChallenge: 'challenge-value-1234567890123456',
  returnTo: '/upload',
  createdAt: Date.now(),
};

describe('GoogleOidcClient (via createOidcClients)', () => {
  beforeEach(() => {
    discovery.mockReset();
    buildAuthorizationUrl.mockReset();
    authorizationCodeGrant.mockReset();
  });

  it('não instancia o cliente Google quando a config não está presente', () => {
    const config = loadConfig({ NODE_ENV: 'development' });
    expect(createOidcClients(config).google).toBeNull();
  });

  it('constrói a URL de autorização via openid-client, com PKCE, escopo mínimo e discovery memorizado', async () => {
    const config = loadConfig(googleConfig);
    const client = createOidcClients(config).google;
    expect(client).not.toBeNull();

    const fakeConfiguration = { marker: 'google-configuration' };
    discovery.mockResolvedValue(fakeConfiguration);
    buildAuthorizationUrl.mockReturnValue(
      new URL('https://accounts.google.com/o/oauth2/v2/auth?state=abc')
    );

    const first = await client?.getAuthorizationUrl(sampleTransaction);
    const second = await client?.getAuthorizationUrl(sampleTransaction);

    expect(first).toBe('https://accounts.google.com/o/oauth2/v2/auth?state=abc');
    expect(second).toBe(first);
    // A descoberta OIDC do Google é cara (rede) e não muda em runtime: deve ser feita uma
    // única vez por processo, mesmo com múltiplos logins.
    expect(discovery).toHaveBeenCalledTimes(1);
    expect(discovery).toHaveBeenCalledWith(
      new URL('https://accounts.google.com'),
      googleConfig.GOOGLE_CLIENT_ID,
      googleConfig.GOOGLE_CLIENT_SECRET
    );

    expect(buildAuthorizationUrl).toHaveBeenCalledWith(
      fakeConfiguration,
      expect.objectContaining({
        redirect_uri: 'https://layoutparser.example/auth/google/callback',
        scope: 'openid profile email',
        state: sampleTransaction.state,
        nonce: sampleTransaction.nonce,
        code_challenge: sampleTransaction.codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      })
    );
  });

  it('troca o código por tokens e mapeia os claims do Google para SessionIdentity', async () => {
    const config = loadConfig(googleConfig);
    const client = createOidcClients(config).google;
    discovery.mockResolvedValue({ marker: 'google-configuration' });
    authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: 'google-subject-123', name: 'Estudante Teste', email: 'e@gmail.com' }),
    });

    const identity = await client?.exchangeAuthorizationCode({
      code: 'auth-code',
      state: sampleTransaction.state,
      nonce: sampleTransaction.nonce,
      codeVerifier: sampleTransaction.codeVerifier,
    });

    expect(identity).toEqual({
      provider: 'google',
      name: 'Estudante Teste',
      roles: [],
      subject: 'google-subject-123',
    });

    const [, callbackUrl, checks] = authorizationCodeGrant.mock.calls[0] as [
      unknown,
      URL,
      Record<string, unknown>,
    ];
    expect(callbackUrl.searchParams.get('code')).toBe('auth-code');
    expect(callbackUrl.searchParams.get('state')).toBe(sampleTransaction.state);
    expect(checks).toMatchObject({
      pkceCodeVerifier: sampleTransaction.codeVerifier,
      expectedState: sampleTransaction.state,
      expectedNonce: sampleTransaction.nonce,
    });
  });

  it('usa o e-mail como nome quando o claim name está ausente', async () => {
    const config = loadConfig(googleConfig);
    const client = createOidcClients(config).google;
    discovery.mockResolvedValue({ marker: 'google-configuration' });
    authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: 'google-subject-456', email: 'somente-email@gmail.com' }),
    });

    const identity = await client?.exchangeAuthorizationCode({
      code: 'auth-code',
      state: sampleTransaction.state,
      nonce: sampleTransaction.nonce,
      codeVerifier: sampleTransaction.codeVerifier,
    });

    expect(identity).toMatchObject({ name: 'somente-email@gmail.com' });
  });

  it('rejeita quando o Google não devolve claims de ID Token', async () => {
    const config = loadConfig(googleConfig);
    const client = createOidcClients(config).google;
    discovery.mockResolvedValue({ marker: 'google-configuration' });
    authorizationCodeGrant.mockResolvedValue({ claims: () => undefined });

    await expect(
      client?.exchangeAuthorizationCode({
        code: 'auth-code',
        state: sampleTransaction.state,
        nonce: sampleTransaction.nonce,
        codeVerifier: sampleTransaction.codeVerifier,
      })
    ).rejects.toThrowError('ID Token');
  });

  it('rejeita quando o subject ou o nome/e-mail estão ausentes dos claims', async () => {
    const config = loadConfig(googleConfig);
    const client = createOidcClients(config).google;
    discovery.mockResolvedValue({ marker: 'google-configuration' });
    authorizationCodeGrant.mockResolvedValue({ claims: () => ({ sub: 'only-subject' }) });

    await expect(
      client?.exchangeAuthorizationCode({
        code: 'auth-code',
        state: sampleTransaction.state,
        nonce: sampleTransaction.nonce,
        codeVerifier: sampleTransaction.codeVerifier,
      })
    ).rejects.toThrowError('identidade utilizável');
  });
});

describe('e-mail verificado na identidade', () => {
  const googleClaims = { sub: 'google-subject-123', name: 'Ana', email: '  Ana@Example.COM ' };
  const entraClaims = {
    oid: 'entra-oid-123',
    preferred_username: 'ana@corp.example',
    email: 'Ana@Corp.Example',
    tid: 'Tenant-Confiavel',
  };

  it('Google com email_verified === true expõe o e-mail normalizado', () => {
    expect(identityFromGoogleClaims({ ...googleClaims, email_verified: true }).email).toBe(
      'ana@example.com'
    );
  });

  it.each([false, 'true', undefined])('Google com email_verified=%s não expõe e-mail', value => {
    const identity = identityFromGoogleClaims({ ...googleClaims, email_verified: value });
    expect(identity.email).toBeUndefined();
  });

  it('Entra fora da allowlist de tenants não expõe e-mail (padrão)', () => {
    expect(identityFromEntraClaims(entraClaims, undefined, 'x', 'y').email).toBeUndefined();
    expect(
      identityFromEntraClaims(entraClaims, undefined, 'x', 'y', new Set(['outro-tenant'])).email
    ).toBeUndefined();
  });

  it('Entra em tenant confiável expõe o e-mail normalizado', () => {
    const identity = identityFromEntraClaims(
      entraClaims,
      undefined,
      'x',
      'y',
      new Set(['tenant-confiavel'])
    );
    expect(identity.email).toBe('ana@corp.example');
  });

  it('e-mail malformado ou acima de 320 caracteres é descartado', () => {
    const long = `${'a'.repeat(320)}@example.com`;
    expect(
      identityFromGoogleClaims({ ...googleClaims, email: 'sem-arroba', email_verified: true }).email
    ).toBeUndefined();
    expect(
      identityFromGoogleClaims({ ...googleClaims, email: long, email_verified: true }).email
    ).toBeUndefined();
  });
});
