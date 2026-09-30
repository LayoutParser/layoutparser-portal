# LayoutParser Academic BFF / BFF Acadêmico

## Português

BFF Node.js isolado para o `LayoutParserReact`, construído com Fastify e TypeScript. Ele mantém
o front e a `LayoutParserApi` separados, centraliza controles de segurança e demonstra uma
arquitetura web com back-end Node sem mover as regras de parsing que pertencem à API .NET.

```text
Navegador -> HTTPS/IIS -> 127.0.0.1:3100 (BFF Node) -> LayoutParserApi
```

### Rotas

| Rota                        | Comportamento                                                           |
| --------------------------- | ----------------------------------------------------------------------- |
| `GET /health`               | Liveness local, sem consultar nem revelar o upstream.                   |
| `GET /auth/login`           | Inicia OIDC Authorization Code com PKCE (Microsoft Entra).              |
| `GET /auth/callback`        | Valida a resposta Microsoft e cria a sessão.                            |
| `GET /auth/google/login`    | Inicia OIDC Authorization Code com PKCE (Google, alternativo).          |
| `GET /auth/google/callback` | Valida a resposta do Google e cria a sessão.                            |
| `POST /auth/logout`         | Apaga a sessão local (de qualquer provedor) sem afetar a conta externa. |
| `GET /api/session`          | Rota própria do BFF; nunca é encaminhada para a API.                    |
| `/api/*`                    | Proxy transparente, preservando `/api`, método, query e payload.        |

Entra e Google são provedores **alternativos**: o usuário escolhe um dos dois na tela de login.
Nenhum substitui o outro, cada um é opcional independentemente (ver variáveis de ambiente
abaixo) e a sessão resultante guarda `identity.provider` (`'entra' | 'google'`) para saber qual
foi usado — sem que isso mude o contrato de `/api/session` consumido pelo front.

O contrato determinístico de sessão é sempre:

```json
{
  "authenticated": true,
  "user": { "name": "usuario-autenticado" },
  "roles": ["RoleA"],
  "isAdmin": false
}
```

Quando não há identidade confiável, `authenticated` é `false`, `user.name` é uma string vazia,
`roles` é uma lista vazia e `isAdmin` é `false`.

### Limites: 32 MiB versus 25 MiB

- **32 MiB (`BFF_REQUEST_LIMIT_MIB`)**: limite da requisição HTTP inteira, incluindo boundary e
  metadados multipart, `layoutFile`, `txtFile` e demais campos. O padrão é 32 MiB.
- **25 MiB (`BFF_DOCUMENT_LIMIT_MIB`)**: limite cumulativo apenas do arquivo no campo
  `txtFile` (`BFF_DOCUMENT_FIELD`). O padrão é 25 MiB.

O espaço adicional não autoriza um documento de 32 MiB: ele acomoda o layout XML e o overhead
do multipart. Os limites são aplicados durante o streaming e o conteúdo TXT/XML não é escrito
nos logs.

### Desenvolvimento local

Requer Node.js 24.15 ou superior dentro da linha LTS 24.x.

```powershell
cd server
Copy-Item .env.example .env
npm install
npm run dev
```

O arquivo de exemplo habilita explicitamente a autenticação local. Envie uma identidade apenas
no ambiente não produtivo:

```powershell
Invoke-RestMethod http://127.0.0.1:3100/api/session `
  -Headers @{ 'X-Dev-User' = 'seu.usuario'; 'X-Dev-Roles' = 'Users' }
```

Não existe usuário, senha, token ou administrador padrão. Para testar rotas administrativas,
configure valores reais e locais em `BFF_ADMIN_USERS` ou `BFF_ADMIN_ROLES` no `.env`, que é
ignorado pelo Git.

### Produção com IIS

O processo falha antes de abrir a porta se a configuração não cumprir os requisitos de
produção. É obrigatório:

1. Publicar o site em HTTPS no IIS.
2. Manter o BFF em `127.0.0.1` ou `::1`; bind externo é recusado em produção.
3. Configurar ARR/URL Rewrite para encaminhar `/auth/*` e `/api/*` ao BFF.
4. Habilitar Anonymous Authentication e desabilitar Windows Authentication no site IIS.
5. Informar origem pública, configuração Entra e uma allowlist administrativa.
6. Usar HTTPS no upstream remoto. HTTP só é aceito para upstream de loopback.
7. Manter `BFF_DEV_AUTH_ENABLED=false`.

Exemplo com placeholders deliberados:

```dotenv
NODE_ENV=production
BFF_HOST=127.0.0.1
BFF_PORT=3100
BFF_PUBLIC_ORIGIN=https://layoutparser.exemplo
LAYOUTPARSER_API_URL=https://api.interna.exemplo
ENTRA_TENANT_ID=common
ENTRA_CLIENT_ID=<Application client ID>
ENTRA_CLIENT_SECRET=<secret Value>
GOOGLE_CLIENT_ID=<Client ID do Google Cloud Console>
GOOGLE_CLIENT_SECRET=<Client Secret do Google Cloud Console>
BFF_TRUSTED_USER_HEADER=X-IIS-User
BFF_TRUSTED_ROLES_HEADER=X-IIS-Roles
BFF_TRUSTED_IDENTITY_PROVIDER_HEADER=X-LayoutParser-Identity-Provider
BFF_TRUSTED_IDENTITY_SUBJECT_HEADER=X-LayoutParser-Identity-Subject
BFF_TRUSTED_IDENTITY_TENANT_HEADER=X-LayoutParser-Identity-Tenant
BFF_TRUSTED_IDENTITY_EMAIL_HEADER=X-LayoutParser-Identity-Email
BFF_TRUSTED_EMAIL_TENANTS=
BFF_ADMIN_USERS=
BFF_ADMIN_ROLES=
BFF_DEV_AUTH_ENABLED=false
```

Preencha a allowlist antes de iniciar. O exemplo é propositalmente incompleto e falhará até que
`ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` e a allowlist tenham valores reais. O client secret deve
existir somente no secret store do ambiente. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` são
**opcionais** em qualquer ambiente, inclusive produção: se ausentes, `/auth/google/login` responde
503 e o Entra continua funcionando normalmente. Não há restrição de domínio do Google — qualquer
conta pessoal ou do Workspace pode autenticar.

**E-mail verificado.** O BFF repassa à API o e-mail do usuário em
`BFF_TRUSTED_IDENTITY_EMAIL_HEADER` (padrão `x-layoutparser-identity-email`), sempre em minúsculas,
com no máximo 320 caracteres e nunca logado. Ele só é enviado quando verificado: Google exige
`email_verified === true`; Entra **não** é confiável por padrão (app multi-tenant `common` pode
emitir e-mail não verificado) e só envia quando o `tid` do token consta em
`BFF_TRUSTED_EMAIL_TENANTS` (CSV de tenant IDs; padrão vazio). E-mail não verificado permitiria
escalada de privilégio (convite pendente viraria membership). O header recebido do cliente é
sempre removido. `/api/admin` e `/api/admin/*` exigem admin do BFF (`BFF_ADMIN_PATHS`).

O BFF usa Authorization Code + PKCE e valida `state` e `nonce` em ambos os provedores. A sessão é
um cookie criptografado `HttpOnly`, `Secure` e `SameSite=Lax`, com duração padrão de oito horas.
Somente nome normalizado, identificador do sujeito, roles e o provedor usado (`entra` ou `google`)
ficam na sessão; o Entra também grava o tenant. ID/access tokens não ficam no navegador nem são
repassados à API. A chave da sessão continua derivada apenas do client secret do Entra com HKDF
(quando presente); o Google não participa dessa derivação — ver comentário em
`src/oidc.ts#deriveSessionKey` para a justificativa.

### Autorização administrativa

Os padrões protegidos por default são:

- `/api/monitoring/*`
- `/api/ai-metrics/*`
- `/api/layoutdatabase/refresh-cache`
- `/api/metrics`

`BFF_ADMIN_PATHS` permite atualizar essa lista quando o contrato da API evoluir. A comparação é
case-insensitive, normaliza barras e URL encoding, e aceita somente caminhos exatos ou wildcard
final `/*`. Um usuário precisa estar em `BFF_ADMIN_USERS` ou possuir uma role presente em
`BFF_ADMIN_ROLES`.

### Segurança e observabilidade

- Helmet adiciona headers defensivos; HSTS é ativado somente em produção.
- Rate limit em memória usa a identidade autenticada e recorre ao IP para anônimos.
- As rotas OIDC têm limites explícitos por minuto: 20 inícios, 60 callbacks e 30 logouts por
  chave do limitador, além do limite global do BFF.
- `X-Correlation-ID` válido é preservado; valores inválidos são substituídos por UUID.
- `Authorization`, cookies e identidades fornecidas pelo navegador são removidos antes do proxy.
  O BFF injeta somente os headers normalizados da sessão validada.
- `provider`, `subject` e `tenant` são encaminhados exclusivamente ao upstream confiável para a API
  resolver um `UserId` interno estável. O subject bruto não faz parte de `/api/session` e não fica
  disponível ao JavaScript.
- Logs Pino são JSON estruturado e contêm método, path sem query, status, duração e estado de
  autenticação. Headers sensíveis e corpos TXT/XML não são registrados.
- URLs de upstream com credenciais são recusadas.

Para múltiplas instâncias, substitua o rate limit em memória por um store compartilhado, como
Redis. A proteção autoritativa dos endpoints deve continuar existindo também na API .NET; o BFF
não substitui autorização em profundidade.

### Verificações

```powershell
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run audit
# tudo em sequência
npm run quality
```

Os testes exercitam configuração fail-fast, health, sessão, autenticação, allowlist admin,
proxy transparente, correlation id, rate limit, os dois limites de payload e ausência de
TXT/XML nos logs.

---

## English

This folder contains an isolated Fastify + TypeScript Node.js BFF for `LayoutParserReact`.
It transparently proxies `/api/*` to the configurable .NET API, except for the local
`GET /api/session` route. It binds to `127.0.0.1` by default and refuses insecure production
configuration.

The total HTTP request limit defaults to **32 MiB**, while the `txtFile` document itself defaults
to **25 MiB**. The difference reserves space for the XML layout, multipart boundaries and form
metadata; it does not increase the allowed document size.

Production authentication uses Microsoft Entra OIDC Authorization Code with PKCE, state and
nonce validation. IIS serves anonymous static content and forwards `/auth/*` and `/api/*` to the
loopback-only BFF. The BFF stores only minimal identity data in an encrypted HttpOnly session
cookie; Microsoft tokens and the client secret never reach React or the .NET API. Development
impersonation remains explicit and is forbidden when `NODE_ENV=production`.

See the Portuguese sections above for the complete environment reference, IIS deployment
checklist, security model and verification commands.
