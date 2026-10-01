import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { adminDirectoryService } from '../../services/api/adminDirectoryService';
import { PERSONAL_MESSAGE } from '../../services/api/workspaceMemberService';
import { ADMIN_USERS_PAGE_SIZE, useAdminDirectoryStore } from '../../store/useAdminDirectoryStore';
import { useWorkspaceMembersStore } from '../../store/useWorkspaceMembersStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import type {
  AssignableMemberRole,
  MemberRole,
  MemberStatus,
  WorkspaceMember,
} from '../../types/member';
import Button from '../shared/Button';
import Modal from '../shared/Modal';
import { Avatar, RoleChip, StatusChip } from './MemberChips';
import { ROLE_LABELS } from './memberLabels';
import './UsersTab.css';

const ASSIGNABLE_ROLES: AssignableMemberRole[] = [
  'fiscal_admin',
  'mapper',
  'reviewer',
  'operator',
  'viewer',
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email: string): string | null {
  if (!email) return 'Informe o e-mail da pessoa.';
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) return 'Informe um e-mail válido.';
  return null;
}

const KIND_LABELS: Record<string, string> = {
  personal: 'pessoal',
  team: 'time',
  organization: 'organização',
};

interface TargetWorkspace {
  workspaceId: string;
  name: string;
  kind: string;
}

function RegisteredUsers({ onPick }: { onPick: (email: string) => void }) {
  const { users, usersStatus, usersSkip, usersHasNext, usersError, usersUnavailable, loadUsers } =
    useAdminDirectoryStore();
  const [query, setQuery] = useState('');
  const loading = usersStatus === 'idle' || usersStatus === 'loading';
  // A API não filtra por e-mail: a busca vale para a página carregada.
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? users.filter(user => user.email.toLowerCase().includes(term)) : users;
  }, [users, query]);

  return (
    <section
      className="users-tab__card users-tab__directory"
      aria-labelledby="users-directory-title"
      aria-busy={loading}
    >
      <header className="users-tab__card-header">
        <div>
          <h3 id="users-directory-title">Usuários cadastrados</h3>
          <p className="users-tab__hint">
            Visão de administrador: todos os usuários da plataforma.
          </p>
        </div>
        <div className="users-tab__field users-tab__search">
          <label htmlFor="directory-search">Buscar usuário por e-mail</label>
          <input
            id="directory-search"
            type="search"
            placeholder="Buscar nesta página"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </div>
      </header>
      {loading && <SkeletonRows label="Carregando usuários…" columns={3} />}
      {usersStatus === 'error' && (
        <p role="alert" className="users-tab__alert users-tab__state">
          {usersUnavailable ? 'Recurso ainda indisponível' : usersError}
          <Button variant="secondary" onClick={() => void loadUsers(usersSkip)}>
            Tentar novamente
          </Button>
        </p>
      )}
      {usersStatus === 'ready' && users.length === 0 && (
        <p className="users-tab__state">Nenhum usuário cadastrado.</p>
      )}
      {usersStatus === 'ready' && users.length > 0 && visible.length === 0 && (
        <p className="users-tab__state">Nenhum usuário nesta página corresponde à busca.</p>
      )}
      {usersStatus === 'ready' && visible.length > 0 && (
        <div className="users-tab__table-wrap">
          <table className="users-tab__table">
            <caption className="users-tab__sr-only">Usuários cadastrados</caption>
            <thead>
              <tr>
                <th scope="col">E-mail</th>
                <th scope="col">Workspaces</th>
                <th scope="col">Cadastrado em</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(user => (
                <tr key={user.userId}>
                  <td>
                    <span className="users-tab__identity">
                      <Avatar email={user.email} />
                      <button
                        type="button"
                        className="users-tab__link"
                        title="Convidar este e-mail para o workspace selecionado"
                        onClick={() => onPick(user.email)}
                      >
                        {user.email}
                      </button>
                    </span>
                  </td>
                  <td>{user.workspaceCount}</td>
                  <td>{new Date(user.createdAt).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="users-tab__pager">
        <span className="users-tab__count" aria-live="polite">
          {usersStatus === 'ready'
            ? `Exibindo ${users.length === 0 ? 0 : usersSkip + 1}–${usersSkip + users.length}`
            : ''}
        </span>
        <Button
          variant="secondary"
          disabled={loading || usersSkip === 0}
          onClick={() => void loadUsers(Math.max(0, usersSkip - ADMIN_USERS_PAGE_SIZE))}
        >
          Anterior
        </Button>
        <Button
          variant="secondary"
          disabled={loading || !usersHasNext}
          onClick={() => void loadUsers(usersSkip + ADMIN_USERS_PAGE_SIZE)}
        >
          Próxima
        </Button>
      </footer>
    </section>
  );
}

/** Linhas fantasma durante o carregamento; o texto fica só para leitores de tela. */
function SkeletonRows({ label, columns }: { label: string; columns: number }) {
  return (
    <div className="users-tab__skeleton" role="status">
      <span className="users-tab__sr-only">{label}</span>
      {[0, 1, 2, 3].map(row => (
        <div key={row} className="users-tab__skeleton-row" aria-hidden="true">
          {Array.from({ length: columns }, (_, col) => (
            <span key={col} className="users-tab__skeleton-cell" />
          ))}
        </div>
      ))}
    </div>
  );
}

const NAME_MAX = 120;

function validateWorkspaceName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > NAME_MAX) {
    return `Informe um nome de 1 a ${NAME_MAX} caracteres.`;
  }
  for (const char of trimmed) {
    const code = char.charCodeAt(0);
    if (code < 32 || (code >= 127 && code <= 159)) {
      return 'O nome não pode conter caracteres de controle.';
    }
  }
  return null;
}

interface PromoteProps {
  workspace: TargetWorkspace;
  onPromoted: () => Promise<void> | void;
}

/** Bloco sudo: promove workspace pessoal a time (irreversível), com confirmação em modal. */
function PromoteWorkspaceBlock({ workspace, onPromoted }: PromoteProps) {
  const [name, setName] = useState(workspace.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const requestConfirmation = () => {
    const problem = validateWorkspaceName(name);
    setNameError(problem);
    if (!problem) setConfirming(true);
  };

  const confirm = async () => {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      await adminDirectoryService.promoteWorkspace(workspace.workspaceId, { name: name.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível promover o workspace.');
      setBusy(false);
      return;
    }
    setBusy(false);
    await onPromoted();
  };

  return (
    <section className="users-tab__promote" aria-labelledby="promote-title" aria-busy={busy}>
      <h3 id="promote-title">Transformar em workspace de time</h3>
      <p>
        Este workspace ainda é pessoal e não aceita membros. Promova-o a workspace de time para
        cadastrar pessoas. Dono, dados e histórico são mantidos; a ação não pode ser desfeita.
      </p>
      <div className="users-tab__field">
        <label htmlFor="promote-name">Nome do workspace</label>
        <input
          id="promote-name"
          type="text"
          value={name}
          onChange={event => setName(event.target.value)}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? 'promote-name-error' : undefined}
        />
        {nameError && (
          <span id="promote-name-error" className="users-tab__field-error">
            {nameError}
          </span>
        )}
      </div>
      <Button disabled={busy} onClick={requestConfirmation}>
        Promover a workspace de time
      </Button>
      {error && (
        <p role="alert" className="users-tab__alert">
          {error}
        </p>
      )}
      <Modal
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        title="Promover a workspace de time"
        size="small"
        initialFocusRef={cancelRef}
      >
        <p>
          {`Promover "${name.trim()}" a workspace de time? Dono, dados e histórico são mantidos; a ação não pode ser desfeita.`}
        </p>
        <div className="users-tab__modal-actions">
          <button
            type="button"
            ref={cancelRef}
            className="btn btn-secondary"
            onClick={() => setConfirming(false)}
          >
            Cancelar
          </button>
          <Button onClick={() => void confirm()}>Promover</Button>
        </div>
      </Modal>
    </section>
  );
}

const UsersTab = () => {
  const activeWorkspace = useWorkspaceStore(state =>
    state.workspaces.find(item => item.workspaceId === state.activeWorkspaceId)
  );
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const admin = useAdminDirectoryStore();
  const workspaceIsSudo = useWorkspaceStore(state => state.isSudo);
  const workspaceStatusForSudo = useWorkspaceStore(state => state.status);
  // `isSudo` de /me é a fonte quando definido; senão vale o probe (derivado, sem cópia).
  const isSudo = workspaceIsSudo ?? admin.sudo === 'yes';
  const [promoted, setPromoted] = useState(false);
  const { detectSudo, loadWorkspaces: loadAdminWorkspaces, loadUsers } = admin;

  // Sudo: alvo = workspace escolhido (padrão: o ativo, se listado, senão o primeiro).
  const adminTarget: TargetWorkspace | undefined = isSudo
    ? (admin.workspaces.find(item => item.workspaceId === admin.selectedWorkspaceId) ??
      admin.workspaces.find(item => item.workspaceId === activeWorkspaceId) ??
      admin.workspaces[0])
    : undefined;
  const workspace: TargetWorkspace | undefined = isSudo ? adminTarget : activeWorkspace;
  const workspaceStatus = useWorkspaceStore(state => state.status);
  const workspaceError = useWorkspaceStore(state => state.error);
  const loadWorkspaces = useWorkspaceStore(state => state.loadWorkspaces);
  const store = useWorkspaceMembersStore();
  const { status, members, error, unavailable, actionError, notice, busy } = store;

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableMemberRole>('viewer');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<WorkspaceMember | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | MemberRole>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | MemberStatus>('all');
  const emailRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const workspaceId = workspace?.workspaceId;
  const isPersonal = workspace?.kind === 'personal';
  const skipMembers = isPersonal && !isSudo;
  const loadMembers = useWorkspaceMembersStore(state => state.loadMembers);

  // O MainLayout só carrega os workspaces em /workspace; em /admin a aba precisa pedi-los
  // sozinha (a chamada é idempotente: ignora se já estiver carregando ou pronto).
  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  // Só sonda quando /me já respondeu sem `isSudo` (API antiga) ou falhou.
  const meSettled = workspaceStatusForSudo === 'ready' || workspaceStatusForSudo === 'error';
  useEffect(() => {
    if (meSettled && workspaceIsSudo === undefined) void detectSudo();
  }, [meSettled, workspaceIsSudo, detectSudo]);

  useEffect(() => {
    if (isSudo) {
      void loadAdminWorkspaces();
      void loadUsers(0);
    }
  }, [isSudo, loadAdminWorkspaces, loadUsers]);

  useEffect(() => {
    if (workspaceId && !skipMembers) {
      void loadMembers(workspaceId, isSudo);
    }
  }, [workspaceId, skipMembers, isSudo, loadMembers]);

  const filteredMembers = useMemo(() => {
    const term = query.trim().toLowerCase();
    return members.filter(
      member =>
        (roleFilter === 'all' || member.role === roleFilter) &&
        (statusFilter === 'all' || member.status === statusFilter) &&
        (!term ||
          member.email.toLowerCase().includes(term) ||
          (member.displayName ?? '').toLowerCase().includes(term))
    );
  }, [members, query, roleFilter, statusFilter]);
  const filtersActive = query.trim() !== '' || roleFilter !== 'all' || statusFilter !== 'all';

  const title = workspace ? `Usuários de ${workspace.name}` : 'Usuários';

  if (!workspace) {
    const loadingWorkspaces = isSudo
      ? admin.workspacesStatus === 'idle' || admin.workspacesStatus === 'loading'
      : workspaceStatus === 'idle' || workspaceStatus === 'loading';
    const loadError = isSudo ? admin.workspacesError : workspaceError;
    const failed = isSudo ? admin.workspacesStatus === 'error' : workspaceStatus === 'error';
    return (
      <section
        className="users-tab"
        aria-labelledby="users-tab-title"
        aria-busy={loadingWorkspaces}
      >
        <h2 id="users-tab-title">{title}</h2>
        {loadingWorkspaces && <p>Carregando workspaces…</p>}
        {failed && <p role="alert">{loadError ?? 'Não foi possível carregar os workspaces.'}</p>}
        {!loadingWorkspaces && !failed && <p>Nenhum workspace ativo.</p>}
      </section>
    );
  }

  if (skipMembers) {
    return (
      <section className="users-tab" aria-labelledby="users-tab-title">
        <h2 id="users-tab-title">{title}</h2>
        <p>Workspaces pessoais não têm membros. Gestão de membros vale para workspaces de time.</p>
      </section>
    );
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    const problem = validateEmail(normalized);
    setEmailError(problem);
    if (problem) return;
    const ok = await store.addMember(
      workspace.workspaceId,
      { email: normalized, role },
      isPersonal
    );
    if (ok) {
      setEmail('');
      setInviteOpen(false);
    }
  };

  const confirmRemoval = async () => {
    if (!pendingRemoval) return;
    const target = pendingRemoval;
    setPendingRemoval(null);
    await store.removeMember(workspace.workspaceId, target);
  };

  const closeModal = () => setPendingRemoval(null);
  const pendingInvite = pendingRemoval?.status === 'pending';

  return (
    <section
      className="users-tab"
      aria-labelledby="users-tab-title"
      aria-busy={status === 'loading'}
    >
      <h2 id="users-tab-title">{title}</h2>

      {isSudo && (
        <div className="users-tab__field users-tab__workspace-select">
          <label htmlFor="admin-workspace">Workspace</label>
          <select
            id="admin-workspace"
            value={workspace.workspaceId}
            onChange={event => {
              setPromoted(false);
              admin.selectWorkspace(event.target.value);
            }}
          >
            {admin.workspaces.map(item => (
              <option key={item.workspaceId} value={item.workspaceId}>
                {`${item.name} (${KIND_LABELS[item.kind] ?? item.kind}, ${item.memberCount} ${
                  item.memberCount === 1 ? 'membro' : 'membros'
                })`}
              </option>
            ))}
          </select>
        </div>
      )}

      {promoted && (
        <p role="status" className="users-tab__notice">
          Workspace promovido a time.
        </p>
      )}
      {isSudo && isPersonal && <p role="status">{PERSONAL_MESSAGE}</p>}
      {isSudo && isPersonal && (
        <PromoteWorkspaceBlock
          key={workspace.workspaceId}
          workspace={workspace}
          onPromoted={async () => {
            setPromoted(true);
            await Promise.all([loadWorkspaces(true), loadAdminWorkspaces()]);
          }}
        />
      )}

      {unavailable ? (
        <p role="alert" className="users-tab__alert">
          Recurso ainda indisponível. Tente novamente mais tarde.
        </p>
      ) : (
        <section className="users-tab__card" aria-label="Membros do workspace">
          <header className="users-tab__toolbar">
            <div className="users-tab__field users-tab__search">
              <label htmlFor="member-search">Buscar membro</label>
              <input
                id="member-search"
                type="search"
                placeholder="E-mail ou nome"
                value={query}
                onChange={event => setQuery(event.target.value)}
              />
            </div>
            <div className="users-tab__field">
              <label htmlFor="member-role-filter">Filtrar por papel</label>
              <select
                id="member-role-filter"
                value={roleFilter}
                onChange={event => setRoleFilter(event.target.value as 'all' | MemberRole)}
              >
                <option value="all">Todos os papéis</option>
                <option value="owner">{ROLE_LABELS.owner}</option>
                {ASSIGNABLE_ROLES.map(item => (
                  <option key={item} value={item}>
                    {ROLE_LABELS[item]}
                  </option>
                ))}
              </select>
            </div>
            <div className="users-tab__field">
              <label htmlFor="member-status-filter">Filtrar por status</label>
              <select
                id="member-status-filter"
                value={statusFilter}
                onChange={event => setStatusFilter(event.target.value as 'all' | MemberStatus)}
              >
                <option value="all">Todos os status</option>
                <option value="active">Ativos</option>
                <option value="pending">Convites pendentes</option>
              </select>
            </div>
            <div className="users-tab__toolbar-action">
              <Button onClick={() => setInviteOpen(true)}>Adicionar membro</Button>
            </div>
          </header>

          {notice && (
            <p role="status" className="users-tab__notice">
              {notice}
            </p>
          )}
          {actionError && !inviteOpen && (
            <p role="alert" className="users-tab__alert">
              {actionError}
            </p>
          )}

          {status === 'loading' && <SkeletonRows label="Carregando membros…" columns={4} />}
          {status === 'error' && (
            <p role="alert" className="users-tab__alert users-tab__state">
              {error}
              <Button
                variant="secondary"
                onClick={() => void loadMembers(workspace.workspaceId, isSudo)}
              >
                Tentar novamente
              </Button>
            </p>
          )}
          {status === 'ready' && members.length <= 1 && members.every(m => m.role === 'owner') && (
            <p className="users-tab__state">Só você está neste workspace. Convide alguém.</p>
          )}
          {status === 'ready' && members.length > 0 && filteredMembers.length === 0 && (
            <p className="users-tab__state">
              Nenhum membro corresponde aos filtros.{' '}
              {filtersActive && (
                <button
                  type="button"
                  className="users-tab__link"
                  onClick={() => {
                    setQuery('');
                    setRoleFilter('all');
                    setStatusFilter('all');
                  }}
                >
                  Limpar filtros
                </button>
              )}
            </p>
          )}
          {status === 'ready' && filteredMembers.length > 0 && (
            <div className="users-tab__table-wrap">
              <table className="users-tab__table">
                <caption className="users-tab__sr-only">Membros de {workspace.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Membro</th>
                    <th scope="col">Papel</th>
                    <th scope="col">Status</th>
                    <th scope="col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map(member => (
                    <tr key={`${member.status}-${member.userId}`}>
                      <td>
                        <span className="users-tab__identity">
                          <Avatar displayName={member.displayName} email={member.email} />
                          <span className="users-tab__identity-text">
                            <span className="users-tab__name">
                              {member.displayName ?? member.email}
                            </span>
                            {member.displayName && (
                              <span className="users-tab__email">{member.email}</span>
                            )}
                          </span>
                        </span>
                      </td>
                      <td>
                        {member.role === 'owner' ? (
                          <RoleChip value="owner" />
                        ) : (
                          <select
                            aria-label={`Papel de ${member.email}`}
                            value={member.role}
                            disabled={busy}
                            onChange={event =>
                              void store.updateRole(
                                workspace.workspaceId,
                                member.userId,
                                event.target.value as AssignableMemberRole
                              )
                            }
                          >
                            {ASSIGNABLE_ROLES.map(item => (
                              <option key={item} value={item}>
                                {ROLE_LABELS[item]}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        <StatusChip status={member.status} />
                      </td>
                      <td>
                        {member.role !== 'owner' && (
                          <Button
                            variant="danger"
                            disabled={busy}
                            onClick={() => setPendingRemoval(member)}
                          >
                            {member.status === 'pending' ? 'Cancelar convite' : 'Remover'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {status === 'ready' && (
            <footer className="users-tab__count" aria-live="polite">
              {filtersActive
                ? `${filteredMembers.length} de ${members.length} membros`
                : `${members.length} ${members.length === 1 ? 'membro' : 'membros'}`}
            </footer>
          )}
        </section>
      )}

      {isSudo && (
        <RegisteredUsers
          onPick={picked => {
            setEmail(picked);
            setEmailError(null);
            setInviteOpen(true);
          }}
        />
      )}

      <Modal
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Adicionar membro"
        size="small"
        initialFocusRef={emailRef}
      >
        <form className="users-tab__form" onSubmit={handleSubmit} noValidate>
          <div className="users-tab__field">
            <label htmlFor="member-email">E-mail</label>
            <input
              id="member-email"
              ref={emailRef}
              type="email"
              autoComplete="off"
              value={email}
              onChange={event => setEmail(event.target.value)}
              onBlur={() => email && setEmailError(validateEmail(email.trim().toLowerCase()))}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? 'member-email-error' : undefined}
            />
            {emailError && (
              <span id="member-email-error" className="users-tab__field-error">
                {emailError}
              </span>
            )}
          </div>
          <div className="users-tab__field">
            <label htmlFor="member-role">Papel</label>
            <select
              id="member-role"
              value={role}
              onChange={event => setRole(event.target.value as AssignableMemberRole)}
            >
              {ASSIGNABLE_ROLES.map(item => (
                <option key={item} value={item}>
                  {ROLE_LABELS[item]}
                </option>
              ))}
            </select>
          </div>
          {actionError && (
            <p role="alert" className="users-tab__alert">
              {actionError}
            </p>
          )}
          <div className="users-tab__modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setInviteOpen(false)}
            >
              Fechar
            </button>
            <Button type="submit" disabled={busy}>
              Adicionar
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={pendingRemoval !== null}
        onClose={closeModal}
        title={pendingInvite ? 'Cancelar convite' : 'Remover pessoa'}
        size="small"
        initialFocusRef={cancelRef}
      >
        <p>
          {pendingInvite
            ? `Cancelar o convite de ${pendingRemoval?.email} para o workspace ${workspace.name}?`
            : `Remover ${pendingRemoval?.email} do workspace ${workspace.name}? A pessoa perde o acesso imediatamente.`}
        </p>
        <div className="users-tab__modal-actions">
          <button type="button" ref={cancelRef} className="btn btn-secondary" onClick={closeModal}>
            Cancelar
          </button>
          <Button variant="danger" onClick={() => void confirmRemoval()}>
            {pendingInvite ? 'Cancelar convite' : 'Remover'}
          </Button>
        </div>
      </Modal>
    </section>
  );
};

export default UsersTab;
