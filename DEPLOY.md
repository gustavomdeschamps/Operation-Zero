# Publicação do OPERATION ZERO 2.0 na internet

O servidor de partidas é um processo Node.js **de longa duração** com **WebSockets persistentes** e um loop de simulação de 60 Hz.
Funções *serverless* convencionais (Vercel Functions, Netlify Functions, AWS Lambda) **não servem**: elas não mantêm conexões nem processos vivos entre requisições.
Use um serviço de containers ou VPS, como Render (Web Service), Railway, Fly.io, uma VM (DigitalOcean, Hetzner, Oracle Cloud, AWS EC2) ou um servidor próprio.

> Estado atual: o projeto está **preparado** para publicação, mas **não foi publicado** em nenhuma hospedagem. Não havia credenciais nem acesso a provedores neste ambiente. Tudo abaixo foi verificado localmente; a verificação em produção (passo 5) deve ser feita após o deploy.

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
   Os arquivos necessários são `index.html`, `style.css`, os `*.js` da raiz, `shared/` e `online/`.
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
- **Segredos**: o cliente não recebe tokens nem segredos.
  O `.env` não é servido nem copiado para a imagem Docker (`.dockerignore`).
