# Certificado TLS em produção (Let's Encrypt / certbot)

`scripts/deploy-linux.sh` e `deploy/nginx/site.conf.template` **consomem** um certificado já
emitido — o script não instala nem gerencia certbot. Este documento descreve o procedimento
esperado quando o certificado de `SSL_CERT_PATH`/`SSL_CERT_KEY_PATH` vier do Let's Encrypt.

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

## Emissão inicial

Fora do escopo deste repositório (infraestrutura do host). Em linhas gerais, para DNS-01 (não
exige que a porta 80/443 esteja liberada durante a emissão):

```bash
sudo certbot certonly --dns-<provider> -d <PUBLIC_HOST>
```

Consulte a documentação do plugin DNS-01 do seu provedor de DNS para o comando exato.

## Renovação automática

O pacote `certbot` já instala, na maioria das distros, um systemd timer (`certbot.timer`) ou
entrada de cron que roda `certbot renew` periodicamente. Garanta que o hook de deploy recarregue
o Nginx após qualquer renovação bem-sucedida, para que o processo passe a servir o novo
certificado sem downtime:

```bash
sudo certbot renew --deploy-hook "nginx -t && systemctl reload nginx"
```

Se preferir configurar explicitamente (em vez de confiar no timer padrão do pacote), crie um
systemd timer ou uma entrada de cron equivalente chamando o comando acima — fora do escopo deste
repositório, pois é infraestrutura do host, não do app.

## Fora do escopo deste repositório

- Instalação/configuração do `certbot` em si.
- Automação de emissão/renovação (systemd timer, cron) — apenas documentada aqui.
- DNS e validação de domínio.

`scripts/deploy-linux.sh` só valida que `SSL_CERT_PATH`/`SSL_CERT_KEY_PATH` existem e aplica o
vhost Nginx; a renovação do certificado acontece de forma independente do deploy da aplicação.
