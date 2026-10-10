# Troubleshooting

## 502 Bad Gateway
O proxy (Traefik) acha o container, mas não consegue falar com ele.
- O app escuta em `0.0.0.0` (não só `127.0.0.1`) e na **porta configurada** na aplicação?
- O container está rodando? Veja a aba Logs; um crash loop mostra 502 entre reinícios.
- Healthcheck configurado e falhando? O Traefik tira o container de rotação enquanto ele não está saudável.

## 503 Service Unavailable
Nenhum container saudável atende aquele domínio: app parado, deploy ainda em andamento, ou o roteador não foi criado. Confira o status da aplicação e se o domínio está salvo (aba Domínios).

## 504 Gateway Timeout
O app demorou demais. Procure queries lentas, chamadas externas sem timeout, ou limite de CPU/memória baixo demais (aba Recursos).

## Build morre por OOM (exit 137 / "Killed")
O build estourou a memória do servidor. Opções: adicionar swap, buildar em outro servidor, diminuir paralelismo do build (`NODE_OPTIONS=--max-old-space-size`), ou subir a VPS. O painel avisa quando o servidor está sobrecarregado antes do deploy.

## Firewall
Portas 80 e 443 precisam estar abertas pra internet (Let's Encrypt usa a 80 no desafio HTTP). A 22 (SSH) precisa estar acessível a partir do painel/worker. Em provedores com firewall próprio (Hetzner, Oracle, AWS), libere lá **e** no `ufw`.

## Let's Encrypt não emite certificado
- O DNS do domínio aponta pro IP do servidor (e propagou)? Com Cloudflare, deixe o registro em "DNS only" na primeira emissão.
- Porta 80 acessível de fora?
- Limite de emissões do Let's Encrypt (5 falhas/hora por domínio): espere antes de tentar de novo.
- Veja o status do certificado na página do proxy do servidor.

## Token do GitHub expirado / push não dispara deploy
Reconecte o GitHub na página de Sources. Para webhooks, confira em *Settings → Webhooks* do repositório se as entregas recentes estão com erro (401 = segredo diferente, 404 = URL errada).

## Servidor aparece offline
O worker não consegue abrir SSH: confira IP/porta, a chave em Keys & Tokens, e se o `sshd` aceita a chave (`~/.ssh/authorized_keys`).
