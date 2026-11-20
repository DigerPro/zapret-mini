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

test('ensureUserLists создаёт недостающие пользовательские списки', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-lists-'));
  fs.mkdirSync(path.join(dir, 'lists'), { recursive: true });
  const created = zu.ensureUserLists(dir);
  assert.deepEqual(
    created.sort(),
    ['ipset-exclude-user.txt', 'list-exclude-user.txt', 'list-general-user.txt'].sort()
  );
  assert.match(fs.readFileSync(path.join(dir, 'lists', 'list-general-user.txt'), 'utf8'), /domain\.example\.abc/);
  fs.writeFileSync(path.join(dir, 'lists', 'list-general-user.txt'), 'my.example\n', 'utf8');
  const again = zu.ensureUserLists(dir);
  assert.equal(again.length, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'lists', 'list-general-user.txt'), 'utf8'), 'my.example\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('installFromDirectory копирует сборку и заменяет старую папку', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-install-'));
  const src = path.join(base, 'src');
  fs.mkdirSync(path.join(src, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(src, 'lists'), { recursive: true });
  fs.mkdirSync(path.join(src, 'utils'), { recursive: true });
  fs.writeFileSync(path.join(src, 'bin', 'winws.exe'), 'dummy');
  fs.writeFileSync(path.join(src, 'service.bat'), 'dummy');
  fs.writeFileSync(path.join(src, 'general.bat'), 'dummy');
  fs.writeFileSync(path.join(src, 'utils', 'targets.txt'), '### Test\n');
  const dest = path.join(base, 'dest');
  const first = zu.installFromDirectory(src, dest);
  assert.equal(first.bats.includes('general.bat'), true);
  assert.equal(fs.existsSync(path.join(dest, 'lists', 'list-general-user.txt')), true);
  fs.writeFileSync(path.join(src, 'marker.txt'), 'new');
  zu.installFromDirectory(src, dest);
  assert.equal(fs.readFileSync(path.join(dest, 'marker.txt'), 'utf8'), 'new');
  assert.equal(fs.existsSync(path.join(dest, 'bin', 'winws.exe')), true);
  fs.rmSync(base, { recursive: true, force: true });
});

test('validateFresh отклоняет неполную сборку', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-invalid-'));
  assert.throws(() => zu.validateFresh(dir), /winws/);
  fs.rmSync(dir, { recursive: true, force: true });
});
