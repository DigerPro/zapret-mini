'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const updater = require('../lib/updater');

test('isNewer сравнивает версии', () => {
  assert.equal(updater.isNewer('0.9.7', '0.9.6'), true);
  assert.equal(updater.isNewer('v1.0.0', '0.99.99'), true);
  assert.equal(updater.isNewer('0.9.6', '0.9.6'), false);
  assert.equal(updater.isNewer('0.9.6', '0.9.7'), false);
});

test('selectAssets выбирает zip и sha256', () => {
  const assets = updater.selectAssets({
    assets: [
      { name: 'ZapretMini-0.9.7-win-x64.zip', browser_download_url: 'zip' },
      { name: 'ZapretMini-0.9.7-win-x64.zip.sha256', browser_download_url: 'sha' },
      { name: 'notes.txt', browser_download_url: 'notes' }
    ]
  });
  assert.equal(assets.zip.browser_download_url, 'zip');
  assert.equal(assets.sha.browser_download_url, 'sha');
});

test('selectAssets не путает чужой архив', () => {
  const assets = updater.selectAssets({
    assets: [
      { name: 'ZapretMini-Setup-0.9.7.zip', browser_download_url: 'full' },
      { name: 'ZapretMini-0.9.7-win-x64.zip.sha256', browser_download_url: 'sha' }
    ]
  });
  assert.equal(assets.zip, null);
  assert.equal(assets.sha, null);
});

test('sha256File считает хеш файла', async () => {
  const file = path.join(os.tmpdir(), 'zapret-updater-test.txt');
  fs.writeFileSync(file, 'hello', 'utf8');
  const hash = await updater.sha256File(file);
  assert.equal(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  fs.rmSync(file, { force: true });
});

test('helperScript ждёт процессы и повторяет замену папки', () => {
  const script = updater.helperScript();
  assert.match(script, /Get-Process -Name ZapretMini/);
  assert.match(script, /rename attempt/);
  assert.match(script, /Restart-App/);
  assert.match(script, /apply-update\.log/);
});
