# Certificado TLS em produção (Let's Encrypt / certbot)

`scripts/deploy-linux.sh` e `deploy/nginx/site.conf.template` **consomem** um certificado já
emitido — o script não instala nem gerencia certbot. Este documento descreve o procedimento
esperado quando o certificado de `SSL_CERT_PATH`/`SSL_CERT_KEY_PATH` vier do Let's Encrypt.

## Por que DNS-01 (e não HTTP-01)

O host de produção é **acessível apenas via VPN** — não há rota pública direta para as portas
80/443 a partir da internet aberta. Os servidores do Let's Encrypt validam o desafio **HTTP-01**
a partir da internet pública, então esse desafio **nunca completa** nesta topologia (com ou sem
webroot, com ou sem `--standalone`). Por isso, o único caminho viável aqui é **DNS-01**: o
Let's Encrypt valida consultando um registro TXT público no DNS, sem precisar alcançar o host
diretamente — só o host precisa de saída de internet para falar com a API do Let's Encrypt e a
do DuckDNS.

## Caminho estável

O certbot atualiza os arquivos **in-place** a cada renovação quando você usa o caminho padrão
de `live/`. Aponte as variáveis de ambiente do deploy para esse caminho, e ele permanece válido
para sempre (nenhum ajuste manual necessário após renovar):

```bash
SSL_CERT_PATH=/etc/letsencrypt/live/<PUBLIC_HOST>/fullchain.pem
SSL_CERT_KEY_PATH=/etc/letsencrypt/live/<PUBLIC_HOST>/privkey.pem
```

> Não aponte para os arquivos versionados em `archive/` — use sempre o symlink estável de
> `live/`.

## Emissão inicial — DNS-01 via API nativa do DuckDNS

`PUBLIC_HOST` de produção (`layoutparser.duckdns.org`) é um domínio **DuckDNS**. O DuckDNS
oferece suporte **nativo** a registro TXT direto na própria API de update
(`https://www.duckdns.org/update?domains=<sub>&token=<TOKEN>&txt=<VALOR>`), então não é preciso
instalar o plugin comunitário `certbot-dns-duckdns` — basta usar o modo `--manual` do certbot
com hooks que chamam essa API via `curl`.

Dois scripts prontos ficam em [`scripts/duckdns-auth-hook.sh`](../scripts/duckdns-auth-hook.sh) e
[`scripts/duckdns-cleanup-hook.sh`](../scripts/duckdns-cleanup-hook.sh). Ambos exigem a variável
de ambiente `DUCKDNS_TOKEN` (nunca hardcoded — falham com mensagem clara se ela não estiver
definida) e usam `DUCKDNS_DOMAIN` (default `layoutparser`, ajustável) para montar o subdomínio.

Comando de emissão:

```bash
export DUCKDNS_TOKEN="<token da conta DuckDNS, obtido fora deste repo>"
sudo certbot certonly --manual --preferred-challenges dns \
  --manual-auth-hook "$(pwd)/scripts/duckdns-auth-hook.sh" \
  --manual-cleanup-hook "$(pwd)/scripts/duckdns-cleanup-hook.sh" \
  -d layoutparser.duckdns.org
```

O certbot injeta a variável `CERTBOT_VALIDATION` (valor que o auth-hook precisa publicar como
TXT) e `CERTBOT_DOMAIN` durante a execução dos hooks — os scripts já leem essas variáveis.

> **Propagação DNS:** após publicar o TXT, é preciso aguardar a propagação antes que o Let's
> Encrypt consiga consultá-lo. O `duckdns-auth-hook.sh` já inclui um `sleep` de alguns segundos
> por padrão (ajustável via `DUCKDNS_PROPAGATION_SLEEP`), mas se a validação falhar por TXT não
> encontrado, aumente esse valor. Certbot não tem um mecanismo próprio de espera para desafios
> `--manual` além de rodar o auth-hook antes de validar — a espera precisa estar no hook mesmo.

## Renovação automática

Com hooks `--manual-auth-hook`/`--manual-cleanup-hook`, o certbot grava os caminhos desses
scripts no arquivo de renovação salvo em `/etc/letsencrypt/renewal/layoutparser.duckdns.org.conf`
na primeira emissão. Isso significa que `certbot renew` **reaproveita os mesmos hooks
automaticamente**, sem precisar repetir os parâmetros — desde que a env var `DUCKDNS_TOKEN`
esteja disponível no contexto em que `certbot renew` roda (ex.: exportada no serviço/timer
systemd que dispara a renovação, não apenas no shell interativo usado na emissão inicial).

Garanta que o hook de deploy recarregue o Nginx após qualquer renovação bem-sucedida, para que o
processo passe a servir o novo certificado sem downtime:

```bash
sudo certbot renew --deploy-hook "nginx -t && systemctl reload nginx"
```

Configure isso num systemd timer ou entrada de cron equivalente — fora do escopo deste
repositório, pois é infraestrutura do host, não do app. Certifique-se de que `DUCKDNS_TOKEN`
esteja acessível nesse contexto (ex.: `Environment=` numa unit systemd dedicada, nunca
hardcoded em texto plano em local compartilhado).

## Fora do escopo deste repositório

- Instalação/configuração do `certbot` em si.
- Automação de emissão/renovação (systemd timer, cron) — apenas documentada aqui.
- Armazenamento seguro de `DUCKDNS_TOKEN` no host (gestão de segredo é infraestrutura do host).
- DNS e validação de domínio além dos hooks fornecidos.

`scripts/deploy-linux.sh` só valida que `SSL_CERT_PATH`/`SSL_CERT_KEY_PATH` existem e aplica o
vhost Nginx; a renovação do certificado acontece de forma independente do deploy da aplicação.
