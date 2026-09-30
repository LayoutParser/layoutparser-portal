import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import WorkspacePage from './WorkspacePage';

const workspace = {
  workspaceId: 'workspace-1',
  name: 'Meu workspace fiscal',
  kind: 'personal' as const,
  role: 'owner' as const,
  createdAt: '2026-08-31T12:00:00Z',
};

describe('WorkspacePage', () => {
  beforeEach(() => useWorkspaceStore.getState().reset());

  it('apresenta o workspace real e mantém o processamento atual acessível', () => {
    useWorkspaceStore.setState({
      status: 'ready',
      workspaces: [workspace],
      activeWorkspaceId: workspace.workspaceId,
      error: null,
    });

    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Meu workspace fiscal' })).toBeVisible();
    expect(screen.getAllByText('Proprietário').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Abrir processamento' })).toHaveAttribute(
      'href',
      '/upload'
    );
    expect(screen.getByText(/Sysmiddle somente leitura/i)).toBeVisible();
  });

  it('mostra loading acessível enquanto a identidade é vinculada', () => {
    useWorkspaceStore.setState({ status: 'loading' });

    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>
    );

    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(/Preparando seu ambiente seguro/i)).toBeVisible();
  });

  it('expõe falha segura e permite tentar novamente', () => {
    const loadWorkspaces = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      status: 'error',
      error: 'O serviço de workspaces está temporariamente indisponível.',
      loadWorkspaces,
    });

    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>
    );

    expect(screen.getByRole('alert')).toContainElement(
      screen.getByText(/temporariamente indisponível/i)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(loadWorkspaces).toHaveBeenCalledWith(true);
  });

  it('mostra o estado sem workspace quando a lista vem vazia', () => {
    useWorkspaceStore.setState({ status: 'ready', workspaces: [], activeWorkspaceId: null });

    render(
      <MemoryRouter>
        <WorkspacePage />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', { name: 'Você ainda não tem acesso a um workspace' })
    ).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
