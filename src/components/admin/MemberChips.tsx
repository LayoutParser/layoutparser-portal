import type { MemberRole, MemberStatus } from '../../types/member';
import { ROLE_LABELS, initialsOf } from './memberLabels';
import './MemberChips.css';

export function Avatar({
  displayName,
  email,
  userId,
}: {
  displayName?: string | null;
  email?: string | null;
  userId?: string;
}) {
  return (
    <span className="member-avatar" aria-hidden="true">
      {initialsOf(displayName, email, userId)}
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
