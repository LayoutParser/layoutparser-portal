import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MemberRequestError,
  workspaceMemberService,
} from '../../services/api/workspaceMemberService';
import { workspaceService } from '../../services/api/workspaceService';
import { useWorkspaceMembersStore } from '../../store/useWorkspaceMembersStore';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import type { WorkspaceMember } from '../../types/member';
import UsersTab from './UsersTab';

vi.mock('../layout/LayoutParserPage', () => ({ default: () => <div>processamento</div> }));
vi.mock('./MonitoringTab', () => ({ default: () => <div>monitoramento</div> }));
vi.mock('./LayoutValidationTab', () => ({ default: () => <div>validacao</div> }));
vi.mock('../aiMetrics/AiMetricsPanel', () => ({ default: () => <div>metricas</div> }));
vi.mock('../../services/api/workspaceMemberService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/api/workspaceMemberService')>()),
  workspaceMemberService: {
    listMembers: vi.fn(),
    addMember: vi.fn(),
    updateRole: vi.fn(),
    removeMember: vi.fn(),
  },
}));

vi.mock('../../services/api/workspaceService', () => ({
  workspaceService: { getCurrentWorkspaces: vi.fn() },
}));

const service = vi.mocked(workspaceMemberService);
const workspaces = vi.mocked(workspaceService);
const owner: WorkspaceMember = {
  userId: 'o1',
  displayName: 'Dona',
  email: 'dona@example.com',
  role: 'owner',
  status: 'active',
  createdAt: '2026-09-30T00:00:00Z',
};
const guest: WorkspaceMember = {
  userId: 'i1',
  displayName: null,
  email: 'convidada@example.com',
  role: 'viewer',
  status: 'pending',
  createdAt: '2026-09-30T00:00:00Z',
};

function seedWorkspace(kind: 'personal' | 'organization') {
  useWorkspaceStore.setState({
    status: 'ready',
    workspaces: [
      {
        workspaceId: 'w1',
        name: 'Fiscal da equipe',
        kind,
        role: 'owner',
        createdAt: '2026-08-31T12:00:00Z',
      },
    ],
    activeWorkspaceId: 'w1',
  });
}

describe('UsersTab', () => {
  beforeEach(() => {
    Object.values(service).forEach(fn => fn.mockReset());
    workspaces.getCurrentWorkspaces.mockReset();
    useWorkspaceStore.getState().reset();
    useWorkspaceMembersStore.getState().reset();
  });

  it('pede os workspaces sozinha quando o store ainda não foi carregado (rota /admin)', async () => {
    workspaces.getCurrentWorkspaces.mockResolvedValue({
      activeWorkspaceId: 'w1',
      workspaces: [
        {
          workspaceId: 'w1',
          name: 'Time Fiscal',
          kind: 'team',
          role: 'owner',
          createdAt: '2026-09-30T12:00:00Z',
        },
      ],
    });
    service.listMembers.mockResolvedValue([owner]);
    render(<UsersTab />);

    expect(screen.getByText('Carregando workspaces…')).toBeVisible();
    expect(await screen.findByRole('heading', { name: 'Usuários de Time Fiscal' })).toBeVisible();
    expect(workspaces.getCurrentWorkspaces).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(service.listMembers).toHaveBeenCalledWith('w1'));
  });

  it('mostra erro quando os workspaces não carregam', async () => {
    workspaces.getCurrentWorkspaces.mockRejectedValue(new Error('Falha ao carregar.'));
    render(<UsersTab />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao carregar.');
  });

  it('carrega e lista membros com status em texto', async () => {
    seedWorkspace('organization');
    service.listMembers.mockResolvedValue([owner, guest]);
    render(<UsersTab />);

    expect(screen.getByRole('heading', { name: 'Usuários de Fiscal da equipe' })).toBeVisible();
    expect(await screen.findByRole('table')).toBeVisible();
    expect(screen.getByText('Convite pendente')).toBeVisible();
    expect(screen.getByText('Ativo')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancelar convite' })).toBeVisible();
  });

  it('mostra estado vazio quando só o dono está no workspace', async () => {
    seedWorkspace('organization');
    service.listMembers.mockResolvedValue([owner]);
    render(<UsersTab />);
    expect(
      await screen.findByText('Só você está neste workspace. Adicione alguém acima.')
    ).toBeVisible();
  });

  it('valida e-mail, normaliza e adiciona; mostra sucesso', async () => {
    seedWorkspace('organization');
    service.listMembers.mockResolvedValue([owner]);
    service.addMember.mockResolvedValue({ ...guest, status: 'pending' });
    render(<UsersTab />);
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    const input = screen.getByLabelText('E-mail');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Informe o e-mail da pessoa.')).toBeVisible();
    expect(service.addMember).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '  Nova@Example.COM ' } });
    fireEvent.change(screen.getByLabelText('Papel'), { target: { value: 'mapper' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() =>
      expect(service.addMember).toHaveBeenCalledWith('w1', {
        email: 'nova@example.com',
        role: 'mapper',
      })
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Convite criado para convidada@example.com'
    );
  });

  it('exibe erro 409 da API em role=alert', async () => {
    seedWorkspace('organization');
    service.listMembers.mockResolvedValue([owner]);
    service.addMember.mockRejectedValue(new MemberRequestError('conflict', 'Já é membro.'));
    render(<UsersTab />);
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@b.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Já é membro.');
  });

  it('remove somente após confirmação, com foco inicial em Cancelar', async () => {
    seedWorkspace('organization');
    service.listMembers.mockResolvedValue([owner, guest]);
    service.removeMember.mockResolvedValue();
    render(<UsersTab />);
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar convite' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(service.removeMember).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar convite' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar convite' })
    );
    await waitFor(() => expect(service.removeMember).toHaveBeenCalledWith('w1', 'i1'));
  });

  it('pede confirmação com o texto de perda de acesso ao remover membro ativo', async () => {
    seedWorkspace('organization');
    service.listMembers.mockResolvedValue([owner, { ...guest, status: 'active' }]);
    render(<UsersTab />);
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    expect(
      screen.getByText(
        'Remover convidada@example.com do workspace Fiscal da equipe? A pessoa perde o acesso imediatamente.'
      )
    ).toBeVisible();
  });

  it('altera o papel pelo select da linha', async () => {
    seedWorkspace('organization');
    service.listMembers.mockResolvedValue([owner, guest]);
    service.updateRole.mockResolvedValue();
    render(<UsersTab />);
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('Papel de convidada@example.com'), {
      target: { value: 'reviewer' },
    });
    await waitFor(() => expect(service.updateRole).toHaveBeenCalledWith('w1', 'i1', 'reviewer'));
  });

  it('não chama a API em workspace pessoal', () => {
    seedWorkspace('personal');
    render(<UsersTab />);
    expect(
      screen.getByText(
        'Workspaces pessoais não têm membros. Gestão de membros vale para workspaces de time.'
      )
    ).toBeVisible();
    expect(service.listMembers).not.toHaveBeenCalled();
  });

  it.each([404, 503])('mostra recurso indisponível quando a API responde %s', async () => {
    seedWorkspace('organization');
    service.listMembers.mockRejectedValue(
      new MemberRequestError(
        'unavailable',
        'Recurso ainda indisponível. Tente novamente mais tarde.'
      )
    );
    render(<UsersTab />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Recurso ainda indisponível');
  });

  it('é acessível pela aba Usuários do painel administrativo', async () => {
    seedWorkspace('personal');
    const { default: AdminPage } = await import('./AdminPage');
    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Usuários' }));
    expect(screen.getByRole('heading', { name: 'Usuários de Fiscal da equipe' })).toBeVisible();
  });
});
