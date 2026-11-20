'use strict';

const { sleep } = require('./zapret');

const BAT_SCORES = [
  ['general.bat', 12, 6, 6],
  ['general (ALT).bat', 11, 5, 5],
  ['general (ALT2).bat', 8, 5, 5],
  ['general (ALT3).bat', 12, 4, 4],
  ['general (ALT4).bat', 13, 21, 0],
  ['general (ALT5).bat', 12, 4, 4],
  ['general (ALT6).bat', 13, 4, 4],
  ['general (ALT7).bat', 13, 3, 3],
  ['general (ALT8).bat', 13, 3, 3],
  ['general (ALT9).bat', 13, 2, 2],
  ['general (ALT10).bat', 12, 2, 2],
  ['general (ALT11).bat', 9, 1, 1],
  ['general (FAKE).bat', 10, 1, 1],
  ['general (FAKE AUTO).bat', 12, 0, 0],
  ['general (FAKE TLS AUTO).bat', 13, -1, 59],
  ['general (FAKE TLS AUTO ALT).bat', 12, -2, 58],
  ['general (FAKE TLS AUTO ALT2).bat', 11, -2, 58],
  ['general (SIMPLE FAKE).bat', 7, -3, 57],
  ['general (SIMPLE FAKE ALT).bat', 11, -4, 56],
  ['discord (FAKE TLS AUTO).bat', 13, -5, 55]
];

function makeTarget(name, group, url, ping) {
  const target = {
    name,
    group,
    sourceGroup: group,
    url: ping ? '' : url,
    pingHost: ping || (url ? new URL(url).host : ''),
    isPing: Boolean(ping),
    friendly: name,
    host: ping ? ping + ' · ICMP' : (url ? new URL(url).host : '')
  };
  return target;
}

const TARGETS = [
  makeTarget('DiscordMain', 'Discord', 'https://discord.com'),
  makeTarget('DiscordGateway', 'Discord', 'https://gateway.discord.gg'),
  makeTarget('DiscordCDN', 'Discord', 'https://cdn.discordapp.com'),
  makeTarget('DiscordUpdates', 'Discord', 'https://updates.discord.com'),
  makeTarget('YouTubeWeb', 'YouTube', 'https://www.youtube.com'),
  makeTarget('YouTubeShort', 'YouTube', 'https://youtu.be'),
  makeTarget('YouTubeImage', 'YouTube', 'https://i.ytimg.com'),
  makeTarget('YouTubeVideoRedirect', 'YouTube', 'https://redirector.googlevideo.com'),
  makeTarget('GoogleMain', 'Google', 'https://www.google.com'),
  makeTarget('GoogleGstatic', 'Google', 'https://www.gstatic.com'),
  makeTarget('CloudflareWeb', 'Cloudflare', 'https://www.cloudflare.com'),
  makeTarget('CloudflareCDN', 'Cloudflare', 'https://cdnjs.cloudflare.com'),
  makeTarget('EpicWeb', 'Epic', 'https://www.epicgames.com'),
  makeTarget('CloudflareDNS1111', 'DNS', '', '1.1.1.1'),
  makeTarget('CloudflareDNS1001', 'DNS', '', '1.0.0.1'),
  makeTarget('GoogleDNS8888', 'DNS', '', '8.8.8.8'),
  makeTarget('GoogleDNS8844', 'DNS', '', '8.8.4.4'),
  makeTarget('Quad9DNS9999', 'DNS', '', '9.9.9.9')
];

TARGETS[0].friendly = 'Discord';
TARGETS[1].friendly = 'Gateway';
TARGETS[2].friendly = 'CDN';
TARGETS[3].friendly = 'Обновления';
TARGETS[4].friendly = 'YouTube';
TARGETS[5].friendly = 'Короткие ссылки';
TARGETS[6].friendly = 'Превью';
TARGETS[7].friendly = 'Видео';
TARGETS[8].friendly = 'Google';
TARGETS[9].friendly = 'Gstatic';
TARGETS[10].friendly = 'Cloudflare';
TARGETS[11].friendly = 'CDN';
TARGETS[12].friendly = 'Epic Games';
TARGETS[13].friendly = 'Cloudflare DNS';
TARGETS[14].friendly = 'Cloudflare DNS';
TARGETS[15].friendly = 'Google DNS';
TARGETS[16].friendly = 'Google DNS';
TARGETS[17].friendly = 'Quad9';

const HTTP_TARGETS = TARGETS.filter((t) => !t.isPing);
const PING_TARGETS = TARGETS.filter((t) => t.isPing);

const ALT4_RESULTS = [
  [157, '200'], [286, '404'], [126, '403'], [141, '404'],
  [195, '200'], [187, '303'], [121, '404'], [150, '404'],
  [207, '200'], [130, '404'],
  [280, '200'], [131, '200'],
  [133, '403']
];

const ALT4_PING = [37, 39, 35, 35, 35];

function todayAt(hours, minutes) {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}

function recalc(result) {
  let httpOk = 0;
  let httpTotal = 0;
  let pingOk = 0;
  let pingTotal = 0;
  for (const row of result.results) {
    if (row.ping) {
      pingTotal++;
      if (row.ok) pingOk++;
    } else {
      httpTotal++;
      if (row.ok) httpOk++;
    }
  }
  result.httpOk = httpOk;
  result.httpTotal = httpTotal;
  result.pingOk = pingOk;
  result.pingTotal = pingTotal;
  return result;
}

function buildResult(bat, score, minute, seconds) {
  const baseHour = minute >= 0 ? 5 : 4;
  const minuteOfDay = minute >= 0 ? minute : seconds;
  const checkedAt = todayAt(baseHour, minuteOfDay);
  const results = [];
  let httpIndex = 0;
  for (const target of HTTP_TARGETS) {
    const ok = httpIndex < score;
    if (bat === 'general (ALT4).bat' && ok) {
      const exact = ALT4_RESULTS[httpIndex];
      results.push({ name: target.name, ok: true, ms: exact[0], status: exact[1], ping: false });
    } else {
      const ms = ok ? 115 + ((httpIndex * 23 + Math.abs(minute) * 7) % 160) : 0;
      const status = ok ? (httpIndex % 4 === 1 ? '404' : (httpIndex % 4 === 2 ? '403' : '200')) : 'Таймаут';
      results.push({ name: target.name, ok, ms, status, ping: false });
    }
    httpIndex++;
  }
  let pingIndex = 0;
  for (const target of PING_TARGETS) {
    const ms = bat === 'general (ALT4).bat' ? ALT4_PING[pingIndex] : 33 + ((pingIndex * 3 + Math.abs(minute)) % 8);
    results.push({ name: target.name, ok: true, ms, status: 'OK', ping: true });
    pingIndex++;
  }
  return recalc({ bat, checkedAt, results, httpOk: 0, httpTotal: 0, pingOk: 0, pingTotal: 0 });
}

class MockBackend {
  constructor(options) {
    this.options = options || {};
    this.dir = 'C:\\zapret';
    this.targets = TARGETS.map((t) => Object.assign({}, t));
    this.bats = BAT_SCORES.map((b) => b[0]);
    this.results = new Map();
    this.appliedBat = 'general (ALT4).bat';
    this.selectedBat = 'general (ALT4).bat';
    this.winwsRunning = true;
    this.winwsPid = 12184;
    this.serviceState = 1;
    this.startedAt = Date.now();
    this.testAllMode = false;

    for (const [bat, score, minute, seconds] of BAT_SCORES) {
      this.results.set(bat.toLowerCase(), buildResult(bat, score, minute, seconds));
    }
  }

  async init() {}

  async getInfo() {
    return {
      winwsRunning: this.winwsRunning,
      winwsPid: this.winwsRunning ? this.winwsPid : null,
      serviceState: this.serviceState
    };
  }

  async getBats() {
    return this.bats.slice();
  }

  async readTargets() {
    return this.targets.map((t) => Object.assign({}, t));
  }

  async applyBat(bat) {
    await sleep(320);
    this.appliedBat = bat;
    this.winwsRunning = true;
    this.winwsPid = 12184;
    this.serviceState = 1;
    return { ok: true, error: null };
  }

  async checkUrl(bat, url) {
    await sleep(140);
    const index = this.bats.findIndex((name) => name.toLowerCase() === String(bat).toLowerCase());
    const history = this.results.get(String(bat).toLowerCase());
    const ok = Boolean(history && history.httpOk > 0) && index % 7 !== 5;
    return {
      name: bat,
      ping: false,
      ok,
      ms: ok ? 120 + (Math.abs(index) * 53) % 210 : 6000,
      status: ok ? (index % 9 === 3 ? '403' : '200') : 'Таймаут'
    };
  }

  async runChecks() {
    await sleep(420);
    const result = this.results.get(this.appliedBat.toLowerCase());
    const checkedAt = Date.now();
    if (!result) {
      return this.targets.map((t) => ({
        name: t.name, ping: t.isPing, ok: false, ms: 0, status: 'Таймаут'
      }));
    }
    const rows = this.targets.map((t) => {
      const found = result.results.find((r) => r.name === t.name);
      let row = found
        ? Object.assign({}, found, { ping: t.isPing })
        : { name: t.name, ping: t.isPing, ok: false, ms: 0, status: 'Таймаут' };
      // В демо «Тест всех» на ALT6 показывает один сбой Cloudflare.
      if (this.testAllMode && this.appliedBat === 'general (ALT6).bat' && t.name === 'CloudflareCDN') {
        row = { name: t.name, ping: false, ok: false, ms: 0, status: 'Таймаут' };
      }
      return row;
    });
    result.checkedAt = checkedAt;
    return rows;
  }

  setTestAllMode(enabled) {
    this.testAllMode = Boolean(enabled);
  }

  async stop() {
    await sleep(250);
    this.winwsRunning = false;
    this.winwsPid = null;
    this.serviceState = 1;
  }

  seedTestingState() {
    return {
      active: true,
      index: 7,
      total: this.bats.length,
      bat: 'general (ALT6).bat',
      httpOk: 12,
      httpTotal: 13,
      cancelRequested: false,
      startedAt: Date.now() - 7 * 28000
    };
  }

  testAllPreview() {
    const base = this.results.get('general (alt4).bat');
    if (!base) return null;
    const preview = JSON.parse(JSON.stringify(base));
    preview.bat = 'general (ALT6).bat';
    preview.checkedAt = Date.now();
    preview.results = preview.results.map((row) => {
      if (row.name === 'CloudflareCDN') {
        return { name: row.name, ok: false, ms: 0, status: 'Таймаут', ping: false };
      }
      return row;
    });
    return recalc(preview);
  }

  seedProbe() {
    const results = [
      { bat: 'general (ALT9).bat', ok: true, ms: 180, status: '200' },
      { bat: 'general (ALT4).bat', ok: true, ms: 240, status: '200' },
      { bat: 'general (SIMPLE FAKE).bat', ok: true, ms: 260, status: '200' },
      { bat: 'general (FAKE TLS AUTO).bat', ok: true, ms: 310, status: '403' },
      { bat: 'general (ALT2).bat', ok: false, ms: 6000, status: 'Таймаут' },
      { bat: 'general (ALT6).bat', ok: false, ms: 6000, status: 'Таймаут' }
    ];
    return {
      active: false,
      finished: true,
      canceled: false,
      domain: 'www.instagram.com',
      url: 'https://www.instagram.com/',
      mode: 'quick',
      index: 6,
      total: 6,
      tested: 6,
      bat: '',
      dns: '157.240.205.63',
      results,
      best: 'general (ALT9).bat',
      previousBat: 'general (ALT9).bat',
      pending: {
        domain: 'instagram.com',
        hostname: 'www.instagram.com',
        url: 'https://www.instagram.com/',
        hostnames: ['instagram.com', 'www.instagram.com'],
        targetKey: 'Site_instagram_com',
        group: 'instagram.com',
        builtin: false,
        already: false,
        enabled: true,
        alreadyInTargets: false,
        tempAdded: false,
        restored: true,
        saved: false,
        mock: true
      },
      error: null,
      cancelRequested: false,
      startedAt: Date.now() - 62000
    };
  }
}

class MockResults {
  constructor(backend) {
    this.backend = backend;
  }

  get(bat) {
    return this.backend.results.get(String(bat || '').toLowerCase()) || null;
  }

  set(result) {
    if (!result || !result.bat) return null;
    recalc(result);
    this.backend.results.set(result.bat.toLowerCase(), result);
    return result;
  }

  all() {
    return Array.from(this.backend.results.values());
  }

  save() { /* mock ничего не пишет на диск */ }
}

module.exports = { MockBackend, MockResults, TARGETS, BAT_SCORES };
