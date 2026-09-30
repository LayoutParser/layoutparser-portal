import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import UsersTab from './UsersTab';

vi.mock('../layout/LayoutParserPage', () => ({ default: () => <div>processamento</div> }));
vi.mock('./MonitoringTab', () => ({ default: () => <div>monitoramento</div> }));
vi.mock('./LayoutValidationTab', () => ({ default: () => <div>validacao</div> }));
vi.mock('../aiMetrics/AiMetricsPanel', () => ({ default: () => <div>metricas</div> }));

describe('UsersTab', () => {
  beforeEach(() => useWorkspaceStore.getState().reset());

  it('mostra o workspace ativo e o aviso de disponibilidade futura', () => {
    useWorkspaceStore.setState({
      status: 'ready',
      workspaces: [
        {
          workspaceId: 'w1',
          name: 'Fiscal da equipe',
          kind: 'organization',
          role: 'owner',
          createdAt: '2026-08-31T12:00:00Z',
        },
      ],
      activeWorkspaceId: 'w1',
    });
    render(<UsersTab />);

    expect(screen.getByRole('heading', { name: 'Usuários de Fiscal da equipe' })).toBeVisible();
    expect(screen.getByText('A gestão de membros estará disponível em breve.')).toBeVisible();
  });

  it('é acessível pela aba Usuários do painel administrativo', async () => {
    const { default: AdminPage } = await import('./AdminPage');
    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Usuários' }));
    expect(screen.getByText('A gestão de membros estará disponível em breve.')).toBeVisible();
  });
});
