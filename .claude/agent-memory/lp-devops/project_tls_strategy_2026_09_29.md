---
name: project-tls-strategy-2026-09-29
description: Decisão final de TLS para o deploy Linux (PM2+Nginx) — self-signed gerado localmente no host, não Let's Encrypt/DuckDNS
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
  `ADMIN_USERS`/`ADMIN_ROLES`.

**DECISÃO FINAL (2026-09-29): certificado self-signed gerado localmente no host Linux — NÃO
Let's Encrypt/DuckDNS.** Isso substitui duas iterações anteriores nesta mesma sessão/dia
(primeiro HTTP-01, depois DNS-01 via DuckDNS) — ambas descartadas antes de qualquer emissão
real ter sido executada.

Motivo: o usuário esclareceu que a produção Windows/IIS atual já opera hoje com um certificado
**self-signed/interno** (`CN=BRNDDAPPBLD01`, no Windows Certificate Store) — nunca houve
Let's Encrypt ou qualquer CA pública em uso. O acesso é **restrito à VPN**, então confiança
pública de CA nunca foi necessária nesta topologia. A decisão explícita do usuário (via
pergunta direta) foi:

1. Gerar um certificado self-signed **novo** diretamente no host Linux de destino.
2. **Não exportar/mover a chave privada do Windows** para o Linux — decisão explícita para
   nunca transportar material de chave privada entre servidores; cada host tem seu próprio
   certificado gerado localmente.

**Comando de geração** (ver `deploy/README-tls.md` para o procedimento completo):

```bash
sudo openssl req -x509 -newkey rsa:4096 -sha256 -days 1095 -nodes \
  -keyout /etc/ssl/layoutparser/privkey.pem \
  -out /etc/ssl/layoutparser/fullchain.pem \
  -subj "/CN=layoutparser.duckdns.org" \
  -addext "subjectAltName=DNS:layoutparser.duckdns.org"
```

Validade de 3 anos (1095 dias); renovação é manual (regenerar e `nginx -s reload`) — não há
`certbot`, hook, DNS-01 nem systemd timer envolvidos neste fluxo.

**Artefatos removidos nesta correção:** `scripts/duckdns-auth-hook.sh`,
`scripts/duckdns-cleanup-hook.sh`, e o antigo `deploy/README-certbot.md` (substituído por
`deploy/README-tls.md`). Nenhum desses scripts chegou a ser executado contra o Let's Encrypt
real — apenas planejados/escritos e depois descartados no mesmo dia.

**Risco concentrado (ainda válido):** como a API .NET, o BFF e o front ficam no MESMO host
(upstream localhost), qualquer problema no corte de TLS afeta os três de uma vez — atenção
redobrada ao testar fora do horário de pico e ter rollback do vhost Nginx pronto (ver script de
deploy Linux, commits 3b48b5d/9721672/120c977 na branch `feat/linux-deploy-pm2-nginx`).

**Estado:** certificado self-signed gerado no host `UBU220405RUN` (via SSH) na mesma sessão
desta correção — ver caminhos exatos reportados no handoff/PR quando disponíveis
(`SSL_CERT_PATH`/`SSL_CERT_KEY_PATH`).
