# Publicação do OPERATION ZERO na internet

O servidor de partidas é um processo Node.js **de longa duração** com **WebSockets persistentes** e um loop de simulação de 60 Hz.
Funções *serverless* convencionais (Vercel Functions, Netlify Functions, AWS Lambda) **não servem**: elas não mantêm conexões nem processos vivos entre requisições.
Use um serviço de containers ou VPS, como Render (Web Service), Railway, Fly.io, uma VM (DigitalOcean, Hetzner, Oracle Cloud, AWS EC2) ou um servidor próprio.

> Estado atual: a versão Next-Gen (4.0) **não foi publicada** em nenhuma hospedagem, e a configuração da sua hospedagem não foi alterada. Tudo abaixo foi verificado localmente; a verificação em produção (passo 5) deve ser feita depois do deploy.

## Atualizando uma publicação 3.0 já existente (ex.: Render)

1. **Protocolo** passou de 3 para **4**: quem estiver com a página antiga aberta vê "Versão do servidor incompatível" e só precisa recarregar. O `/health` deve mostrar `"protocol": 4`.
2. **Nova variável opcional `DATA_DIR`**: pasta da economia (contas, saldos, inventários). Sem ela, os dados ficam em `server/data/` dentro do serviço. **No Render gratuito o disco é efêmero**: cada deploy ou reinício apaga contas e saldos (os jogadores recebem uma conta nova automaticamente, com aviso na loja). Para manter os dados, crie um *Persistent Disk* (recurso pago) montado, por exemplo, em `/var/data` e defina `DATA_DIR=/var/data`. Detalhes em `ECONOMY.md`.
3. **Nada mais muda**: comando de instalação/início, health check e demais variáveis são os mesmos.
4. **Teste antes** localmente (`npm install`, `npm start`): busca pública (completa com bots após ~8 s), loja, pós-partida.

## Atualizando uma publicação 2.0 já existente (ex.: Render)

1. **Teste a 3.0 localmente antes** (`npm install`, `npm start`, `http://localhost:2567`, duas janelas).
2. **Não envie `server/node_modules`** ao repositório; a hospedagem roda `npm install`.
3. **Controle a publicação:** se o *Auto-Deploy* do Render estiver ligado, cada envio para a branch configurada é publicado. Para testar antes de substituir a versão online, envie para outra branch ou desative o *Auto-Deploy* até aprovar.
4. **Configuração:** as variáveis de ambiente, o comando de instalação/início e o health check **não mudam** na 3.0.
5. **Protocolo:** passou de 2 para **3**. Jogadores com a página 2.0 aberta veem "Versão do servidor incompatível" e só precisam recarregar.
6. **Primeiro carregamento:** baixa cerca de 7 MB a mais (modelos GLB + three.js local). O servidor envia esses arquivos com cache de 1 hora.

## Opção A (recomendada): cliente e servidor no mesmo domínio

Um único serviço entrega a página do jogo **e** o WebSocket.
Não há CORS para configurar, e o cliente detecta o servidor sozinho (mesma origem).

### 1. Build e start

| Item | Valor |
|---|---|
| Raiz do projeto | pasta `operation-zero/` |
| Comando de instalação | `npm install` (instala também as dependências de `server/`) |
| Comando de início | `npm start` |
| Porta | variável `PORT` (a hospedagem normalmente define sozinha) |
| Health check | `GET /health` → `{"status":"ok", ...}` |
| Node.js | 20 ou superior |

Também há um `Dockerfile` pronto (imagem única, `node:22-alpine`):

```bash
docker build -t operation-zero .
docker run -p 2567:2567 -e NODE_ENV=production operation-zero
```

### 2. Variáveis de ambiente (painel da hospedagem)

```
NODE_ENV=production
TRUST_PROXY=true            # atrás do proxy HTTPS da hospedagem
LOG_LEVEL=info
# Opcional: limitar origens. Vazio em produção = somente a própria URL do serviço.
ALLOWED_ORIGINS=
```

### 3. HTTPS/WSS

As hospedagens citadas fornecem HTTPS automaticamente.
Como o cliente usa a mesma origem, o WebSocket passa a ser `wss://` sem configuração adicional.

### 4. Acesso

Abra `https://SEU-SERVICO/` e compartilhe a URL com os jogadores.
Salas privadas são compartilhadas pelo código de 5 caracteres exibido no lobby.

### 5. Verificação após publicar

```bash
curl https://SEU-SERVICO/health          # deve responder status ok
curl https://SEU-SERVICO/api/rooms       # lista de salas públicas (JSON)
```

No navegador:

1. Abra o jogo em dois computadores ou redes diferentes (por exemplo, um no Wi-Fi e outro no 4G).
2. Crie uma sala privada em um e entre pelo código no outro.
3. No DevTools, aba **Rede → WS**, confirme uma conexão `wss://SEU-SERVICO/...` com status **101**.
4. Verifique se a latência exibida no lobby e na HUD é coerente.

## Opção B: cliente estático e servidor em domínios separados

Exemplo: cliente em GitHub Pages, Netlify ou Cloudflare Pages, e servidor no Render ou no Fly.

1. **Servidor**: publique como na opção A, com `SERVE_CLIENT=false` e `ALLOWED_ORIGINS=https://SEU-CLIENTE`.
2. **Cliente**: publique os arquivos da raiz, **sem** a pasta `server/`.
   Os arquivos necessários são `index.html`, `style.css`, `favicon.svg`, os `*.js` da raiz e as pastas `shared/` (com `shared/maps/`), `online/`, `characters/`, `ui/`, `assets/` e `vendor/`.
   Antes de publicar, edite **um único arquivo**, `client-config.js`:
   ```js
   export const CLIENT_CONFIG = { serverUrl: 'https://SEU-SERVIDOR' };
   ```
   O SDK de rede é carregado de `https://SEU-SERVIDOR/vendor/colyseus.js`, e o WebSocket usa `wss://SEU-SERVIDOR`.
3. Para um teste rápido sem editar arquivos, use `https://SEU-CLIENTE/?server=https://SEU-SERVIDOR`.

## Notas operacionais

- **Escala**: cada processo mantém suas próprias salas em memória.
  Para vários processos/instâncias seria necessário o driver/presença Redis do Colyseus, que não está configurado.
  Mantenha **uma instância** por enquanto.
  Até 10 jogadores por sala e `MAX_ROOMS` salas por processo.
- **Encerramento**: em `SIGTERM`/`SIGINT` o servidor desconecta as salas de forma ordenada (*graceful shutdown* do Colyseus).
- **Logs**: uma linha por evento (`room.create`, `player.join`, `player.drop`, `player.reconnect`, `player.leave`, `room.dispose`, `ws.origin_rejected`).
- **Limites**: `MAX_CONNECTIONS_PER_IP` limita conexões simultâneas por IP.
  Com `TRUST_PROXY=true` o IP vem do cabeçalho `X-Forwarded-For`, que só é confiável atrás de um proxy controlado pela hospedagem.
- **Economia**: contas e transações ficam em `DATA_DIR` (`economy.json` gravado de forma atômica + `transactions.jsonl`). Faça backup dessa pasta se ela estiver num disco persistente. Um único processo é o dono dos dados (não rode duas instâncias apontando para a mesma pasta).
- **Segredos**: o cliente não recebe segredos do servidor; o token da conta é gerado pelo servidor e só o hash é armazenado.
  O `.env` não é servido nem copiado para a imagem Docker (`.dockerignore`).
