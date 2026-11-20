'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('../lib/site-store');

function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapret-store-'));
  fs.mkdirSync(path.join(dir, 'utils'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'lists'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'utils', 'targets.txt'),
    '# targets\n\n### Discord\nDiscordMain = "https://discord.com"\n\n### DNS\nCloudflareDNS = "PING:1.1.1.1"\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'lists', 'list-general-user.txt'),
    '# user list\nexample.org\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'lists', 'list-general.txt'),
    'discord.com\nyoutube.com\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'lists', 'list-google.txt'),
    'youtube.com\nyoutu.be\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'lists', 'ipset-all.txt'),
    '203.0.113.113/32\n', 'utf8');
  return dir;
}

test('addTargetGroup добавляет цель в существующую группу', () => {
  const dir = makeDir();
  const file = path.join(dir, 'utils', 'targets.txt');
  const res = store.addTargetGroup(file, 'Discord', 'DiscordSecond', 'https://example.com');
  assert.equal(res.ok, true);
  assert.equal(res.added, true);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /DiscordMain = "https:\/\/discord\.com"/);
  assert.match(text, /DiscordSecond = "https:\/\/example\.com"/);
  assert.ok(text.indexOf('DiscordSecond') < text.indexOf('### DNS'));
});

test('addTargetGroup создаёт новую группу и не дублирует цель', () => {
  const dir = makeDir();
  const file = path.join(dir, 'utils', 'targets.txt');
  const first = store.addTargetGroup(file, 'example.com', 'Site_example_com', 'https://example.com/');
  assert.equal(first.ok, true);
  assert.equal(first.added, true);
  const second = store.addTargetGroup(file, 'example.com', 'Site_example_com', 'https://example.com/');
  assert.equal(second.ok, true);
  assert.equal(second.added, false);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /### example\.com/);
  assert.equal((text.match(/Site_example_com/g) || []).length, 1);
});

test('removeTargetGroup удаляет секцию целиком', () => {
  const dir = makeDir();
  const file = path.join(dir, 'utils', 'targets.txt');
  store.addTargetGroup(file, 'example.com', 'Site_example_com', 'https://example.com/');
  const res = store.removeTargetGroup(file, 'example.com');
  assert.equal(res.ok, true);
  assert.equal(res.removed, true);
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(text.includes('### example.com'), false);
  assert.equal(text.includes('Site_example_com'), false);
});

test('addHostnames и removeHostnames работают без дублей', () => {
  const dir = makeDir();
  const file = path.join(dir, 'lists', 'list-general-user.txt');
  const added = store.addHostnames(file, ['example.com', 'www.example.com', 'example.com']);
  assert.deepEqual(added.added, ['example.com', 'www.example.com']);
  assert.equal(fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l === 'example.com').length, 1);
  const removed = store.removeHostnames(file, ['example.com']);
  assert.equal(removed.removed, 1);
  assert.equal(fs.readFileSync(file, 'utf8').includes('\nexample.com\n'), false);
});

test('hostnamesForDomain покрывает www и базовый домен', () => {
  assert.deepEqual(store.hostnamesForDomain('www.example.com'), ['example.com', 'www.example.com']);
  assert.deepEqual(store.hostnamesForDomain('example.com'), ['example.com', 'www.example.com']);
});

test('checkDefaultCoverage видит стандартные списки и ipset', () => {
  const dir = makeDir();
  assert.equal(store.checkDefaultCoverage(dir, 'youtube.com').builtin, true);
  assert.equal(store.checkDefaultCoverage(dir, 'www.youtube.com').builtin, true);
  assert.equal(store.checkDefaultCoverage(dir, 'example.com').builtin, false);
  const ip = store.checkDefaultCoverage(dir, 'example.com', '203.0.113.113');
  assert.equal(ip.builtin, true);
  assert.equal(ip.source, 'ipset-all.txt');
});

test('targetKeyForDomain делает уникальный ключ', () => {
  const text = 'Site_example_com = "https://example.com/"\n';
  assert.equal(store.targetKeyForDomain('example.com', text), 'Site_example_com_2');
  assert.equal(store.targetKeyForDomain('www.example.com', text), 'Site_example_com_2');
  assert.equal(store.targetKeyForDomain('новый.сайт', ''), 'Site_domain');
});

test('removeHostsEntries удаляет только нужные записи и хранит комментарии', () => {
  const dir = makeDir();
  const file = path.join(dir, 'hosts');
  fs.writeFileSync(file, '# comment\n157.240.205.63 www.instagram.com\n127.0.0.1 localhost\n157.240.205.63 instagram.com\n', 'utf8');
  const res = store.removeHostsEntries(file, ['instagram.com']);
  assert.equal(res.removed, 2);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /# comment/);
  assert.match(text, /127\.0\.0\.1 localhost/);
  assert.equal(text.includes('www.instagram.com'), false);
  assert.equal(text.includes('157.240.205.63 instagram.com'), false);
});

test('manifest сохраняется и читается', () => {
  const dir = makeDir();
  const file = path.join(dir, 'user-sites.json');
  assert.equal(store.loadManifest(file), null);
  store.saveManifest(file, [{ id: 'example', group: 'example.com' }]);
  const data = store.loadManifest(file);
  assert.equal(data.version, 1);
  assert.equal(data.sites.length, 1);
  assert.equal(data.sites[0].group, 'example.com');
});
