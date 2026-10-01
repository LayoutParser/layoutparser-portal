import { useEffect } from 'react';
import './Toast.css';

interface ToastProps {
  kind: 'success' | 'error';
  message: string;
  onDismiss: () => void;
  /** Tempo até sumir sozinho; erros ficam mais tempo para dar chance de leitura. */
  durationMs?: number;
}

/** Feedback leve: sucesso em role=status (educado), erro em role=alert (assertivo). */
export function Toast({ kind, message, onDismiss, durationMs }: ToastProps) {
  const timeout = durationMs ?? (kind === 'error' ? 8000 : 5000);

  useEffect(() => {
    const timer = window.setTimeout(onDismiss, timeout);
    return () => window.clearTimeout(timer);
  }, [message, timeout, onDismiss]);

  return (
    <div className="toast-region">
      <div className={`toast toast--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
        <span className="toast__message">{message}</span>
        <button
          type="button"
          className="toast__close"
          aria-label="Dispensar aviso"
          onClick={onDismiss}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}

export default Toast;
