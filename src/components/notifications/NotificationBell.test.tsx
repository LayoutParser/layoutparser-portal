import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import NotificationBell from './NotificationBell';

describe('NotificationBell', () => {
  it('abre e fecha o painel como disclosure', () => {
    render(<NotificationBell />);
    const button = screen.getByRole('button', { name: 'Notificações' });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Notificações' })).toBeVisible();
    expect(screen.getByText('Você não tem notificações.')).toBeVisible();

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('fecha com Esc devolvendo o foco ao sino', () => {
    render(<NotificationBell />);
    const button = screen.getByRole('button', { name: 'Notificações' });
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole('region', { name: 'Notificações' }), { key: 'Escape' });

    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it('fecha ao clicar fora', () => {
    render(<NotificationBell />);
    const button = screen.getByRole('button', { name: 'Notificações' });
    fireEvent.click(button);
    fireEvent.mouseDown(document.body);

    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('mostra badge e rótulo com não lidas, com teto em 9+', () => {
    const { rerender } = render(<NotificationBell unreadCount={3} />);
    expect(screen.getByRole('button', { name: 'Notificações, 3 não lidas' })).toBeVisible();
    expect(screen.getByText('3')).toBeInTheDocument();

    rerender(<NotificationBell unreadCount={12} />);
    expect(screen.getByText('9+')).toBeInTheDocument();

    rerender(<NotificationBell unreadCount={0} />);
    expect(screen.queryByText('9+')).not.toBeInTheDocument();
  });
});
