/** Papéis atribuíveis a membros (a API rejeita 'owner' com 400). */
export type AssignableMemberRole = 'fiscal_admin' | 'mapper' | 'reviewer' | 'operator' | 'viewer';

/** Papel exibido: inclui 'owner', que pode aparecer na listagem mas não é editável. */
export type MemberRole = AssignableMemberRole | 'owner';

export type MemberStatus = 'active' | 'pending';

/** Para status 'pending', `userId` é o id do CONVITE (usar em PATCH/DELETE). */
export interface WorkspaceMember {
  userId: string;
  displayName: string | null;
  email: string;
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
  email: string;
  workspaceCount: number;
  createdAt: string;
}

export interface AdminPageParams {
  skip?: number;
  take?: number;
}
