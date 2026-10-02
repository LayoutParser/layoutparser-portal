import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { mappingReleaseService } from '../../services/api/mappingReleaseService';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import type { MappingGeneratedTransformation } from '../../types/mappingRelease';
import './MappingStudioPage.css';

const pollIntervalMs = 3000;

/**
 * Visualiza o TCL/XSLT gerado automaticamente para um mapeador Sysmiddle (item do catálogo de
 * releases com `origin: 'auto_generated'`). Somente leitura; enquanto a API responde `generating`
 * a página consulta de novo até o conteúdo ficar pronto.
 */
const GeneratedMapperPage = () => {
  const { mapperGuid = '' } = useParams();
  const { activeWorkspaceId } = useWorkspaceStore();
  const [result, setResult] = useState<MappingGeneratedTransformation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const waiting = result === null || result.status === 'generating';

  useEffect(() => {
    if (!activeWorkspaceId || !mapperGuid || !waiting || error) return;

    let disposed = false;
    const timer = window.setTimeout(
      () => {
        void mappingReleaseService
          .getGeneratedTransformation(activeWorkspaceId, mapperGuid)
          .then(next => {
            if (!disposed) setResult(next);
          })
          .catch(loadError => {
            if (disposed) return;
            setError(
              loadError instanceof Error
                ? loadError.message
                : 'Não foi possível carregar o mapeador gerado.'
            );
          });
      },
      result === null ? 0 : pollIntervalMs
    );

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [activeWorkspaceId, mapperGuid, waiting, error, result]);

  const coverage = result?.generatedCoverage;

  return (
    <main className="mapping-studio-page">
      <section className="mapping-studio-section" aria-labelledby="generated-mapper-title">
        <p className="mapping-kicker">Mapeador gerado automaticamente</p>
        <h1 id="generated-mapper-title">{mapperGuid}</h1>
        <Link to="/workspace/mapping-studio">Voltar ao catálogo</Link>

        {error && <p role="alert">{error}</p>}

        {!error && waiting && (
          <p aria-busy="true" aria-live="polite">
            <span className="mapping-loader" aria-hidden="true" /> Gerando o TCL/XSLT…
          </p>
        )}

        {result?.status === 'none' && <p>Não há conteúdo a gerar para este mapeador.</p>}

        {result?.status === 'ready' && (
          <>
            <p>
              {result.validationBasis && (
                <span
                  className="mapping-status-badge mapping-status-badge--generated"
                  title="Cobertura calculada contra a regra declarada do mapeador Sysmiddle, não contra uma execução real."
                >
                  {result.validationBasis}
                </span>
              )}
              {coverage?.linkPct && <span> · links {coverage.linkPct}</span>}
              {coverage?.rulePct && <span> · regras {coverage.rulePct}</span>}
              {result.generatedAt && (
                <span> · gerado em {new Date(result.generatedAt).toLocaleString('pt-BR')}</span>
              )}
            </p>
            {coverage?.compiles === false && (
              <p role="alert">Não compila: {coverage.compileError ?? 'erro não informado'}</p>
            )}
            {coverage && coverage.limitations.length > 0 && (
              <details>
                <summary>Limitações do gerador ({coverage.limitations.length})</summary>
                <ul>
                  {coverage.limitations.map(limitation => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </details>
            )}
            <pre className="mapping-generated-content" aria-label="Conteúdo TCL/XSLT gerado">
              <code>{result.content ?? ''}</code>
            </pre>
          </>
        )}
      </section>
    </main>
  );
};

export default GeneratedMapperPage;
