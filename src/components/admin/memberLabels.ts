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
export function initialsOf(displayName: string | null | undefined, email: string): string {
  const source = displayName?.trim() || email.split('@')[0] || email;
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}
