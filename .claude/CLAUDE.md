# CLAUDE.md — layoutparser-portal (Front-end)

Este arquivo configura o comportamento do Claude Code ao trabalhar neste repositório.
Inspirado no harness **AIOX**, alinhado ao harness da **LayoutParserApi**, porém **enxuto e
focado no stack front-end (Vite + React + TypeScript)**.

> **Idioma:** responda ao usuário em **português (PT-BR)**. Documentação de produto é
> **bilíngue (PT/EN)** — ver `@lp-doc`.

---

## 1. O que é este projeto

Aplicação web **Vite + React 19 + TypeScript**, com BFF **Node.js + Fastify**, do ecossistema **LayoutParser**. O usuário sobe um
arquivo **TXT** (+ opcionalmente um **layout XML**); a **API .NET** processa e devolve um
**mapeamento do documento** (linhas, campos, posições e validações) que este app renderiza
como **árvore de estrutura**. Nenhuma regra de parsing roda aqui: o BFF aplica a fronteira web
(autenticação, autorização, limites e proxy), enquanto a API é o hub/fonte da verdade do domínio:

| Repo                             | Papel                                                                     |
| -------------------------------- | ------------------------------------------------------------------------- |
| **LayoutParserApi**              | API .NET 10. Orquestra parse, cache, IA, transformação. Fonte da verdade. |
| **LayoutParserLib**              | Criptografia Sysmiddle (DLL).                                             |
| **LayoutParserDecrypt**          | `.exe` de descriptografia.                                                |
| **layoutparser-portal** _(este)_ | Front-end Vite + React e BFF Node/Fastify em `server/`.                   |

Contexto completo: [`README.md`](../README.md). Contrato consumido: [`src/types/api.ts`](../src/types/api.ts).

---

## 2. Stack & estrutura (resumo)

- **Vite 8** (porta 3000, proxy `/api`), **React 19**, **react-router-dom 7.18**, **Zustand 5**, **Axios 1.19**.
- **Node 24 LTS + Fastify 5** em `server/`; o BFF é a única fronteira do navegador com a API em produção.
- **TS strict** com `noUnusedLocals`/`noUnusedParameters`; alias `@/*` → `src/*`.
- Camadas: `components/` (por feature) · `store/` (Zustand) · `services/` (HTTP, **único lugar** que fala com a API) · `types/` · `utils/`.
- Detalhe: [`.claude/rules/frontend-standards.md`](rules/frontend-standards.md).

---

## 3. Sistema de Agentes (enxuto)

Ative com `@agent-name` ou via `Task` tool. Personas alinhadas ao harness da API.

| Agente                | Persona   | Escopo principal                                                                                        |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `@lp-product-manager` | **Maya**  | GitHub Projects, Epics, PBIs, Stories, Bugs, Tasks, Gates, sprints e rastreabilidade.                   |
| `@lp-front-dev`       | **Remy**  | Implementação React/TS: componentes, stores, services, rotas, build.                                    |
| `@lp-ui-ux`           | **Nina**  | Componentes reutilizáveis, CSS por componente, acessibilidade, fluxo UX.                                |
| `@lp-qa`              | **Quinn** | Quality gates do front (lint/a11y, tipos, testes/cobertura, builds, format, audit), validação de fluxo. |
| `@lp-security`        | **Iris**  | Revisão read-only de segurança, dependências, dados, browser e supply chain; veredito priorizado.       |
| `@lp-contract-qa`     | **Cora**  | Validação read-only do contrato API ↔ types/services/consumidores; veredito PASS/DRIFT/UNVERIFIED.      |
| `@lp-doc`             | **Duda**  | Documentação bilíngue (README, comentários, material acadêmico).                                        |
| `@lp-devops`          | **Gage**  | `git push` (EXCLUSIVO), build/deploy (Vite/IIS/CI), **conexão ao MCP** da API.                          |

### Regra de autoridade (resumo)

- **Apenas `@lp-devops` faz `git push`** e gerencia MCP/CI/deploy. Demais agentes: `git add/commit` local apenas.
- `@lp-product-manager` governa Project/Issues/milestones, mas não implementa, aprova risco,
  faz push, merge ou deploy; detalhes em [`rules/product-management.md`](rules/product-management.md).
- `@lp-qa` **valida e dá veredito**; a correção volta para `@lp-front-dev` (QA não implementa fix de produção).
- `@lp-security` e `@lp-contract-qa` são **revisores read-only**: não implementam correções;
  entregam evidência ao dono e revalidam depois.
- Detalhe: [`.claude/rules/agent-authority.md`](rules/agent-authority.md).

### Handoff entre agentes

Ao trocar de agente, compacte o contexto anterior num artefato (~400 tokens): tarefa atual,
branch, decisões-chave, arquivos tocados, próximo passo. Protocolo:
[`.claude/rules/agent-handoff.md`](rules/agent-handoff.md).

---

## 4. Padrões de Código (React/TS) — resumo

Detalhe completo em [`.claude/rules/frontend-standards.md`](rules/frontend-standards.md).

- **HTTP só na camada `services/`.** Componentes e stores **não** chamam `axios` direto.
- **Tipos primeiro:** todo payload de API tem tipo em `src/types`. Não use `any` novo (há resquícios — não amplie).
- **Estado:** Zustand por domínio; não duplique estado entre stores. Derive, não copie.
- **Componente:** um por pasta com seu `.css` ao lado; nomeie em PascalCase; props tipadas.
- **Imports:** use o alias `@/`; ordene externos antes de locais.
- **Erros de API:** trate via o padrão já presente (`axios.isAxiosError`) e propague mensagem amigável.
- **CorrelationId:** nunca remova o interceptor de `X-Correlation-ID` em [`src/services/api.ts`](../src/services/api.ts).
- **Comentários:** PT-BR, no estilo já presente no código.

---

## 5. Quality Gates (antes de concluir)

```bash
npm run lint            # ESLint, --max-warnings 0
npm run typecheck       # TypeScript strict (o build também roda tsc)
npm run test:coverage   # Vitest + relatório de cobertura
npm run test:e2e        # Playwright desktop/mobile (job próprio na CI)
npm run contract:check  # manifesto local + OpenAPI opcional
npm run format:check    # Prettier
npm run audit           # bloqueia vulnerabilidades moderadas ou maiores
# ou todos de uma vez: npm run quality
```

- Não conclua uma tarefa com qualquer etapa de **`npm run quality` quebrada**.
- Mudou contrato com a API? Atualize `src/types` + o README (delegue a `@lp-doc`).
- Mexeu em fluxo crítico (upload/parse/árvore/XML)? Amplie a suite e valide manualmente no `npm run dev`.

---

## 6. Git & Commits

- **Conventional Commits:** `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Trabalhe em branch (`feat/*`, `fix/*`); não faça push direto em `develop` ou `main`.
- Fluxo de promoção obrigatório: `feature/fix → develop → main`.
- Todo PR para `main` deve ter `develop` como origem, após gates e deploy no environment
  `development`; a ruleset da `main` bloqueia qualquer outro caminho.
- **Push só por `@lp-devops`** e só quando o usuário pedir.

---

## 7. Otimização Claude Code

| Tarefa          | Use    | Não use             |
| --------------- | ------ | ------------------- |
| Buscar conteúdo | `Grep` | `grep`/`rg` no bash |
| Ler arquivos    | `Read` | `cat`/`head`/`tail` |
| Editar          | `Edit` | `sed`/`awk`         |
| Buscar arquivos | `Glob` | `find`              |

- Chamadas independentes em **paralelo** num só turno.
- Shell primário: **PowerShell** (Windows); Bash também disponível.
- **better-context (btca):** ao mexer com libs externas (React Router, Zustand, Axios, Vite),
  prefira consultar o **código-fonte real** via btca a confiar em docs desatualizadas.
  Ex.: `btca ask --resource zustand --question "..."`. Ver [`rules/frontend-standards.md`](rules/frontend-standards.md).

---

## 8. MCP — conectar à API

O **MCP Server é da API** (C#, `LayoutParserApi/mcp/LayoutParserMcp/`) e expõe parse/catálogo
como _tools_. Este front **não cria** MCP — apenas **conecta** a ele. Para habilitar: copie
[`.mcp.json.example`](../.mcp.json.example) para `.mcp.json` (na raiz), buildando antes o MCP
da API. **Gestão de MCP é exclusiva do `@lp-devops`**. Regras: [`rules/mcp-usage.md`](rules/mcp-usage.md).

---

_layoutparser-portal · Claude Code harness v1 · enxuto, focado em Vite/React/TS_
