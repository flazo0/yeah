# Rodando em pouca memória (VPS 1 vCPU / 4 GB)

O painel foi desenhado pra caber numa máquina pequena. Sem agente residente nos servidores gerenciados: métricas, tráfego e limpeza usam SSH efêmero.

## Limites já aplicados (`docker-compose.prod.yml`)

| Serviço | Memória máx. |
|---|---|
| postgres | 512 MB |
| redis | 320 MB (`maxmemory 256mb`) |
| api | 384 MB |
| worker | 512 MB |
| ws | 128 MB |
| web | 64 MB |
| cloudflared (opcional) | 96 MB |

Soma ≈ 2 GB no pior caso, sobrando o resto da máquina pros apps (se ela também for servidor de deploy).

## Botões pra apertar mais

Todos no `.env` (veja `.env.example`); vazio = padrão.

- `METRICS_INTERVAL_SECONDS` — intervalo da coleta de métricas (padrão 60, mínimo 15). Subir reduz SSH e CPU quando há muitos servidores.
- `PATCH_CHECK_INTERVAL_SECONDS` — de quanto em quanto tempo o worker checa atualizações do sistema (apt) em cada servidor conectado (padrão 21600 = 6 h, mínimo 600).
- `AUDIT_RETENTION_DAYS` — por quanto tempo o registro de auditoria é guardado (padrão 365; `0` guarda para sempre).
- Desligar o monitoramento por servidor: aba Geral do servidor → "Monitoramento".
- Analytics de tráfego é opt-in por servidor (aba Proxy) e custa uma leitura local do Traefik a cada 5 min.
- `DB_POOL_MAX` — tamanho máximo do pool do Postgres por processo (`api`, `worker`). Não tem valor recomendado ainda: precisa ser medido sob carga numa VPS real.
- `LOG_RETENTION_DAYS` — dias até esvaziar logs de texto de deploys/backups (padrão 90).
- `LOG_LEVEL=warn` — menos escrita de log.

## Painel separado

Se a máquina de apps está apertada, instale o painel em outra (`--control-plane-only`, ou responda `n` à pergunta do instalador): Postgres, Redis, API e worker saem da VPS dos apps.
