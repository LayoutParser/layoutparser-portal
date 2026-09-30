import React, { useState } from 'react';
import {
  MappingDraftRequestError,
  mappingDraftService,
} from '../../services/api/mappingDraftService';
import type { MappingDraft } from '../../types/mappingDraft';
import type { FiscalDocumentType } from '../../types/workspace';

interface MappingFiscalProfilePanelProps {
  workspaceId: string;
  draft: MappingDraft;
  onDraftChange: (draft: MappingDraft) => void;
}

const documentTypeOptions: Array<{ value: FiscalDocumentType; label: string }> = [
  { value: 'nfe', label: 'NF-e' },
  { value: 'cte', label: 'CT-e' },
  { value: 'mdfe', label: 'MDF-e' },
  { value: 'nfse', label: 'NFS-e' },
  { value: 'nfcom', label: 'NFCom' },
];

/**
 * Perfil fiscal do draft (issue #198). PUT .../mapping-drafts/{draftId}/fiscal-profile via
 * `mappingDraftService.setFiscalProfile`. `resolvedXsd` é derivado pela API — somente leitura.
 */
const MappingFiscalProfilePanel = ({
  workspaceId,
  draft,
  onDraftChange,
}: MappingFiscalProfilePanelProps) => {
  const existing = draft.fiscalProfile;
  const [documentType, setDocumentType] = useState<FiscalDocumentType>(
    existing?.documentType ?? 'nfe'
  );
  const [schemaVersion, setSchemaVersion] = useState(existing?.schemaVersion ?? '');
  const [operation, setOperation] = useState(existing?.operation ?? '');
  const [jurisdiction, setJurisdiction] = useState(existing?.jurisdiction ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!schemaVersion.trim() || !operation.trim()) {
      setError('Versão do schema e operação são obrigatórias.');
      setSuccess(null);
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await mappingDraftService.setFiscalProfile({
        workspaceId,
        draftId: draft.draftId,
        profile: {
          documentType,
          schemaVersion: schemaVersion.trim(),
          operation: operation.trim(),
          ...(jurisdiction.trim() ? { jurisdiction: jurisdiction.trim() } : {}),
        },
      });
      onDraftChange(updated);
      setSuccess('Perfil fiscal salvo.');
    } catch (submitError) {
      if (submitError instanceof MappingDraftRequestError) {
        setError(
          submitError.kind === 'not_found'
            ? 'Este draft não foi encontrado — ele pode ter sido removido ou arquivado.'
            : submitError.message
        );
      } else {
        setError(
          submitError instanceof Error
            ? submitError.message
            : 'Não foi possível salvar o perfil fiscal.'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mapping-studio-section" aria-labelledby="mapping-fiscal-profile-title">
      <div className="mapping-section-heading">
        <div>
          <p className="mapping-kicker">Issue #198</p>
          <h2 id="mapping-fiscal-profile-title">Perfil fiscal do draft</h2>
          <p>
            Define o tipo de documento fiscal, versão de schema e operação usados para resolver o
            XSD e calcular a cobertura obrigatória das releases.
          </p>
        </div>
      </div>

      <form className="mapping-rule-form" onSubmit={event => void handleSubmit(event)}>
        <label htmlFor="fiscal-profile-document-type">
          Tipo de documento
          <select
            id="fiscal-profile-document-type"
            value={documentType}
            onChange={event => setDocumentType(event.target.value as FiscalDocumentType)}
          >
            {documentTypeOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="fiscal-profile-schema-version">
          Versão do schema
          <input
            id="fiscal-profile-schema-version"
            value={schemaVersion}
            onChange={event => setSchemaVersion(event.target.value)}
            placeholder="ex.: 4.00"
            required
            aria-describedby={error ? 'fiscal-profile-error' : undefined}
          />
        </label>
        <label htmlFor="fiscal-profile-operation">
          Operação
          <input
            id="fiscal-profile-operation"
            value={operation}
            onChange={event => setOperation(event.target.value)}
            placeholder="ex.: saida_interestadual"
            required
            aria-describedby={error ? 'fiscal-profile-error' : undefined}
          />
        </label>
        <label htmlFor="fiscal-profile-jurisdiction">
          Jurisdição (opcional)
          <input
            id="fiscal-profile-jurisdiction"
            value={jurisdiction}
            onChange={event => setJurisdiction(event.target.value)}
            placeholder="ex.: SP"
          />
        </label>

        {error && (
          <p id="fiscal-profile-error" className="mapping-inline-error" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="mapping-job-status" role="status">
            {success}
          </p>
        )}

        <button type="submit" className="mapping-button mapping-button--primary" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar perfil fiscal'}
        </button>
      </form>

      {draft.resolvedXsd && (
        <dl className="mapping-rule-facts">
          <div>
            <dt>XSD resolvido</dt>
            <dd>{draft.resolvedXsd.xsdVersion}</dd>
          </div>
          <div>
            <dt>Elemento raiz</dt>
            <dd>{draft.resolvedXsd.rootElement}</dd>
          </div>
        </dl>
      )}
      {!draft.resolvedXsd && draft.fiscalProfile && (
        <p className="mapping-limitations">
          A API ainda não devolveu o XSD resolvido para este perfil.
        </p>
      )}
    </section>
  );
};

export default MappingFiscalProfilePanel;
