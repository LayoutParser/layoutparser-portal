#!/usr/bin/env bash
#
# deploy-linux.sh — equivalente Linux (PM2 + Nginx) de scripts/Deploy-Iis.ps1.
#
# Publica o build já pronto do front (dist/) e do BFF (server/dist/) como uma nova "release"
# imutável, sobe o BFF sob PM2, aponta o symlink `current` (servido pelo Nginx) para a nova
# release e faz rollback automático se o smoke test falhar. Reaproveitável em dev-local (WSL) e,
# futuramente, em produção — ver `.claude/plans` (migração Windows/IIS -> Linux) para o desenho
# completo. Todas as entradas são env vars (mapeamento 1:1 com os parâmetros de Deploy-Iis.ps1,
# ver tabela no plano de migração); nenhum valor é lido de arquivo além dos builds já gerados.
#
# Uso: DEPLOY_ROOT=... SITE_NAME=... PUBLIC_HOST=... UPSTREAM_URL=... \
#      ADMIN_USERS=... ENTRA_TENANT_ID=... ENTRA_CLIENT_ID=... ENTRA_CLIENT_SECRET=... \
#      SSL_CERT_PATH=... SSL_CERT_KEY_PATH=... ./scripts/deploy-linux.sh
#
# -E (errtrace) é obrigatório aqui: sem ele, `trap rollback ERR` não é herdado por chamadas de
# função (wait_bff_health, test_authentication_redirect etc.) — uma falha dentro delas encerra
# o script via -e mas NUNCA dispara o rollback. Achado ao testar o script de verdade em WSL.
set -Eeuo pipefail

# ---------------------------------------------------------------------------
# 1. Entrada (env vars) + defaults
# ---------------------------------------------------------------------------
DEPLOY_ROOT="${DEPLOY_ROOT:-}"
SITE_NAME="${SITE_NAME:-}"
PUBLIC_HOST="${PUBLIC_HOST:-}"
UPSTREAM_URL="${UPSTREAM_URL:-}"
ADMIN_USERS="${ADMIN_USERS:-}"
ADMIN_ROLES="${ADMIN_ROLES:-}"
ENTRA_TENANT_ID="${ENTRA_TENANT_ID:-}"
ENTRA_CLIENT_ID="${ENTRA_CLIENT_ID:-}"
ENTRA_CLIENT_SECRET="${ENTRA_CLIENT_SECRET:-}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}"
DNS_SERVERS="${DNS_SERVERS:-}"
FRONTEND_SOURCE="${FRONTEND_SOURCE:-dist}"
SERVER_SOURCE="${SERVER_SOURCE:-server}"
BFF_PORT="${BFF_PORT:-3100}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
SSL_CERT_PATH="${SSL_CERT_PATH:-}"
SSL_CERT_KEY_PATH="${SSL_CERT_KEY_PATH:-}"

log() { printf '[deploy-linux] %s\n' "$*" >&2; }
# Usa `return`, não `exit`: o builtin `exit` nunca dispara `trap ... ERR`, então um `exit 1`
# aqui pularia o rollback automático em toda falha de validação/health-check/smoke-test — só
# `return 1` (como último comando de um `cmd || fail ...`) aciona a trap e ainda encerra o
# script via `set -e`, já que essa é a exceção documentada para o comando final de uma lista.
fail() {
  printf '[deploy-linux] ERRO: %s\n' "$*" >&2
  return 1
}

# ---------------------------------------------------------------------------
# 2. Validação de entrada (replica as checagens de Deploy-Iis.ps1)
# ---------------------------------------------------------------------------
[[ -n "$DEPLOY_ROOT" ]] || fail 'DEPLOY_ROOT é obrigatória.'
[[ -n "$SITE_NAME" ]] || fail 'SITE_NAME é obrigatória.'
[[ "$SITE_NAME" =~ ^[A-Za-z0-9._-]{1,64}$ ]] \
  || fail 'SITE_NAME deve conter apenas letras, números, ponto, hífen ou underscore.'
[[ -n "$PUBLIC_HOST" ]] || fail 'PUBLIC_HOST é obrigatória.'
[[ "$PUBLIC_HOST" =~ ^(([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)\.)*[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] \
  || fail 'PUBLIC_HOST deve ser somente um hostname DNS, sem protocolo, caminho ou porta.'
[[ -n "$UPSTREAM_URL" ]] || fail 'UPSTREAM_URL é obrigatória.'
[[ -n "$ADMIN_USERS" || -n "$ADMIN_ROLES" ]] \
  || fail 'Configure ADMIN_USERS e/ou ADMIN_ROLES.'

TENANT_ID_PATTERN='^(common|organizations|consumers|[0-9a-fA-F-]{36}|[a-zA-Z0-9]([a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?)$'
[[ -n "$ENTRA_TENANT_ID" ]] || fail 'ENTRA_TENANT_ID é obrigatória.'
[[ "$ENTRA_TENANT_ID" =~ $TENANT_ID_PATTERN ]] || fail 'ENTRA_TENANT_ID possui formato inválido.'

CLIENT_ID_PATTERN='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
[[ "$ENTRA_CLIENT_ID" =~ $CLIENT_ID_PATTERN ]] || fail 'ENTRA_CLIENT_ID deve ser um GUID válido.'

[[ -n "$ENTRA_CLIENT_SECRET" && ${#ENTRA_CLIENT_SECRET} -ge 16 ]] \
  || fail 'ENTRA_CLIENT_SECRET está ausente ou é curto demais.'

if [[ -n "$GOOGLE_CLIENT_ID" || -n "$GOOGLE_CLIENT_SECRET" ]]; then
  GOOGLE_CLIENT_ID_PATTERN='^[0-9]+-[0-9a-zA-Z]+\.apps\.googleusercontent\.com$'
  [[ "$GOOGLE_CLIENT_ID" =~ $GOOGLE_CLIENT_ID_PATTERN ]] \
    || fail 'GOOGLE_CLIENT_ID deve ser o Client ID emitido pelo Google Cloud Console (*.apps.googleusercontent.com).'
  [[ -n "$GOOGLE_CLIENT_SECRET" && ${#GOOGLE_CLIENT_SECRET} -ge 16 ]] \
    || fail 'GOOGLE_CLIENT_SECRET está ausente ou é curto demais.'
fi

[[ "$BFF_PORT" =~ ^[0-9]+$ && "$BFF_PORT" -ge 1 && "$BFF_PORT" -le 65535 ]] \
  || fail 'BFF_PORT inválida.'
[[ "$KEEP_RELEASES" =~ ^[0-9]+$ && "$KEEP_RELEASES" -ge 2 && "$KEEP_RELEASES" -le 20 ]] \
  || fail 'KEEP_RELEASES deve estar entre 2 e 20.'

[[ -n "$SSL_CERT_PATH" ]] || fail 'SSL_CERT_PATH é obrigatória (certificado gerado via mkcert).'
[[ -n "$SSL_CERT_KEY_PATH" ]] || fail 'SSL_CERT_KEY_PATH é obrigatória (chave gerada via mkcert).'
[[ -f "$SSL_CERT_PATH" ]] || fail "SSL_CERT_PATH não existe: $SSL_CERT_PATH"
[[ -f "$SSL_CERT_KEY_PATH" ]] || fail "SSL_CERT_KEY_PATH não existe: $SSL_CERT_KEY_PATH"

command -v pm2 >/dev/null 2>&1 || fail 'pm2 não encontrado no PATH.'
command -v npm >/dev/null 2>&1 || fail 'npm não encontrado no PATH.'
command -v curl >/dev/null 2>&1 || fail 'curl não encontrado no PATH.'

# ---------------------------------------------------------------------------
# 3. Resolução segura de DEPLOY_ROOT
# ---------------------------------------------------------------------------
resolve_safe_deploy_root() {
  local candidate="$1"
  local full_path
  full_path="$(readlink -m -- "$candidate")"
  local workspace_root
  workspace_root="$(readlink -m -- "$PWD")"

  if [[ "$full_path" == "/" || "$full_path" == "$HOME" || "$full_path" == "$workspace_root" \
        || ${#full_path} -lt 10 ]]; then
    fail "DEPLOY_ROOT inseguro ou amplo demais: $full_path"
  fi

  printf '%s' "${full_path%/}"
}

DEPLOY_PATH="$(resolve_safe_deploy_root "$DEPLOY_ROOT")"

# ---------------------------------------------------------------------------
# 4. Verificação dos builds de origem (já gerados por step anterior do workflow)
# ---------------------------------------------------------------------------
[[ -d "$FRONTEND_SOURCE" ]] || fail "FRONTEND_SOURCE não existe: $FRONTEND_SOURCE"
[[ -d "$SERVER_SOURCE" ]] || fail "SERVER_SOURCE não existe: $SERVER_SOURCE"
[[ -f "$FRONTEND_SOURCE/index.html" ]] || fail 'O build do front não contém dist/index.html.'
[[ -f "$SERVER_SOURCE/dist/src/index.js" ]] \
  || fail 'O build do BFF não contém server/dist/src/index.js.'

FRONTEND_SOURCE_PATH="$(readlink -m -- "$FRONTEND_SOURCE")"
SERVER_SOURCE_PATH="$(readlink -m -- "$SERVER_SOURCE")"

# ---------------------------------------------------------------------------
# 5. Estrutura de diretórios
# ---------------------------------------------------------------------------
RELEASES_ROOT="$DEPLOY_PATH/releases"
STATE_ROOT="$DEPLOY_PATH/state"
LOGS_ROOT="$DEPLOY_PATH/logs"
mkdir -p "$DEPLOY_PATH" "$RELEASES_ROOT" "$STATE_ROOT" "$LOGS_ROOT"

SHA="manual"
if git rev-parse --short=12 HEAD >/dev/null 2>&1; then
  SHA="$(git rev-parse --short=12 HEAD)"
fi
RELEASE_NAME="$(date +%Y%m%d-%H%M%S)-${SHA}"
RELEASE_ROOT="$RELEASES_ROOT/$RELEASE_NAME"
FRONTEND_TARGET="$RELEASE_ROOT/front-end"
SERVER_TARGET="$RELEASE_ROOT/server"
mkdir -p "$FRONTEND_TARGET" "$SERVER_TARGET"

log "Preparando release $RELEASE_NAME em $RELEASE_ROOT"

# ---------------------------------------------------------------------------
# 6. Cópia dos artefatos de build
# ---------------------------------------------------------------------------
cp -r "$FRONTEND_SOURCE_PATH"/. "$FRONTEND_TARGET"/
cp -r "$SERVER_SOURCE_PATH/dist" "$SERVER_TARGET"/
cp "$SERVER_SOURCE_PATH/package.json" "$SERVER_TARGET"/
cp "$SERVER_SOURCE_PATH/package-lock.json" "$SERVER_TARGET"/

# ---------------------------------------------------------------------------
# 7. Dependências de produção do BFF
# ---------------------------------------------------------------------------
log 'Instalando dependências de produção do BFF (npm ci --omit=dev --ignore-scripts)'
npm ci --omit=dev --ignore-scripts --prefix "$SERVER_TARGET"

# ---------------------------------------------------------------------------
# 8. Origem pública (PUBLIC_ORIGIN sempre HTTPS 443 em dev-local/produção Nginx)
# ---------------------------------------------------------------------------
PUBLIC_ORIGIN="https://${PUBLIC_HOST}"

# ---------------------------------------------------------------------------
# 9. Geração do ecosystem file do PM2 (mapeamento 1:1 com Start-Bff.ps1)
# ---------------------------------------------------------------------------
ECOSYSTEM_PATH="$RELEASE_ROOT/ecosystem.config.cjs"
BFF_OUT_LOG="$LOGS_ROOT/bff-out.log"
BFF_ERROR_LOG="$LOGS_ROOT/bff-error.log"
APP_NAME="${SITE_NAME}-bff"

# Serializa cada valor como string JS entre aspas simples, escapando aspas simples e barras
# invertidas — evita que segredos (ex. client secret) quebrem a sintaxe do arquivo gerado.
js_string_literal() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\'/\\\'}"
  printf "'%s'" "$value"
}

{
  echo "// Gerado automaticamente por scripts/deploy-linux.sh — NÃO versionar nem editar à mão."
  echo "// Uma cópia por release, preservada em state/current.json para rollback (ver passo 13)."
  echo "module.exports = {"
  echo "  apps: [{"
  echo "    name: $(js_string_literal "$APP_NAME"),"
  echo "    cwd: $(js_string_literal "$SERVER_TARGET"),"
  echo "    script: 'dist/src/index.js',"
  echo "    interpreter: 'node',"
  echo "    env: {"
  echo "      NODE_ENV: 'production',"
  echo "      BFF_HOST: '127.0.0.1',"
  echo "      BFF_PORT: $(js_string_literal "$BFF_PORT"),"
  echo "      BFF_PUBLIC_ORIGIN: $(js_string_literal "$PUBLIC_ORIGIN"),"
  echo "      LAYOUTPARSER_API_URL: $(js_string_literal "$UPSTREAM_URL"),"
  if [[ -n "$DNS_SERVERS" ]]; then
    echo "      BFF_DNS_SERVERS: $(js_string_literal "$DNS_SERVERS"),"
  fi
  echo "      BFF_TRUSTED_USER_HEADER: 'x-iis-user',"
  echo "      BFF_TRUSTED_ROLES_HEADER: 'x-iis-roles',"
  echo "      BFF_ADMIN_USERS: $(js_string_literal "$ADMIN_USERS"),"
  echo "      BFF_ADMIN_ROLES: $(js_string_literal "$ADMIN_ROLES"),"
  echo "      ENTRA_TENANT_ID: $(js_string_literal "$ENTRA_TENANT_ID"),"
  echo "      ENTRA_CLIENT_ID: $(js_string_literal "$ENTRA_CLIENT_ID"),"
  echo "      ENTRA_CLIENT_SECRET: $(js_string_literal "$ENTRA_CLIENT_SECRET"),"
  echo "      GOOGLE_CLIENT_ID: $(js_string_literal "$GOOGLE_CLIENT_ID"),"
  echo "      GOOGLE_CLIENT_SECRET: $(js_string_literal "$GOOGLE_CLIENT_SECRET"),"
  echo "      BFF_DEV_AUTH_ENABLED: 'false',"
  echo "    },"
  echo "    out_file: $(js_string_literal "$BFF_OUT_LOG"),"
  echo "    error_file: $(js_string_literal "$BFF_ERROR_LOG"),"
  echo "    merge_logs: true,"
  echo "    time: true,"
  echo "    max_restarts: 5,"
  echo "    min_uptime: '10s',"
  echo "    restart_delay: 60000,"
  echo "    autorestart: true,"
  echo "  }]"
  echo "};"
} > "$ECOSYSTEM_PATH"
chmod 600 "$ECOSYSTEM_PATH"

# ---------------------------------------------------------------------------
# 10-15. Deploy com rollback automático em qualquer falha a partir daqui
# ---------------------------------------------------------------------------
STATE_FILE="$STATE_ROOT/current.json"
CURRENT_LINK="$DEPLOY_PATH/current"

PREVIOUS_RELEASE=""
PREVIOUS_ECOSYSTEM_PATH=""
PREVIOUS_FRONTEND_PATH=""
if [[ -f "$STATE_FILE" ]]; then
  PREVIOUS_RELEASE="$(sed -n 's/.*"release"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
  PREVIOUS_ECOSYSTEM_PATH="$(sed -n 's/.*"ecosystemPath"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
  PREVIOUS_FRONTEND_PATH="$(sed -n 's/.*"frontendPath"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$STATE_FILE" | head -n1)"
fi

wait_bff_health() {
  local health_url="http://127.0.0.1:${BFF_PORT}/health"
  local attempt
  for attempt in $(seq 1 15); do
    local body
    if body="$(curl -sf --max-time 3 "$health_url" 2>/dev/null)"; then
      if printf '%s' "$body" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"' \
        && printf '%s' "$body" | grep -q '"service"[[:space:]]*:[[:space:]]*"layout-parser-bff"'; then
        return 0
      fi
    fi
    sleep 2
  done

  fail "O BFF não ficou saudável em $health_url."
}

# Confere que o redirect OIDC do /auth/login aponta para login.microsoftonline.com com o
# redirect_uri esperado — mesma verificação de Test-AuthenticationRedirect em Deploy-Iis.ps1.
test_authentication_redirect() {
  local login_url="${PUBLIC_ORIGIN}/auth/login?returnTo=%2F"
  local headers
  headers="$(curl -sk -D - -o /dev/null --max-time 15 "$login_url")"

  local status_line
  status_line="$(printf '%s' "$headers" | head -n1 | tr -d '\r')"
  [[ "$status_line" == *" 302"* ]] \
    || fail "O login Microsoft retornou '$status_line', esperado 302."

  local location
  location="$(printf '%s' "$headers" | grep -i '^location:' | head -n1 | cut -d' ' -f2- | tr -d '\r\n')"
  [[ -n "$location" ]] || fail 'O login Microsoft não retornou o header Location.'
  [[ "$location" == https://login.microsoftonline.com/* ]] \
    || fail "O destino do login Microsoft mudou para: $location"

  local redirect_uri
  redirect_uri="$(printf '%s' "$location" | grep -oP '(?:[?&])redirect_uri=\K[^&]+' | head -n1)"
  [[ -n "$redirect_uri" ]] || fail 'A autorização Microsoft não contém redirect_uri.'
  # Decodifica percent-encoding.
  redirect_uri="$(printf '%b' "${redirect_uri//%/\\x}")"

  local expected_redirect_uri="${PUBLIC_ORIGIN}/auth/callback"
  [[ "$redirect_uri" == "$expected_redirect_uri" ]] \
    || fail "OIDC redirect_uri incorreta: '$redirect_uri'; esperado '$expected_redirect_uri'."
}

rollback() {
  log 'Falha detectada — revertendo para a release anterior.'
  if [[ -n "$PREVIOUS_FRONTEND_PATH" && -d "$PREVIOUS_FRONTEND_PATH" ]]; then
    ln -sfn "$PREVIOUS_FRONTEND_PATH" "$CURRENT_LINK"
  fi
  if [[ -n "$PREVIOUS_ECOSYSTEM_PATH" && -f "$PREVIOUS_ECOSYSTEM_PATH" ]]; then
    pm2 startOrReload "$PREVIOUS_ECOSYSTEM_PATH" --update-env || true
  else
    pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
  fi
  fail 'Deploy revertido — release anterior restaurada.'
}
trap rollback ERR

log "Subindo $APP_NAME via pm2 startOrReload"
pm2 startOrReload "$ECOSYSTEM_PATH" --update-env

log 'Aguardando health check do BFF'
wait_bff_health

log 'Atualizando symlink current (front-end)'
ln -sfn "$FRONTEND_TARGET" "$CURRENT_LINK"

render_nginx_site() {
  local template="$1"
  local target="$2"
  sed \
    -e "s#__PUBLIC_HOST__#${PUBLIC_HOST}#g" \
    -e "s#__DEPLOY_ROOT__#${DEPLOY_PATH}#g" \
    -e "s#__BFF_PORT__#${BFF_PORT}#g" \
    -e "s#__SSL_CERT_PATH__#${SSL_CERT_PATH}#g" \
    -e "s#__SSL_CERT_KEY_PATH__#${SSL_CERT_KEY_PATH}#g" \
    "$template" > "$target"
}

# O Nginx é atualizado dentro deste script (não como step separado do workflow) para manter um
# único lugar de lógica de deploy, igual ao papel que Deploy-Iis.ps1 cumpre hoje sozinho. Requer
# uma regra sudoers NOPASSWD restrita a `nginx -t` e `systemctl reload nginx` (ver plano de
# migração, seção 1.5) — nunca sudo irrestrito.
NGINX_TEMPLATE="$(dirname -- "${BASH_SOURCE[0]}")/../deploy/nginx/dev-local.conf.template"
if [[ -f "$NGINX_TEMPLATE" ]] && command -v nginx >/dev/null 2>&1; then
  NGINX_SITE_AVAILABLE="/etc/nginx/sites-available/${SITE_NAME}.conf"
  NGINX_SITE_ENABLED="/etc/nginx/sites-enabled/${SITE_NAME}.conf"
  RENDERED_SITE="$RELEASE_ROOT/nginx-${SITE_NAME}.conf"
  render_nginx_site "$NGINX_TEMPLATE" "$RENDERED_SITE"

  log 'Aplicando vhost Nginx (sudo restrito a nginx -t / systemctl reload nginx)'
  sudo cp "$RENDERED_SITE" "$NGINX_SITE_AVAILABLE"
  sudo ln -sfn "$NGINX_SITE_AVAILABLE" "$NGINX_SITE_ENABLED"
  sudo nginx -t
  sudo systemctl reload nginx
else
  log 'nginx não encontrado ou template ausente — pulando aplicação do vhost (dev sem Nginx local?).'
fi

log 'Rodando smoke test (front-end)'
curl -skf --max-time 15 "${PUBLIC_ORIGIN}/" >/dev/null \
  || fail "Smoke test em ${PUBLIC_ORIGIN}/ falhou."

log 'Rodando smoke test (redirect OIDC)'
test_authentication_redirect

trap - ERR

# ---------------------------------------------------------------------------
# 14. Persistir estado só após sucesso
# ---------------------------------------------------------------------------
DEPLOYED_AT_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "$STATE_FILE" <<EOF
{
  "release": "$RELEASE_NAME",
  "frontendPath": "$FRONTEND_TARGET",
  "serverPath": "$SERVER_TARGET",
  "ecosystemPath": "$ECOSYSTEM_PATH",
  "deployedAtUtc": "$DEPLOYED_AT_UTC"
}
EOF

# ---------------------------------------------------------------------------
# 15. Prune de releases antigas (nunca remove a release apontada por `current`)
# ---------------------------------------------------------------------------
CURRENT_RELEASE_REAL="$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)"
mapfile -t OLD_RELEASES < <(
  find "$RELEASES_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | tail -n +$((KEEP_RELEASES + 1))
)
for old_release in "${OLD_RELEASES[@]:-}"; do
  [[ -z "$old_release" ]] && continue
  old_release_path="$RELEASES_ROOT/$old_release"
  resolved_old_release_path="$(readlink -f -- "$old_release_path")"
  case "$resolved_old_release_path" in
    "$RELEASES_ROOT"/*) ;;
    *) fail "Release fora da raiz esperada: $resolved_old_release_path" ;;
  esac
  if [[ -n "$CURRENT_RELEASE_REAL" && "$resolved_old_release_path" == "$(dirname "$CURRENT_RELEASE_REAL")" ]]; then
    continue
  fi
  log "Removendo release antiga: $old_release"
  rm -rf -- "$resolved_old_release_path"
done

log "Deploy concluído: release $RELEASE_NAME, front HTTPS e BFF saudável."
