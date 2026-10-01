import { useEffect, useId, useRef } from 'react';
import type { AssignableMemberRole, WorkspaceMember } from '../../types/member';
import Button from '../shared/Button';
import { Avatar, RoleChip, StatusChip } from './MemberChips';
import { NO_EMAIL_LABEL, ROLE_LABELS, displayLabel, emailOrId } from './memberLabels';
import './MemberDrawer.css';

const ASSIGNABLE_ROLES: AssignableMemberRole[] = [
  'fiscal_admin',
  'mapper',
  'reviewer',
  'operator',
  'viewer',
];

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface MemberDrawerProps {
  member: WorkspaceMember;
  busy: boolean;
  /** Quando true, o foco inicial vai para o seletor de papel (vindo de "Alterar papel"). */
  focusRole?: boolean;
  onClose: () => void;
  onChangeRole: (role: AssignableMemberRole) => void;
  onRemove: () => void;
}

/** Painel lateral com detalhes do membro: foco preso, Esc/overlay fecham, devolve o foco. */
export function MemberDrawer({
  member,
  busy,
  focusRole = false,
  onClose,
  onChangeRole,
  onRemove,
}: MemberDrawerProps) {
  const panelRef = useRef<HTMLElement>(null);
  const roleRef = useRef<HTMLSelectElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const owner = member.role === 'owner';
  const pending = member.status === 'pending';

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (focusRole && roleRef.current ? roleRef.current : closeRef.current)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previous?.focus();
    };
    // Só na montagem: trocar de membro com o drawer aberto não deve roubar o foco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const date = new Date(member.createdAt).toLocaleDateString('pt-BR');

  return (
    <div
      className="member-drawer__overlay"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        className="member-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="member-drawer__header">
          <Avatar displayName={member.displayName} email={member.email} userId={member.userId} />
          <div className="member-drawer__heading">
            <h2 id={titleId}>{displayLabel(member)}</h2>
            {member.displayName && (
              <span className="member-drawer__email">{emailOrId(member)}</span>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="member-drawer__close"
            aria-label="Fechar detalhes"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <dl className="member-drawer__details">
          <dt>E-mail</dt>
          <dd>{member.email ?? NO_EMAIL_LABEL}</dd>
          <dt>Status</dt>
          <dd>
            <StatusChip status={member.status} />
          </dd>
          <dt>{pending ? 'Convidado em' : 'Membro desde'}</dt>
          <dd>{date}</dd>
          <dt>Papel</dt>
          <dd>
            {owner ? (
              <>
                <RoleChip value="owner" />
                <span className="member-drawer__hint">
                  O proprietário não pode ter o papel alterado nem ser removido.
                </span>
              </>
            ) : (
              <select
                ref={roleRef}
                className="member-drawer__select"
                aria-label={`Papel de ${displayLabel(member)}`}
                value={member.role}
                disabled={busy}
                onChange={event => onChangeRole(event.target.value as AssignableMemberRole)}
              >
                {ASSIGNABLE_ROLES.map(item => (
                  <option key={item} value={item}>
                    {ROLE_LABELS[item]}
                  </option>
                ))}
              </select>
            )}
          </dd>
        </dl>

        {!owner && (
          <footer className="member-drawer__footer">
            <Button variant="danger" disabled={busy} onClick={onRemove}>
              {pending ? 'Cancelar convite' : 'Remover membro'}
            </Button>
          </footer>
        )}
      </aside>
    </div>
  );
}

export default MemberDrawer;
