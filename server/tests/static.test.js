// Arquivos estáticos servidos junto com o servidor: só o que o jogo precisa (código do cliente,
// modelos, marca e three.js local). Pastas do servidor, dependências e arquivos ocultos nunca saem.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/index.js';

const PORT = 27500 + Math.floor(Math.random() * 1500);
const URL = `http://127.0.0.1:${PORT}`;
let server;

before(async () => { server = await startServer({ port: PORT, host: '127.0.0.1' }); });
after(async () => { await server.gracefullyShutdown(false); });

const get = (path) => fetch(`${URL}${path}`, { redirect: 'manual' });

test('S1 — serve o cliente 3.0: páginas, módulos, mapas, personagens e interface', async () => {
  for (const p of ['/', '/index.html', '/game.js', '/style.css', '/favicon.svg', '/ui/menu.js', '/ui/studio.js',
    '/characters/human.js', '/shared/maps/vesper.js', '/online/match.js']) {
    const res = await get(p);
    assert.equal(res.status, 200, p);
    assert.equal(res.headers.get('cache-control'), 'no-cache', p);
  }
});

test('S2 — modelos GLB, marca SVG e three.js local com tipo e cache corretos', async () => {
  const glb = await get('/assets/characters/gaviao.glb');
  assert.equal(glb.status, 200);
  assert.equal(glb.headers.get('content-type'), 'model/gltf-binary');
  assert.match(glb.headers.get('cache-control'), /max-age=3600/);
  const head = Buffer.from(await glb.arrayBuffer()).subarray(0, 4).toString('latin1');
  assert.equal(head, 'glTF', 'arquivo GLB válido');
  assert.equal((await get('/assets/animations/sprint.glb')).status, 200);
  const svg = await get('/assets/branding/logo-horizontal-light.svg');
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
  for (const p of ['/vendor/three/three.module.min.js', '/vendor/three/addons/loaders/GLTFLoader.js', '/vendor/three/addons/utils/SkeletonUtils.js']) {
    assert.equal((await get(p)).status, 200, p);
  }
});

test('S3 — nunca expõe servidor, dependências, licenças internas ou arquivos ocultos', async () => {
  for (const p of ['/server/src/index.js', '/server/package.json', '/server/node_modules/express/package.json',
    '/.env', '/.env.example', '/.git/config', '/package.json', '/assets/characters/LICENSE-Rocketbox.md',
    '/assets/../server/src/config.js', '/shared/../server/src/config.js', '/vendor/three/LICENSE', '/ui/../server/src/index.js',
    '/assets/characters/gaviao.fbx', '/Dockerfile']) {
    const res = await get(p);
    assert.notEqual(res.status, 200, p);
  }
});
