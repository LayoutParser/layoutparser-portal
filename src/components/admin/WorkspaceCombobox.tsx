import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import './WorkspaceCombobox.css';

export interface ComboboxOption {
  value: string;
  label: string;
}

interface WorkspaceComboboxProps {
  id: string;
  label: string;
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
}

/** Combobox com busca (WAI-ARIA 1.2, autocomplete=list): digita para filtrar, setas navegam. */
export function WorkspaceCombobox({ id, label, options, value, onChange }: WorkspaceComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options.find(option => option.value === value);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? options.filter(option => option.label.toLowerCase().includes(term)) : options;
  }, [options, query]);

  // Mantém a opção ativa visível ao navegar pelo teclado.
  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);

  const openList = () => {
    if (open) return;
    setQuery('');
    setActive(
      Math.max(
        0,
        options.findIndex(option => option.value === value)
      )
    );
    setOpen(true);
  };

  const choose = (option: ComboboxOption | undefined) => {
    if (option) onChange(option.value);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openList();
        else setActive(index => Math.min(index + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openList();
        else setActive(index => Math.max(index - 1, 0));
        break;
      case 'Enter':
        if (open) {
          event.preventDefault();
          choose(filtered[active]);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          setQuery('');
        }
        break;
    }
  };

  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <div className="ws-combobox">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && filtered.length > 0 ? optionId(active) : undefined}
        placeholder="Buscar workspace"
        value={open ? query : (selected?.label ?? '')}
        onFocus={openList}
        onClick={openList}
        onBlur={() => {
          setOpen(false);
          setQuery('');
        }}
        onChange={event => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={`${label}s disponíveis`}
        className="ws-combobox__list"
        hidden={!open}
      >
        {open && filtered.length === 0 && (
          <li className="ws-combobox__empty" role="presentation">
            Nenhum workspace encontrado.
          </li>
        )}
        {open &&
          filtered.map((option, index) => (
            // Teclado é tratado pelo input (aria-activedescendant); a opção só recebe o mouse.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === value}
              className={`ws-combobox__option${index === active ? ' ws-combobox__option--active' : ''}`}
              // Mantém o foco no input: o blur fecharia a lista antes do clique.
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(option)}
            >
              {option.label}
            </li>
          ))}
      </ul>
      <span className="users-tab__sr-only" role="status">
        {open ? `${filtered.length} resultados` : ''}
      </span>
    </div>
  );
}

export default WorkspaceCombobox;
