# scripts/

Scripts de deploy e utilitários de build do layoutparser-portal.

| Script                              | Papel                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Deploy-Iis.ps1`                    | Deploy em Windows/IIS (ambiente de desenvolvimento, `ci-dev.yml`). Releases imutáveis, Scheduled Task, ARR.                                                                                                                                                                             |
| `deploy-linux.sh`                   | Equivalente Linux (PM2 + Nginx) de `Deploy-Iis.ps1`, para dev-local em WSL e produção (`deploy.yml`, runner Linux). Mesma estrutura de releases, validações e smoke test (incluindo redirect OIDC); troca Scheduled Task por `pm2 startOrReload` e IIS/ARR por Nginx (`deploy/nginx/`). |
| `Initialize-IisDevHttps.ps1`        | Provisiona HTTPS local no IIS (self-signed) para dev em Windows.                                                                                                                                                                                                                        |
| `Install-IisArr.ps1`                | Instala/valida o módulo ARR (Application Request Routing) do IIS.                                                                                                                                                                                                                       |
| `Register-VirtualBoxAutostart.ps1`  | Autostart de VM auxiliar (ambiente de dev), não relacionado ao deploy do app.                                                                                                                                                                                                           |
| `check-api-contract.mjs`            | Gate `npm run contract:check` — compara manifesto local com a API.                                                                                                                                                                                                                      |
| `validate-production-artifacts.mjs` | Valida artefatos de build antes do deploy de produção.                                                                                                                                                                                                                                  |

`deploy-linux.sh` só grava/lê estado sob `DEPLOY_ROOT` (env var) e nunca versiona segredos —
o `ecosystem.config.cjs` do PM2 é gerado por release e fica fora do controle de versão.
