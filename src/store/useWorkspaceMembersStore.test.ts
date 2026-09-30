import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberRequestError, workspaceMemberService } from '../services/api/workspaceMemberService';
import type { WorkspaceMember } from '../types/member';
import { useWorkspaceMembersStore } from './useWorkspaceMembersStore';

vi.mock('../services/api/workspaceMemberService', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/api/workspaceMemberService')>()),
  workspaceMemberService: {
    listMembers: vi.fn(),
    addMember: vi.fn(),
    updateRole: vi.fn(),
    removeMember: vi.fn(),
  },
}));

const member: WorkspaceMember = {
  userId: 'u1',
  displayName: 'Ana',
  email: 'ana@example.com',
  role: 'viewer',
  status: 'active',
  createdAt: '2026-09-30T00:00:00Z',
};
const service = vi.mocked(workspaceMemberService);

describe('useWorkspaceMembersStore', () => {
  beforeEach(() => {
    Object.values(service).forEach(fn => fn.mockReset());
    useWorkspaceMembersStore.getState().reset();
  });

  it('carrega membros', async () => {
    service.listMembers.mockResolvedValue([member]);
    await useWorkspaceMembersStore.getState().loadMembers('w1');
    expect(useWorkspaceMembersStore.getState()).toMatchObject({
      status: 'ready',
      members: [member],
    });
  });

  it('marca unavailable em 404/503', async () => {
    service.listMembers.mockRejectedValue(new MemberRequestError('unavailable', 'indisponível'));
    await useWorkspaceMembersStore.getState().loadMembers('w1');
    expect(useWorkspaceMembersStore.getState()).toMatchObject({
      status: 'error',
      unavailable: true,
    });
  });

  it('adiciona e informa convite pendente; erro fica em actionError', async () => {
    service.listMembers.mockResolvedValue([]);
    service.addMember.mockResolvedValueOnce({ ...member, status: 'pending' });
    await expect(
      useWorkspaceMembersStore
        .getState()
        .addMember('w1', { email: 'ana@example.com', role: 'viewer' })
    ).resolves.toBe(true);
    expect(useWorkspaceMembersStore.getState().notice).toBe('Convite criado para ana@example.com');

    service.addMember.mockRejectedValueOnce(new MemberRequestError('conflict', 'Já é membro.'));
    await expect(
      useWorkspaceMembersStore
        .getState()
        .addMember('w1', { email: 'ana@example.com', role: 'viewer' })
    ).resolves.toBe(false);
    expect(useWorkspaceMembersStore.getState()).toMatchObject({
      actionError: 'Já é membro.',
      notice: null,
    });
  });

  it('remove e reset volta ao estado inicial', async () => {
    service.removeMember.mockResolvedValue();
    service.listMembers.mockResolvedValue([]);
    await useWorkspaceMembersStore.getState().removeMember('w1', member);
    expect(useWorkspaceMembersStore.getState().notice).toBe('Pessoa removida');
    useWorkspaceMembersStore.getState().reset();
    expect(useWorkspaceMembersStore.getState()).toMatchObject({ notice: null, members: [] });
  });
});
