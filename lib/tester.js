'use strict';

const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');

const SYSTEM32 = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DEFAULT_TIMEOUT_MS = 6000;
const CONCURRENCY = 8;

function mapError(err) {
  const code = String((err && (err.code || err.message)) || '');
  if (/ENOTFOUND|EAI_AGAIN|EAI_FAIL|ERR_NAME_NOT_RESOLVED/i.test(code)) return 'DNS';
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|timeout/i.test(code)) return 'Таймаут';
  if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(code)) return 'Нет связи';
  if (/ECONNRESET|EPIPE|socket hang up/i.test(code)) return 'Обрыв';
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/i.test(code)) return 'SSL';
  return 'Ошибка';
}

function checkHttp(target, timeoutMs) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const elapsed = () => Number((process.hrtime.bigint() - started) / 1000000n);
    let settled = false;
    let timer = null;
    let req = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    let parsed;
    try {
      parsed = new URL(target.url);
    } catch {
      finish({ name: target.name, ping: false, ok: false, ms: 0, status: 'Ошибка' });
      return;
    }
    const mod = parsed.protocol === 'https:' ? https : (parsed.protocol === 'http:' ? http : null);
    if (!mod) {
      finish({ name: target.name, ping: false, ok: false, ms: 0, status: 'Ошибка' });
      return;
    }

    try {
      req = mod.request(parsed, {
        method: 'GET',
        agent: false,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
          'Connection': 'close'
        }
      }, (res) => {
        const status = String(res.statusCode || '');
        const ms = elapsed();
        res.destroy();
        // Любой HTTP-ответ считается успехом: цель доступна.
        finish({ name: target.name, ping: false, ok: true, ms, status });
      });

      req.on('error', (err) => {
        finish({ name: target.name, ping: false, ok: false, ms: elapsed(), status: mapError(err) });
      });

      timer = setTimeout(() => {
        const result = { name: target.name, ping: false, ok: false, ms: timeoutMs, status: 'Таймаут' };
        try { req.destroy(new Error('timeout')); } catch { /* ignore */ }
        finish(result);
      }, timeoutMs);

      req.end();
    } catch (err) {
      finish({ name: target.name, ping: false, ok: false, ms: elapsed(), status: mapError(err) });
    }
  });
}

function decodeOem(buffer) {
  const utf = buffer.toString('utf8');
  let oem = '';
  try { oem = new TextDecoder('ibm866').decode(buffer); } catch { oem = utf; }
  return { utf, oem };
}

function checkPing(target, timeoutMs) {
  return new Promise((resolve) => {
    const host = target.pingHost;
    if (!host) {
      resolve({ name: target.name, ping: true, ok: false, ms: 0, status: 'Таймаут' });
      return;
    }
    let settled = false;
    let child = null;
    let timer = null;
    const chunks = [];
    const started = Date.now();

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    try {
      child = spawn(path.join(SYSTEM32, 'ping.exe'), ['-n', '1', '-w', String(timeoutMs), host], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      child.stdout.on('data', (b) => chunks.push(b));
      child.stderr.on('data', (b) => chunks.push(b));
      child.on('error', () => {
        finish({ name: target.name, ping: true, ok: false, ms: Date.now() - started, status: 'Таймаут' });
      });
      child.on('close', (code) => {
        const buffer = Buffer.concat(chunks);
        const { utf, oem } = decodeOem(buffer);
        const text = utf + '\n' + oem;
        const match = text.match(/(?:time|время)\s*[=<]\s*(\d+)\s*(?:ms|мс)?/i) ||
          text.match(/TTL[=\s:]*\d*/i);
        const ms = match && match[1] ? parseInt(match[1], 10) : Math.max(0, Date.now() - started);
        const ok = code === 0;
        finish({ name: target.name, ping: true, ok, ms: ok ? ms : 0, status: ok ? 'OK' : 'Таймаут' });
      });
      timer = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        finish({ name: target.name, ping: true, ok: false, ms: timeoutMs + 1000, status: 'Таймаут' });
      }, timeoutMs + 1500);
    } catch {
      finish({ name: target.name, ping: true, ok: false, ms: 0, status: 'Таймаут' });
    }
  });
}

function checkOne(target, timeoutMs) {
  return target.isPing ? checkPing(target, timeoutMs) : checkHttp(target, timeoutMs);
}

async function runChecks(targets, options) {
  const opts = options || {};
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const concurrency = Math.max(1, Math.min(opts.concurrency || CONCURRENCY, targets.length || 1));
  const results = new Array(targets.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= targets.length) return;
      try {
        results[index] = await checkOne(targets[index], timeoutMs);
      } catch {
        results[index] = {
          name: targets[index].name,
          ping: Boolean(targets[index].isPing),
          ok: false,
          ms: 0,
          status: 'Ошибка'
        };
      }
      if (opts.onResult) {
        try { opts.onResult(results[index], index); } catch { /* ignore */ }
      }
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

module.exports = { runChecks, checkHttp, checkPing, USER_AGENT, DEFAULT_TIMEOUT_MS, CONCURRENCY };
