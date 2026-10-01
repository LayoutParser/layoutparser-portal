import type { MemberRole } from '../../types/member';

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Proprietário',
  fiscal_admin: 'Administrador fiscal',
  mapper: 'Mapeador',
  reviewer: 'Revisor',
  operator: 'Operador',
  viewer: 'Leitor',
};

/** Iniciais para o avatar: nome (2 palavras) ou, sem displayName, o começo do e-mail. */
export function initialsOf(
  displayName: string | null | undefined,
  email: string | null | undefined,
  userId?: string
): string {
  const source = displayName?.trim() || email?.split('@')[0] || email || userId || '?';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

export const NO_EMAIL_LABEL = 'sem e-mail';

/** Rótulo de pessoa: e-mail quando existe; senão o userId abreviado (e-mail pode faltar). */
export function emailOrId(person: { email?: string | null; userId: string }): string {
  return person.email?.trim() || `${NO_EMAIL_LABEL} · ${person.userId.slice(0, 8)}`;
}

/** Nome de exibição: displayName, e-mail ou userId abreviado. */
export function displayLabel(person: {
  displayName?: string | null;
  email?: string | null;
  userId: string;
}): string {
  return person.displayName?.trim() || emailOrId(person);
}
