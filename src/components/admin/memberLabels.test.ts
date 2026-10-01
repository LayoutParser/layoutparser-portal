import { describe, expect, it } from 'vitest';
import { displayLabel, emailOrId, initialsOf } from './memberLabels';

describe('memberLabels com e-mail ausente', () => {
  it('usa userId abreviado quando não há e-mail', () => {
    expect(emailOrId({ userId: 'abcdef1234567890' })).toBe('sem e-mail · abcdef12');
    expect(emailOrId({ userId: 'x', email: 'a@b.test' })).toBe('a@b.test');
  });

  it('displayLabel prefere nome, depois e-mail, depois userId', () => {
    expect(displayLabel({ userId: 'u', displayName: 'Ana Souza', email: 'a@b.test' })).toBe(
      'Ana Souza'
    );
    expect(displayLabel({ userId: 'abcdef1234', email: null })).toBe('sem e-mail · abcdef12');
  });

  it('gera iniciais sem nome nem e-mail', () => {
    expect(initialsOf(undefined, undefined, 'abcdef')).toBe('AB');
    expect(initialsOf(undefined, undefined)).toBe('?');
  });
});
