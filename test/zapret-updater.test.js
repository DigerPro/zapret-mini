'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const zu = require('../lib/zapret-updater');

test('isNewer понимает версии zapret', () => {
  assert.equal(zu.isNewer('1.10.4', '1.9.9d'), true);
  assert.equal(zu.isNewer('1.10.4', '1.10.4'), false);
  assert.equal(zu.isNewer('1.10.4', '1.10.5'), false);
});

test('localVersion читает .service/version.txt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-version-'));
  fs.mkdirSync(path.join(dir, '.service'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.service', 'version.txt'), '1.9.9d\n', 'utf8');
  assert.equal(zu.localVersion(dir), '1.9.9d');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mergeTargets сохраняет пользовательские группы и записи', () => {
  const local = [
    '### Discord',
    'DiscordMain = "https://discord.com"',
    'MyDiscord = "https://example.com"',
    '',
    '### Instagram',
    'InstagramWeb = "https://www.instagram.com"',
    '### example.com',
    'Site_example_com = "https://example.com/"'
  ].join('\r\n');
  const next = [
    '### Discord',
    'DiscordMain = "https://discord.com"',
    'DiscordNew = "https://new.discord.com"',
    '### YouTube',
    'YouTubeWeb = "https://www.youtube.com"'
  ].join('\r\n');
  const merged = zu.mergeTargets(local, next);
  assert.match(merged, /DiscordNew/);
  assert.match(merged, /MyDiscord/);
  assert.match(merged, /### Instagram/);
  assert.match(merged, /### example\.com/);
  assert.equal((merged.match(/DiscordMain/g) || []).length, 1);
});

test('mergeHostlist сохраняет пользовательские домены', () => {
  const merged = zu.mergeHostlist('localhost\nexample.com\n', 'youtube.com\nexample.com\n');
  assert.match(merged, /youtube\.com/);
  assert.match(merged, /example\.com/);
  assert.match(merged, /localhost/);
  assert.equal((merged.match(/example\.com/g) || []).length, 1);
});
