/** Papéis atribuíveis a membros (a API rejeita 'owner' com 400). */
export type AssignableMemberRole = 'fiscal_admin' | 'mapper' | 'reviewer' | 'operator' | 'viewer';

/** Papel exibido: inclui 'owner', que pode aparecer na listagem mas não é editável. */
export type MemberRole = AssignableMemberRole | 'owner';

export type MemberStatus = 'active' | 'pending';

/** Para status 'pending', `userId` é o id do CONVITE (usar em PATCH/DELETE). */
export interface WorkspaceMember {
  userId: string;
  /** A API omite campos nulos: `displayName` e `email` podem faltar. */
  displayName?: string | null;
  email?: string | null;
  role: MemberRole;
  status: MemberStatus;
  createdAt: string;
}

export interface AddMemberRequest {
  email: string;
  role: AssignableMemberRole;
}

/** Visão sudo (somente leitura, prefixo /api/admin) — ainda sem UI nesta etapa. */
export interface AdminWorkspaceSummary {
  workspaceId: string;
  name: string;
  kind: string;
  ownerUserId: string;
  memberCount: number;
  createdAt: string;
}

export interface AdminUserSummary {
  userId: string;
  /** Ausente quando a pessoa nunca informou e-mail. */
  email?: string | null;
  workspaceCount: number;
  createdAt: string;
}

export interface AdminPageParams {
  skip?: number;
  take?: number;
}
