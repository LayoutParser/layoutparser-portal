import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useFieldStore } from '../../store/useFieldStore';
import { useSearchStore } from '../../store/useSearchStore';
import { useTraceabilityStore } from '../../store/useTraceabilityStore';
import type { DisplayGroup, Field } from '../../types/field';
import { findFirstDesyncLineIndex } from '../../utils/documentHealth';
import { getFieldPhysicalId } from '../../utils/fieldIdentity';
import DocumentHealthBanner from './DocumentHealthBanner';
import Modal from '../shared/Modal';
import './FieldDisplay.css';

const FieldDisplay: React.FC = () => {
  const { parseResult, fields, txtContent } = useAppStore();
  const { fieldGroups, selectField, highlightedFields, highlightField } = useFieldStore();
  const { searchResults, currentResultIndex } = useSearchStore();
  const { requestedFieldId, setInspectorOpen, selectXmlNode, clearFieldFocusRequest } =
    useTraceabilityStore();
  const fieldDisplayRef = useRef<HTMLDivElement>(null);
  const [rovingFieldId, setRovingFieldId] = useState<string | null>(null);
  const [mobileGroup, setMobileGroup] = useState<DisplayGroup | null>(null);

  // Usar campos do parseResult se fields estiver vazio.
  // Memoizado para estabilizar a identidade do array: o efeito de sincronização mais abaixo
  // depende dele e, sem isso, o `|| []` devolvia um array novo a cada render. O valor
  // calculado é o mesmo de antes — só a identidade passa a ser reaproveitada.
  const actualFields = useMemo(
    () => (fields.length > 0 ? fields : parseResult?.fields || []),
    [fields, parseResult?.fields]
  );
  const effectiveRovingFieldId = actualFields.some(
    field => getFieldPhysicalId(field) === rovingFieldId
  )
    ? rovingFieldId
    : actualFields[0]
      ? getFieldPhysicalId(actualFields[0])
      : null;

  // ✅ Tamanho REAL de cada linha, vindo do contrato (`lineValidations[].totalLength`).
  // Antes o arquivo inteiro assumia 600 chars fixos (convenção MQSeries) — quebrava em
  // layouts de linha variável (ex.: IDOC/SAP), onde cada segmento tem tamanho próprio.
  // A API já devolve esse dado por linha; não precisamos adivinhar.
  const lineLengthByName = useMemo(() => {
    const map = new Map<string, number>();
    parseResult?.lineValidations?.forEach(lv => {
      if (typeof lv.totalLength === 'number' && lv.totalLength > 0) {
        map.set(lv.lineName, lv.totalLength);
      }
    });
    return map;
  }, [parseResult?.lineValidations]);

  // "Grade" de 600 chars só existe em layouts de linha FIXA (convenção MQSeries), onde
  // toda linha conhecida mede exatamente 600. Só nesse caso faz sentido "arredondar" uma
  // posição encontrada por indexOf para o múltiplo de 600 mais próximo. Em layouts de
  // linha variável (IDOC/SAP) não há essa grade — cada linha tem seu próprio totalLength.
  const isFixedLength600Layout = useMemo(() => {
    const lengths = Array.from(lineLengthByName.values());
    return lengths.length > 0 && lengths.every(len => len === 600);
  }, [lineLengthByName]);

  // Fallback só quando a API não informou totalLength para a linha (layout mal
  // configurado no back-end) — não é suposição de layout, é o último recurso, sinalizado
  // em DEV, já usado antes desta função existir.
  const FALLBACK_LINE_LENGTH = 600;
  const getLineLength = (lineName: string): number => {
    const known = lineLengthByName.get(lineName);
    if (typeof known === 'number' && known > 0) return known;
    if (import.meta.env.DEV) {
      console.warn(
        `⚠️ Linha "${lineName}" sem totalLength em lineValidations; usando fallback de ${FALLBACK_LINE_LENGTH} caracteres.`
      );
    }
    return FALLBACK_LINE_LENGTH;
  };

  // Função comentada - não utilizada (número da linha agora é sequencial)
  // const getLineInitialValue = (lineName: string): string | null => {
  //   if (!parseResult?.layout?.elements) return null;
  //
  //   const lineElement = parseResult.layout.elements.find(
  //     (el: any) => el.type === 'LineElementVO' && el.name === lineName
  //   );
  //
  //   return lineElement?.initialValue || null;
  // };

  useEffect(() => {
    // Quando há resultados de busca, destacar o campo atual
    if (searchResults.length > 0 && currentResultIndex >= 0) {
      const currentResult = searchResults[currentResultIndex];
      if (currentResult) {
        const fieldId = getFieldPhysicalId(currentResult.field);
        highlightField(fieldId);
        selectField(currentResult.field);
        setInspectorOpen(true);
      }
    }
  }, [searchResults, currentResultIndex, highlightField, selectField, setInspectorOpen]);

  const handleFieldClick = (field: Field) => {
    selectField(field);
    selectXmlNode(null);
    setInspectorOpen(true);
    setRovingFieldId(getFieldPhysicalId(field));
  };

  const isFieldHighlighted = (field: Field): boolean => {
    return highlightedFields.has(getFieldPhysicalId(field));
  };

  const isFieldInSearch = (field: Field): boolean => {
    const fieldId = getFieldPhysicalId(field);
    return searchResults.some(result => getFieldPhysicalId(result.field) === fieldId);
  };

  // Sincronizar campos com o store se necessário
  useEffect(() => {
    if (actualFields.length > 0) {
      const { setFields: setFieldsInStore } = useFieldStore.getState();
      setFieldsInStore(actualFields);
    }
  }, [actualFields]);

  useEffect(() => {
    if (!requestedFieldId) return;
    const requestedButton = Array.from(
      fieldDisplayRef.current?.querySelectorAll<HTMLButtonElement>('[data-field-id]') ?? []
    ).find(button => button.dataset.fieldId === requestedFieldId);
    if (!requestedButton) return;

    setRovingFieldId(requestedFieldId);
    requestedButton.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    requestedButton.focus();
    clearFieldFocusRequest();
  }, [requestedFieldId, clearFieldFocusRequest]);

  const focusFieldButton = (button: HTMLButtonElement | undefined) => {
    if (!button?.dataset.fieldId) return;
    setRovingFieldId(button.dataset.fieldId);
    button.focus();
  };

  const handleFieldKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const allButtons = Array.from(
      fieldDisplayRef.current?.querySelectorAll<HTMLButtonElement>('[data-field-id]') ?? []
    );
    const currentIndex = allButtons.indexOf(event.currentTarget);
    if (currentIndex < 0) return;

    if (event.ctrlKey && event.key === 'Home') return focusFieldButton(allButtons[0]);
    if (event.ctrlKey && event.key === 'End') {
      return focusFieldButton(allButtons[allButtons.length - 1]);
    }

    const line = event.currentTarget.closest('.field-line-container');
    const lineButtons = Array.from(
      line?.querySelectorAll<HTMLButtonElement>('[data-field-id]') ?? []
    );
    const lineIndex = lineButtons.indexOf(event.currentTarget);
    if (event.key === 'Home') return focusFieldButton(lineButtons[0]);
    if (event.key === 'End') return focusFieldButton(lineButtons[lineButtons.length - 1]);
    if (event.key === 'ArrowLeft') {
      return focusFieldButton(lineButtons[Math.max(0, lineIndex - 1)]);
    }
    if (event.key === 'ArrowRight') {
      return focusFieldButton(lineButtons[Math.min(lineButtons.length - 1, lineIndex + 1)]);
    }

    const lines = Array.from(
      fieldDisplayRef.current?.querySelectorAll<HTMLElement>('.field-line-container') ?? []
    );
    const currentLineIndex = line instanceof HTMLElement ? lines.indexOf(line) : -1;
    const targetLine =
      event.key === 'ArrowUp'
        ? lines[Math.max(0, currentLineIndex - 1)]
        : lines[Math.min(lines.length - 1, currentLineIndex + 1)];
    const targetButtons = Array.from(
      targetLine?.querySelectorAll<HTMLButtonElement>('[data-field-id]') ?? []
    );
    const currentStart = Number(event.currentTarget.dataset.startPosition ?? 0);
    const nearest = targetButtons.reduce<HTMLButtonElement | undefined>((best, candidate) => {
      if (!best) return candidate;
      const candidateDistance = Math.abs(
        Number(candidate.dataset.startPosition ?? 0) - currentStart
      );
      const bestDistance = Math.abs(Number(best.dataset.startPosition ?? 0) - currentStart);
      return candidateDistance < bestDistance ? candidate : best;
    }, undefined);
    focusFieldButton(nearest);
  };

  // Função para extrair número da linha do nome (ex: "LINHA000" -> "000")
  const extractLineNumber = (lineName: string): string => {
    const match = lineName.match(/(\d+)$/);
    if (match) {
      return match[1].padStart(3, '0');
    }
    if (lineName === 'HEADER') return '000';
    return '000';
  };

  // Função para extrair SEMPRE apenas os últimos 3 dígitos do nome da linha
  // Ex: "LINHA096" -> "096", "LINHA999999" -> "999"
  const extractLineNumber3 = (lineName: string): string => {
    const digits = (lineName.match(/(\d+)$/)?.[1] ?? '').trim();
    if (!digits) return '000';
    return digits.slice(-3).padStart(3, '0');
  };

  // Função para extrair o sequencial do arquivo baseado na posição da linha
  const extractSequentialFromFile = (
    lineName: string,
    lineSequence: string,
    txtContent: string,
    position: number
  ): string => {
    if (!txtContent) {
      return '000001';
    }

    // HEADER: sempre é o primeiro sequencial (000001)
    if (lineName === 'HEADER' || lineSequence === 'HEADER') {
      return '000001';
    }

    if (position < 0) {
      return '000000';
    }

    // Para outras linhas, o sequencial está nas primeiras 6 posições do início físico da linha.
    // Em layout de linha FIXA (600, MQSeries) a posição encontrada por indexOf é arredondada
    // para o múltiplo de 600 mais próximo (defesa contra match acidental da sequência no meio
    // do conteúdo). Em layout de linha VARIÁVEL (IDOC/SAP) não existe essa grade — confiamos
    // diretamente na posição encontrada.
    const lineStart = isFixedLength600Layout ? Math.floor(position / 600) * 600 : position;

    // O sequencial está nas posições 0-5 de cada linha
    const sequentialInFile = txtContent.substring(lineStart, lineStart + 6);

    // Verificar se é um número válido (formato: 000001, 000002, etc)
    if (/^\d{6}$/.test(sequentialInFile)) {
      return sequentialInFile;
    }

    return '000000';
  };

  // Função para calcular a posição da linha no arquivo baseado no lineSequence
  const calculateLinePosition = (lineSequence: string, txtContent: string): number => {
    if (!txtContent || !lineSequence) return -1;
    // Procurar a sequência no texto (formato: 000001, 000002, etc)
    const index = txtContent.indexOf(lineSequence);
    return index >= 0 ? index : -1;
  };

  // Criar grupos se fieldGroups estiver vazio mas houver campos
  // Agrupar por lineSequence + occurrence para manter múltiplas ocorrências da mesma linha
  const displayGroups: DisplayGroup[] =
    fieldGroups.length > 0
      ? fieldGroups
      : (() => {
          if (actualFields.length === 0) return [];
          const groupsMap = new Map<string, Field[]>();

          // Agrupar por lineSequence + occurrence para distinguir múltiplas ocorrências
          actualFields.forEach(field => {
            const lineName = field.lineName || 'OUTROS';
            const lineSequence = field.lineSequence || extractLineNumber(lineName);
            const occurrence = field.occurrence ?? 1;
            // Chave única: lineSequence + occurrence para distinguir múltiplas ocorrências
            const key = `${lineSequence}_${occurrence}_${lineName}`;

            if (!groupsMap.has(key)) {
              groupsMap.set(key, []);
            }
            groupsMap.get(key)!.push(field);
          });

          return Array.from(groupsMap.entries())
            .map(([, fields]) => {
              const lineName = fields[0]?.lineName || 'OUTROS';
              const lineSequence = fields[0]?.lineSequence || extractLineNumber(lineName);
              let position = -1;

              // HEADER: se lineSequence é "HEADER", procurar diretamente no texto
              if (lineSequence === 'HEADER' || lineName === 'HEADER') {
                position = txtContent.indexOf('HEADER');
              } else {
                // Para outras linhas, procurar pelo lineSequence no texto
                position = calculateLinePosition(lineSequence, txtContent);
              }

              // Extrair sequencial do arquivo
              const sequential = extractSequentialFromFile(
                lineName,
                lineSequence,
                txtContent,
                position
              );

              return {
                lineName,
                fields: fields.sort((a, b) => (a.sequence || 0) - (b.sequence || 0)),
                sequence: fields[0]?.sequence || 0,
                lineSequence,
                position,
                sequential,
                occurrence: fields[0]?.occurrence ?? 1,
              };
            })
            .sort((a, b) => {
              // Ordenar por posição no arquivo
              if (a.position >= 0 && b.position >= 0) {
                return a.position - b.position;
              }

              // HEADER sempre primeiro se não tiver posição calculada
              if (a.lineName === 'HEADER' || a.lineSequence === 'HEADER') return -1;
              if (b.lineName === 'HEADER' || b.lineSequence === 'HEADER') return 1;

              // Fallback: ordenar por sequencial numérico
              const seqA = parseInt(a.sequential || '0', 10);
              const seqB = parseInt(b.sequential || '0', 10);
              if (seqA !== seqB) return seqA - seqB;

              // Se mesmo sequencial, ordenar por occurrence
              return (a.occurrence ?? 1) - (b.occurrence ?? 1);
            });
        })();

  if (!actualFields || actualFields.length === 0) {
    return (
      <div className="field-display-empty">
        {/* Também aqui: um 200 com defeito e sem campos renderizáveis não pode terminar em
            "nenhum campo disponível" sem dizer que o documento tem defeito. */}
        <DocumentHealthBanner />
        <p>Nenhum campo disponível. Processe um documento primeiro.</p>
        {parseResult && parseResult.success && (
          <p className="field-display-empty__details">
            O documento foi processado, mas a resposta não contém campos para exibição.
          </p>
        )}
      </div>
    );
  }

  // ✅ Verificar se há erros de validação no documento
  const validationErrors = parseResult?.validationErrors || [];

  // O CORTE da exibição é condicionado à CLASSE do erro, não à mera existência de erro.
  // Só erro de tamanho de linha desloca os offsets seguintes; erro de conteúdo (sequência
  // inválida etc.) não move nada e não pode esconder o resto do documento. Ver
  // `isDesyncingValidationError`. Antes, qualquer erro cortava — e num caso real 46 registros
  // alinhados sumiam da tela por causa de erros de sequência.
  const firstDesyncLineIndex = findFirstDesyncLineIndex(validationErrors);
  const isTruncated = firstDesyncLineIndex >= 0;

  // ✅ Índice físico da linha no TXT (0-based).
  // Em layout de linha FIXA (600, MQSeries), blocos de 600 chars permitem derivar o índice
  // a partir da posição em bytes (mais confiável que o índice do array). Em layout de linha
  // VARIÁVEL (IDOC/SAP) essa divisão não tem significado nenhum — cada linha tem tamanho
  // próprio — então usamos a ordem sequencial já estabelecida em `displayGroups` (mesma
  // ordem que `validationErrors[].lineIndex` referencia).
  const getPhysicalLineIndex = (group: DisplayGroup, fallbackIndex: number): number => {
    if (isFixedLength600Layout) {
      const pos = group?.position;
      if (typeof pos === 'number' && pos >= 0) {
        return Math.floor(pos / 600);
      }
    }
    return fallbackIndex;
  };

  // ✅ Renderizar apenas até a primeira linha que DESSINCRONIZA (inclusive). Sem erro desse
  // tipo, o documento inteiro é exibido — com os defeitos anotados linha a linha.
  const groupsToRender = isTruncated
    ? displayGroups.filter((g, idx) => getPhysicalLineIndex(g, idx) <= firstDesyncLineIndex)
    : displayGroups;

  // ✅ Função para verificar se uma linha tem erro específico
  //
  // Independe do corte: TODA linha com defeito é marcada, inclusive as que continuam sendo
  // exibidas depois de um erro que não dessincroniza. Marcar é o que aponta o problema ao
  // usuário; cortar é só a proteção contra exibir dado desalinhado.
  const isLineWithError = (lineIndex: number): boolean =>
    validationErrors.some(error => error.lineIndex === lineIndex);

  // ✅ Função para identificar qual campo específico está causando erro na linha
  const getProblematicField = (
    group: DisplayGroup,
    groupIndex: number
  ): { fieldName: string; issue: string; expectedSize?: number; actualSize?: number } | null => {
    const lineError = validationErrors.find(error => error.lineIndex === groupIndex);
    if (!lineError) return null;

    // ✅ IDENTIDADE DE CAMPO VINDA DO BACK-END tem precedência absoluta sobre a heurística
    // abaixo (spec "Taxonomia de falha do parse" §3). A heurística deduz o campo por
    // aritmética de posição acumulada — é chute educado, e chute não deve competir com quem
    // validou o documento. Enquanto `fieldName` vier null/ausente, seguimos na heurística.
    //
    // ⚠️ `recordName`/`recordGuid` NÃO entram aqui de propósito, mesmo sendo o que o back-end
    // realmente emite hoje: eles identificam o REGISTRO (a linha inteira), não um campo dela.
    // Usá-los para destacar um campo específico seria apresentar dado de segmento como se
    // fosse de campo — exatamente o erro que a spec §5.1 recusou ao manter `fieldGuid` nulo.
    // A identidade de registro aparece no DocumentHealthBanner, onde o rótulo é honesto.
    const reportedField = lineError.fieldName?.trim();
    if (reportedField) {
      return {
        fieldName: reportedField,
        issue: lineError.errorMessage || 'Campo apontado como defeituoso pela validação',
        expectedSize: lineError.expectedLength,
        actualSize: lineError.actualLength,
      };
    }

    // Para linhas com erro de tamanho, identificar qual campo está causando o problema
    const displayFields = group.fields
      .filter((field: Field) => !field.fieldName?.toUpperCase().includes('SEQUENCIA'))
      .sort(
        (a: Field, b: Field) =>
          (a.startPosition ?? a.sequence ?? 0) - (b.startPosition ?? b.sequence ?? 0)
      );

    // Calcular posições cumulativas para identificar onde o problema ocorre
    let currentPosition = 0;
    const sequenceLength = 6; // Sequencial sempre 6 chars
    const lineNumberLength = 3; // Número da linha sempre 3 chars
    // Tamanho real da linha (vem de lineValidations; fallback sinalizado se ausente).
    const lineLength = getLineLength(group.lineName);

    // Adicionar sequencial e número da linha
    currentPosition += sequenceLength + lineNumberLength;

    // Verificar cada campo
    for (const field of displayFields) {
      const fieldStart = field.startPosition ? field.startPosition - 1 : currentPosition; // converter para 0-based
      const fieldLength = field.length || field.value?.length || 1;

      // Se a posição do campo + seu tamanho excederia o tamanho real da linha, este campo é problemático
      if (fieldStart + fieldLength > lineLength) {
        return {
          fieldName: field.fieldName || 'Campo Desconhecido',
          issue: `Campo excede limite de ${lineLength} caracteres da linha`,
          expectedSize: lineLength - fieldStart,
          actualSize: fieldLength,
        };
      }

      // Se chegamos ao limite da linha antes de processar todos os campos
      if (currentPosition >= lineLength) {
        return {
          fieldName: field.fieldName || 'Campo Desconhecido',
          issue: `Campo não cabe na linha (limite de ${lineLength} caracteres atingido)`,
          expectedSize: 0,
          actualSize: fieldLength,
        };
      }

      currentPosition = fieldStart + fieldLength;
    }

    // Se não encontrou campo específico, pode ser um problema geral de tamanho
    return {
      fieldName: 'Estrutura da Linha',
      issue: `Linha tem ${lineError.actualLength} caracteres (esperado: ${lineError.expectedLength})`,
      expectedSize: lineError.expectedLength,
      actualSize: lineError.actualLength,
    };
  };

  return (
    <div className="field-display" ref={fieldDisplayRef}>
      {/* Estado "200 com defeito": o documento continua abaixo, com os defeitos anotados.
          Substitui o alerta inline que só aparecia quando `validationWarning` vinha
          preenchido — a decisão agora é do `documentHealth`/`validationErrors`. */}
      <DocumentHealthBanner />

      {/* Nota de leitura específica desta aba: o corte das linhas seguintes é comportamento
          do FieldDisplay, não do payload, então não pertence ao banner de saúde. Só aparece
          quando o corte REALMENTE aconteceu — anunciar corte inexistente faria o usuário
          procurar linhas que estão logo ali na tela. */}
      {isTruncated && (
        <p className="field-display-truncation-note">
          O documento é posicional: um tamanho de linha errado desalinha tudo o que vem depois,
          então a exibição vai até a primeira linha com tamanho incorreto (destacada em vermelho) e
          para. Os demais defeitos ficam marcados no documento, sem interromper a exibição.
        </p>
      )}

      {groupsToRender.map((group, groupIndex) => {
        const groupData: DisplayGroup = group;
        const physicalLineIndex = getPhysicalLineIndex(groupData, groupIndex);
        const isHeader = group.lineName === 'HEADER' || groupData.lineSequence === 'HEADER';
        const isLine999999 = group.lineName === 'LINHA999999' || group.lineName?.includes('999999');

        // ✅ Obter informação de ocorrência para exibição
        const occurrence = groupData.occurrence ?? 1;
        const hasMultipleOccurrences =
          groupsToRender.filter(g => g.lineName === group.lineName).length > 1;

        // ✅ Verificar se esta linha tem erro de validação
        // Calcular posição da linha no TXT (baseado no índice do grupo)
        // let lineStartPosition = -1; - não usado diretamente, calculado quando necessário

        const hasLineError = isLineWithError(physicalLineIndex);
        const problematicField = hasLineError
          ? getProblematicField(group, physicalLineIndex)
          : null;

        // Determinar o sequencial a ser exibido (6 dígitos) - sempre do TXT
        // Extrair diretamente do txtContent (primeiras 6 posições de cada linha)
        let displaySequential = '000000';

        // `position` só existe nos grupos derivados aqui; vindo do store é undefined.
        // O -1 reproduz o comportamento anterior, em que `undefined >= 0` já era falso.
        const groupPosition = groupData.position ?? -1;
        if (txtContent && groupPosition >= 0) {
          const lineStart = isFixedLength600Layout
            ? Math.floor(groupPosition / 600) * 600
            : groupPosition;
          const sequentialInFile = txtContent.substring(lineStart, lineStart + 6);
          if (sequentialInFile) {
            displaySequential = sequentialInFile;
          }
        }

        // Para HEADER, se não encontrou no TXT, usar "HEADER" como fallback
        if (isHeader && displaySequential === '000000') {
          displaySequential = 'HEADER';
        }

        // O número da linha agora é calculado posteriormente como lineNumberFromJson

        // Filtrar e ordenar campos (excluir Sequencia, incluir Filler)
        const displayFields = group.fields
          .filter(field => {
            const fieldNameUpper = field.fieldName?.toUpperCase() || '';
            return fieldNameUpper !== 'SEQUENCIA';
          })
          .sort((a, b) => {
            // Ordenar campos por startPosition ou sequence para manter ordem correta
            const posA = a.startPosition ?? a.sequence ?? 0;
            const posB = b.startPosition ?? b.sequence ?? 0;
            return posA - posB;
          });

        // Usar posições calculadas do back-end (apenas para layouts configurados)
        const lineValidation = parseResult?.lineValidations?.find(
          lv => lv.lineName === group.lineName
        );

        if (lineValidation && lineValidation.calculatedPositions) {
          // Usar posições calculadas do back-end
          const calculatedPositions = lineValidation.calculatedPositions;
          if (calculatedPositions && typeof calculatedPositions === 'object') {
            displayFields.forEach(field => {
              // ⚠️ Chave do mapa NÃO é mais field.fieldName puro: layouts com nomes de campo
              // duplicados na mesma linha (ex: LINHA037/038/055/090 do layout NFe da Fiat)
              // faziam vários campos colidirem na mesma startPosition. Back-end confirmou
              // (@lp-backend-dev) chave composta "Name#Sequence", ex: "ValorDaBase...#9".
              const key =
                field.sequence !== undefined && field.sequence !== null
                  ? `${field.fieldName}#${field.sequence}`
                  : field.fieldName; // fallback defensivo se sequence não vier preenchido
              const calculatedPos = calculatedPositions[key];
              if (calculatedPos !== undefined && calculatedPos !== null) {
                field.startPosition = calculatedPos;
              } else if (import.meta.env.DEV) {
                // Chave de posição ausente/ambígua: indica layout mal configurado no
                // back-end. Diagnóstico de desenvolvimento — roda por campo, então nunca
                // deve sobrar no bundle.
                console.warn(
                  field.sequence === undefined || field.sequence === null
                    ? `⚠️ Campo "${field.fieldName}" da linha ${group.lineName} sem "sequence" definido; usar fieldName puro como chave de posição pode colidir com campos de mesmo nome na linha.`
                    : `⚠️ Chave "${key}" não encontrada em calculatedPositions para o campo "${field.fieldName}" da linha ${group.lineName}.`
                );
              }
            });
          }
        }

        // Se não há campos, retornar linha vazia
        if (displayFields.length === 0) {
          return (
            <div
              key={`${group.lineName}_${groupData.occurrence ?? 1}_${groupIndex}`}
              className="field-line-container"
            >
              <div className="field-list-inline">
                {isHeader ? (
                  <span
                    className="field-sequential field-sequential-header"
                    title="Sequencial: HEADER (000001)"
                  >
                    HEADER
                  </span>
                ) : (
                  <span className="field-sequential" title={`Sequencial: ${displaySequential}`}>
                    {displaySequential}
                  </span>
                )}
                <span className="field-line-content">
                  {' '.repeat(getLineLength(group.lineName))}
                </span>
              </div>
            </div>
          );
        }

        // Construir linha completa usando a lógica do back-end. O tamanho vem de
        // `lineValidations[].totalLength` (contrato da API) — não é mais fixo em 600, o que
        // permite layouts de linha variável (IDOC/SAP) além do fixo (600, MQSeries).
        const LINE_LENGTH = getLineLength(group.lineName);
        const lineParts: Array<{
          type: 'field' | 'space' | 'initial' | 'sequence' | 'static';
          content: string;
          field?: Field;
          start: number;
          end: number;
        }> = [];

        // IMPORTANTE: Usar APENAS os dados do JSON retornado pela API
        // O JSON já contém todas as informações parseadas:
        // - lineSequence: número da linha (3 dígitos, ex: "000", "001", "031")
        // - Campo "Sequencia": sequencial (6 dígitos) que pertence à PRÓXIMA linha
        // Para obter o sequencial da linha atual, buscar o campo "Sequencia" da linha ANTERIOR
        let sequentialFromJson = '';
        let lineNumberFromJson = '';
        let currentPos = 0;

        if (isHeader) {
          // HEADER: usar "HEADER" como sequencial (6 chars) e "HEADER" também como identificador exibido da linha
          sequentialFromJson = 'HEADER';
          lineNumberFromJson = 'HEADER';
        } else if (isLine999999) {
          // LINHA999999: usar sequencial do JSON se existir; caso contrário, usar "999999"
          const seqCandidate = String(groupData.lineSequence || groupData.sequential || '').trim();
          sequentialFromJson = /^\d{6}$/.test(seqCandidate) ? seqCandidate : '999999';
          lineNumberFromJson = extractLineNumber3(group.lineName);
        } else {
          // ✅ Usar APENAS o JSON do back-end:
          // - sequencial (6 dígitos) vem do ParsedField.LineSequence (primeiros 6 chars da linha)
          // - número da linha (3 dígitos) vem do nome da linha (LINHA096 -> 096)
          const seqCandidate = String(
            groupData.lineSequence || group.fields?.[0]?.lineSequence || ''
          ).trim();
          if (/^\d{6}$/.test(seqCandidate)) {
            sequentialFromJson = seqCandidate;
          } else if (seqCandidate === 'HEADER') {
            sequentialFromJson = 'HEADER';
          } else if (/^\d+$/.test(seqCandidate)) {
            sequentialFromJson = seqCandidate.padStart(6, '0').slice(-6);
          } else {
            sequentialFromJson = '000000';
          }

          lineNumberFromJson = extractLineNumber3(group.lineName);
        }

        // 1. Adicionar sequencial (6 dígitos) - APENAS para linhas que NÃO são HEADER ou LINHA999999
        // IMPORTANTE: O sequencial vem do campo "Sequencia" da linha ANTERIOR (já parseado pela API)
        // HEADER e LINHA999999 NÃO têm sequencial, começam direto com o número da linha
        if (!isHeader && !isLine999999) {
          if (sequentialFromJson) {
            lineParts.push({
              type: 'sequence',
              content: sequentialFromJson,
              start: 0,
              end: 6,
            });
            currentPos = 6;
          } else {
            // Se não tem sequencial, começar na posição 0
            currentPos = 0;
          }
        } else {
          // HEADER e LINHA999999 não têm sequencial, mas precisam alinhar o número da linha
          // na mesma posição das outras linhas (após 6 caracteres de sequencial)
          // Não adicionar espaços - o número da linha começará na posição 0, mas será alinhado via CSS
          currentPos = 0;
        }

        // 2. Adicionar número da linha (3 dígitos) - sempre adicionar
        // IMPORTANTE: Usar lineSequence do JSON (já parseado pela API)
        if (lineNumberFromJson) {
          lineParts.push({
            type: 'initial',
            content: lineNumberFromJson,
            start: currentPos,
            end: currentPos + lineNumberFromJson.length,
          });
          currentPos += lineNumberFromJson.length;
        }

        // ✅ As posições (startPosition/length) já vêm corretas do back-end (1-based).
        // Não tentar "adivinhar" offsets no front-end.

        // OBS: O back-end não retorna o campo "Sequencia" (ele é filtrado).
        // Então não tentamos completar a linha adicionando "Sequencia" no final.

        // 4. Campos da linha (já ordenados por startPosition, SEM a tag Sequencia própria)
        // A tag Sequencia desta linha será adicionada no final para completar 600 caracteres

        // ✅ Checagem defensiva: dois campos consecutivos com startPosition idêntico ou fora de
        // ordem crescente indicam colisão na chave do mapa de posições calculadas (ex: nome de
        // campo duplicado na linha, ver comentário acima sobre calculatedPositions). Detectar
        // aqui em vez de deixar o overflow estourar silenciosamente só no total final da linha.
        for (let i = 1; i < displayFields.length; i++) {
          const prev = displayFields[i - 1];
          const curr = displayFields[i];
          if (prev.startPosition !== undefined && curr.startPosition !== undefined) {
            if (curr.startPosition <= prev.startPosition && import.meta.env.DEV) {
              console.warn(
                `⚠️ Possível nome de campo duplicado na linha ${group.lineName}: "${curr.fieldName}" (startPosition=${curr.startPosition}) não é maior que "${prev.fieldName}" (startPosition=${prev.startPosition}). Verificar mapeador/back-end (calculatedPositions).`
              );
            }
          }
        }

        displayFields.forEach(field => {
          // startPosition é sempre 1-based (vem do back-end)
          let startPos = field.startPosition ?? 0;

          // Converter para 0-based para uso interno
          if (startPos > 0) {
            startPos = startPos - 1;
          } else {
            // Se não tem startPosition, usar posição atual
            startPos = currentPos;
          }

          // Não pular campos com base em heurística de offset; confiar no startPosition do back-end.

          const fieldLength = field.length || 1; // Mínimo 1 para evitar campos invisíveis
          let fieldValue = field.value || '';

          // Se não tem valor mas tem length, preencher com espaços
          if (!fieldValue && fieldLength > 0) {
            // Para Filler, sempre usar espaços
            if (
              field.fieldName?.toUpperCase().includes('FILLER') ||
              field.fieldName?.toUpperCase() === 'FILLER'
            ) {
              fieldValue = ' '.repeat(fieldLength);
            } else {
              // Para outros campos vazios, usar espaços também para manter o layout
              fieldValue = ' '.repeat(fieldLength);
            }
          }

          // Garantir que o valor tenha o tamanho correto
          if (fieldLength > 0) {
            if (fieldValue.length < fieldLength) {
              // Preencher com espaços à direita
              fieldValue = fieldValue.padEnd(fieldLength, ' ');
            } else if (fieldValue.length > fieldLength) {
              // Truncar se for maior
              fieldValue = fieldValue.substring(0, fieldLength);
            }
          } else if (!fieldValue) {
            // Se não tem length definido e não tem valor, usar pelo menos 1 espaço
            fieldValue = ' ';
          }

          // Adicionar espaço antes do campo se necessário (reduzir espaços múltiplos)
          if (startPos > currentPos) {
            const spaceCount = startPos - currentPos;
            // Reduzir espaços múltiplos - se houver muitos espaços, usar apenas 1
            const spaceContent = spaceCount > 1 ? ' ' : ' '.repeat(spaceCount);
            lineParts.push({
              type: 'space',
              content: spaceContent,
              start: currentPos,
              end: startPos,
            });
            currentPos = startPos;
          }

          // Adicionar o campo (sempre adicionar, mesmo se startPos for negativo)
          const actualStart = Math.max(0, startPos);
          const actualLength = fieldLength || fieldValue.length || 1;

          if (actualStart + actualLength <= LINE_LENGTH) {
            lineParts.push({
              type: 'field',
              content: fieldValue,
              field: field,
              start: actualStart,
              end: actualStart + actualLength,
            });
            currentPos = actualStart + actualLength;
          } else if (actualStart < LINE_LENGTH) {
            // Campo que ultrapassa o limite, truncar
            const truncatedLength = LINE_LENGTH - actualStart;
            lineParts.push({
              type: 'field',
              content: fieldValue.substring(0, truncatedLength),
              field: field,
              start: actualStart,
              end: LINE_LENGTH,
            });
            currentPos = LINE_LENGTH;
          }
        });

        // Não adicionar "Sequencia" ao final no front-end.

        // 5. Preencher até LINE_LENGTH (tamanho real da linha) se necessário — não deveria
        // acontecer se o cálculo estiver correto.
        if (currentPos < LINE_LENGTH) {
          const missing = LINE_LENGTH - currentPos;
          lineParts.push({
            type: 'space',
            content: ' '.repeat(missing),
            start: currentPos,
            end: LINE_LENGTH,
          });
          // Linha menor que o tamanho esperado: sintoma de layout/documento desalinhado.
          // Diagnóstico só de desenvolvimento — roda por linha e cita conteúdo do documento.
          if (import.meta.env.DEV) {
            console.warn(
              `⚠️ Linha ${group.lineName} tem apenas ${currentPos} chars (esperado ${LINE_LENGTH}), preenchendo ${missing} espaços`
            );
          }
        } else if (currentPos > LINE_LENGTH && import.meta.env.DEV) {
          console.warn(
            `⚠️ Linha ${group.lineName} excedeu ${LINE_LENGTH} chars (${currentPos}), truncando`
          );
        }

        // Validar e garantir que a linha tenha exatamente LINE_LENGTH caracteres
        let fullLineContent = '';
        lineParts.forEach(part => {
          fullLineContent += part.content;
        });

        // Se não tiver LINE_LENGTH caracteres, preencher com espaços no final
        if (fullLineContent.length < LINE_LENGTH) {
          const missing = LINE_LENGTH - fullLineContent.length;
          lineParts.push({
            type: 'space',
            content: ' '.repeat(missing),
            start: currentPos,
            end: LINE_LENGTH,
          });
          fullLineContent = fullLineContent.padEnd(LINE_LENGTH, ' ');
        } else if (fullLineContent.length > LINE_LENGTH) {
          // Truncar se exceder (não deveria acontecer)
          fullLineContent = fullLineContent.substring(0, LINE_LENGTH);
          if (import.meta.env.DEV) {
            console.warn(`⚠️ Linha ${group.lineName} excedeu ${LINE_LENGTH} caracteres, truncando`);
          }
        }

        return (
          <div
            key={`${group.lineName}_${occurrence}_${groupIndex}`}
            className={`field-line-container ${hasMultipleOccurrences ? 'field-line-container--occurrence' : ''} ${hasLineError ? 'line-with-error' : ''}`}
          >
            {/* ✅ Indicador de múltiplas ocorrências: cabeçalho do bloco, nunca misturado ao
                conteúdo bruto da linha. Mostrado a partir da 1ª ocorrência quando há mais de
                uma, para deixar claro que a linha abaixo é só um recorte físico do grupo. */}
            {hasMultipleOccurrences && (
              <div className="line-occurrence-indicator">
                {group.lineName} - Ocorrência {occurrence}
              </div>
            )}
            <button
              type="button"
              className="field-occurrence-list-trigger"
              onClick={() => setMobileGroup(groupData)}
            >
              Ver campos de {group.lineName}, ocorrência {occurrence}
            </button>
            <div className={`field-list-inline ${hasLineError ? 'line-with-error-content' : ''}`}>
              {/* Linha completa com exatamente 600 caracteres */}
              <span
                className={`field-line-content ${hasLineError ? 'line-with-error-content' : ''}`}
              >
                {(() => {
                  return lineParts.map((part, partIndex) => {
                    if (part.type === 'space') {
                      // Renderizar espaços diretamente sem span, mas reduzir espaços múltiplos
                      const spaceContent = part.content.replace(/\s+/g, ' '); // Reduzir múltiplos espaços para um único
                      // Renderizar como string diretamente (React renderiza strings)
                      return spaceContent || null;
                    }

                    if (part.type === 'sequence') {
                      // Sequencial (6 dígitos) - destacar com cinza
                      // IMPORTANTE: HEADER e LINHA999999 não devem ter esta tag, apenas espaços invisíveis
                      let sequentialContent = String(part.content || '');

                      // Se tiver conteúdo numérico, garantir 6 dígitos
                      if (/^\d+$/.test(sequentialContent.trim())) {
                        sequentialContent = sequentialContent.trim().padStart(6, '0');
                      } else if (sequentialContent.trim() === '') {
                        // Se estiver vazio, usar padrão
                        sequentialContent = '000000';
                      } else {
                        // Se não for numérico, garantir 6 caracteres
                        sequentialContent = sequentialContent.padEnd(6, ' ');
                      }

                      // Usar uma key única que inclui o conteúdo para forçar re-render se mudar
                      return (
                        <span
                          key={`seq-${groupIndex}-${partIndex}-${sequentialContent.replace(/\s/g, '_')}`}
                          className="field-static field-sequential-static"
                          data-sequential={sequentialContent}
                        >
                          {sequentialContent}
                        </span>
                      );
                    }

                    if (part.type === 'initial') {
                      // Número da linha (3 dígitos) - destacar com rosa
                      return (
                        <span
                          key={`${part.type}-${partIndex}`}
                          className="field-static field-line-number-static"
                        >
                          {part.content}
                        </span>
                      );
                    }

                    if (part.type === 'static') {
                      // Conteúdo estático (como tag Sequencia no final) - não destacar
                      return (
                        <span key={`${part.type}-${partIndex}`} className="field-static">
                          {part.content}
                        </span>
                      );
                    }

                    if (part.type === 'field' && part.field) {
                      const field = part.field;
                      const fieldId = getFieldPhysicalId(field);
                      const highlighted = isFieldHighlighted(field);
                      const inSearch = isFieldInSearch(field);

                      // ✅ Verificar se este campo é o problemático na linha com erro
                      const isProblematicField =
                        problematicField && problematicField.fieldName === field.fieldName;

                      return (
                        <button
                          key={fieldId}
                          type="button"
                          data-field-id={fieldId}
                          data-start-position={field.startPosition ?? part.start + 1}
                          tabIndex={effectiveRovingFieldId === fieldId ? 0 : -1}
                          className={`field-inline ${highlighted ? 'highlighted' : ''} ${inSearch ? 'in-search' : ''} ${isProblematicField ? 'field-problematic' : ''}`}
                          onClick={() => handleFieldClick(field)}
                          onFocus={() => setRovingFieldId(fieldId)}
                          onKeyDown={handleFieldKeyDown}
                          aria-label={`Selecionar campo ${field.fieldName}, ocorrência ${field.occurrence ?? occurrence}: ${field.value || 'vazio'}`}
                          title={`${field.fieldName} (Pos: ${part.start + 1}-${part.end}) - Valor: ${field.value || '(vazio)'} - Len: ${field.length || 'N/A'}${isProblematicField ? ` - ❌ ${problematicField.issue}` : ''}`}
                        >
                          {part.content}
                        </button>
                      );
                    }

                    return null;
                  });
                })()}
              </span>
            </div>
          </div>
        );
      })}
      <Modal
        isOpen={Boolean(mobileGroup)}
        onClose={() => setMobileGroup(null)}
        title={
          mobileGroup
            ? `${mobileGroup.lineName} — ocorrência ${mobileGroup.occurrence ?? 1}`
            : 'Campos da ocorrência'
        }
        size="large"
      >
        <div className="field-occurrence-list">
          {mobileGroup?.fields.map(field => (
            <button
              key={getFieldPhysicalId(field)}
              type="button"
              onClick={() => {
                handleFieldClick(field);
                setMobileGroup(null);
              }}
            >
              <strong>{field.fieldName}</strong>
              <span>{field.value?.trim() || 'Vazio'}</span>
              <small>
                Posição {field.startPosition ?? 'N/A'} · {field.length ?? 'N/A'} caracteres
              </small>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
};

export default FieldDisplay;
