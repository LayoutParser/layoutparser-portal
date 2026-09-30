import { describe, expect, it } from 'vitest';
import { normalizeEmail } from '../src/auth.js';

describe('normalizeEmail', () => {
  it('normaliza para minúsculas e remove espaços', () => {
    expect(normalizeEmail('  Pessoa@Example.TEST ')).toBe('pessoa@example.test');
  });

  it.each(['sem-arroba', 'a@b', 'a b@example.test', 'josé@example.test', 'a@exämple.test'])(
    'recusa e-mail inválido ou fora do ASCII imprimível: %s',
    value => {
      expect(normalizeEmail(value)).toBeNull();
    }
  );

  it('recusa valor que não é string e e-mail acima de 320 caracteres', () => {
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(`${'a'.repeat(320)}@example.test`)).toBeNull();
  });
});
