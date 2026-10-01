import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MemberRequestError,
  workspaceMemberService,
} from '../../services/api/workspaceMemberService';
import { AdminRequestError, adminDirectoryService } from '../../services/api/adminDirectoryService';
import { workspaceService } from '../../services/api/workspaceService';
import { useAdminDirectoryStore } from '../../store/useAdminDirectoryStore';
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

vi.mock('../../services/api/adminDirectoryService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/api/adminDirectoryService')>()),
  adminDirectoryService: {
    probeSudo: vi.fn(),
    listWorkspaces: vi.fn(),
    listMembers: vi.fn(),
    listUsers: vi.fn(),
    promoteWorkspace: vi.fn(),
  },
}));

vi.mock('../../services/api/workspaceService', () => ({
  workspaceService: { getCurrentWorkspaces: vi.fn() },
}));

const service = vi.mocked(workspaceMemberService);
const workspaces = vi.mocked(workspaceService);
const adminApi = vi.mocked(adminDirectoryService);
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

const openMenu = (email: string) =>
  fireEvent.click(screen.getByRole('button', { name: `Ações de ${email}` }));
const pickItem = (name: string) => fireEvent.click(screen.getByRole('menuitem', { name }));
const pickWorkspace = (target: string) => {
  fireEvent.focus(screen.getByRole('combobox', { name: 'Workspace' }));
  fireEvent.click(screen.getByRole('option', { name: new RegExp(target) }));
};

const openInvite = () => fireEvent.click(screen.getByRole('button', { name: 'Adicionar membro' }));

describe('UsersTab', () => {
  beforeEach(() => {
    Object.values(service).forEach(fn => fn.mockReset());
    workspaces.getCurrentWorkspaces.mockReset();
    Object.values(adminApi).forEach(fn => fn.mockReset());
    adminApi.probeSudo.mockResolvedValue(false);
    useAdminDirectoryStore.getState().reset();
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
    expect(screen.getByRole('button', { name: 'Ações de convidada@example.com' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Ações de dona@example.com' })).toBeNull();
  });

  it('mostra estado vazio quando só o dono está no workspace', async () => {
    seedWorkspace('organization');
    service.listMembers.mockResolvedValue([owner]);
    render(<UsersTab />);
    expect(await screen.findByText('Só você está neste workspace. Convide alguém.')).toBeVisible();
  });

  it('valida e-mail, normaliza e adiciona; mostra sucesso', async () => {
    seedWorkspace('organization');
    service.listMembers.mockResolvedValue([owner]);
    service.addMember.mockResolvedValue({ ...guest, status: 'pending' });
    render(<UsersTab />);
    await screen.findByRole('table');

    openInvite();
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

    openInvite();
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

    openMenu('convidada@example.com');
    pickItem('Cancelar convite');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(service.removeMember).not.toHaveBeenCalled();

    openMenu('convidada@example.com');
    pickItem('Cancelar convite');
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

    openMenu('convidada@example.com');
    pickItem('Remover membro');
    expect(
      screen.getByText(
        'Remover convidada@example.com do workspace Fiscal da equipe? A pessoa perde o acesso imediatamente.'
      )
    ).toBeVisible();
  });

  it('altera o papel pelo menu da linha, no painel lateral com foco no seletor', async () => {
    seedWorkspace('organization');
    service.listMembers.mockResolvedValue([owner, guest]);
    service.updateRole.mockResolvedValue();
    render(<UsersTab />);
    await screen.findByRole('table');

    openMenu('convidada@example.com');
    pickItem('Alterar papel');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const select = within(dialog).getByLabelText('Papel de convidada@example.com');
    expect(select).toHaveFocus();
    fireEvent.change(select, { target: { value: 'reviewer' } });
    await waitFor(() => expect(service.updateRole).toHaveBeenCalledWith('w1', 'i1', 'reviewer'));
    expect(await screen.findByRole('status')).toHaveTextContent('Papel atualizado');
  });

  describe('menu de ações da linha', () => {
    async function setup() {
      seedWorkspace('organization');
      service.listMembers.mockResolvedValue([owner, guest]);
      render(<UsersTab />);
      await screen.findByRole('table');
      return screen.getByRole('button', { name: 'Ações de convidada@example.com' });
    }

    it('expõe aria-haspopup/expanded, navega por setas e fecha com Esc devolvendo o foco', async () => {
      const button = await setup();
      expect(button).toHaveAttribute('aria-haspopup', 'menu');
      expect(button).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'true');
      const items = screen.getAllByRole('menuitem');
      await waitFor(() => expect(items[0]).toHaveFocus());
      fireEvent.keyDown(items[0], { key: 'ArrowDown' });
      expect(items[1]).toHaveFocus();
      fireEvent.keyDown(items[1], { key: 'ArrowDown' });
      expect(items[0]).toHaveFocus();
      fireEvent.keyDown(items[0], { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(button).toHaveFocus();
    });

    it('abre com ArrowDown no botão e fecha ao clicar fora', async () => {
      const button = await setup();
      fireEvent.keyDown(button, { key: 'ArrowDown' });
      expect(screen.getByRole('menu')).toBeVisible();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('o proprietário não tem menu de ações', async () => {
      await setup();
      expect(screen.queryByRole('button', { name: 'Ações de dona@example.com' })).toBeNull();
    });
  });

  describe('painel lateral do membro', () => {
    it('abre pelo nome, mostra detalhes, prende o foco e fecha com Esc devolvendo o foco', async () => {
      seedWorkspace('organization');
      service.listMembers.mockResolvedValue([owner, guest]);
      render(<UsersTab />);
      await screen.findByRole('table');

      const trigger = screen.getByRole('button', { name: 'convidada@example.com' });
      trigger.focus();
      fireEvent.click(trigger);
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Convite pendente')).toBeVisible();
      expect(within(dialog).getByText('Convidado em')).toBeVisible();
      const close = within(dialog).getByRole('button', { name: 'Fechar detalhes' });
      expect(close).toHaveFocus();

      const remove = within(dialog).getByRole('button', { name: 'Cancelar convite' });
      remove.focus();
      fireEvent.keyDown(remove, { key: 'Tab' });
      expect(close).toHaveFocus();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(trigger).toHaveFocus();
    });

    it('remove pelo painel usando o modal de confirmação', async () => {
      seedWorkspace('organization');
      service.listMembers.mockResolvedValue([owner, { ...guest, status: 'active' }]);
      service.removeMember.mockResolvedValue();
      render(<UsersTab />);
      await screen.findByRole('table');
      fireEvent.click(screen.getByRole('button', { name: 'convidada@example.com' }));
      fireEvent.click(screen.getByRole('button', { name: 'Remover membro' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText(/perde o acesso imediatamente/)).toBeVisible();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
      await waitFor(() => expect(service.removeMember).toHaveBeenCalledWith('w1', 'i1'));
      expect(await screen.findByRole('status')).toHaveTextContent('Pessoa removida');
    });

    it('proprietário: sem troca de papel nem remoção', async () => {
      seedWorkspace('organization');
      service.listMembers.mockResolvedValue([owner]);
      render(<UsersTab />);
      await screen.findByRole('table');
      fireEvent.click(screen.getByRole('button', { name: 'Dona' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).queryByRole('combobox')).toBeNull();
      expect(within(dialog).queryByRole('button', { name: /Remover|Cancelar convite/ })).toBeNull();
    });
  });

  it('toast de erro some sozinho', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      seedWorkspace('organization');
      service.listMembers.mockResolvedValue([owner, guest]);
      service.removeMember.mockRejectedValue(
        new MemberRequestError('failed', 'Falhou ao remover.')
      );
      render(<UsersTab />);
      await screen.findByRole('table');
      openMenu('convidada@example.com');
      pickItem('Cancelar convite');
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar convite' })
      );
      expect(await screen.findByRole('alert')).toHaveTextContent('Falhou ao remover.');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8100);
      });
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('filtra por e-mail, papel e status, com contagem e limpeza dos filtros', async () => {
    seedWorkspace('organization');
    service.listMembers.mockResolvedValue([owner, guest]);
    render(<UsersTab />);
    await screen.findByRole('table');
    expect(screen.getByText('2 membros')).toBeVisible();

    fireEvent.change(screen.getByLabelText('Buscar membro'), { target: { value: 'convidada' } });
    expect(screen.getByText('1 de 2 membros')).toBeVisible();
    expect(screen.queryByText('Dona')).toBeNull();

    fireEvent.change(screen.getByLabelText('Filtrar por status'), { target: { value: 'active' } });
    expect(screen.getByText('Nenhum membro corresponde aos filtros.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getByText('2 membros')).toBeVisible();
  });

  it('mostra iniciais do e-mail quando não há displayName', async () => {
    seedWorkspace('organization');
    service.listMembers.mockResolvedValue([owner, guest]);
    render(<UsersTab />);
    await screen.findByRole('table');
    expect(screen.getByText('CO')).toBeInTheDocument();
  });

  it('oferece tentar novamente quando a lista de membros falha', async () => {
    seedWorkspace('organization');
    service.listMembers.mockRejectedValueOnce(new Error('Falhou.'));
    service.listMembers.mockResolvedValue([owner]);
    render(<UsersTab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('1 membro')).toBeVisible();
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

  describe('visão de administrador (sudo)', () => {
    const adminWorkspaces = [
      {
        workspaceId: 'w1',
        name: 'Pessoal',
        kind: 'personal',
        ownerUserId: 'u1',
        memberCount: 1,
        createdAt: '2026-08-31T12:00:00Z',
      },
      {
        workspaceId: 'w2',
        name: 'Time B',
        kind: 'team',
        ownerUserId: 'u2',
        memberCount: 3,
        createdAt: '2026-08-31T12:00:00Z',
      },
    ];
    const adminUser = {
      userId: 'u9',
      email: 'fulana@example.com',
      workspaceCount: 2,
      createdAt: '2026-09-01T00:00:00Z',
    };

    function seedSudo() {
      adminApi.probeSudo.mockResolvedValue(true);
      adminApi.listWorkspaces.mockResolvedValue(adminWorkspaces);
      adminApi.listMembers.mockResolvedValue([owner]);
      adminApi.listUsers.mockResolvedValue([adminUser]);
      seedWorkspace('personal');
    }

    it('não-sudo não vê seletor nem lista de usuários', async () => {
      seedWorkspace('organization');
      service.listMembers.mockResolvedValue([owner]);
      render(<UsersTab />, { wrapper: MemoryRouter });
      await screen.findByText('dona@example.com');
      expect(adminApi.probeSudo).toHaveBeenCalled();
      expect(screen.queryByLabelText('Workspace')).toBeNull();
      expect(screen.queryByText('Usuários cadastrados')).toBeNull();
      expect(adminApi.listUsers).not.toHaveBeenCalled();
    });

    it('sudo vê todos os workspaces, mesmo o pessoal, e a lista de usuários', async () => {
      seedSudo();
      render(<UsersTab />, { wrapper: MemoryRouter });
      const combo = await screen.findByLabelText('Workspace');
      expect((combo as HTMLInputElement).value).toBe('Pessoal (pessoal, 1 membro)');
      fireEvent.focus(combo);
      expect(screen.getByRole('option', { name: 'Time B (time, 3 membros)' })).toBeTruthy();
      // Busca filtra as opções; setas + Enter selecionam.
      fireEvent.change(combo, { target: { value: 'time' } });
      expect(screen.queryByRole('option', { name: /Pessoal/ })).toBeNull();
      fireEvent.change(combo, { target: { value: 'zzz' } });
      expect(screen.getByText('Nenhum workspace encontrado.')).toBeVisible();
      fireEvent.change(combo, { target: { value: '' } });
      fireEvent.keyDown(combo, { key: 'ArrowDown' });
      fireEvent.keyDown(combo, { key: 'Enter' });
      await waitFor(() => expect(adminApi.listMembers).toHaveBeenCalledWith('w2'));
      expect(combo).toHaveAttribute('aria-expanded', 'false');
      await screen.findByText('fulana@example.com');
      await waitFor(() => expect(adminApi.listMembers).toHaveBeenCalledWith('w1'));
      expect(service.listMembers).not.toHaveBeenCalled();
    });

    it('trocar o workspace muda o alvo das chamadas', async () => {
      seedSudo();
      service.addMember.mockRejectedValue(new MemberRequestError('conflict', 'x'));
      render(<UsersTab />, { wrapper: MemoryRouter });
      await screen.findByLabelText('Workspace');
      pickWorkspace('Time B');
      await waitFor(() => expect(adminApi.listMembers).toHaveBeenCalledWith('w2'));
      service.addMember.mockResolvedValue({ ...guest, email: 'nova@example.com' });
      openInvite();
      openInvite();
      fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nova@example.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
      await waitFor(() =>
        expect(service.addMember).toHaveBeenCalledWith('w2', {
          email: 'nova@example.com',
          role: 'viewer',
        })
      );
    });

    it('409 ao adicionar em workspace pessoal mostra mensagem amigável', async () => {
      seedSudo();
      service.addMember.mockRejectedValue(new MemberRequestError('conflict', 'x'));
      render(<UsersTab />, { wrapper: MemoryRouter });
      await screen.findByLabelText('Workspace');
      openInvite();
      fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nova@example.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(
        'Este workspace ainda não aceita membros. Aguarde a liberação pela API.'
      );
    });

    it('403 do sudo em workspace alheio mostra mensagem de permissão', async () => {
      seedSudo();
      service.addMember.mockRejectedValue(new MemberRequestError('forbidden', 'x'));
      render(<UsersTab />, { wrapper: MemoryRouter });
      await screen.findByLabelText('Workspace');
      pickWorkspace('Time B');
      openInvite();
      fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'nova@example.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
      expect((await screen.findByRole('alert')).textContent).toBe(
        'Você não tem permissão para gerenciar este workspace na API.'
      );
    });

    it('clicar no e-mail da lista preenche o formulário e a paginação usa take 50', async () => {
      seedSudo();
      adminApi.listUsers.mockResolvedValueOnce(
        Array.from({ length: 50 }, (_, i) => ({
          ...adminUser,
          userId: `u${i}`,
          email: `p${i}@x.com`,
        }))
      );
      render(<UsersTab />, { wrapper: MemoryRouter });
      fireEvent.click(await screen.findByRole('button', { name: 'p3@x.com' }));
      expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('p3@x.com');
      fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
      fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
      await waitFor(() =>
        expect(adminApi.listUsers).toHaveBeenLastCalledWith({ skip: 50, take: 50 })
      );
      await screen.findByText('fulana@example.com');
      fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
      await waitFor(() =>
        expect(adminApi.listUsers).toHaveBeenLastCalledWith({ skip: 0, take: 50 })
      );
    });

    it('lista de usuários indisponível (404/503) mostra aviso sem quebrar o resto', async () => {
      seedSudo();
      adminApi.listUsers.mockRejectedValue(
        new AdminRequestError(
          'unavailable',
          'Recurso ainda indisponível. Tente novamente mais tarde.'
        )
      );
      render(<UsersTab />, { wrapper: MemoryRouter });
      expect(await screen.findByText('Recurso ainda indisponível')).toBeTruthy();
      expect(screen.getByLabelText('Workspace')).toBeTruthy();
    });

    it('isSudo de /me dispensa o probe', async () => {
      adminApi.listWorkspaces.mockResolvedValue(adminWorkspaces);
      adminApi.listMembers.mockResolvedValue([owner]);
      adminApi.listUsers.mockResolvedValue([adminUser]);
      useWorkspaceStore.setState({
        status: 'ready',
        isSudo: true,
        activeWorkspaceId: 'w1',
        workspaces: [
          { workspaceId: 'w1', name: 'Pessoal', kind: 'personal', role: 'owner', createdAt: 'x' },
        ],
      });
      render(<UsersTab />, { wrapper: MemoryRouter });
      expect(await screen.findByLabelText('Workspace')).toBeTruthy();
      expect(adminApi.probeSudo).not.toHaveBeenCalled();
    });

    it('isSudo false de /me não vê visão admin nem chama o probe', async () => {
      seedWorkspace('organization');
      useWorkspaceStore.setState({ isSudo: false });
      service.listMembers.mockResolvedValue([owner]);
      render(<UsersTab />, { wrapper: MemoryRouter });
      await screen.findByText('dona@example.com');
      expect(adminApi.probeSudo).not.toHaveBeenCalled();
      expect(screen.queryByLabelText('Workspace')).toBeNull();
    });

    describe('promoção a workspace de time', () => {
      it('confirma, envia o nome e recarrega os workspaces', async () => {
        seedSudo();
        adminApi.promoteWorkspace.mockResolvedValue();
        workspaces.getCurrentWorkspaces.mockResolvedValue({
          activeWorkspaceId: 'w1',
          workspaces: [
            { workspaceId: 'w1', name: 'Novo', kind: 'team', role: 'owner', createdAt: 'x' },
          ],
        });
        adminApi.listWorkspaces
          .mockResolvedValueOnce(adminWorkspaces)
          .mockResolvedValue([
            { ...adminWorkspaces[0], name: 'Novo', kind: 'team' },
            adminWorkspaces[1],
          ]);
        render(<UsersTab />, { wrapper: MemoryRouter });
        const input = await screen.findByLabelText('Nome do workspace');
        expect((input as HTMLInputElement).value).toBe('Pessoal');
        fireEvent.change(input, { target: { value: '  Novo  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Promover a workspace de time' }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
        expect(adminApi.promoteWorkspace).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Promover' }));
        await waitFor(() =>
          expect(adminApi.promoteWorkspace).toHaveBeenCalledWith('w1', { name: 'Novo' })
        );
        expect(await screen.findByText('Workspace promovido a time.')).toBeTruthy();
        await waitFor(() => expect(workspaces.getCurrentWorkspaces).toHaveBeenCalled());
        expect(await screen.findByRole('button', { name: 'Adicionar membro' })).toBeTruthy();
        expect(screen.queryByLabelText('Nome do workspace')).toBeNull();
      });

      it('valida o nome antes de confirmar', async () => {
        seedSudo();
        render(<UsersTab />, { wrapper: MemoryRouter });
        const input = await screen.findByLabelText('Nome do workspace');
        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Promover a workspace de time' }));
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input).toHaveAttribute('aria-describedby', 'promote-name-error');
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      it.each([
        ['mensagem da API (400)', 'Nome inválido.'],
        ['404', 'Recurso ainda indisponível ou sem permissão.'],
        ['503', 'Serviço indisponível. Tente novamente.'],
      ])('mostra erro em role=alert: %s', async (_label, message) => {
        seedSudo();
        adminApi.promoteWorkspace.mockRejectedValue(new AdminRequestError('failed', message));
        render(<UsersTab />, { wrapper: MemoryRouter });
        await screen.findByLabelText('Nome do workspace');
        fireEvent.click(screen.getByRole('button', { name: 'Promover a workspace de time' }));
        fireEvent.click(
          within(screen.getByRole('dialog')).getByRole('button', { name: 'Promover' })
        );
        expect(await screen.findByRole('alert')).toHaveTextContent(message);
      });

      it('não aparece para workspace de time', async () => {
        seedSudo();
        render(<UsersTab />, { wrapper: MemoryRouter });
        await screen.findByLabelText('Workspace');
        pickWorkspace('Time B');
        await waitFor(() => expect(adminApi.listMembers).toHaveBeenCalledWith('w2'));
        expect(screen.queryByText('Transformar em workspace de time')).toBeNull();
      });

      it('não aparece para não-sudo', async () => {
        seedWorkspace('personal');
        render(<UsersTab />, { wrapper: MemoryRouter });
        await waitFor(() => expect(adminApi.probeSudo).toHaveBeenCalled());
        expect(screen.queryByText('Transformar em workspace de time')).toBeNull();
      });
    });

    it('lista de usuários vazia', async () => {
      seedSudo();
      adminApi.listUsers.mockResolvedValue([]);
      render(<UsersTab />, { wrapper: MemoryRouter });
      expect(await screen.findByText('Nenhum usuário cadastrado.')).toBeTruthy();
    });
  });
});
