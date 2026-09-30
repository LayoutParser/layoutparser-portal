import { isIP } from 'node:net';

const MEBIBYTE = 1024 * 1024;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const DOCUMENT_FIELD_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const CLIENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TENANT_ID_PATTERN =
  /^(?:common|organizations|consumers|[0-9a-f-]{36}|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)$/i;
// Google Client ID emitido pelo Google Cloud Console, ex.: 1234567890-abc123.apps.googleusercontent.com
const GOOGLE_CLIENT_ID_PATTERN = /^[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com$/i;
const DEFAULT_ADMIN_PATHS = [
  '/api/monitoring/*',
  '/api/ai-metrics/*',
  '/api/layoutdatabase/refresh-cache',
  '/api/metrics',
  // Visão sudo da API (somente leitura): exige admin do BFF além da checagem da própria API.
  '/api/admin',
  '/api/admin/*',
];

export type NodeEnvironment = 'development' | 'test' | 'production';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface EntraConfig {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authority: string;
  readonly redirectUri: string;
}

export interface GoogleConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface AppConfig {
  readonly nodeEnv: NodeEnvironment;
  readonly isProduction: boolean;
  readonly host: string;
  readonly port: number;
  readonly upstreamUrl: string;
  readonly requestLimitBytes: number;
  readonly documentLimitBytes: number;
  readonly documentField: string;
  readonly rateLimitMax: number;
  readonly rateLimitWindowMs: number;
  readonly trustedUserHeader: string;
  readonly trustedRolesHeader: string;
  readonly trustedIdentityProviderHeader: string;
  readonly trustedIdentitySubjectHeader: string;
  readonly trustedIdentityTenantHeader: string;
  readonly trustedIdentityEmailHeader: string;
  // Tenants Entra cujo claim de e-mail é confiável (CSV em minúsculas). Vazio = nunca confiar.
  readonly trustedEmailTenants: ReadonlySet<string>;
  readonly adminUsers: ReadonlySet<string>;
  readonly adminRoles: ReadonlySet<string>;
  readonly adminPaths: readonly string[];
  readonly developmentAuthEnabled: boolean;
  readonly developmentUserHeader: string;
  readonly developmentRolesHeader: string;
  readonly publicOrigin: string;
  readonly sessionTtlSeconds: number;
  readonly entra: EntraConfig | null;
  readonly google: GoogleConfig | null;
  readonly logLevel: LogLevel;
  readonly dnsServers: readonly string[];
}

export class ConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function parseNodeEnvironment(value: string | undefined): NodeEnvironment {
  const environment = value?.trim() || 'development';
  if (environment !== 'development' && environment !== 'test' && environment !== 'production') {
    throw new ConfigError('NODE_ENV deve ser development, test ou production.');
  }

  return environment;
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum = 1,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  if (!/^\d+$/.test(value.trim())) {
    throw new ConfigError(`${name} deve ser um número inteiro.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigError(`${name} deve estar entre ${minimum} e ${maximum}.`);
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new ConfigError(`${name} deve ser true ou false.`);
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parseHeaderName(value: string | undefined, fallback: string, name: string): string {
  const header = value?.trim().toLowerCase() || fallback;
  if (!HEADER_NAME_PATTERN.test(header)) {
    throw new ConfigError(`${name} contém um nome de header inválido.`);
  }

  return header;
}

function parseUpstreamUrl(value: string | undefined, isProduction: boolean): string {
  if (isProduction && !value?.trim()) {
    throw new ConfigError('LAYOUTPARSER_API_URL é obrigatória em produção.');
  }

  let url: URL;
  try {
    url = new URL(value?.trim() || 'http://127.0.0.1:5000');
  } catch {
    throw new ConfigError('LAYOUTPARSER_API_URL deve ser uma URL HTTP(S) válida.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError('LAYOUTPARSER_API_URL deve usar HTTP ou HTTPS.');
  }

  if (url.username || url.password) {
    throw new ConfigError('LAYOUTPARSER_API_URL não pode conter credenciais.');
  }

  if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new ConfigError(
      'LAYOUTPARSER_API_URL deve conter apenas a origem, sem path, query ou hash.'
    );
  }

  const isLoopback =
    url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1';
  if (isProduction && url.protocol !== 'https:' && !isLoopback) {
    throw new ConfigError('Em produção, um upstream remoto deve usar HTTPS.');
  }

  return url.origin;
}

function parseAdminPaths(value: string | undefined): readonly string[] {
  const paths = parseCsv(value);
  const selected = paths.length > 0 ? paths : DEFAULT_ADMIN_PATHS;

  for (const path of selected) {
    const wildcardCount = [...path].filter(character => character === '*').length;
    if (
      !path.startsWith('/api/') ||
      wildcardCount > 1 ||
      (wildcardCount === 1 && !path.endsWith('/*'))
    ) {
      throw new ConfigError(`BFF_ADMIN_PATHS contém padrão inválido: ${path}.`);
    }
  }

  return selected.map(path => path.toLowerCase());
}

function parseLogLevel(value: string | undefined): LogLevel {
  const selected = value?.trim() || 'info';
  const levels: readonly LogLevel[] = [
    'fatal',
    'error',
    'warn',
    'info',
    'debug',
    'trace',
    'silent',
  ];
  if (!levels.includes(selected as LogLevel)) {
    throw new ConfigError('BFF_LOG_LEVEL é inválido.');
  }

  return selected as LogLevel;
}

// Servidores DNS fixos, opcionais, usados para contornar a resolução multi-homed lenta do SO em
// hosts com múltiplas interfaces de rede ativas (ver server/src/dnsOverride.ts). Sem a variável,
// o comportamento padrão do Node é mantido — só afeta hosts explicitamente configurados.
function parseDnsServers(value: string | undefined): readonly string[] {
  const servers = parseCsv(value);
  for (const server of servers) {
    if (isIP(server) === 0) {
      throw new ConfigError(`BFF_DNS_SERVERS contém um endereço IP inválido: ${server}.`);
    }
  }

  return servers;
}

function lowercaseSet(values: readonly string[]): ReadonlySet<string> {
  return new Set(values.map(value => value.toLocaleLowerCase('en-US')));
}

function parsePublicOrigin(value: string | undefined, isProduction: boolean): string {
  const selected = value?.trim() || (isProduction ? '' : 'http://localhost:3000');
  if (!selected) {
    throw new ConfigError('BFF_PUBLIC_ORIGIN é obrigatória em produção.');
  }

  let url: URL;
  try {
    url = new URL(selected);
  } catch {
    throw new ConfigError('BFF_PUBLIC_ORIGIN deve ser uma origem HTTP(S) válida.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError('BFF_PUBLIC_ORIGIN deve usar HTTP ou HTTPS.');
  }

  if (isProduction && url.protocol !== 'https:') {
    throw new ConfigError('BFF_PUBLIC_ORIGIN deve usar HTTPS em produção.');
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new ConfigError(
      'BFF_PUBLIC_ORIGIN deve conter somente a origem, sem credenciais ou path.'
    );
  }

  return url.origin;
}

function parseEntraConfig(
  environment: NodeJS.ProcessEnv,
  publicOrigin: string,
  isProduction: boolean
): EntraConfig | null {
  const tenantId = environment.ENTRA_TENANT_ID?.trim() ?? '';
  const clientId = environment.ENTRA_CLIENT_ID?.trim() ?? '';
  const clientSecret = environment.ENTRA_CLIENT_SECRET ?? '';
  const hasAnyValue = Boolean(tenantId || clientId || clientSecret.trim());

  if (!hasAnyValue && !isProduction) {
    return null;
  }

  if (!tenantId) {
    throw new ConfigError('ENTRA_TENANT_ID é obrigatória quando OIDC está habilitado.');
  }
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new ConfigError('ENTRA_TENANT_ID possui formato inválido.');
  }
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    throw new ConfigError('ENTRA_CLIENT_ID deve ser o Application (client) ID em formato GUID.');
  }
  if (clientSecret.trim().length < 16) {
    throw new ConfigError('ENTRA_CLIENT_SECRET está ausente ou é curto demais.');
  }

  return {
    tenantId,
    clientId,
    clientSecret,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: `${publicOrigin}/auth/callback`,
  };
}

function parseGoogleConfig(
  environment: NodeJS.ProcessEnv,
  publicOrigin: string
): GoogleConfig | null {
  const clientId = environment.GOOGLE_CLIENT_ID?.trim() ?? '';
  const clientSecret = environment.GOOGLE_CLIENT_SECRET ?? '';
  const hasAnyValue = Boolean(clientId || clientSecret.trim());

  // Google é um provedor alternativo ao Entra: opcional em qualquer ambiente, inclusive em
  // produção. Se nenhuma variável for informada, a rota /auth/google/login responde 503.
  if (!hasAnyValue) {
    return null;
  }

  if (!GOOGLE_CLIENT_ID_PATTERN.test(clientId)) {
    throw new ConfigError(
      'GOOGLE_CLIENT_ID deve ser o Client ID emitido pelo Google Cloud Console (*.apps.googleusercontent.com).'
    );
  }
  if (clientSecret.trim().length < 16) {
    throw new ConfigError('GOOGLE_CLIENT_SECRET está ausente ou é curto demais.');
  }

  return {
    clientId,
    clientSecret,
    redirectUri: `${publicOrigin}/auth/google/callback`,
  };
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = parseNodeEnvironment(environment.NODE_ENV);
  const isProduction = nodeEnv === 'production';
  const host = environment.BFF_HOST?.trim() || '127.0.0.1';
  const port = parseInteger(environment.BFF_PORT, 3100, 'BFF_PORT', 1, 65_535);
  const requestLimitMiB = parseInteger(
    environment.BFF_REQUEST_LIMIT_MIB,
    32,
    'BFF_REQUEST_LIMIT_MIB',
    1,
    1024
  );
  const documentLimitMiB = parseInteger(
    environment.BFF_DOCUMENT_LIMIT_MIB,
    25,
    'BFF_DOCUMENT_LIMIT_MIB',
    1,
    1024
  );
  const documentField = environment.BFF_DOCUMENT_FIELD?.trim() || 'txtFile';
  const trustedUserHeader = parseHeaderName(
    environment.BFF_TRUSTED_USER_HEADER,
    'x-iis-user',
    'BFF_TRUSTED_USER_HEADER'
  );
  const trustedRolesHeader = parseHeaderName(
    environment.BFF_TRUSTED_ROLES_HEADER,
    'x-iis-roles',
    'BFF_TRUSTED_ROLES_HEADER'
  );
  const trustedIdentityProviderHeader = parseHeaderName(
    environment.BFF_TRUSTED_IDENTITY_PROVIDER_HEADER,
    'x-layoutparser-identity-provider',
    'BFF_TRUSTED_IDENTITY_PROVIDER_HEADER'
  );
  const trustedIdentitySubjectHeader = parseHeaderName(
    environment.BFF_TRUSTED_IDENTITY_SUBJECT_HEADER,
    'x-layoutparser-identity-subject',
    'BFF_TRUSTED_IDENTITY_SUBJECT_HEADER'
  );
  const trustedIdentityTenantHeader = parseHeaderName(
    environment.BFF_TRUSTED_IDENTITY_TENANT_HEADER,
    'x-layoutparser-identity-tenant',
    'BFF_TRUSTED_IDENTITY_TENANT_HEADER'
  );
  const trustedIdentityEmailHeader = parseHeaderName(
    environment.BFF_TRUSTED_IDENTITY_EMAIL_HEADER,
    'x-layoutparser-identity-email',
    'BFF_TRUSTED_IDENTITY_EMAIL_HEADER'
  );
  const trustedIdentityHeaders = [
    trustedUserHeader,
    trustedRolesHeader,
    trustedIdentityProviderHeader,
    trustedIdentitySubjectHeader,
    trustedIdentityTenantHeader,
    trustedIdentityEmailHeader,
  ];
  if (new Set(trustedIdentityHeaders).size !== trustedIdentityHeaders.length) {
    throw new ConfigError('Os headers confiáveis de identidade precisam ter nomes distintos.');
  }
  const developmentAuthEnabled = parseBoolean(
    environment.BFF_DEV_AUTH_ENABLED,
    false,
    'BFF_DEV_AUTH_ENABLED'
  );
  const adminUsers = lowercaseSet(parseCsv(environment.BFF_ADMIN_USERS));
  const adminRoles = lowercaseSet(parseCsv(environment.BFF_ADMIN_ROLES));
  const upstreamUrl = parseUpstreamUrl(environment.LAYOUTPARSER_API_URL, isProduction);
  const publicOrigin = parsePublicOrigin(environment.BFF_PUBLIC_ORIGIN, isProduction);
  const entra = parseEntraConfig(environment, publicOrigin, isProduction);
  const google = parseGoogleConfig(environment, publicOrigin);

  if (!DOCUMENT_FIELD_PATTERN.test(documentField)) {
    throw new ConfigError('BFF_DOCUMENT_FIELD contém um nome de campo inválido.');
  }

  if (documentLimitMiB > requestLimitMiB) {
    throw new ConfigError('BFF_DOCUMENT_LIMIT_MIB não pode exceder BFF_REQUEST_LIMIT_MIB.');
  }

  if (isProduction) {
    if (host !== '127.0.0.1' && host !== '::1') {
      throw new ConfigError('Em produção, BFF_HOST deve apontar para loopback (127.0.0.1 ou ::1).');
    }

    if (developmentAuthEnabled) {
      throw new ConfigError('BFF_DEV_AUTH_ENABLED não pode ser true em produção.');
    }

    if (adminUsers.size === 0 && adminRoles.size === 0) {
      throw new ConfigError('Configure BFF_ADMIN_USERS e/ou BFF_ADMIN_ROLES em produção.');
    }
  }

  return {
    nodeEnv,
    isProduction,
    host,
    port,
    upstreamUrl,
    requestLimitBytes: requestLimitMiB * MEBIBYTE,
    documentLimitBytes: documentLimitMiB * MEBIBYTE,
    documentField,
    rateLimitMax: parseInteger(
      environment.BFF_RATE_LIMIT_MAX,
      120,
      'BFF_RATE_LIMIT_MAX',
      1,
      1_000_000
    ),
    rateLimitWindowMs: parseInteger(
      environment.BFF_RATE_LIMIT_WINDOW_MS,
      60_000,
      'BFF_RATE_LIMIT_WINDOW_MS',
      1000,
      86_400_000
    ),
    trustedUserHeader,
    trustedRolesHeader,
    trustedIdentityProviderHeader,
    trustedIdentitySubjectHeader,
    trustedIdentityTenantHeader,
    trustedIdentityEmailHeader,
    trustedEmailTenants: lowercaseSet(parseCsv(environment.BFF_TRUSTED_EMAIL_TENANTS)),
    adminUsers,
    adminRoles,
    adminPaths: parseAdminPaths(environment.BFF_ADMIN_PATHS),
    developmentAuthEnabled,
    developmentUserHeader: parseHeaderName(
      environment.BFF_DEV_USER_HEADER,
      'x-dev-user',
      'BFF_DEV_USER_HEADER'
    ),
    developmentRolesHeader: parseHeaderName(
      environment.BFF_DEV_ROLES_HEADER,
      'x-dev-roles',
      'BFF_DEV_ROLES_HEADER'
    ),
    publicOrigin,
    sessionTtlSeconds: parseInteger(
      environment.BFF_SESSION_TTL_SECONDS,
      28_800,
      'BFF_SESSION_TTL_SECONDS',
      300,
      86_400
    ),
    entra,
    google,
    logLevel: parseLogLevel(environment.BFF_LOG_LEVEL),
    dnsServers: parseDnsServers(environment.BFF_DNS_SERVERS),
  };
}
