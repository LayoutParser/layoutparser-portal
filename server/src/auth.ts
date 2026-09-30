import type {
  FastifyReply,
  FastifyRequest,
  RawServerBase,
  RequestGenericInterface,
  RouteGenericInterface,
} from 'fastify';

import type { AppConfig } from './config.js';

export interface AuthenticatedIdentity {
  readonly provider: AuthProvider | 'development';
  readonly name: string;
  readonly roles: readonly string[];
  readonly subject: string;
  readonly tenantId?: string;
  // E-mail já verificado pelo provedor (ver oidc.ts). Ausente = não confiável.
  readonly email?: string;
  readonly isAdmin: boolean;
}

export type AuthProvider = 'entra' | 'google';

export interface SessionIdentity {
  readonly provider: AuthProvider;
  readonly name: string;
  readonly roles: readonly string[];
  readonly subject: string;
  // Específico do Entra (tenant do diretório). Login via Google não preenche este campo.
  readonly tenantId?: string;
  // Só preenchido quando o provedor garante a verificação do e-mail.
  readonly email?: string;
}

type AnyFastifyRequest = FastifyRequest<RequestGenericInterface, RawServerBase>;
type AnyFastifyReply = FastifyReply<RouteGenericInterface, RawServerBase>;

const EMAIL_PATTERN = /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[^\s@,;<>()"]+$/;

// Normaliza (trim + minúsculas) e valida o formato; devolve null se inválido. Nunca logar o valor.
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const email = value.trim().toLocaleLowerCase('en-US');
  // ASCII imprimível apenas: o valor vai num header HTTP e o Node rejeita bytes fora de Latin-1.
  return email.length <= 320 && /^[\x21-\x7e]+$/.test(email) && EMAIL_PATTERN.test(email)
    ? email
    : null;
}

function isSafeIdentityValue(value: string): boolean {
  if (value.length === 0 || value.length > 256) {
    return false;
  }

  return [...value].every(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 31 && codePoint !== 127;
  });
}

function readSafeHeader(request: AnyFastifyRequest, name: string): string | null {
  const rawValue = request.headers[name];
  if (rawValue === undefined || Array.isArray(rawValue)) {
    return null;
  }

  const value = rawValue.trim();
  return isSafeIdentityValue(value) ? value : null;
}

function parseRoles(value: string | null): readonly string[] {
  if (!value) {
    return [];
  }

  return [
    ...new Set(
      value
        .split(/[;,]/)
        .map(role => role.trim())
        .filter(Boolean)
    ),
  ].slice(0, 50);
}

// No Google o `name` é o display name da conta, editável por qualquer pessoa: usá-lo para conceder
// admin permitiria a qualquer usuário se passar por um admin só renomeando a própria conta. Para o
// Google, portanto, só vale o e-mail verificado (SessionIdentity.email) ou os papéis. No Entra o
// `name` continua sendo o preferred_username (comportamento existente).
function calculateIsAdmin(
  identity: { provider: string; name: string; email?: string },
  roles: readonly string[],
  config: AppConfig
): boolean {
  const adminKey = identity.provider === 'google' ? identity.email : identity.name;
  if (adminKey && config.adminUsers.has(adminKey.toLocaleLowerCase('en-US'))) {
    return true;
  }

  return roles.some(role => config.adminRoles.has(role.toLocaleLowerCase('en-US')));
}

export function resolveIdentity(
  request: AnyFastifyRequest,
  config: AppConfig
): AuthenticatedIdentity | null {
  const sessionIdentity = request.session.get('identity');
  if (
    sessionIdentity &&
    typeof sessionIdentity.name === 'string' &&
    typeof sessionIdentity.subject === 'string' &&
    (sessionIdentity.provider === 'entra' || sessionIdentity.provider === 'google') &&
    (sessionIdentity.tenantId === undefined ||
      (typeof sessionIdentity.tenantId === 'string' &&
        isSafeIdentityValue(sessionIdentity.tenantId))) &&
    (sessionIdentity.email === undefined || typeof sessionIdentity.email === 'string') &&
    Array.isArray(sessionIdentity.roles) &&
    isSafeIdentityValue(sessionIdentity.name) &&
    isSafeIdentityValue(sessionIdentity.subject)
  ) {
    const roles = sessionIdentity.roles
      .filter((role): role is string => typeof role === 'string' && isSafeIdentityValue(role))
      .slice(0, 50);
    const email = normalizeEmail(sessionIdentity.email);
    return {
      provider: sessionIdentity.provider,
      name: sessionIdentity.name,
      roles,
      subject: sessionIdentity.subject,
      ...(sessionIdentity.tenantId ? { tenantId: sessionIdentity.tenantId } : {}),
      ...(email ? { email } : {}),
      isAdmin: calculateIsAdmin(
        {
          provider: sessionIdentity.provider,
          name: sessionIdentity.name,
          ...(email ? { email } : {}),
        },
        roles,
        config
      ),
    };
  }

  if (config.isProduction || !config.developmentAuthEnabled) {
    return null;
  }

  const name = readSafeHeader(request, config.developmentUserHeader);
  if (!name) {
    return null;
  }

  const roles = parseRoles(readSafeHeader(request, config.developmentRolesHeader));
  return {
    provider: 'development',
    name,
    roles,
    // Identidade sintética limitada ao desenvolvimento. Produção nunca entra neste ramo.
    subject: name,
    isAdmin: calculateIsAdmin({ provider: 'development', name }, roles, config),
  };
}

export function canonicalizePath(rawUrl: string): string {
  try {
    const pathname = new URL(rawUrl, 'http://bff.local').pathname;
    let decoded = pathname;
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    }
    return decoded.replace(/\/{2,}/g, '/').toLocaleLowerCase('en-US');
  } catch {
    return '/invalid-path';
  }
}

export function isAdministrativePath(rawUrl: string, patterns: readonly string[]): boolean {
  const path = canonicalizePath(rawUrl);
  return patterns.some(pattern => {
    if (!pattern.endsWith('/*')) {
      return path === pattern;
    }

    const prefix = pattern.slice(0, -1);
    return path.startsWith(prefix);
  });
}

export async function authorizeProxyRequest(
  request: AnyFastifyRequest,
  reply: AnyFastifyReply,
  config: AppConfig
): Promise<void> {
  if (!request.identity) {
    await reply.code(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Autenticação obrigatória.',
      correlationId: request.id,
    });
    return;
  }

  if (
    isAdministrativePath(request.raw.url ?? request.url, config.adminPaths) &&
    !request.identity.isAdmin
  ) {
    await reply.code(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Acesso administrativo não autorizado.',
      correlationId: request.id,
    });
  }
}
