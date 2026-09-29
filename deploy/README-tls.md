# Certificado TLS em produção (self-signed local — decisão final)

`scripts/deploy-linux.sh` e `deploy/nginx/site.conf.template` **consomem** um certificado já
existente — o script não gera, instala nem gerencia nenhuma CA. Este documento descreve a
decisão final para `SSL_CERT_PATH`/`SSL_CERT_KEY_PATH`: um certificado **self-signed gerado
diretamente no host Linux**.

## Decisão e motivo

A produção atual em Windows/IIS já opera hoje com um certificado **self-signed/interno**
(`CN=BRNDDAPPBLD01`, emitido no Windows Certificate Store) — nunca houve Let's Encrypt/CA
pública em uso. O acesso à ferramenta é **restrito à VPN**; não existe rota pública direta ao
host, então um certificado publicamente confiável nunca foi necessário. A decisão explícita do
usuário (2026-09-29) foi:

- Gerar um certificado self-signed **novo** diretamente no host Linux de destino.
- **Não exportar/mover a chave privada do certificado do Windows** para o Linux — decisão
  explícita para não transportar material de chave privada entre servidores.

Isso substitui a abordagem anterior (Let's Encrypt via DNS-01/DuckDNS), que foi descartada
antes de qualquer emissão real ter sido feita.

## Geração do certificado

No host Linux, com `openssl` (já disponível na maioria das distros):

```bash
sudo mkdir -p /etc/ssl/layoutparser
sudo openssl req -x509 -newkey rsa:4096 -sha256 -days 1095 -nodes \
  -keyout /etc/ssl/layoutparser/privkey.pem \
  -out /etc/ssl/layoutparser/fullchain.pem \
  -subj "/CN=layoutparser.duckdns.org" \
  -addext "subjectAltName=DNS:layoutparser.duckdns.org"

sudo chmod 600 /etc/ssl/layoutparser/privkey.pem
sudo chmod 644 /etc/ssl/layoutparser/fullchain.pem
```

Notas:

- `-addext "subjectAltName=DNS:..."` evita o aviso adicional que navegadores modernos mostram
  para certificados sem SAN (mesmo sendo self-signed, ainda vale usar SAN).
- `-days 1095` (3 anos) é um prazo razoável para um certificado self-signed de uso interno via
  VPN — evita a necessidade de automação de renovação (não há CA pública nem `certbot` neste
  fluxo) sem deixar a validade longa demais.
- `-nodes` deixa a chave sem senha, necessário para o Nginx carregá-la sem interação manual.
- Aponte `SSL_CERT_PATH`/`SSL_CERT_KEY_PATH` para os dois arquivos gerados; `deploy-linux.sh`
  só valida que os arquivos existem — aceita qualquer certificado, self-signed inclusive.

## Aviso do navegador

Por ser self-signed, o navegador mostrará aviso de certificado não confiável no primeiro
acesso (igual ao que já acontece hoje na produção Windows). Isso é aceitável nesta topologia:
o acesso é só via VPN, para um público interno que já sabe que o certificado é interno. Não há
necessidade de confiança pública de CA.

## Renovação (manual)

Sem CA pública, não há `certbot renew` nem automação de renovação. Quando o certificado
expirar (validade de 3 anos a partir da emissão), regenere com o mesmo comando acima
(sobrescrevendo os arquivos existentes) e recarregue o Nginx para que ele passe a servir o
certificado novo:

```bash
sudo nginx -t && sudo systemctl reload nginx
# ou, se preferir aplicar sem systemd:
sudo nginx -s reload
```

Recomenda-se registrar a data de expiração (via `openssl x509 -in <cert> -noout -enddate`) em
algum lembrete externo ao repositório (ex.: calendário da equipe), já que não há monitoramento
automático de expiração neste fluxo.

## Fora do escopo deste repositório

- Qualquer integração com CA pública (Let's Encrypt, DuckDNS DNS-01) — descartada nesta
  topologia.
- Automação de renovação (systemd timer, cron) — desnecessária com validade de 3 anos e
  renovação manual.
- Transporte de chave privada entre servidores (Windows → Linux) — explicitamente descartado
  pelo usuário; cada host tem seu próprio certificado self-signed gerado localmente.

`scripts/deploy-linux.sh` só valida que `SSL_CERT_PATH`/`SSL_CERT_KEY_PATH` existem e aplica o
vhost Nginx; qualquer certificado válido (self-signed incluído) é aceito.
