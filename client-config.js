// Endereço do servidor de partidas.
//
// - Vazio (padrão): o cliente detecta sozinho — usa a mesma origem da página quando ela é
//   servida pelo servidor Node (npm start), ou http://<host>:2567 em desenvolvimento.
// - Hospedagem separada (cliente estático num domínio, servidor em outro): defina aqui a URL
//   pública do servidor, por exemplo 'https://oz-server.exemplo.com' (o WebSocket usa wss://).
// - Para um teste pontual, também é possível usar ?server=https://... na URL do jogo.
//
// Quando a página é servida pelo próprio servidor Node, este arquivo é gerado a partir da
// variável de ambiente PUBLIC_SERVER_URL (ver .env.example) e esta versão estática é ignorada.
export const CLIENT_CONFIG = { serverUrl: '' };
