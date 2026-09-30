import { useEffect, useId, useRef, useState } from 'react';
import './NotificationBell.css';

export interface NotificationItem {
  id: string;
  title: string;
  createdAt: string;
  read: boolean;
}

export type NotificationStatus = 'idle' | 'loading' | 'ready' | 'error';

interface NotificationBellProps {
  items?: NotificationItem[];
  unreadCount?: number;
  status?: NotificationStatus;
}

// Esqueleto sem fonte de dados: pronto para receber store/service depois.
const NotificationBell = ({
  items = [],
  unreadCount = 0,
  status = 'ready',
}: NotificationBellProps) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  // Perdeu o foco para fora do componente: fecha sem roubar o foco.
  const handleBlur = (event: React.FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && rootRef.current && !rootRef.current.contains(next)) {
      setOpen(false);
    }
  };

  const label = unreadCount > 0 ? `Notificações, ${unreadCount} não lidas` : 'Notificações';

  return (
    // Wrapper só captura Esc/blur que borbulham dos controles interativos internos.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="notification-bell" ref={rootRef} onKeyDown={handleKeyDown} onBlur={handleBlur}>
      <button
        ref={buttonRef}
        type="button"
        className="notification-bell__button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(current => !current)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2Zm6-6V11a6 6 0 0 0-5-5.9V4a1 1 0 0 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2Z"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="notification-bell__badge" aria-hidden="true">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      <div
        id={panelId}
        role="region"
        aria-label="Notificações"
        className="notification-bell__panel"
        hidden={!open}
      >
        {status === 'loading' && <p className="notification-bell__empty">Carregando…</p>}
        {status === 'error' && (
          <p className="notification-bell__empty">Não foi possível carregar as notificações.</p>
        )}
        {status !== 'loading' && status !== 'error' && items.length === 0 && (
          <p className="notification-bell__empty">Você não tem notificações.</p>
        )}
        {status === 'ready' && items.length > 0 && (
          <ul className="notification-bell__list">
            {items.map(item => (
              <li key={item.id} className={item.read ? '' : 'notification-bell__item--unread'}>
                {item.title}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default NotificationBell;
