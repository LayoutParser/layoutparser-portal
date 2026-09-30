import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import NoWorkspaceState from './NoWorkspaceState';

describe('NoWorkspaceState', () => {
  beforeEach(() => useWorkspaceStore.getState().reset());

  it('foca o título, explica o que fazer e recarrega ao atualizar', () => {
    const loadWorkspaces = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({ status: 'ready', workspaces: [], loadWorkspaces });

    render(<NoWorkspaceState />);

    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'Você ainda não tem acesso a um workspace',
    });
    expect(heading).toHaveFocus();
    expect(screen.getByText(/Peça ao administrador da sua equipe/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(loadWorkspaces).toHaveBeenCalledWith(true);
  });
});
