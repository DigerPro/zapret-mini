'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeProbeInput,
  quickCandidates,
  statusRank,
  rankProbeRows,
  bestProbeRow
} = require('../lib/probe');

test('normalizeProbeInput добавляет https и разбирает домен', () => {
  const parsed = normalizeProbeInput('example.com');
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.host, 'example.com');
  assert.equal(parsed.hostname, 'example.com');
  assert.equal(parsed.protocol, 'https:');
  assert.equal(parsed.url, 'https://example.com/');
});

test('normalizeProbeInput сохраняет путь и убирает hash', () => {
  const parsed = normalizeProbeInput('http://example.com/path?a=1#top');
  assert.equal(parsed.url, 'http://example.com/path?a=1');
  assert.equal(parsed.protocol, 'http:');
});

test('normalizeProbeInput отклоняет пустой ввод и чужие схемы', () => {
  assert.match(normalizeProbeInput('   ').error, /Введи/);
  assert.match(normalizeProbeInput('ftp://example.com').error, /http и https/);
  assert.match(normalizeProbeInput('javascript:alert(1)').error, /http и https/);
  assert.match(normalizeProbeInput('https://user:pass@example.com').error, /логин/);
});

test('normalizeProbeInput не ломает кириллический домен', () => {
  const parsed = normalizeProbeInput('пример.рф');
  assert.equal(parsed.error, undefined);
  assert.match(parsed.url, /^https:\/\/xn--/);
});

test('quickCandidates берёт текущую, историю и все семейства', () => {
  const bats = [
    'general.bat',
    'general (ALT).bat',
    'general (ALT2).bat',
    'general (ALT3).bat',
    'general (ALT4).bat',
    'general (ALT9).bat',
    'general (FAKE TLS AUTO).bat',
    'general (FAKE TLS AUTO ALT).bat',
    'general (SIMPLE FAKE).bat',
    'general (SIMPLE FAKE ALT).bat'
  ];
  const results = [
    { bat: 'general (ALT9).bat', httpOk: 15, httpTotal: 15, pingOk: 5, pingTotal: 5, results: [] },
    { bat: 'general (ALT4).bat', httpOk: 14, httpTotal: 15, pingOk: 5, pingTotal: 5, results: [] },
    { bat: 'general (ALT2).bat', httpOk: 9, httpTotal: 15, pingOk: 3, pingTotal: 5, results: [] }
  ];
  const picked = quickCandidates(bats, results, 'general (ALT9).bat');
  assert.equal(picked.length, 6);
  assert.equal(picked[0], 'general (ALT9).bat');
  assert.equal(new Set(picked.map((name) => name.toLowerCase())).size, picked.length);
  assert.ok(picked.some((name) => name.includes('FAKE TLS AUTO')));
  assert.ok(picked.some((name) => name.includes('SIMPLE FAKE')));
  assert.ok(picked.includes('general (ALT4).bat'));
});

test('quickCandidates без истории использует понятный набор', () => {
  const bats = [
    'general.bat',
    'general (ALT).bat',
    'general (ALT2).bat',
    'general (ALT4).bat',
    'general (ALT9).bat',
    'general (FAKE TLS AUTO).bat',
    'general (SIMPLE FAKE).bat'
  ];
  const picked = quickCandidates(bats, [], 'general.bat');
  assert.equal(picked.length, 6);
  assert.ok(picked.includes('general (ALT9).bat'));
  assert.ok(picked.includes('general (ALT4).bat'));
  assert.ok(picked.includes('general (FAKE TLS AUTO).bat'));
  assert.ok(picked.includes('general (SIMPLE FAKE).bat'));
});

test('statusRank различает классы ответа', () => {
  assert.equal(statusRank('200'), 0);
  assert.equal(statusRank('301'), 0);
  assert.equal(statusRank('403'), 1);
  assert.equal(statusRank('503'), 2);
  assert.equal(statusRank('Таймаут'), 3);
});

test('rankProbeRows ставит успехи по классу и отклику', () => {
  const rows = [
    { bat: 'timeout', ok: false, ms: 6000, status: 'Таймаут' },
    { bat: '503', ok: true, ms: 50, status: '503' },
    { bat: '403', ok: true, ms: 100, status: '403' },
    { bat: 'slow200', ok: true, ms: 300, status: '200' },
    { bat: 'fast200', ok: true, ms: 100, status: '200' }
  ];
  const ordered = rankProbeRows(rows).map((row) => row.bat);
  assert.deepEqual(ordered, ['fast200', 'slow200', '403', '503', 'timeout']);
  assert.equal(bestProbeRow(rows).bat, 'fast200');
});

test('bestProbeRow возвращает null без успехов', () => {
  const rows = [
    { bat: 'a', ok: false, ms: 0, status: 'SSL' },
    { bat: 'b', ok: false, ms: 6000, status: 'Таймаут' }
  ];
  assert.equal(bestProbeRow(rows), null);
});
