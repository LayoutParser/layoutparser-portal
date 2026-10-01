import type { MemberRole, MemberStatus } from '../../types/member';
import { ROLE_LABELS, initialsOf } from './memberLabels';
import './MemberChips.css';

export function Avatar({ displayName, email }: { displayName?: string | null; email: string }) {
  return (
    <span className="member-avatar" aria-hidden="true">
      {initialsOf(displayName, email)}
    </span>
  );
}

export function RoleChip({ value }: { value: MemberRole }) {
  return <span className={`member-chip member-chip--role-${value}`}>{ROLE_LABELS[value]}</span>;
}

export function StatusChip({ status }: { status: MemberStatus }) {
  return (
    <span className={`member-chip member-chip--${status}`}>
      {status === 'pending' ? 'Convite pendente' : 'Ativo'}
    </span>
  );
}
