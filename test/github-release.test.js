'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const gr = require('../lib/github-release');

test('parseTag берёт тег из URL или HTML', () => {
  assert.equal(
    gr.parseTag('https://github.com/Flowseal/zapret-discord-youtube/releases/tag/1.10.4', ''),
    '1.10.4'
  );
  assert.equal(
    gr.parseTag(
      'https://github.com/Flowseal/zapret-discord-youtube/releases/latest',
      '<a href="/Flowseal/zapret-discord-youtube/releases/tag/v0.9.8">release</a>'
    ),
    'v0.9.8'
  );
});

test('parseAssets берёт только файлы релиза и строит абсолютные ссылки', () => {
  const html = [
    '<a href="/Flowseal/zapret-discord-youtube/releases/download/1.10.4/zapret-discord-youtube-1.10.4.zip">zip</a>',
    '<a href="/Flowseal/zapret-discord-youtube/releases/download/1.10.4/zapret-discord-youtube-1.10.4.rar">rar</a>',
    '<a href="/Flowseal/zapret-discord-youtube/archive/refs/tags/1.10.4.zip">source</a>',
    '<a href="/DigerPro/zapret-mini/releases/download/v0.9.8/ZapretMini-0.9.8-win-x64.zip.sha256">sha</a>'
  ].join('\n');

  const flowseal = gr.parseAssets(html, 'Flowseal/zapret-discord-youtube');
  assert.deepEqual(
    flowseal.map((asset) => asset.name).sort(),
    ['zapret-discord-youtube-1.10.4.rar', 'zapret-discord-youtube-1.10.4.zip']
  );
  assert.match(flowseal[0].url, /^https:\/\/github\.com\/Flowseal\/zapret-discord-youtube\/releases\/download\//);

  const app = gr.parseAssets(html, 'DigerPro/zapret-mini');
  assert.deepEqual(app.map((asset) => asset.name), ['ZapretMini-0.9.8-win-x64.zip.sha256']);
});

test('кэш релизов сохраняет несколько репозиториев', () => {
  const file = path.join(os.tmpdir(), 'zapret-release-cache-' + process.pid + '-' + Date.now() + '.json');
  gr.writeCache(file, 'Flowseal/zapret-discord-youtube', {
    tag: '1.10.4',
    htmlUrl: 'https://github.com/Flowseal/zapret-discord-youtube/releases/tag/1.10.4',
    assets: [{ name: 'zapret.zip', url: 'https://github.com/Flowseal/zapret-discord-youtube/releases/download/1.10.4/zapret.zip', size: 10 }]
  });
  gr.writeCache(file, 'DigerPro/zapret-mini', {
    tag: 'v0.9.10',
    htmlUrl: 'https://github.com/DigerPro/zapret-mini/releases/tag/v0.9.10',
    assets: [{ name: 'app.zip', url: 'https://github.com/DigerPro/zapret-mini/releases/download/v0.9.10/app.zip', size: 20 }]
  });

  const zapret = gr.readCache(file, 'Flowseal/zapret-discord-youtube');
  assert.equal(zapret.tag, '1.10.4');
  assert.equal(zapret.cached, true);
  assert.equal(zapret.assets[0].name, 'zapret.zip');

  const app = gr.readCache(file, 'DigerPro/zapret-mini');
  assert.equal(app.tag, 'v0.9.10');
  assert.equal(app.assets[0].size, 20);
  assert.equal(gr.readCache(file, 'missing/repo'), null);

  fs.rmSync(file, { force: true });
});
