import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import './UsersTab.css';

// Esqueleto: a gestão de membros depende de contrato da API ainda não confirmado.
const UsersTab = () => {
  const workspaceName = useWorkspaceStore(
    state =>
      state.workspaces.find(workspace => workspace.workspaceId === state.activeWorkspaceId)?.name
  );

  return (
    <section className="users-tab" aria-labelledby="users-tab-title">
      <h2 id="users-tab-title">{workspaceName ? `Usuários de ${workspaceName}` : 'Usuários'}</h2>
      <p>A gestão de membros estará disponível em breve.</p>
    </section>
  );
};

export default UsersTab;
