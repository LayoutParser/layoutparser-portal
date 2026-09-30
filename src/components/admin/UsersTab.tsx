import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PERSONAL_MESSAGE } from '../../services/api/workspaceMemberService';
import { ADMIN_USERS_PAGE_SIZE, useAdminDirectoryStore } from '../../store/useAdminDirectoryStore';
import { useWorkspaceMembersStore } from '../../store/useWorkspaceMembersStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import type { AssignableMemberRole, MemberRole, WorkspaceMember } from '../../types/member';
import Button from '../shared/Button';
import Modal from '../shared/Modal';
import './UsersTab.css';

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Proprietário',
  fiscal_admin: 'Administrador fiscal',
  mapper: 'Mapeador',
  reviewer: 'Revisor',
  operator: 'Operador',
  viewer: 'Leitor',
};

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
  const loading = usersStatus === 'idle' || usersStatus === 'loading';

  return (
    <section
      className="users-tab__directory"
      aria-labelledby="users-directory-title"
      aria-busy={loading}
    >
      <h3 id="users-directory-title">Usuários cadastrados</h3>
      {loading && <p role="status">Carregando usuários…</p>}
      {usersStatus === 'error' && (
        <p role="alert" className="users-tab__alert">
          {usersUnavailable ? 'Recurso ainda indisponível' : usersError}
        </p>
      )}
      {usersStatus === 'ready' && users.length === 0 && <p>Nenhum usuário cadastrado.</p>}
      {usersStatus === 'ready' && users.length > 0 && (
        <div className="users-tab__table-wrap">
          <table className="users-tab__table">
            <caption>Usuários cadastrados</caption>
            <thead>
              <tr>
                <th scope="col">E-mail</th>
                <th scope="col">Workspaces</th>
                <th scope="col">Cadastrado em</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.userId}>
                  <td>
                    <button
                      type="button"
                      className="users-tab__link"
                      title="Usar este e-mail no formulário"
                      onClick={() => onPick(user.email)}
                    >
                      {user.email}
                    </button>
                  </td>
                  <td>{user.workspaceCount}</td>
                  <td>{new Date(user.createdAt).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="users-tab__pager">
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
      </div>
    </section>
  );
}

const UsersTab = () => {
  const activeWorkspace = useWorkspaceStore(state =>
    state.workspaces.find(item => item.workspaceId === state.activeWorkspaceId)
  );
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const admin = useAdminDirectoryStore();
  const isSudo = admin.sudo === 'yes';
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

  useEffect(() => {
    void detectSudo();
  }, [detectSudo]);

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
    if (ok) setEmail('');
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
            onChange={event => admin.selectWorkspace(event.target.value)}
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

      {isSudo && isPersonal && <p role="status">{PERSONAL_MESSAGE}</p>}

      {unavailable ? (
        <p role="alert" className="users-tab__alert">
          Recurso ainda indisponível. Tente novamente mais tarde.
        </p>
      ) : (
        <>
          <form className="users-tab__form" onSubmit={handleSubmit} noValidate>
            <div className="users-tab__field">
              <label htmlFor="member-email">E-mail</label>
              <input
                id="member-email"
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
            <Button type="submit" disabled={busy}>
              Adicionar
            </Button>
          </form>

          {notice && (
            <p role="status" className="users-tab__notice">
              {notice}
            </p>
          )}
          {actionError && (
            <p role="alert" className="users-tab__alert">
              {actionError}
            </p>
          )}

          {status === 'loading' && <p>Carregando membros…</p>}
          {status === 'error' && (
            <p role="alert" className="users-tab__alert">
              {error}
            </p>
          )}
          {status === 'ready' && members.length <= 1 && members.every(m => m.role === 'owner') && (
            <p>Só você está neste workspace. Adicione alguém acima.</p>
          )}
          {status === 'ready' && members.length > 0 && (
            <div className="users-tab__table-wrap">
              <table className="users-tab__table">
                <caption>Membros de {workspace.name}</caption>
                <thead>
                  <tr>
                    <th scope="col">Nome</th>
                    <th scope="col">E-mail</th>
                    <th scope="col">Papel</th>
                    <th scope="col">Status</th>
                    <th scope="col">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(member => (
                    <tr key={`${member.status}-${member.userId}`}>
                      <td>{member.displayName ?? member.email}</td>
                      <td>{member.email}</td>
                      <td>
                        {member.role === 'owner' ? (
                          ROLE_LABELS.owner
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
                      <td>{member.status === 'pending' ? 'Convite pendente' : 'Ativo'}</td>
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
        </>
      )}

      {isSudo && <RegisteredUsers onPick={setEmail} />}

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
