import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import './RowActionsMenu.css';

export interface RowAction {
  key: string;
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

interface RowActionsMenuProps {
  /** Nome acessível do botão, ex.: "Ações de fulana@example.com". */
  label: string;
  actions: RowAction[];
  disabled?: boolean;
}

/** Menu "⋯" por linha (padrão WAI-ARIA menu button): setas, Home/End, Esc e clique fora. */
export function RowActionsMenu({ label, actions, disabled = false }: RowActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  const openMenu = (focus: 'first' | 'last' = 'first') => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpen(true);
    // O foco é aplicado após a renderização do menu.
    requestAnimationFrame(() => {
      const list = items();
      (focus === 'last' ? list[list.length - 1] : list[0])?.focus();
    });
  };

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    // Menu em posição fixa: fecha ao rolar/redimensionar para não ficar solto da linha.
    const dismiss = () => setOpen(false);
    document.addEventListener('mousedown', handlePointer);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);

  const handleButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openMenu('first');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu('last');
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        move(index + 1);
        break;
      case 'ArrowUp':
        move(index - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(list.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
    }
  };

  return (
    <span className="row-actions">
      <button
        ref={buttonRef}
        type="button"
        className="row-actions__button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => (open ? close(true) : openMenu('first'))}
        onKeyDown={handleButtonKeyDown}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label={label}
          className="row-actions__menu"
          style={{ top: position.top, right: position.right }}
          onKeyDown={handleMenuKeyDown}
        >
          {actions.map(action => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={`row-actions__item${action.danger ? ' row-actions__item--danger' : ''}`}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export default RowActionsMenu;
