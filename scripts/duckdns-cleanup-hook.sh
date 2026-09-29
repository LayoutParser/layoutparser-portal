#!/usr/bin/env bash
# Cleanup hook do certbot (--manual-cleanup-hook) para desafio DNS-01 via DuckDNS.
#
# O certbot chama este script depois da validação (sucesso ou falha), para remover o
# registro TXT publicado pelo duckdns-auth-hook.sh.
#
# Requer a variável de ambiente DUCKDNS_TOKEN (token da conta DuckDNS) já exportada
# no ambiente em que o certbot roda. NUNCA hardcode o token neste arquivo.
#
# ASSUNÇÃO: a API do DuckDNS documenta o parâmetro `clear=true` para limpar o TXT
# (equivalente a publicar um TXT vazio). Se o comportamento observado divergir, confirme
# na documentação oficial do DuckDNS (https://www.duckdns.org/spec.jsp) antes de confiar
# cegamente neste script em produção.

set -euo pipefail

if [[ -z "${DUCKDNS_TOKEN:-}" ]]; then
  echo "ERRO: variável de ambiente DUCKDNS_TOKEN não definida. Exporte o token da conta" >&2
  echo "DuckDNS antes de rodar o certbot (nunca hardcode este valor em arquivo)." >&2
  exit 1
fi

# Subdomínio DuckDNS (sem o sufixo .duckdns.org). Ajuste via env var se o domínio mudar.
DUCKDNS_DOMAIN="${DUCKDNS_DOMAIN:-layoutparser}"

echo "Limpando TXT no DuckDNS para o domínio '${DUCKDNS_DOMAIN}.duckdns.org'..." >&2

response=$(curl -sS "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&txt=removed&clear=true")

if [[ "${response}" != OK* ]]; then
  echo "AVISO: DuckDNS não confirmou a limpeza do TXT (resposta: '${response}')." >&2
  echo "O registro pode ter ficado órfão — verifique manualmente se necessário." >&2
  # Não falha o processo do certbot por causa disso; o cleanup é best-effort.
fi
