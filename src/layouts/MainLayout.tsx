import React, { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import AuthenticationGate from '../components/auth/AuthenticationGate';
import HomePage from '../components/marketing/HomePage';
import NotificationBell from '../components/notifications/NotificationBell';
import WorkspaceSwitcher from '../components/workspace/WorkspaceSwitcher';
import { sessionService } from '../services/api/sessionService';
import { useAppStore } from '../store/useAppStore';
import { useSessionStore } from '../store/useSessionStore';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { SESSION_EXPIRED_EVENT } from '../types/session';
import './MainLayout.css';

export const MainLayout: React.FC = () => {
  const { parseResult } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { status, authenticated, user, isAdmin, error, loadSession, expireSession } =
    useSessionStore();
  const { loadWorkspaces, reset: resetWorkspace } = useWorkspaceStore();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const searchParameters = new URLSearchParams(location.search);
  const authError = searchParameters.get('authError');
  searchParameters.delete('authError');
  const cleanSearch = searchParameters.toString();
  const returnTo = `${location.pathname}${cleanSearch ? `?${cleanSearch}` : ''}${location.hash}`;

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, expireSession);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expireSession);
  }, [expireSession]);

  useEffect(() => {
    // O workspace possui persistência SQL própria na API e não pode se tornar dependência
    // implícita do fluxo legado de parse. Carregamos ao entrar na área fiscal; depois disso o
    // store em memória mantém o seletor disponível durante a navegação autenticada.
    if (status === 'authenticated' && authenticated && location.pathname.startsWith('/workspace')) {
      void loadWorkspaces();
      return;
    }

    if (status === 'unauthenticated' || status === 'error') {
      resetWorkspace();
    }
  }, [authenticated, loadWorkspaces, location.pathname, resetWorkspace, status]);

  // Redirecionar para /upload se estiver em /analysis sem parseResult
  useEffect(() => {
    if (location.pathname === '/analysis' && (!parseResult || !parseResult.success)) {
      navigate('/upload', { replace: true });
    }
  }, [location.pathname, parseResult, navigate]);

  if (status === 'idle' || status === 'loading') {
    return (
      <AuthenticationGate
        status="loading"
        returnTo={returnTo}
        onRetry={() => void loadSession(true)}
      />
    );
  }

  if (status === 'error') {
    return (
      <AuthenticationGate
        status="error"
        returnTo={returnTo}
        infrastructureError={error}
        onRetry={() => void loadSession(true)}
      />
    );
  }

  if (!authenticated) {
    // A home pública (apresentação do produto + login) só aparece em "/"; demais rotas
    // protegidas continuam mostrando o gate de autenticação focado em retomar o acesso.
    if (location.pathname === '/') {
      return <HomePage returnTo={returnTo} authError={authError} />;
    }

    return (
      <AuthenticationGate
        status="unauthenticated"
        returnTo={returnTo}
        authError={authError}
        onRetry={() => void loadSession(true)}
      />
    );
  }

  const userName = user?.name || 'Conta Microsoft';
  const userInitial = userName.trim().charAt(0).toLocaleUpperCase('pt-BR') || 'U';

  // SPA sem fallback sem-JS relevante: POST via fetch (sem body/Content-Type) evita o form
  // HTML nativo, que sempre envia application/x-www-form-urlencoded e é rejeitado pelo BFF
  // (sem parser registrado para esse content-type) com 415. A navegação de página inteira ao
  // final garante estado limpo (sessão, stores) equivalente ao redirect 303 que o form fazia.
  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }
    setIsLoggingOut(true);
    try {
      await sessionService.logout();
    } catch {
      // Mesmo se a chamada falhar (ex.: rede), seguimos para '/' — o gate de autenticação
      // revalida a sessão via /api/session no próximo carregamento.
    } finally {
      resetWorkspace();
      window.location.assign('/');
    }
  };

  return (
    <div className="main-layout">
      <header className="session-bar">
        <Link to="/workspace" className="session-brand" aria-label="Ir para o workspace fiscal">
          <img src="/layoutparser-mark.svg" alt="" />
          <span>LayoutParser</span>
        </Link>
        <div className="session-account">
          <WorkspaceSwitcher />
          {isAdmin && (
            <Link to="/admin" className="session-admin-link">
              Administração
            </Link>
          )}
          <NotificationBell />
          <span className="session-avatar" aria-hidden="true">
            {userInitial}
          </span>
          <span className="session-user" title={userName}>
            {userName}
          </span>
          <button
            type="button"
            className="session-logout"
            onClick={() => void handleLogout()}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? 'Saindo...' : 'Sair'}
          </button>
        </div>
      </header>
      <main className="main-content">
        <div className="main-content-area">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default MainLayout;
