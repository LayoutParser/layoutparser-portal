# Memória — @lp-devops (Gage)

- Push, PR, CI, deploy, secrets e MCP são autoridade exclusiva de `@lp-devops`.
- [Promoção develop→main pausada (SHA 5ba3c1e, 504 em execute-candidates)](project_develop_main_promotion_blocked_504_2026_09_10.md) — aguardando API confirmar correção antes de reabrir PR.
- [MCP da API validado para detecção automática](project_api_mcp_validation_2026_08_29.md) —
  servidor saudável, endpoint `/api/parse/auto` entregue em branch e tool tipada rastreada em
  #184/#216.
- [Pipeline seguro](project_quality_pipeline_2026_08_10.md) — runners isolados, Actions por SHA e releases IIS+BFF.
- [gh CLI e git de rede](project_gh_cli_unavailable_wsl.md) — hoje funcionam direto do bash/WSL (remote HTTPS + gh 2.45); nota antiga do `git.exe` está superada.
- [Node no Windows](project_node_toolchain_wsl_interop.md) — validar env vars no shell nativo correto.
- [Parede de permissão](feedback_parar_em_parede_de_permissao.md) — não contornar elevação ou credenciais.
- [Verificação independente](feedback_verificar_diagnostico_independente.md) — reproduzir a evidência-chave.
- [Dependabot](project_dependabot_compatibility_policy.md) — agrupar pares e migrar majors manualmente.
- [CodeQL/dependency-review sempre vermelhos](project_codeql_dependency_review_need_ghas.md) — falta GHAS no repo privado; falha pré-existente, não regressão.
- [Quality Gates flaky](project_quality_gates_flaky_unhandled_errors.md) — vermelho com testes verdes: "Unhandled Errors" do Vitest; compare runs do mesmo SHA.
- [Merge em head desatualizado](project_stale_head_merge_drops_commits.md) — commits pós-merge somem sem aviso; confira o fix pelo conteúdo do arquivo na `develop`.
- [Páginas legais com placeholder](project_legal_pages_placeholders_pending.md) — `/terms` e `/privacy` esperam e-mail/jurisdição da empresa; não preencher sozinho.
- [Plano Cloudflare Quick Tunnel p/ OAuth](project_cloudflare_quick_tunnel_google_oauth_plan.md) — OBSOLETO desde 2026-08-26: produção usa `layoutparser.duckdns.org` (HTTPS direto no IIS); script/switch do tunnel removidos do repo.
- [.env do BFF é fail-fast](project_bff_env_failfast_placeholders.md) — placeholder no valor aborta o boot; use comentário e chave vazia.
- [Log persistente do BFF + script do tunnel Cloudflare](project_bff_persistent_logs_and_cloudflare_tunnel_task.md) — `logs/` fora do release; script idempotente escrito, NUNCA registrado em produção (ver correção 2026-08-22).
- [VirtualBox autostart + investigação de login flaky](project_virtualbox_autostart_task_and_login_flakiness_investigation.md) — task S4U/`-RunAsUser` (não SYSTEM); bug de discovery cacheado no GoogleOidcClient; hipótese MSAL cold-start não confirmada.
- [Cloudflare tunnel NUNCA foi registrado (2026-08-22)](project_cloudflare_tunnel_task_never_registered_2026_08_22.md) — evidência real do host: task/processo/log ausentes; URL do Entra veio de run manual que morreu; registrado com sucesso no mesmo dia com fix `--edge-ip-version 4`.
- [Bug de extração de URL do tunnel](project_cloudflare_tunnel_url_extraction_regex_bug.md) — regex pegava `api.trycloudflare.com` (endpoint interno) por log append-only + `-First 1`; corrigido para ancorar no último marcador de boot + excluir host da API.
- [Patch manual BFF_PUBLIC_ORIGIN (2026-08-23)](project_bff_public_origin_manual_patch_2026_08_23.md) — Start-Bff.ps1 do release editado à mão p/ apontar pro Quick Tunnel; some no próximo deploy.
- [Patch manual BFF_DNS_SERVERS (2026-08-23)](project_bff_dns_servers_manual_patch_2026_08_23.md) — PR #153 agora persiste BFF_DNS_SERVERS opcional no pipeline; patch manual do release ativo montado, pendente de execução pelo usuário.

- [Loop de login em produção — Set-Cookie ausente (2026-09-15)](project_login_loop_setcookie_investigation_2026_09_15.md) — revisão de código/config sem achar bug; causa raiz não confirmada por falta de acesso ao host de produção.
- [Fronteira de credencial do agente](feedback_agent_credential_boundary_crossing.md) — não contornar falta de SSH/RDP/WinRM via interop Windows sem confirmar com o usuário.
- [DuckDNS + cert strategy (2026-09-29, corrigido)](project_duckdns_cert_strategy_2026_09_29.md) — host é VPN-only, logo HTTP-01 é inviável; usar DNS-01 via API nativa TXT do DuckDNS (hooks manuais).
- [MQSeries e2e 504 recorrente (2026-09-21)](project_mqseries_e2e_504_recurrence_watch_2026_09_21.md) — mqseries-user-flow.spec.ts:148 já falhou 2x por 504 em ~3h (PRs #284 e #287); rerun resolveu ambas; na 3ª ocorrência, investigar timeout/capacidade real em vez de assumir flake.

Arquitetura vigente: front same-origin; IIS HTTPS anônimo encaminha `/auth` e `/api` → BFF Node
em loopback com Entra OIDC/sessão criptografada → API .NET. `Deploy-Iis.ps1` desabilita Windows
Auth, publica releases versionadas, mantém rollback e falha sem ARR, Rewrite, Entra, site HTTPS,
allowlist ou configuração segura. `ENTRA_CLIENT_SECRET` existe somente como environment secret;
o launcher local que o recebe fica restrito a SYSTEM/Administradores. Não versionar secrets,
paths pessoais, IPs, tokens ou payloads. O MCP continua pertencendo à API.
