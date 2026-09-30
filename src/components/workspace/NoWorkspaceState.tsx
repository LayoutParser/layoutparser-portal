import { useEffect, useRef } from 'react';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import { Button } from '../shared/Button';
import './NoWorkspaceState.css';

// Mesmo texto para "não existe" e "sem acesso": não revela nome, contagem nem admin.
const NoWorkspaceState = () => {
  const loadWorkspaces = useWorkspaceStore(state => state.loadWorkspaces);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main className="workspace-page workspace-page--centered">
      <section className="workspace-state-card no-workspace-state">
        <h1 ref={headingRef} tabIndex={-1}>
          Você ainda não tem acesso a um workspace
        </h1>
        <p>
          Peça ao administrador da sua equipe para adicionar você. Assim que isso acontecer,
          avisaremos aqui e no sino.
        </p>
        <Button onClick={() => void loadWorkspaces(true)}>Atualizar</Button>
      </section>
    </main>
  );
};

export default NoWorkspaceState;
