# LayoutParser Web

Aplicação web do ecossistema **LayoutParser** para enviar documentos posicionais, visualizar o
mapeamento produzido pela API e solicitar a transformação final para XML. Este repositório reúne
um front-end React e um gateway Node.js; as regras de parsing e transformação continuam na API
.NET, que é a fonte da verdade do domínio.

> **English summary:** LayoutParser Web combines a Vite/React front-end with a secure
> Node.js/Fastify gateway. Users upload positional text documents, inspect the mapping produced
> by the .NET API, generate transformation candidates and download the resulting XML. Browser
> traffic uses same-origin `/api`; domain parsing and transformation rules remain in the .NET
> backend.

## Conteúdo

### Evolução para produto fiscal

- [Arquitetura-alvo da plataforma fiscal](docs/architecture/fiscal-document-platform.md)
- [Roadmap de produto e implementação](docs/product/fiscal-platform-roadmap.md)
- [Mapping Studio fiscal assistido por IA](docs/product/ai-assisted-fiscal-mapping-studio.md)
- [Contrato cross-repo de workspace e explicabilidade](docs/contracts/fiscal-workspace-and-mapping-explanation-api.md)
- ADRs: [escopo fiscal](docs/architecture/adr/0001-fiscal-product-scope.md),
  [identidade do workspace](docs/architecture/adr/0002-immutable-user-workspace-identity.md) e
  [explicação independente do motor](docs/architecture/adr/0003-engine-neutral-mapping-explanation.md),
  além da [fronteira read-only do Sysmiddle](docs/architecture/adr/0004-sysmiddle-read-only-and-human-in-the-loop-authoring.md)

- [O que o sistema faz](#o-que-o-sistema-faz)
- [Arquitetura e ecossistema](#arquitetura-e-ecossistema)
- [Tecnologias](#tecnologias)
- [Segurança](#segurança)
- [Desenvolvimento local](#desenvolvimento-local)
- [Configuração do gateway](#configuração-do-gateway)
- [Produção com IIS](#produção-com-iis)
- [Qualidade, testes e contrato](#qualidade-testes-e-contrato)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Harness de IA, agentes e MCP](#harness-de-ia-agentes-e-mcp)
- [Avaliação para o trabalho acadêmico](#avaliação-para-o-trabalho-acadêmico)

## O que o sistema faz

O fluxo principal é:

1. O usuário seleciona um documento `.txt`, `.mq_series` ou `.idoc` de até **25 MiB**.
2. Sem seleção manual, o front envia somente o documento para `POST /api/parse/auto`.
3. A API prova um layout único, devolve até cinco equivalências explicáveis ou informa que nenhum
   candidato foi confirmado. Mais de um candidato nunca gera escolha silenciosa.
4. Em caso ambíguo, o usuário escolhe explicitamente **Usar este layout**; o GUID volta como
   `layoutGuidOverride`, é revalidado pela API e fica associado ao correlation ID da execução.
5. O catálogo manual e `POST /api/parse/upload` continuam disponíveis como fallback avançado.
6. A API .NET identifica e processa a estrutura do documento sem expor o XML descriptografado no
   fluxo automático.
7. O front apresenta campos, posições, linhas, validações e a árvore estrutural retornada.
8. Após um parse bem-sucedido, o usuário solicita a avaliação dos candidatos Sysmiddle e TCL/XSL.
   A ausência de mapper Sysmiddle não bloqueia a avaliação TCL/XSL.
9. Quando o candidato fornece rastreabilidade, o inspetor liga a ocorrência física do campo TXT
   ao elemento, atributo ou texto correspondente no XML.
10. O XML retornado pode ser visualizado, copiado ou baixado como arquivo `.xml`.

Quando nenhum candidato é produzido, a interface separa os avisos devolvidos pela API por pathway.
Assim, falhas de mapper/runner Sysmiddle não são confundidas com falhas do pipeline TCL/XSL. Se a
API devolver apenas um aviso genérico, a tela informa explicitamente que a causa específica não foi
fornecida, em vez de presumir um diagnóstico.

> **EN:** After a successful parse, the transformation tab evaluates Sysmiddle and TCL/XSL
> independently. Missing Sysmiddle mapping no longer blocks TCL/XSL. When both paths return no
> candidate, the UI groups the API warnings by pathway and clearly flags missing diagnostic data.

### Edição segura do TXT posicional / Safe positional TXT editing

Na aba **TXT Posicional**, cada campo com posição física confirmada pelo parse e largura fixa
declarada no layout pode ser selecionado para edição. O novo valor precisa ocupar **exatamente** o
mesmo número de posições:
um CNPJ de 14 posições só aceita outro valor com 14 caracteres. A substituição acontece apenas
no intervalo daquele campo e também precisa manter o mesmo tamanho em bytes no encoding original.
O histórico fica somente na sessão e permite desfazer alterações; o TXT editado pode ser baixado
sem mudar encoding ou tamanho e reenviado à API pelo botão **Reprocessar e revalidar**, que substitui
campos, erros e demais estados derivados pela nova resposta. Qualquer edição invalida candidatos XML
gerados para a versão anterior. Se posição, ocorrência, comprimento, encoding ou conteúdo atual não
puderem ser comprovados, a operação falha de forma segura e o documento precisa ser reprocessado.
Campos vazios continuam visíveis e editáveis com sua largura declarada. Entradas lógicas agregadas
pela API (`isAggregatedOccurrence`/`occurrence=0`) não são linhas físicas e ficam fora desta régua.

> **EN:** In the **Positional TXT** tab, a field can be edited only when its parsed physical
> position and layout-declared fixed width are verifiable. Empty fields remain visible/editable,
> while API logical aggregates are excluded from the physical ruler. The replacement must have
> exactly the same character count,
> changes only that field range and must keep the same byte length in the original encoding.
> Session-only undo, encoding/size-preserving download and API reprocessing are available; a new
> parse response replaces fields, validation errors and other derived state. Ambiguous, stale or
> encoding-unsafe changes are rejected, and XML candidates from the previous version are cleared.

### Proveniência e navegação TXT ↔ XML / Provenance and linked navigation

Cada parse bem-sucedido grava a identidade do arquivo e do layout que produziram o resultado. A
troca de qualquer um desses insumos invalida campos, histórico, transformação e seleção vinculada;
se houver edição pendente, o descarte exige confirmação explícita. A transformação e a revalidação
também conferem esse vínculo antes de enviar dados à API, impedindo combinações acidentais entre um
TXT antigo e um layout novo.

O **Inspetor de rastreabilidade** consome `fieldMappings`, `sectionMappings` e `xmlNamespaces` do
candidato ativo:

- `fieldMappings` liga a ocorrência física do campo a elementos, atributos ou texto do XML, sem
  comparar valores textuais;
- `sectionMappings` é mostrado apenas como navegação de bloco/seção e nunca autoriza edição de
  campo;
- `null`, lista vazia e lista preenchida possuem mensagens diferentes;
- `Authoritative` aparece como **Declarado no mapeador** e `BestEffort` como **Melhor estimativa**,
  com todas as limitações visíveis;
- no desktop, o inspetor ocupa um painel lateral; em telas de até 900 px, abre como bottom sheet;
- a régua TXT usa foco móvel por setas e mantém somente um campo na ordem de `Tab`; no mobile,
  cada ocorrência oferece uma lista alternativa com alvos de pelo menos 44 px.

O espaço de trabalho também é ajustável: o separador horizontal distribui a altura entre a régua
TXT e a árvore estrutural, enquanto o separador vertical distribui a largura entre a análise e o
inspetor no desktop. Ambos aceitam arraste, setas do teclado, `Home`/`End` e duplo clique para
restaurar o padrão. A preferência fica somente no `localStorage`. Em telas de até 900 px, o
separador lateral desaparece porque o inspetor passa a modal; o ajuste TXT↔estrutura continua
disponível com área de toque ampliada.

> **Limitação ativa:** a API validou estruturalmente os mappings com fixtures sintéticas, mas a
> comparação comportamental de pelo menos 20 documentos reais contra o `LowCodeRunner.exe` ainda
> depende de execução em Windows. Por isso, nem mesmo “Declarado no mapeador” é apresentado como
> “validado em produção”. Detalhes técnicos: [rastreabilidade TXT↔XML](docs/features/txt-xml-traceability.md).

> **EN:** Each parse stores the exact document/layout provenance. Changing either input clears
> derived fields, edits, XML candidates and linked selections, with explicit confirmation when
> edits are pending. The traceability inspector consumes candidate-scoped `fieldMappings`,
> `sectionMappings` and `xmlNamespaces`, distinguishes unsupported/empty/populated states, labels
> confidence without overstating validation, and provides keyboard, desktop and mobile navigation.
> Behavioral comparison against the real Windows-only `LowCodeRunner.exe` is still pending.
> The analysis workspace is user-resizable by pointer or keyboard, persists only local visual
> preferences and automatically switches the inspector to a modal layout below 900 px.

### Hierarquia SAP IDoc / SAP IDoc hierarchy

Quando o nome do layout termina em `_TXT_SAP_ENVNFE_4.00_NFe`, a aba **TXT Posicional**
apresenta os `LineElementVO` como uma árvore de segmentos SAP. `EDI_DC40` é o registro de
controle e a raiz da visualização; os botões `+` permitem navegar pelos segmentos filhos, como
`ZRSDM_NFE_400_EMIT` e `ZRSDM_NFE_400_ENDEREMIT`. A hierarquia vem dos elementos aninhados do
próprio layout, sem depender do prefixo específico de um cliente. Os três dígitos técnicos no fim
do valor inicial são ocultados no rótulo, enquanto os campos posicionais continuam disponíveis no
painel de campos.

Essa árvore representa o **esquema declarado pelo layout**. Ela não afirma que todos os segmentos
foram encontrados no TXT processado.

> **EN:** Layout names ending in `_TXT_SAP_ENVNFE_4.00_NFe` render their nested
> `LineElementVO` entries as an SAP segment tree in the **Positional TXT** tab. `EDI_DC40` is the
> control-record root, `+` buttons expand child segments, and the final three technical digits are
> omitted from labels. The tree represents the layout schema, not proof that every segment occurs
> in the processed document; positional fields remain available in the field panel.

O navegador não executa parsing posicional nem transformação XSLT. O front valida apenas o
arquivo para dar feedback imediato; a validação autoritativa e as regras de negócio pertencem
ao gateway e à API.

### Workspace fiscal e pacotes versionados / Fiscal workspace and versioned packages

Após a autenticação, `/workspace` carrega `GET /api/workspaces/me` e apresenta somente os
workspaces associados à identidade imutável resolvida pela API. O workspace ativo permanece em
memória; IDs, documentos e conteúdo fiscal não são persistidos pelo front. Falhas de contrato,
autorização e indisponibilidade aparecem como estados explícitos com nova tentativa segura.

O contrato do primeiro `FiscalMappingPackage` também está tipado no front: upload multipart
idempotente e consulta de metadados da revisão, sem registrar conteúdo. O wizard completo continua
condicionado ao inventário normalizado de Excel/XSD, à navegação de projetos e ao endpoint de nova
revisão ainda pendentes na API. Consulte o
[contrato cross-repo](docs/contracts/fiscal-workspace-and-mapping-explanation-api.md).

> **EN:** Authenticated users enter `/workspace`, which resolves only API-authorized workspaces and
> keeps the active selection in memory. The first versioned package upload/read contract is typed,
> but the complete wizard remains gated by normalized inventory, project navigation and revision
> APIs; the UI never fabricates these missing domain results.

### Mapping Studio e Fiscal Test Lab / Mapping Studio and Fiscal Test Lab

O `/workspace/mapping-studio` abre Drafts TCL/XSLT e mappings Sysmiddle pelo contrato canônico da
API. Regras propostas mostram origem, destino, operação, evidências, confiança e perguntas; decisões
de aceitar, editar ou rejeitar usam ETag/`If-Match`, evitando sobrescrever outra sessão. Sysmiddle é
sempre somente leitura, inclusive por deep link ou estado adulterado.

Para Drafts compiláveis, o Fiscal Test Lab acompanha o job assíncrono, reabre a release pela URL,
mostra hash, correlation ID, diagnósticos e código gerado, e executa fixtures XSLT individuais. O
resultado apresenta validação XSD, cobertura, diff canônico e proveniência até a regra de origem.
O conteúdo das fixtures é limpo após o envio e nunca vai para `localStorage`. A UI obedece
`capabilities` de forma fail-closed: enquanto a API declarar `compile=false`, nenhum botão de
compilação é exposto. TCL pode ser compilado, mas ainda não possui runner determinístico na API.

Quando uma release XSLT chega a `test_passed`, o Studio consome a governança do Slice 7: Revisor ou
Administrador fiscal pode aprovar com justificativa; Owner ou Administrador fiscal pode publicar
em desenvolvimento, validação ou produção e executar rollback para a publicação anterior. A API
revalida o papel do workspace e registra as transições; o React nunca promove automaticamente pela
simples presença de `RequiredGatesPassed=true`. Releases publicadas não reabrem o formulário do Test
Lab e seus artefatos permanecem imutáveis. O `GET` completo da release ainda não devolve todos os
metadados de governança, e a API ainda não expõe leitura de transições nem concorrência `If-Match`
nessas três operações.

> **EN:** Mapping Studio reviews TCL/XSLT proposals with optimistic concurrency and renders
> Sysmiddle as strictly read-only. Fiscal Test Lab observes asynchronous compilation, exposes the
> immutable snapshot and runs individual XSLT fixtures with XSD, canonical diff, coverage and
> provenance. Fixtures are not persisted in the browser, and capabilities are enforced fail-closed.
> Slice 7 adds explicit RBAC-protected approval, publication and rollback actions; technical gates
> never trigger an automatic promotion, and published releases cannot be retested or edited.

A rota `/admin` consulta a sessão do gateway e exige autorização administrativa. A proteção no
React melhora a experiência, mas não substitui a autorização aplicada no servidor.

## Arquitetura e ecossistema

```text
Navegador
  │ HTTPS, mesma origem: /auth e /api
  ▼
IIS — arquivos estáticos do React + URL Rewrite/ARR
  │ encaminha /auth/* e /api/*; não solicita credencial Windows
  ▼
Gateway Node.js/Fastify — server/ — loopback
  │ Microsoft Entra OIDC, sessão, autorização, limites, rate limit e proxy
  ▼
LayoutParserApi — ASP.NET Core/.NET — hub e fonte da verdade
  ├── LayoutParserLib — criptografia Sysmiddle
  ├── LayoutParserDecrypt — descriptografia externa
  └── serviços de cache, persistência, IA e transformação
```

O ecossistema é dividido em quatro projetos:

| Projeto                 | Responsabilidade                                                                |
| ----------------------- | ------------------------------------------------------------------------------- |
| **layoutparser-portal** | Este repositório: interface React e gateway Node/Fastify.                       |
| **LayoutParserApi**     | API .NET que orquestra parsing, validação, catálogo, cache, IA e transformação. |
| **LayoutParserLib**     | Biblioteca usada na integração com criptografia Sysmiddle.                      |
| **LayoutParserDecrypt** | Processo auxiliar de descriptografia.                                           |

O gateway é um **BFF** (Backend for Frontend): ele não duplica o parser da API. Sua função é
criar uma fronteira web segura e estável entre o navegador e os serviços internos.

## Tecnologias

| Camada              | Tecnologia atual                                                                   |
| ------------------- | ---------------------------------------------------------------------------------- |
| Front-end           | React 19, React Router 7, Zustand 5 e Axios                                        |
| Build               | Vite 8 e TypeScript em modo estrito                                                |
| Gateway             | Node.js 24 LTS, Fastify 5 e TypeScript                                             |
| Testes do front     | Vitest, Testing Library, MSW e cobertura V8                                        |
| Testes de navegador | Playwright, com Chromium desktop e perfil móvel                                    |
| Segurança           | Entra OIDC/PKCE, sessão criptografada, Helmet, rate limit, CSP/IIS e auditoria npm |
| CI                  | GitHub Actions com actions fixadas por SHA, CodeQL, Dependabot e dependency review |

As versões efetivamente instaladas e seus intervalos estão em [`package.json`](package.json) e
[`server/package.json`](server/package.json).

## Segurança

As principais proteções existentes nesta branch são:

- **Mesma origem:** por padrão, o Axios usa caminhos relativos. O navegador acessa `/api` sem
  conhecer host ou porta internos e sem depender de CORS em produção.
- **Upload em camadas:** o front rejeita arquivo vazio, extensão não permitida, nome excessivo
  e documento acima de 25 MiB. O gateway limita o documento a 25 MiB e a requisição multipart
  completa a 32 MiB; a API deve manter sua própria validação autoritativa.
- **Microsoft Entra OIDC:** o BFF executa Authorization Code com PKCE, `state` e `nonce`. A
  senha permanece na Microsoft; tokens e o client secret nunca chegam ao React nem à API .NET.
- **Sessão mínima e criptografada:** o cookie é `HttpOnly`, `Secure`, `SameSite=Lax`, expira em
  oito horas e contém somente identidade mínima. A chave é derivada do client secret com HKDF.
- **Autorização administrativa:** usuários e/ou grupos precisam estar nas allowlists do
  gateway para acessar os caminhos administrativos protegidos.
- **Restrição de rede:** o gateway usa loopback por padrão e recusa bind externo em produção.
- **Abuso e rastreabilidade:** rate limit por identidade/IP e `X-Correlation-ID` ponta a ponta.
- **Privacidade de logs:** payloads, headers sensíveis e conteúdo TXT/XML são omitidos ou
  redigidos; erros enviados ao cliente não expõem detalhes internos.
- **Headers defensivos:** Helmet no gateway e CSP, HSTS, `nosniff`, política de referência,
  permissões e isolamento de origem no IIS.
- **Build de produção:** source maps não são publicados e há uma checagem contra endereços
  internos gravados no bundle.

O limite do front é configurável entre 1 e 100 MiB para experiências locais, mas aumentar
`VITE_MAX_UPLOAD_MB` não aumenta os limites autoritativos do gateway ou da API.

## Desenvolvimento local

### Pré-requisitos

- Node.js **24.15+** (linha LTS 24.x);
- npm compatível com os lockfiles;
- `LayoutParserApi` disponível em ambiente local;
- Chromium do Playwright, apenas para executar os testes E2E.

### 1. Instalar as dependências

O front e o gateway são projetos Node separados e possuem lockfiles próprios:

```powershell
npm ci
npm ci --prefix server
```

### 2. Configurar o gateway

```powershell
Copy-Item server/.env.example server/.env
```

No arquivo local `server/.env`, ajuste `LAYOUTPARSER_API_URL` para a origem da API .NET. O
arquivo é ignorado pelo Git e não deve conter segredos versionados.

### 3. Fazer o Vite encaminhar `/api` ao gateway

O arquivo versionado [`.env.development`](.env.development) já configura o gateway e uma
identidade fictícia de demonstração. Para sobrescrever localmente, crie `.env.local`:

```dotenv
VITE_API_BASE_URL=
VITE_DEV_BFF_PROXY_TARGET=http://127.0.0.1:3100
VITE_DEV_BFF_USER=layoutparser.local
VITE_DEV_BFF_ROLES=LayoutParserAdmins
VITE_MAX_UPLOAD_MB=25
```

Manter `VITE_API_BASE_URL` vazio ativa o fluxo recomendado de mesma origem:

```text
React :3000 -> proxy /api do Vite -> gateway :3100 -> API .NET
```

Uma URL absoluta em `VITE_API_BASE_URL` existe somente como override de diagnóstico e pula o
gateway. Evite esse modo nos fluxos que precisam validar autenticação e segurança do BFF.

### 4. Iniciar os processos

```powershell
npm run dev
```

O comando inicia Vite e BFF juntos. Para depuração em terminais separados, use
`npm run dev:front` e `npm run dev:bff`.

Abra `http://localhost:3000`. A saúde local do gateway pode ser consultada em
`http://127.0.0.1:3100/health`.

O proxy do Vite injeta somente em desenvolvimento a identidade fictícia declarada no `.env`.
Ela não é uma credencial, não é aceita em produção e existe para tornar o fluxo acadêmico local
reproduzível. O BFF continua recusando requests anônimos e proíbe esse mecanismo quando
`NODE_ENV=production`. Consulte [`server/README.md`](server/README.md) para o modelo completo.

As variáveis do front estão documentadas em [`.env.example`](.env.example); as do gateway, em
[`server/.env.example`](server/.env.example).

## Configuração do gateway

As variáveis mais importantes são:

| Variável                              | Finalidade                                   | Padrão de desenvolvimento |
| ------------------------------------- | -------------------------------------------- | ------------------------- |
| `BFF_HOST` / `BFF_PORT`               | Bind local do Fastify                        | `127.0.0.1` / `3100`      |
| `BFF_PUBLIC_ORIGIN`                   | Origem HTTPS pública usada no callback OIDC  | derivada no deploy        |
| `LAYOUTPARSER_API_URL`                | Origem da API .NET                           | loopback local            |
| `ENTRA_TENANT_ID`                     | Authority Microsoft (`common` neste projeto) | obrigatório em produção   |
| `ENTRA_CLIENT_ID`                     | Application (client) ID                      | obrigatório em produção   |
| `ENTRA_CLIENT_SECRET`                 | Credencial confidencial do BFF               | secret, nunca versionado  |
| `BFF_SESSION_TTL_SECONDS`             | Vida máxima da sessão criptografada          | `28800`                   |
| `BFF_TRUSTED_IDENTITY_*_HEADER`       | Principal imutável encaminhado à API         | `x-layoutparser-*`        |
| `BFF_REQUEST_LIMIT_MIB`               | Limite da requisição multipart completa      | `32`                      |
| `BFF_DOCUMENT_LIMIT_MIB`              | Limite cumulativo do campo `txtFile`         | `25`                      |
| `BFF_RATE_LIMIT_MAX`                  | Máximo por janela                            | `120`                     |
| `BFF_ADMIN_USERS` / `BFF_ADMIN_ROLES` | Allowlists administrativas                   | ao menos uma em produção  |
| `BFF_DEV_AUTH_ENABLED`                | Habilita identidade simulada local           | proibido em produção      |

Rotas próprias do gateway:

| Método e rota        | Finalidade                                                                 |
| -------------------- | -------------------------------------------------------------------------- |
| `GET /health`        | Liveness local, sem revelar nem consultar o upstream.                      |
| `GET /auth/login`    | Inicia Authorization Code + PKCE na Microsoft.                             |
| `GET /auth/callback` | Valida `state`, `nonce`, código e cria a sessão criptografada.             |
| `POST /auth/logout`  | Encerra apenas a sessão do LayoutParser.                                   |
| `GET /api/session`   | Sessão normalizada para o front: autenticação, usuário, roles e `isAdmin`. |
| `/api/*`             | Proxy para a API .NET depois de autenticação e autorização.                |

Os caminhos administrativos protegidos e todos os detalhes de fail-fast estão em
[`server/README.md`](server/README.md).

## Produção com IIS

O desenho de produção esperado é:

1. Publicar o conteúdo de `dist/` em um site **HTTPS** no IIS.
2. Instalar e habilitar URL Rewrite e ARR com proxy.
3. Executar o gateway compilado como processo/serviço Node separado, escutando somente em
   loopback.
4. Fazer o IIS encaminhar `/auth/*` e `/api/*` ao gateway.
5. Manter **Anonymous Authentication habilitada** e **Windows Authentication desabilitada** no
   site; a autenticação acontece no BFF com a Microsoft.
6. Configurar o App Registration como multitenant + contas pessoais e registrar exatamente
   `https://<PUBLIC_HOST>/auth/callback` como URI da plataforma **Web**. No ambiente atual, a URI
   canônica de produção é `https://172.25.32.42/auth/callback`.
7. Configurar `ENTRA_TENANT_ID=common`, client ID e client secret nos environments do GitHub.
8. Manter a API .NET inacessível diretamente pelo navegador e protegida também em profundidade.

O arquivo [`public/web.config`](public/web.config) é copiado para o build e contém a regra
same-origin para autenticação/API, limite total de 32 MiB e headers defensivos. O deploy configura
o `applicationHost.config` para acesso anônimo ao conteúdo e desativa
`reverseRewriteHostInResponseHeaders`: assim, o ARR preserva o `Location` externo emitido pelo BFF
para `login.microsoftonline.com`. Headers de identidade, cookies e `Authorization` enviados pelo
navegador são removidos antes do proxy; somente a identidade validada pelo BFF é encaminhada à API.

Os environments `development` e `production` são isolados pelo GitHub. Portanto, cadastre os
três valores **separadamente em cada environment**, mesmo quando o conteúdo for igual. No
environment `development`, configure exatamente:

```text
Variable ENTRA_TENANT_ID = common
Variable ENTRA_CLIENT_ID = 9ff4c9ba-1bab-414a-a6df-39ddce8f7425
Secret   ENTRA_CLIENT_SECRET = <Value do secret, não o Secret ID>
```

Repita a mesma configuração em `production`. Variáveis ou secrets criados somente em
`production` não ficam disponíveis ao workflow `ci-dev.yml`; nesse caso o deploy de
desenvolvimento falha deliberadamente antes de alterar o IIS. Se o hostname de desenvolvimento
for diferente do de produção, adicione também `https://<PUBLIC_HOST_DEV>/auth/callback` como URI
de redirecionamento da plataforma **Web** no mesmo App Registration.

O servidor e os navegadores precisam alcançar `login.microsoftonline.com` por HTTPS. Políticas de
um tenant corporativo externo ainda podem exigir consentimento administrativo para aplicativos
multitenant; essa decisão pertence ao tenant da conta que está entrando.

```powershell
npm ci
npm ci --prefix server
npm run quality
```

O workflow [`deploy.yml`](.github/workflows/deploy.yml) (produção, push em `main`) roda no runner
Linux (`self-hosted, Linux, layoutparser-portal`), executa os gates e chama
[deploy-linux.sh](scripts/deploy-linux.sh) (PM2 + Nginx, certificado self-signed do host). O
desenvolvimento (`ci-dev.yml`) continua no Windows/IIS: o workflow executa os gates, cria uma release
versionada, publica o React, instala as dependências de produção do BFF, registra/reinicia seu
processo em uma Scheduled Task do Windows, faz smoke tests e mantém rollback para a release
anterior. O script [Deploy-Iis.ps1](scripts/Deploy-Iis.ps1) exige HTTPS e falha se URL Rewrite,
ARR, OIDC, allowlists ou variáveis obrigatórias estiverem ausentes. Configure `PUBLIC_HOST` em produção
e `PUBLIC_HOST_DEV` em desenvolvimento com o hostname DNS ou IP privado coberto pelo SAN do
certificado, sem protocolo ou porta. O smoke test HTTPS também confirma que o login aponta para a
Microsoft e que o `redirect_uri` coincide com essa origem. Os environments `development` e
`production` devem exigir aprovação e isolar seus secrets/runners.

No runner de desenvolvimento, o workflow instala o ARR 3 quando ele estiver ausente usando o
instalador x64 oficial da Microsoft, com assinatura Authenticode e SHA-256 fixado verificados por
[`Install-IisArr.ps1`](scripts/Install-IisArr.ps1). O instalador é compatível tanto com o Windows
PowerShell 5.1 (`powershell.exe`) quanto com o PowerShell 7 (`pwsh`). Ele também migra o site de HTTP para HTTPS de
forma idempotente com [`Initialize-IisDevHttps.ps1`](scripts/Initialize-IisDevHttps.ps1), usando um
certificado válido para `PUBLIC_HOST_DEV` já instalado em `Cert:\LocalMachine\My`. O runner de
produção continua exigindo ARR, site e binding HTTPS pré-provisionados para impedir alterações
automáticas na infraestrutura produtiva.

Quando o certificado de desenvolvimento é autoassinado, o bootstrap adiciona somente sua parte
pública à raiz confiável da máquina após validar hostname, período de validade e chave privada. O
workflow também força e verifica o checkout em LF sem alterar permanentemente a configuração Git
do runner. A exceção de `safe.directory` usada nessa verificação é limitada ao workspace exato do
job e não é persistida na conta do serviço. Em workspaces reutilizados, somente arquivos rastreados
que o próprio Git identifica como CRLF indevido são normalizados, com validação posterior de diff.

As etapas que manipulam o provider `IIS:\` usam o Windows PowerShell nativo (`powershell.exe`).
Isso evita a sessão de compatibilidade do PowerShell 7, que importa os cmdlets de
`WebAdministration`, mas não disponibiliza o drive `IIS:\` ao processo chamador.

O executável Node usado pelo BFF é armazenado em `runtime/` com um nome derivado de seu SHA-256.
Assim, uma atualização do Node cria um runtime imutável em vez de tentar sobrescrever o executável
que ainda está aberto pelo BFF da release anterior.

Nunca publique o front com `VITE_API_BASE_URL` apontando para uma origem interna. O build de
produção foi desenhado para deixar essa variável vazia e usar `/api` na mesma origem HTTPS.

## Qualidade, testes e contrato

### Front-end

| Comando                         | Verificação                                             |
| ------------------------------- | ------------------------------------------------------- |
| `npm run lint`                  | ESLint, acessibilidade estática e zero warnings.        |
| `npm run typecheck`             | TypeScript estrito sem emitir arquivos.                 |
| `npm run test:run`              | Testes unitários e de integração do front.              |
| `npm run test:coverage`         | Vitest com cobertura V8.                                |
| `npm run test:fixture:mqseries` | Aceitação opt-in com o par MQSeries real privado.       |
| `npm run build`                 | Type-check e build Vite.                                |
| `npm run build:dev`             | Build no modo development.                              |
| `npm run build:prod`            | Build no modo production.                               |
| `npm run format:check`          | Prettier nos arquivos do front.                         |
| `npm run test:e2e`              | Fluxo Playwright em desktop e mobile.                   |
| `npm run test:e2e:real`         | Fluxo de usuário contra BFF/API e fixture reais.        |
| `npm run contract:check`        | Contrato local e OpenAPI opcional.                      |
| `npm run audit`                 | Auditoria npm, bloqueando severidade moderada ou maior. |
| `npm run quality`               | Gate agregado do front, BFF, artefatos e contrato.      |

### Gateway Node

```powershell
npm run quality --prefix server
```

O gate próprio executa tipos, testes com cobertura, build e auditoria. A suíte cobre configuração
fail-fast, sessão criptografada, OIDC/PKCE, proteção contra CSRF/open redirect, allowlist
administrativa, proxy, correlação, rate limit, limites de payload e privacidade dos logs.

### E2E com Playwright

```powershell
npx playwright install chromium
npm run typecheck:e2e
npm run test:e2e
```

A suíte em [`e2e/`](e2e/) valida o fluxo TXT → transformação → download XML e a restrição da
área administrativa em perfis desktop e móvel. As APIs são mockadas no navegador para tornar o
teste determinístico; isso não substitui um teste de integração contra o gateway e a API reais.

#### Gate E2E real do usuário

O cenário [`mqseries-user-flow.spec.ts`](e2e-real/mqseries-user-flow.spec.ts) não intercepta nem
simula APIs. Ele inicia o front e o BFF reais, aponta o BFF para a `LayoutParserApi`, abre a página
como usuário autenticado de desenvolvimento e opera os mesmos controles da interface: anexa o TXT,
executa a detecção automática, escolhe explicitamente o layout homologado dentro do top 5,
processa, seleciona uma tag vazia, gera a transformação multi-candidato, volta ao TXT, edita suas
15 posições e reprocessa o documento com o mesmo GUID auditável.

Além da UI, o teste exige HTTP 200 e valida que um `X-Correlation-ID` válido, novo por operação e
imutável atravessou navegador → BFF → API → navegador nas chamadas de sessão, detecção, parse,
transformação multi-candidato e reparse. O contrato aceito é o do documento homologado: 59 linhas,
705 campos e quatro ocorrências físicas da `LINHA081`, sem a ocorrência agregada duplicada no fim.

```powershell
$env:REAL_E2E_API_URL = 'http://127.0.0.1:5100'
$env:REAL_E2E_FIXTURE_DIR = 'C:\caminho\privado\teste'
$env:REAL_E2E_LAYOUT_NAME = 'LAY_TXT_MQSERIES_ENVNFE_4.00_NFe'
npm run test:e2e:real
```

No runner Windows, a localização padrão persistente é
`C:\ProgramData\LayoutParser\e2e-fixtures\mqseries`. O environment `development` pode sobrescrever
o caminho e o layout pelas variables `REAL_E2E_FIXTURE_DIR` e `REAL_E2E_LAYOUT_NAME`. Screenshots,
vídeos e traces ficam desabilitados nessa suíte para que uma falha não publique dados privados.

Em [`ci-dev.yml`](.github/workflows/ci-dev.yml), esse cenário roda imediatamente após a instalação
das dependências. Se ele falhar, os quality gates seguintes, o build e o deploy de desenvolvimento
não executam; consequentemente, a proteção de `main` não recebe o deployment ativo necessário para
autorizar a promoção `develop → main`.

### Aceitação com o par MQSeries real

A suíte opt-in reúne [`mqseries-layout-detection.test.ts`](tests/real-fixture/mqseries-layout-detection.test.ts)
e [`mqseries-positional.test.ts`](tests/real-fixture/mqseries-positional.test.ts). O primeiro envia
somente o documento, exige estado `ambiguous`, top 5 explicável, correlation ID preservado e
ausência de parse antes da escolha; depois confirma o layout homologado por override. O segundo
valida o parse posicional manual de regressão, os 59 grupos físicos, as larguras fixas, a cobertura
até a posição 600, as quatro ocorrências da `LINHA081`, a remoção das duas entradas agregadas e a
editabilidade segura dos 703 campos. Nenhum conteúdo ou valor do documento é registrado no teste.

```powershell
# API padrão: http://127.0.0.1:5100
npm run test:fixture:mqseries

# Overrides opcionais
$env:LAYOUTPARSER_REAL_API_URL = 'http://127.0.0.1:5100'
$env:LAYOUTPARSER_REAL_FIXTURE_DIR = 'C:\caminho\privado\teste'
npm run test:fixture:mqseries
```

Os dois arquivos reais permanecem ignorados pelo Git. A suíte falha explicitamente se o par não
estiver presente, se os tamanhos não corresponderem à fixture homologada ou se a API estiver fora
do ar. No runner de desenvolvimento, a mesma fixture é provisionada fora do repositório e o E2E
executa o percurso real arquivo → top 5 → escolha → parse → edição → revalidação. A regressão
sanitizada equivalente continua em `src/utils` e roda em todo `npm run quality`.

Como prova complementar local, a amostra privada `maiorMenor.idoc` foi enviada ao mesmo endpoint:
a API retornou `unique` para `LAY_MARELLI_TXT_SAP_ENVNFE_4.00_NFe`, preservou o correlation ID e
processou 55 linhas/263 campos. A fixture IDoc também permanece fora do Git; seu comportamento
estrutural é protegido pelos testes determinísticos da API.

### Contrato da API

```powershell
npm run contract:check
```

O script cruza os endpoints usados pelos services com
[`contracts/api-endpoints.json`](contracts/api-endpoints.json). Opcionalmente,
`LAYOUTPARSER_OPENAPI_URL` permite comparar o manifesto com um OpenAPI acessível:

```powershell
$env:LAYOUTPARSER_OPENAPI_URL = 'https://api-de-teste.exemplo/openapi.json'
node scripts/check-api-contract.mjs
```

Para conferir o artefato final:

```powershell
npm run build:prod
npm run artifacts:validate
```

Essa checagem reprova source maps e referências internas indevidas no bundle, confirma os
fragmentos de segurança esperados no `web.config` e valida que a autenticação está sob autoridade
do script de deploy do IIS.

Playwright roda em job próprio do workflow de qualidade. Os demais gates fazem parte de
`npm run quality`, inclusive o BFF e a auditoria de ambos os lockfiles.

Os workflows de qualidade e segurança estão em [`.github/workflows/`](.github/workflows/).
O Dependabot agrupa atualizações compatíveis de React, ESLint e Vite, enquanto upgrades major
dessas famílias ficam bloqueados para migração manual conjunta. Isso evita PRs isolados com
peer dependencies incompatíveis sem enfraquecer as atualizações minor, patch ou de segurança.
Todos os PRs automáticos do Dependabot também têm `develop` como destino; eles nunca promovem
dependências diretamente para `main`.

### Política de promoção para produção

O fluxo obrigatório é `feature/fix → develop → main`: toda mudança entra primeiro em `develop`,
passa pelos quality gates e pelo deploy HTTPS no environment `development` e somente depois pode
ser promovida para produção por um PR cuja origem seja exatamente `develop` e o destino seja
`main`. A ruleset da `main` exige esse deploy de desenvolvimento bem-sucedido e os checks de
qualidade, segurança, dependências e origem definidos em
[`main-promotion-guard.yml`](.github/workflows/main-promotion-guard.yml). Push direto, force-push e
exclusão da `main` permanecem bloqueados, sem bypass administrativo.

> **EN:** Production promotion follows `feature/fix → develop → main`. The `main` ruleset only
> accepts pull requests from `develop` after a successful `development` deployment and all
> required quality and security checks. Direct pushes, force pushes, deletion and administrator
> bypass are disabled.

## Estrutura do repositório

```text
layoutparser-portal/
├── src/
│   ├── components/       # upload, análise, XML, admin, autenticação e componentes compartilhados
│   ├── layouts/          # shell e navegação
│   ├── services/         # única camada que chama /api
│   ├── store/            # estado Zustand por domínio
│   ├── types/            # contratos TypeScript
│   └── utils/            # correlação, validações, árvore, cache e sanitização
├── server/               # BFF Node.js/Fastify independente
├── e2e/                  # cenários Playwright
├── contracts/            # manifesto versionado de endpoints
├── scripts/              # validações de contrato e artefatos
├── public/               # arquivos públicos e configuração IIS
├── .claude/              # harness Claude Code: agentes, comandos, regras, hooks e memória
├── .codex/               # definições de agentes do Codex
└── .github/               # CI, segurança, ownership e atualização de dependências
```

Chamadas HTTP devem permanecer em `src/services`; payloads da API devem possuir tipos em
[`src/types/`](src/types/). O contrato principal do parse está em
[`src/types/api.ts`](src/types/api.ts).

## Harness de IA, agentes e MCP

O repositório possui um harness inspirado no AIOX, adaptado ao front e ao gateway:

| Agente                | Papel                                                           |
| --------------------- | --------------------------------------------------------------- |
| `@lp-product-manager` | GitHub Projects, backlog, sprints, critérios e rastreabilidade. |
| `@lp-front-dev`       | React, TypeScript, stores, services e rotas.                    |
| `@lp-ui-ux`           | UX, componentes, CSS e acessibilidade.                          |
| `@lp-qa`              | Gates, testes, cobertura e validação de fluxo.                  |
| `@lp-security`        | Revisão read-only de segurança e supply chain.                  |
| `@lp-contract-qa`     | Revisão read-only do contrato front ↔ API.                      |
| `@lp-doc`             | Documentação PT-BR com resumo EN quando necessário.             |
| `@lp-devops`          | CI, deploy, push e integração MCP.                              |

As regras operacionais estão em [`AGENTS.md`](AGENTS.md), e a visão do harness Claude em
[`.claude/README.md`](.claude/README.md). O harness inclui `/product-sync` para governança do
backlog, comandos de revisão de segurança e sincronização de contrato, hooks de feedback
rápido/proteção de caminhos sensíveis e memória por agente.

O registro operacional do produto é o Project privado
[**LayoutParserReact — Backlog**](https://github.com/orgs/LayoutParser/projects/3), com views de
backlog, board, sprint, roadmap e bugs/gates. Issues e critérios continuam sendo a fonte de
evidência; o Project organiza status, tipo, prioridade, área e agente dono.

O MCP **não é implementado neste front**. O servidor MCP pertence ao `LayoutParserApi`, pois a
API é o hub e a fonte da verdade. Este repositório fornece apenas
[`.mcp.json.example`](.mcp.json.example) para conectar o ambiente de IA ao MCP da API; copie para
`.mcp.json`, ajuste o caminho local da DLL e não versione a configuração resultante. A autoridade
e as regras estão em [`.claude/rules/mcp-usage.md`](.claude/rules/mcp-usage.md).

Estudo em refinamento: [detecção automática de layout MQSeries/IDoc](docs/proposals/automatic-layout-detection-mqseries-idoc.md).
Ele propõe um fluxo arquivo-primeiro com `unique`, `ambiguous` e `not_found`, preservando o modo
manual como fallback, apresentando até cinco equivalências explicáveis quando houver ambiguidade e
exigindo 100% de precisão no subconjunto auto-selecionado.

## Avaliação para o trabalho acadêmico

Requisito informado:

> Desenvolver um sistema web com Node como base, front e back separados, usando um framework
> trabalhado em laboratório, com regras complexas de negócio, código em Git e apresentação para
> a turma.

### Veredito: atende com ressalva

| Critério                       | Estado atual                                                                    | Como demonstrar                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Sistema web                    | **Atende**                                                                      | Fluxo completo no navegador, do upload ao XML.                                                                  |
| Node como base                 | **Atende**                                                                      | O repositório tem toolchain Node e um backend Node/Fastify executável em `server/`.                             |
| Front e back separados         | **Atende**                                                                      | React em `src/`; BFF Node em `server/`; API de domínio em projeto .NET separado.                                |
| Framework de front             | **Atende**, se React/Vite estiver entre os frameworks permitidos no laboratório | Mostrar componentes, rotas, estado e services.                                                                  |
| Regras complexas               | **Atende no sistema**, mas principalmente na API .NET                           | Parsing posicional, layout, validações e transformação são regras reais, porém não estão implementadas em Node. |
| Repositório Git e apresentação | **Atende quando publicado/apresentado**                                         | Usar histórico, CI e demonstração ponta a ponta.                                                                |

A ressalva é importante: o gateway Node contém controles relevantes — autenticação, autorização,
limites multipart por streaming, rate limit e proxy seguro —, mas eles são predominantemente
regras de infraestrutura. As regras complexas de **domínio** continuam concentradas no projeto
.NET.

Na apresentação, descreva o projeto como uma arquitetura web poliglota:

1. **React** resolve interface, navegação, acessibilidade e estado.
2. **Node/Fastify** cumpre o papel de backend web/BFF e fronteira de segurança.
3. **.NET** concentra o domínio especializado de parsing e transformação.
4. O usuário percorre as três camadas em uma demonstração única: upload, mapeamento, geração e
   download do XML.

Se a interpretação do professor for “as regras complexas precisam estar implementadas
especificamente no backend Node”, o projeto ainda não atende integralmente esse ponto. Para
eliminar a ambiguidade, seria necessário implementar no gateway Node ao menos uma regra de
domínio substancial e testável — por exemplo, uma política versionada de pré-validação e seleção
de estratégia de transformação — sem duplicar nem contradizer a API que continua sendo a fonte
da verdade.

---

**LayoutParser Web** · Front React + gateway Node/Fastify + domínio .NET
