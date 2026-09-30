import { Link } from 'react-router-dom';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import './WorkspaceSwitcher.css';

const WorkspaceSwitcher = () => {
  const { status, workspaces, activeWorkspaceId, error, loadWorkspaces, selectWorkspace } =
    useWorkspaceStore();

  if (status === 'idle') {
    return (
      <Link
        to="/workspace"
        className="workspace-switcher workspace-switcher--idle"
        aria-label="Abrir workspace fiscal"
      >
        Workspace fiscal
      </Link>
    );
  }

  if (status === 'loading') {
    return (
      <div className="workspace-switcher workspace-switcher--loading" aria-live="polite">
        <span className="workspace-switcher__pulse" aria-hidden="true" />
        <span>Preparando workspace…</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <button
        type="button"
        className="workspace-switcher workspace-switcher--error"
        title={error ?? undefined}
        onClick={() => void loadWorkspaces(true)}
      >
        Reconectar workspace
      </button>
    );
  }

  if (workspaces.length === 0) {
    return (
      <Link to="/workspace" className="workspace-switcher workspace-switcher__link">
        Sem workspace
      </Link>
    );
  }

  return (
    <div className="workspace-switcher">
      <Link to="/workspace" className="workspace-switcher__link">
        Workspace
      </Link>
      <select
        className="workspace-switcher__select"
        aria-label="Workspace ativo"
        value={activeWorkspaceId ?? ''}
        onChange={event => selectWorkspace(event.target.value)}
      >
        {workspaces.map(workspace => (
          <option key={workspace.workspaceId} value={workspace.workspaceId}>
            {workspace.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default WorkspaceSwitcher;
