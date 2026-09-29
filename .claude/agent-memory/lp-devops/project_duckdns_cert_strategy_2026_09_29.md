---
name: project-duckdns-cert-strategy-2026-09-29
description: DNS de produção é DuckDNS (duckdns.org); estratégia de certificado Let's Encrypt corrigida para DNS-01 devido ao acesso VPN-only do host
metadata:
  type: project
---

Variáveis reveladas em GitHub Actions environments/secrets confirmam a topologia de produção
do host Linux alvo do deploy PM2+Nginx (branch `feat/linux-deploy-pm2-nginx`):

- `PUBLIC_HOST` = `layoutparser.duckdns.org` — provedor de DNS é **DuckDNS** (dynamic DNS
  gratuito), não Cloudflare/Route53/provedor enterprise.
- `LAYOUTPARSER_API_URL` = `http://127.0.0.1:5000` — a API .NET roda na MESMA máquina que vai
  receber front+BFF; upstream é localhost.
- `BFF_DNS_SERVERS` = `172.31.250.251,172.31.250.252`.
- `ENTRA_CLIENT_ID`/`ENTRA_TENANT_ID=common` e `GOOGLE_CLIENT_ID` já configurados.
- Ainda faltam: `ENTRA_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`, `DEPLOY_ROOT`, `SITE_NAME`,
  `ADMIN_USERS`/`ADMIN_ROLES`, `SSL_CERT_PATH`/`SSL_CERT_KEY_PATH` (cert ainda não emitido).

**CORREÇÃO (2026-09-29): a recomendação anterior de HTTP-01 estava ERRADA e foi revertida.**

Motivo: o usuário revelou que o acesso à ferramenta em produção hoje é **restrito por VPN** —
só quem está na VPN alcança o servidor pela rede pública. Os servidores do Let's Encrypt
validam o desafio HTTP-01 a partir da internet pública aberta e **não conseguem entrar pela
VPN**, então HTTP-01 (com ou sem webroot) nunca vai completar a validação nesse host. Toda a
recomendação anterior (webroot, `certbot renew --webroot`, exposição de porta 80/443 direto)
não se aplica enquanto o host permanecer VPN-only.

**Nova recomendação: DNS-01 via DuckDNS, usando o suporte NATIVO a TXT da própria API do
DuckDNS** (parâmetro `txt=` em `https://www.duckdns.org/update?domains=<sub>&token=<TOKEN>&txt=<VALOR>`),
sem depender do plugin comunitário `certbot-dns-duckdns`. Fluxo:

```bash
certbot certonly --manual --preferred-challenges dns \
  --manual-auth-hook /caminho/duckdns-auth-hook.sh \
  --manual-cleanup-hook /caminho/duckdns-cleanup-hook.sh \
  -d layoutparser.duckdns.org
```

Os hooks (`scripts/duckdns-auth-hook.sh` e `scripts/duckdns-cleanup-hook.sh`, criados nesta
sessão) chamam a API do DuckDNS via `curl` usando `$CERTBOT_VALIDATION` (valor do TXT injetado
pelo certbot) e exigem a env var `DUCKDNS_TOKEN` (nunca hardcoded). Como a validação sai do
Let's Encrypt para consultar o DNS público (não para acessar o host), a VPN não é um obstáculo
— só o host precisa de saída de internet para falar com a API do Let's Encrypt e do DuckDNS.

**Renovação:** `certbot renew` reaproveita automaticamente os hooks salvos no arquivo de
renovação em `/etc/letsencrypt/renewal/layoutparser.duckdns.org.conf` (certbot grava
`--manual-auth-hook`/`--manual-cleanup-hook` lá na primeira emissão). Não há webroot nem porta
80/443 envolvidos neste fluxo.

**Risco concentrado:** como a API .NET, o BFF e o front ficam no MESMO host (upstream
localhost), qualquer problema no corte de DNS/TLS afeta os três de uma vez — atenção redobrada
ao testar o corte fora do horário de pico e ter rollback do vhost Nginx pronto (ver script de
deploy Linux, commits 3b48b5d/9721672/120c977 na branch `feat/linux-deploy-pm2-nginx`).

**Como aplicar:** ao planejar o corte real de DNS/certbot deste host, seguir DNS-01 via DuckDNS
acima. Nenhuma ação de certbot foi executada nesta sessão nem na anterior — apenas planejamento
e preparação de scripts. O token da conta DuckDNS (`DUCKDNS_TOKEN`) ainda não foi fornecido pelo
usuário e não deve ser pedido no chat principal — só por canal separado quando for hora de
executar de verdade.
