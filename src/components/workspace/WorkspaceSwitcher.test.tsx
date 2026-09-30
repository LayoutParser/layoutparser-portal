import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import WorkspaceSwitcher from './WorkspaceSwitcher';

const workspace = {
  workspaceId: 'workspace-1',
  name: 'Fiscal da equipe',
  kind: 'organization' as const,
  role: 'mapper' as const,
  createdAt: '2026-08-31T12:00:00Z',
};

describe('WorkspaceSwitcher', () => {
  beforeEach(() => useWorkspaceStore.getState().reset());

  it('mantém acesso explícito sem iniciar consulta fora da área fiscal', () => {
    render(
      <MemoryRouter>
        <WorkspaceSwitcher />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Abrir workspace fiscal' })).toHaveAttribute(
      'href',
      '/workspace'
    );
  });

  it('mostra o workspace resolvido e liga para a visão geral', () => {
    useWorkspaceStore.setState({
      status: 'ready',
      workspaces: [workspace],
      activeWorkspaceId: workspace.workspaceId,
      error: null,
    });

    render(
      <MemoryRouter>
        <WorkspaceSwitcher />
      </MemoryRouter>
    );

    expect(screen.getByRole('combobox', { name: 'Workspace ativo' })).toHaveValue('workspace-1');
    expect(screen.getByRole('link', { name: 'Workspace' })).toHaveAttribute('href', '/workspace');
  });

  it('oferece retry quando a API está indisponível', () => {
    const loadWorkspaces = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      status: 'error',
      error: 'Serviço temporariamente indisponível.',
      loadWorkspaces,
    });

    render(
      <MemoryRouter>
        <WorkspaceSwitcher />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reconectar workspace' }));
    expect(loadWorkspaces).toHaveBeenCalledWith(true);
  });

  it('mostra "Sem workspace" no lugar do select quando a lista é vazia', () => {
    useWorkspaceStore.setState({ status: 'ready', workspaces: [], activeWorkspaceId: null });

    render(
      <MemoryRouter>
        <WorkspaceSwitcher />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Sem workspace' })).toHaveAttribute(
      'href',
      '/workspace'
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
