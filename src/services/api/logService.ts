import apiClient from '../api';
import type { ClientLogEntry, ClientLogLevel } from '../../types/clientLog';
import { sanitizeLogContext, sanitizeLogMessage } from '../../utils/logSanitizer';

// A API só aceita Debug|Information|Warning|Error em POST /api/logs/client; enviar 'info'/'warn'
// resultava em 400 engolido em silêncio e o evento nunca chegava ao log do servidor.
const apiLevels: Record<ClientLogLevel, string> = {
  info: 'Information',
  warn: 'Warning',
  error: 'Error',
};

/**
 * Envia eventos de diagnóstico do front-end para a API (POST /api/logs/client), em vez de
 * `console.log` solto — decisão do usuário para termos visibilidade centralizada dos erros
 * que hoje só apareciam no console do navegador.
 *
 * Nunca deve derrubar o fluxo do usuário: falha ao logar é engolida sem imprimir erro,
 * entry ou payload no console.
 */
const send = (level: ClientLogLevel, message: string, context?: Record<string, unknown>): void => {
  const entry: ClientLogEntry = {
    level,
    message: sanitizeLogMessage(message),
    context: sanitizeLogContext(context),
    timestamp: new Date().toISOString(),
  };

  apiClient.post('/api/logs/client', { ...entry, level: apiLevels[level] }).catch(() => undefined);
};

export const logService = {
  info: (message: string, context?: Record<string, unknown>) => send('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => send('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => send('error', message, context),
};
