import { createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

import { ConfidentialClientApplication } from '@azure/msal-node';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import * as openidClient from 'openid-client';

import type { AuthProvider, SessionIdentity } from './auth.js';
import type { AppConfig, EntraConfig, GoogleConfig } from './config.js';

const OIDC_SCOPES = ['openid', 'profile', 'email'];
const GOOGLE_ISSUER = new URL('https://accounts.google.com');
const AUTH_VALUE_PATTERN = /^[A-Za-z0-9_-]{20,512}$/;
const SESSION_KEY_INFO = Buffer.from('LayoutParserReact/BFF/session/v1', 'utf8');
const AUTH_LOGIN_RATE_LIMIT = { max: 20, timeWindow: 60_000 } as const;
const AUTH_CALLBACK_RATE_LIMIT = { max: 60, timeWindow: 60_000 } as const;
const AUTH_LOGOUT_RATE_LIMIT = { max: 30, timeWindow: 60_000 } as const;

export interface OidcTransaction {
  readonly provider: AuthProvider;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly returnTo: string;
  readonly createdAt: number;
}

export interface OidcExchangeRequest {
  readonly code: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  // Parâmetro `iss` (RFC 9207) devolvido no callback; o Google o anuncia como obrigatório.
  readonly issuer?: string;
}

export interface OidcClient {
  getAuthorizationUrl(transaction: OidcTransaction): Promise<string>;
  exchangeAuthorizationCode(request: OidcExchangeRequest): Promise<SessionIdentity>;
}

interface LoginQuery {
  returnTo?: string;
}

interface CallbackQuery {
  code?: string;
  state?: string;
  iss?: string;
  error?: string;
}

type TokenClaims = Record<string, unknown>;

// Observabilidade pura (sem mudar comportamento): classifica um erro como "rede/timeout" vs
// "outro" para ajudar a distinguir, no log, se uma falha de login veio de conectividade de saída
// fria (accounts.google.com / login.microsoftonline.com logo após boot/restart do host ou do
// túnel) ou de outra causa (config, validação de state/nonce, etc.). Heurística best-effort:
// não tem acesso a stack traces de bibliotecas de terceiros, só aos campos padrão de erro Node.
function classifyErrorKind(error: unknown): 'network' | 'other' {
  if (!(error instanceof Error)) {
    return 'other';
  }

  const code = (error as NodeJS.ErrnoException).code;
  const networkCodes = new Set([
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'EAI_AGAIN',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
  ]);
  if (code && networkCodes.has(code)) {
    return 'network';
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    return classifyErrorKind(cause);
  }

  return 'other';
}

function base64UrlRandom(byteLength: number): string {
  return randomBytes(byteLength).toString('base64url');
}

function createTransaction(provider: AuthProvider, returnTo: string): OidcTransaction {
  const codeVerifier = base64UrlRandom(48);
  return {
    provider,
    state: base64UrlRandom(32),
    nonce: base64UrlRandom(32),
    codeVerifier,
    codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
    returnTo,
    createdAt: Date.now(),
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeReturnTo(value: string | undefined, publicOrigin: string): string {
  if (!value || value.length > 2048 || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }

  if (value.includes('\\') || [...value].some(character => (character.codePointAt(0) ?? 0) < 32)) {
    return '/';
  }

  try {
    const target = new URL(value, publicOrigin);
    if (target.origin !== publicOrigin) {
      return '/';
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}

function readStringClaim(claims: TokenClaims, name: string): string | null {
  const value = claims[name];
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 256 ? normalized : null;
}

function readRoles(claims: TokenClaims): readonly string[] {
  const value = claims.roles;
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter((role): role is string => typeof role === 'string')
        .map(role => role.trim())
        .filter(role => role.length > 0 && role.length <= 256)
    ),
  ].slice(0, 50);
}

function identityFromEntraClaims(
  claims: TokenClaims,
  fallbackUsername: string | undefined,
  fallbackSubject: string,
  fallbackTenantId: string
): SessionIdentity {
  const name =
    readStringClaim(claims, 'preferred_username') ??
    readStringClaim(claims, 'email') ??
    fallbackUsername?.trim();
  const subject =
    readStringClaim(claims, 'oid') ?? readStringClaim(claims, 'sub') ?? fallbackSubject.trim();
  const tenantId = readStringClaim(claims, 'tid') ?? fallbackTenantId.trim();

  if (!name || !subject || !tenantId) {
    throw new Error('O token autenticado não contém uma identidade utilizável.');
  }

  return { provider: 'entra', name, roles: readRoles(claims), subject, tenantId };
}

function identityFromGoogleClaims(claims: TokenClaims): SessionIdentity {
  const name = readStringClaim(claims, 'name') ?? readStringClaim(claims, 'email');
  const subject = readStringClaim(claims, 'sub');

  if (!name || !subject) {
    throw new Error('O token autenticado não contém uma identidade utilizável.');
  }

  // O Google não emite papéis (roles) de aplicação; autorização fina segue via
  // BFF_ADMIN_USERS/BFF_ADMIN_ROLES com base no e-mail/nome, igual ao fluxo Entra.
  return { provider: 'google', name, roles: [], subject };
}

class MsalOidcClient implements OidcClient {
  readonly #configuration: EntraConfig;
  readonly #client: ConfidentialClientApplication;
  readonly #logger: FastifyBaseLogger | undefined;

  public constructor(configuration: EntraConfig, logger?: FastifyBaseLogger) {
    this.#configuration = configuration;
    this.#logger = logger;
    this.#client = new ConfidentialClientApplication({
      auth: {
        clientId: configuration.clientId,
        authority: configuration.authority,
        clientSecret: configuration.clientSecret,
      },
    });
  }

  public async getAuthorizationUrl(transaction: OidcTransaction): Promise<string> {
    // Instrumentação pura (sem alterar comportamento): mede o tempo da chamada ao MSAL, que
    // internamente busca metadata da autoridade (login.microsoftonline.com) na primeira vez e
    // pode ficar lenta/falhar em conexão de saída fria (logo após boot do host ou do túnel
    // Cloudflare). O objetivo é permitir correlacionar, na próxima ocorrência real de login
    // lento/falho, se este passo específico é o gargalo — sem precisar reproduzir manualmente.
    const startedAt = Date.now();
    try {
      const url = await this.#client.getAuthCodeUrl({
        scopes: [...OIDC_SCOPES],
        redirectUri: this.#configuration.redirectUri,
        state: transaction.state,
        nonce: transaction.nonce,
        codeChallenge: transaction.codeChallenge,
        codeChallengeMethod: 'S256',
        prompt: 'select_account',
      });
      this.#logger?.debug(
        { event: 'auth.entra.get_auth_code_url', durationMs: Date.now() - startedAt },
        'URL de autorização Entra obtida.'
      );
      return url;
    } catch (error) {
      this.#logger?.warn(
        {
          event: 'auth.entra.get_auth_code_url_failed',
          durationMs: Date.now() - startedAt,
          errorKind: classifyErrorKind(error),
          errorType: error instanceof Error ? error.name : 'UnknownError',
          // Diagnóstico: nesta etapa (metadata da autoridade Entra) o MSAL não recebe nenhum dado
          // de usuário (code/state/token) — os parâmetros enviados são só client id/secret e
          // escopos fixos. A mensagem de erro do MSAL (ex.: "fetch failed", timeout) não carrega
          // esses segredos, então é seguro logar truncada para correlacionar rede lenta vs. outra
          // causa na próxima ocorrência real.
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : undefined,
        },
        'Falha ao obter a URL de autorização do Entra (possível metadata de autoridade fria).'
      );
      throw error;
    }
  }

  public async exchangeAuthorizationCode(request: OidcExchangeRequest): Promise<SessionIdentity> {
    const startedAt = Date.now();
    try {
      const result = await this.#client.acquireTokenByCode(
        {
          code: request.code,
          scopes: [...OIDC_SCOPES],
          redirectUri: this.#configuration.redirectUri,
          codeVerifier: request.codeVerifier,
          state: request.state,
        },
        {
          code: request.code,
          state: request.state,
          nonce: request.nonce,
        }
      );
      this.#logger?.debug(
        { event: 'auth.entra.acquire_token', durationMs: Date.now() - startedAt },
        'Token Entra adquirido a partir do código de autorização.'
      );

      return identityFromEntraClaims(
        result.idTokenClaims as TokenClaims,
        result.account?.username,
        result.uniqueId,
        result.tenantId
      );
    } catch (error) {
      this.#logger?.warn(
        {
          event: 'auth.entra.acquire_token_failed',
          durationMs: Date.now() - startedAt,
          errorKind: classifyErrorKind(error),
          errorType: error instanceof Error ? error.name : 'UnknownError',
          // Diagnóstico (achado nesta investigação): o MSAL embrulha falha de rede em
          // NetworkError, mas o nome/mensagem do erro original de rede (ex.: "fetch failed",
          // timeout) só existe dentro de `error.message` — nunca em `.cause`/`.code` — então
          // `classifyErrorKind` sozinho não distingue rede lenta de erro de validação de token.
          // A mensagem do MSAL aqui é sempre sobre a chamada HTTP ao endpoint de token ou sobre
          // validação de claims/assinatura; não inclui `code`/`state`/tokens em texto (o MSAL não
          // ecoa esses valores nas mensagens de erro que produz). Truncado como precaução.
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : undefined,
        },
        'Falha ao trocar o código de autorização Entra por um token.'
      );
      throw error;
    } finally {
      // O aplicativo usa o token apenas para validar o login. Não chama Graph nem mantém refresh
      // tokens; limpar o cache evita prolongar credenciais Microsoft na memória do processo.
      this.#client.clearCache();
    }
  }
}

/**
 * Cliente OIDC para "Entrar com Google", provedor alternativo ao Entra. Usa a lib genérica
 * `openid-client` (mesma família usada por outros OIDC compatíveis) em vez do MSAL, que é
 * específico da Microsoft. A descoberta do documento OIDC do Google (`/.well-known/...`) é
 * feita de forma preguiçosa e memorizada: não bloqueia o boot do BFF nem depende de rede em
 * ambientes onde o Google não está configurado.
 */
class GoogleOidcClient implements OidcClient {
  readonly #configuration: GoogleConfig;
  readonly #logger: FastifyBaseLogger | undefined;
  #discovery: Promise<openidClient.Configuration> | null = null;
  // Contador só de diagnóstico (não influencia nenhuma decisão de negócio): permite ver, nos
  // logs, quantas vezes a descoberta OIDC do Google foi *tentada* desde o boot do processo.
  #discoveryAttempts = 0;

  public constructor(configuration: GoogleConfig, logger?: FastifyBaseLogger) {
    this.#configuration = configuration;
    this.#logger = logger;
  }

  #getConfiguration(): Promise<openidClient.Configuration> {
    // A promise de descoberta só fica cacheada em caso de sucesso. Uma falha de rede na primeira
    // tentativa (ex.: saída fria para accounts.google.com logo após restart do host/túnel) não
    // deve grudar: `#discovery` é limpo no `.catch`, então a próxima tentativa de login refaz a
    // descoberta em vez de reusar para sempre a mesma rejeição até o processo do BFF reiniciar.
    const wasAlreadyCached = this.#discovery !== null;
    if (!wasAlreadyCached) {
      this.#discoveryAttempts += 1;
      const attemptNumber = this.#discoveryAttempts;
      const startedAt = Date.now();
      this.#discovery = openidClient
        .discovery(GOOGLE_ISSUER, this.#configuration.clientId, this.#configuration.clientSecret)
        .then(configuration => {
          this.#logger?.debug(
            {
              event: 'auth.google.discovery_succeeded',
              attemptNumber,
              durationMs: Date.now() - startedAt,
            },
            'Descoberta OIDC do Google concluída.'
          );
          return configuration;
        })
        .catch((error: unknown) => {
          this.#discovery = null;
          this.#logger?.error(
            {
              event: 'auth.google.discovery_failed',
              attemptNumber,
              durationMs: Date.now() - startedAt,
              errorKind: classifyErrorKind(error),
              errorType: error instanceof Error ? error.name : 'UnknownError',
              // Mesma lacuna de observabilidade do fluxo Entra: só `client id`/`secret` fixos
              // trafegam nesta etapa (metadata OIDC do Google), sem dado de usuário na mensagem.
              errorMessage: error instanceof Error ? error.message.slice(0, 500) : undefined,
            },
            'Descoberta OIDC do Google falhou; próxima tentativa de login refará a descoberta.'
          );
          throw error;
        });
    } else {
      this.#logger?.debug(
        { event: 'auth.google.discovery_reused', attemptNumber: this.#discoveryAttempts },
        'Reusando a descoberta OIDC do Google já iniciada (cache em memória do processo).'
      );
    }
    // Não-nulo em ambos os ramos acima: o `if` acaba de atribuir e o `else` só executa quando já
    // havia sido atribuído em uma chamada anterior.
    return this.#discovery as Promise<openidClient.Configuration>;
  }

  public async getAuthorizationUrl(transaction: OidcTransaction): Promise<string> {
    const configuration = await this.#getConfiguration();
    const url = openidClient.buildAuthorizationUrl(configuration, {
      redirect_uri: this.#configuration.redirectUri,
      scope: OIDC_SCOPES.join(' '),
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: transaction.codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return url.href;
  }

  public async exchangeAuthorizationCode(request: OidcExchangeRequest): Promise<SessionIdentity> {
    const configuration = await this.#getConfiguration();

    // O estado e o nonce já foram conferidos pela rota antes de chegar aqui; reconstruímos uma
    // URL sintética apenas com os parâmetros que o openid-client exige para o grant, sem
    // depender da querystring bruta do navegador.
    const callbackUrl = new URL(this.#configuration.redirectUri);
    callbackUrl.searchParams.set('code', request.code);
    callbackUrl.searchParams.set('state', request.state);
    // Sem o `iss`, o openid-client recusa a resposta quando o provedor anuncia
    // `authorization_response_iss_parameter_supported` (caso do Google). A lib valida o valor.
    if (request.issuer) {
      callbackUrl.searchParams.set('iss', request.issuer);
    }

    const startedAt = Date.now();
    try {
      const tokens = await openidClient.authorizationCodeGrant(configuration, callbackUrl, {
        pkceCodeVerifier: request.codeVerifier,
        expectedState: request.state,
        expectedNonce: request.nonce,
      });

      const claims = tokens.claims();
      if (!claims) {
        throw new Error('A resposta do Google não contém um ID Token.');
      }

      this.#logger?.debug(
        { event: 'auth.google.authorization_code_grant', durationMs: Date.now() - startedAt },
        'Token Google adquirido a partir do código de autorização.'
      );
      return identityFromGoogleClaims(claims as TokenClaims);
    } catch (error) {
      this.#logger?.warn(
        {
          event: 'auth.google.authorization_code_grant_failed',
          durationMs: Date.now() - startedAt,
          errorKind: classifyErrorKind(error),
          errorType: error instanceof Error ? error.name : 'UnknownError',
          // `openid-client` reporta erros do grant (rede, resposta OAuth de erro, validação de
          // claims) em `error.message`; não ecoa `code`/`codeVerifier`/tokens em texto na
          // mensagem. Truncado como precaução, mesmo padrão do fluxo Entra acima.
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : undefined,
        },
        'Falha ao trocar o código de autorização Google por um token.'
      );
      throw error;
    }
  }
}

export function deriveSessionKey(config: AppConfig): Buffer {
  // Decisão: a chave de sessão continua derivada apenas do segredo do Entra (quando presente),
  // sem misturar o segredo do Google. Motivo: ambos os provedores gravam a mesma sessão
  // criptografada (`identity.provider` diferencia a origem), então uma única chave HKDF é
  // suficiente; usar dois segredos como salt/info tornaria a rotação de qualquer um deles capaz
  // de invalidar sessões do outro provedor sem necessidade. Ambientes só com Google (sem Entra)
  // geram uma chave aleatória por processo, igual ao comportamento hoje sem OIDC configurado —
  // aceitável porque nesse caso não há segredo estável de longo prazo para derivar a chave.
  if (!config.entra) {
    return randomBytes(32);
  }

  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(config.entra.clientSecret, 'utf8'),
      Buffer.from(config.entra.clientId, 'utf8'),
      SESSION_KEY_INFO,
      32
    )
  );
}

export interface OidcClients {
  readonly entra: OidcClient | null;
  readonly google: OidcClient | null;
}

export function createOidcClients(config: AppConfig, logger?: FastifyBaseLogger): OidcClients {
  return {
    entra: config.entra ? new MsalOidcClient(config.entra, logger) : null,
    google: config.google ? new GoogleOidcClient(config.google, logger) : null,
  };
}

function errorRedirectLocation(returnTo: string, code: string): string {
  // Preserva o destino original da tentativa de login (ex.: "/" para quem veio da home pública,
  // ou uma rota protegida específica) em vez de cair sempre em "/upload" — o MainLayout só exibe
  // a home pública de apresentação quando o pathname é exatamente "/". O hash (se houver) fica
  // depois da query: senão authError viraria parte do fragmento e nunca apareceria em
  // location.search.
  const hashIndex = returnTo.indexOf('#');
  const path = hashIndex === -1 ? returnTo : returnTo.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : returnTo.slice(hashIndex);
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}authError=${encodeURIComponent(code)}${hash}`;
}

interface ProviderRouteConfig {
  readonly provider: AuthProvider;
  readonly loginPath: '/auth/login' | '/auth/google/login';
  readonly callbackPath: '/auth/callback' | '/auth/google/callback';
  readonly unavailableMessage: string;
}

const PROVIDER_ROUTES: Record<AuthProvider, ProviderRouteConfig> = {
  entra: {
    provider: 'entra',
    loginPath: '/auth/login',
    callbackPath: '/auth/callback',
    unavailableMessage: 'Autenticação Microsoft não configurada neste ambiente.',
  },
  google: {
    provider: 'google',
    loginPath: '/auth/google/login',
    callbackPath: '/auth/google/callback',
    unavailableMessage: 'Autenticação Google não configurada neste ambiente.',
  },
};

function registerProviderRoutes(
  app: FastifyInstance,
  config: AppConfig,
  client: OidcClient | null,
  route: ProviderRouteConfig
): void {
  app.get<{ Querystring: LoginQuery }>(
    route.loginPath,
    { config: { rateLimit: AUTH_LOGIN_RATE_LIMIT } },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (!client) {
        await reply.code(503).send({
          statusCode: 503,
          error: 'Service Unavailable',
          message: route.unavailableMessage,
          correlationId: request.id,
        });
        return;
      }

      const returnTo = normalizeReturnTo(request.query.returnTo, config.publicOrigin);
      const transaction = createTransaction(route.provider, returnTo);
      request.session.regenerate();
      request.session.set('oidcTransaction', transaction);

      try {
        const authorizationUrl = await client.getAuthorizationUrl(transaction);
        await reply.redirect(authorizationUrl, 302);
      } catch (error) {
        request.session.regenerate();
        request.log.error(
          {
            event: 'auth.login.start_failed',
            provider: route.provider,
            errorKind: classifyErrorKind(error),
            errorType: error instanceof Error ? error.name : 'UnknownError',
          },
          'Não foi possível iniciar a autenticação OIDC.'
        );
        await reply.redirect(
          errorRedirectLocation(transaction.returnTo, 'temporarily_unavailable'),
          303
        );
      }
    }
  );

  app.get<{ Querystring: CallbackQuery }>(
    route.callbackPath,
    { config: { rateLimit: AUTH_CALLBACK_RATE_LIMIT } },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const transaction = request.session.get('oidcTransaction');
      const code = request.query.code;
      const state = request.query.state;

      // O callback sempre abandona o cookie de transação antes de interpretar qualquer valor
      // fornecido pelo navegador. Assim, nenhum parâmetro decide se uma sessão será regenerada.
      request.session.regenerate();

      const transactionExpired =
        !transaction || Date.now() - transaction.createdAt > 10 * 60 * 1000;
      if (
        !client ||
        transactionExpired ||
        transaction.provider !== route.provider ||
        !state ||
        !AUTH_VALUE_PATTERN.test(state) ||
        !safeEqual(state, transaction.state)
      ) {
        await reply.redirect(
          errorRedirectLocation(transaction?.returnTo ?? '/', 'invalid_callback'),
          303
        );
        return;
      }

      if (request.query.error === 'access_denied') {
        await reply.redirect(errorRedirectLocation(transaction.returnTo, 'access_denied'), 303);
        return;
      }

      if (request.query.error !== undefined || !code) {
        await reply.redirect(errorRedirectLocation(transaction.returnTo, 'login_failed'), 303);
        return;
      }

      try {
        const identity = await client.exchangeAuthorizationCode({
          code,
          state,
          nonce: transaction.nonce,
          codeVerifier: transaction.codeVerifier,
          ...(typeof request.query.iss === 'string' && request.query.iss.length <= 2048
            ? { issuer: request.query.iss }
            : {}),
        });
        const returnTo = transaction.returnTo;
        request.session.set('identity', identity);
        request.log.info(
          { event: 'auth.login.completed', provider: route.provider },
          'Sessão OIDC criada.'
        );
        await reply.redirect(returnTo, 303);
      } catch (error) {
        request.log.warn(
          {
            event: 'auth.login.callback_failed',
            provider: route.provider,
            errorKind: classifyErrorKind(error),
            errorType: error instanceof Error ? error.name : 'UnknownError',
          },
          'A resposta OIDC foi rejeitada.'
        );
        await reply.redirect(errorRedirectLocation(transaction.returnTo, 'login_failed'), 303);
      }
    }
  );
}

export function registerAuthenticationRoutes(
  app: FastifyInstance,
  config: AppConfig,
  clients: OidcClients
): void {
  registerProviderRoutes(app, config, clients.entra, PROVIDER_ROUTES.entra);
  registerProviderRoutes(app, config, clients.google, PROVIDER_ROUTES.google);

  app.post(
    '/auth/logout',
    { config: { rateLimit: AUTH_LOGOUT_RATE_LIMIT } },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      request.session.delete();
      await reply.redirect('/', 303);
    }
  );
}
