# Papéis de workspace (RBAC) / Workspace roles (RBAC)

> **Status:** a seção "Estado atual" descreve o que a API faz hoje. A seção "Modelo-alvo" é uma
> **decisão do dono do produto ainda NÃO implementada**; o pedido foi enviado à API em
> 2026-09-30 e aguarda confirmação. Não há prazo prometido.
>
> **Status:** "Current state" describes what the API does today. "Target model" is a **product-owner
> decision NOT yet implemented**; the request was sent to the API on 2026-09-30 and awaits
> confirmation. No delivery date is promised.

A autorização de papéis é aplicada pela API .NET (fonte da verdade); o portal apenas exibe os
rótulos e chama os endpoints. / Role authorization is enforced by the .NET API (source of truth);
the portal only shows labels and calls endpoints.

---

## PT-BR

### 1. Estado atual (implementado)

Identificadores da API e rótulos do portal
([`WorkspacePage.tsx`](../../src/components/workspace/WorkspacePage.tsx)):

| Identificador  | Rótulo no portal     |
| -------------- | -------------------- |
| `owner`        | Proprietário         |
| `fiscal_admin` | Administrador fiscal |
| `mapper`       | Mapeador             |
| `reviewer`     | Revisor              |
| `operator`     | Operador             |
| `viewer`       | Leitor               |

**Matriz atual** (levantamento parcial: apenas endpoints com o atributo `[RequireWorkspaceRole]`,
cerca de 19 ações; endpoints sem o atributo exigem apenas ser membro do workspace):

| Capacidade                                                                                                     | Papéis permitidos                                     |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Leitura: listar análises, rascunhos, versões/releases, árvore de layout, artefatos gerados, respostas de regra | Qualquer papel                                        |
| Salvar resposta a regra                                                                                        | `owner`, `fiscal_admin`, `mapper`, `reviewer`         |
| Editar artefato do rascunho, definir perfil fiscal, criar suíte de teste, adicionar fixture, rodar suíte       | `owner`, `fiscal_admin`, `mapper`                     |
| Aprovar release                                                                                                | `fiscal_admin`, `reviewer` (o `owner` **não** aprova) |
| Publicar, reverter (rollback), descontinuar, arquivar release; gerenciar membros                               | `owner`, `fiscal_admin`                               |

Observações:

- Hoje `operator` e `viewer` são equivalentes: **somente leitura**.
- `owner` só é atribuído pelo sistema (criador do workspace). `POST` de membros recusa `owner`
  (400); alterar ou remover `owner` retorna 409; não se remove nem rebaixa o último
  `owner`/`fiscal_admin` (409).
- Membros: `GET/POST/PATCH/DELETE /api/workspaces/{id}/members`, somente workspace do tipo `team`
  (workspace pessoal responde 409). Autorização: `owner`/`fiscal_admin`; não membro recebe 404.
- Convite por e-mail: vira membership quando o login traz e-mail **verificado** igual ao do
  convite (normalizado em minúsculas, comparação exata).
- **Sudo** (super-administrador da plataforma) é distinto de papel de workspace: configurado na
  API por e-mail, lê todos os workspaces e usuários em `/api/admin/*` e promove workspace pessoal
  a time via `PATCH /api/admin/workspaces/{id}` com `{kind: 'team', name?}` (conforme contrato
  confirmado pela API; o PR correspondente na API ainda aguardava deploy quando este texto foi
  escrito).

### 2. Modelo-alvo (decidido, NÃO implementado)

| Papel             | Pode                                                                                                                                                                      | Não pode                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Leitor**        | Ler toda a aplicação; editar o **documento de entrada apenas para testar** a transformação, sem persistir nada                                                            | Alterar TCL, XSL/XSLT, artefatos ou mapeamentos     |
| **Operador**      | Toda modificação de trabalho: mapeamentos/mapeadores, artefatos TCL/XSL/XSLT, perfil fiscal, respostas de regra, suítes/fixtures/execuções de teste, edição de documentos | Publicar, reverter, descontinuar; gerenciar membros |
| **Administrador** | Tudo do Operador + publicar, reverter, descontinuar (e arquivar) versões + gerenciar membros                                                                              | —                                                   |
| **Proprietário**  | Único, o dono do produto; tudo do Administrador                                                                                                                           | Atribuído somente pelo sistema (não cadastrável)    |

Sugestão enviada à API (decisão final dela): manter os ids `viewer`/`operator`/`fiscal_admin`/
`owner`; `mapper` e `reviewer` viram legados equivalentes a `operator`, não atribuíveis.

**Atenção:** hoje `operator == viewer`; redefinir `operator` como escrita muda o efeito para
membros `operator` existentes (segundo o conhecimento atual, em produção só existe o
proprietário).

### 3. Comparativo atual x alvo

| Capacidade                                   | Atual                                | Alvo                                  |
| -------------------------------------------- | ------------------------------------ | ------------------------------------- |
| Ler a aplicação                              | Qualquer papel                       | Todos os papéis                       |
| Editar documento de entrada só para testar   | Não definido como capacidade própria | Leitor, Operador, Administrador       |
| Editar artefatos, mapeamentos, perfil fiscal | `owner`, `fiscal_admin`, `mapper`    | Operador, Administrador, Proprietário |
| Salvar resposta a regra                      | + `reviewer`                         | Operador, Administrador, Proprietário |
| Suítes, fixtures e execução de testes        | `owner`, `fiscal_admin`, `mapper`    | Operador, Administrador, Proprietário |
| Aprovar release                              | `fiscal_admin`, `reviewer`           | **Em aberto** (ver seção 4)           |
| Publicar/reverter/descontinuar/arquivar      | `owner`, `fiscal_admin`              | Administrador, Proprietário           |
| Gerenciar membros                            | `owner`, `fiscal_admin`              | Administrador, Proprietário           |

### 4. Pontos em aberto (sem decisão)

1. Quem aprova release no modelo novo: apenas Administrador ou também Operador. Sugestão de
   segregação de funções a avaliar: quem edita não aprova o próprio trabalho.
2. Qual endpoint permite ao Leitor testar a transformação com documento editado, e a garantia de
   que nada é persistido.
3. Classificação dos endpoints sem atributo de papel (hoje exigem só ser membro).
4. Matriz final endpoint x papel, a ser devolvida pela API.

### 5. Como escolher o papel ao cadastrar uma pessoa

Conforme o modelo-alvo:

- **Leitor:** quem só precisa consultar e testar transformações sem alterar o trabalho.
- **Operador:** quem produz e altera o trabalho do dia a dia (mapeamentos, artefatos, testes).
- **Administrador:** quem publica/reverte versões e gerencia pessoas.
- **Proprietário:** não é escolhido no cadastro; é atribuído pelo sistema.

**Aviso:** até a API implementar o modelo-alvo, **"Operador" no cadastro ainda equivale a
leitura**. Para conceder escrita hoje, é preciso usar os papéis atuais (`mapper`, `fiscal_admin`).

---

## EN

### 1. Current state (implemented)

API identifiers and portal labels: `owner` (Owner), `fiscal_admin` (Fiscal administrator),
`mapper` (Mapper), `reviewer` (Reviewer), `operator` (Operator), `viewer` (Viewer).

**Current matrix** (partial survey: only endpoints carrying `[RequireWorkspaceRole]`, about 19
actions; endpoints without the attribute only require workspace membership):

| Capability                                                                            | Allowed roles                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Read: list analyses, drafts, releases, layout tree, generated artifacts, rule answers | Any role                                          |
| Save a rule answer                                                                    | `owner`, `fiscal_admin`, `mapper`, `reviewer`     |
| Edit draft artifact, set fiscal profile, create test suite, add fixture, run suite    | `owner`, `fiscal_admin`, `mapper`                 |
| Approve release                                                                       | `fiscal_admin`, `reviewer` (`owner` does **not**) |
| Publish, roll back, deprecate, archive release; manage members                        | `owner`, `fiscal_admin`                           |

Notes:

- Today `operator` and `viewer` are equivalent: **read-only**.
- `owner` is assigned only by the system (workspace creator). Member `POST` rejects `owner`
  (400); changing/removing `owner` returns 409; the last `owner`/`fiscal_admin` cannot be removed
  or demoted (409).
- Members: `GET/POST/PATCH/DELETE /api/workspaces/{id}/members`, `team` workspaces only (personal
  returns 409). Authorization: `owner`/`fiscal_admin`; non-members get 404.
- Email invite: becomes a membership when the login carries a **verified** email exactly equal
  (lowercase-normalized) to the invited one.
- **Sudo** (platform super-admin) is distinct from workspace roles: configured in the API by
  email, reads all workspaces/users under `/api/admin/*` and promotes a personal workspace to a
  team via `PATCH /api/admin/workspaces/{id}` with `{kind: 'team', name?}` (per the contract
  confirmed by the API; the related API PR was still awaiting deploy when this was written).

### 2. Target model (decided, NOT implemented)

- **Viewer:** reads the whole application; cannot change TCL, XSL/XSLT, artifacts or mappings.
  The only "edit" allowed is editing the input **document to test** a transformation, persisting
  nothing.
- **Operator:** all working modifications (mappings/mappers, TCL/XSL/XSLT artifacts, fiscal
  profile, rule answers, test suites/fixtures/runs, document editing); cannot publish, roll back
  or deprecate, nor manage members.
- **Administrator:** everything the Operator can do, plus publish, roll back, deprecate (and
  archive) versions and manage workspace members.
- **Owner:** single, the product owner; everything the Administrator can do; assigned only by
  the system.

Suggestion sent to the API (its final call): keep ids `viewer`/`operator`/`fiscal_admin`/`owner`;
`mapper` and `reviewer` become legacy roles equivalent to `operator`, not assignable.

**Caution:** today `operator == viewer`; redefining `operator` as write changes the effect for
existing `operator` members (as far as currently known, only the owner exists in production).

### 3. Current vs. target

See the table in the PT-BR section 3 (capabilities are language-neutral).

### 4. Open points (undecided)

1. Who approves a release in the new model: Administrator only, or Operator too. Suggested
   segregation of duties to evaluate: whoever edits does not approve their own work.
2. Which endpoint lets the Viewer test a transformation with an edited document, and the
   guarantee that nothing is persisted.
3. Classification of endpoints with no role attribute (today membership only).
4. Final endpoint x role matrix, to be returned by the API.

### 5. Choosing a role when adding a person

Per the target model: **Viewer** to consult and test only; **Operator** to do day-to-day work;
**Administrator** to publish/roll back and manage people; **Owner** is not selectable (system
assigned).

**Warning:** until the API implements the target model, **"Operator" at registration still
equals read-only**. To grant write access today, use the current roles (`mapper`, `fiscal_admin`).
