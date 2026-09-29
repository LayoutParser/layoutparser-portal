#!/usr/bin/env bash
# Auth hook do certbot (--manual-auth-hook) para desafio DNS-01 via DuckDNS.
#
# O certbot chama este script antes de pedir ao Let's Encrypt que valide o desafio,
# injetando as variáveis de ambiente CERTBOT_DOMAIN e CERTBOT_VALIDATION.
#
# Requer a variável de ambiente DUCKDNS_TOKEN (token da conta DuckDNS) já exportada
# no ambiente em que o certbot roda. NUNCA hardcode o token neste arquivo.
#
# Uso (ver deploy/README-certbot.md):
#   certbot certonly --manual --preferred-challenges dns \
#     --manual-auth-hook "$(pwd)/scripts/duckdns-auth-hook.sh" \
#     --manual-cleanup-hook "$(pwd)/scripts/duckdns-cleanup-hook.sh" \
#     -d layoutparser.duckdns.org

set -euo pipefail

if [[ -z "${DUCKDNS_TOKEN:-}" ]]; then
  echo "ERRO: variável de ambiente DUCKDNS_TOKEN não definida. Exporte o token da conta" >&2
  echo "DuckDNS antes de rodar o certbot (nunca hardcode este valor em arquivo)." >&2
  exit 1
fi

if [[ -z "${CERTBOT_VALIDATION:-}" ]]; then
  echo "ERRO: CERTBOT_VALIDATION não foi injetada pelo certbot. Este script deve ser" >&2
  echo "chamado apenas como --manual-auth-hook em um desafio DNS-01." >&2
  exit 1
fi

# Subdomínio DuckDNS (sem o sufixo .duckdns.org). Ajuste via env var se o domínio mudar.
DUCKDNS_DOMAIN="${DUCKDNS_DOMAIN:-layoutparser}"

# Tempo de espera após publicar o TXT, para dar chance de propagação antes do certbot
# pedir ao Let's Encrypt para validar. Ajuste via DUCKDNS_PROPAGATION_SLEEP se necessário.
PROPAGATION_SLEEP="${DUCKDNS_PROPAGATION_SLEEP:-30}"

echo "Publicando TXT no DuckDNS para o domínio '${DUCKDNS_DOMAIN}.duckdns.org'..." >&2

response=$(curl -sS "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&txt=${CERTBOT_VALIDATION}")

if [[ "${response}" != OK* ]]; then
  echo "ERRO: DuckDNS não confirmou a atualização do TXT (resposta: '${response}')." >&2
  exit 1
fi

echo "TXT publicado. Aguardando ${PROPAGATION_SLEEP}s para propagação DNS..." >&2
sleep "${PROPAGATION_SLEEP}"
