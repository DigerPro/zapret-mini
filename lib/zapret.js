'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { runChecks, checkHttp } = require('./tester');

const SYSTEM32 = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeOutput(buffer) {
  const utf = buffer.toString('utf8');
  let oem = '';
  try { oem = new TextDecoder('ibm866').decode(buffer); } catch { oem = ''; }
  return (utf + '\n' + oem).trim();
}

function runProcess(exe, args, options) {
  const opts = options || {};
  const timeout = opts.timeout || 20000;
  return new Promise((resolve) => {
    let settled = false;
    const chunks = [];
    let timer = null;
    let child = null;

    const finish = (code, output) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, output: output || '' });
    };

    try {
      child = spawn(exe, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: opts.env || process.env
      });
      child.stdout.on('data', (b) => chunks.push(b));
      child.stderr.on('data', (b) => chunks.push(b));
      child.on('error', (err) => finish(-1, err.message));
      child.on('close', (code) => finish(typeof code === 'number' ? code : -1, decodeOutput(Buffer.concat(chunks))));
      timer = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        finish(-1, 'timeout');
      }, timeout);
    } catch (err) {
      finish(-1, err.message);
    }
  });
}

async function isWinwsRunning() {
  const res = await runProcess(path.join(SYSTEM32, 'tasklist.exe'),
    ['/FI', 'IMAGENAME eq winws.exe', '/FO', 'CSV', '/NH'], { timeout: 10000 });
  const text = res.output || '';
  const match = text.match(/"winws\.exe"\s*,\s*"(\d+)"/i);
  if (match) return { running: true, pid: parseInt(match[1], 10) || null };
  if (/\bwinws\.exe\b/i.test(text) && !/No tasks|Нет задач/i.test(text)) {
    return { running: true, pid: null };
  }
  return { running: false, pid: null };
}

async function killWinws(logger) {
  const res = await runProcess(path.join(SYSTEM32, 'taskkill.exe'), ['/IM', 'winws.exe', '/F'], { timeout: 10000 });
  if (logger && res.code !== 0 && !/not found|не найден/i.test(res.output || '')) {
    logger.write('winws kill: ' + (res.output || 'код ' + res.code));
  }
}

async function getServiceState() {
  const res = await runProcess(path.join(SYSTEM32, 'sc.exe'), ['query', 'zapret'], { timeout: 10000 });
  if (res.code !== 0 && !res.output) return -1;
  const text = res.output || '';
  const m = text.match(/(?:STATE|СОСТОЯНИЕ)\s*:\s*(\d+)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) return n;
  }
  const word = text.match(/\b(4|2|3|1)\s+(RUNNING|STOPPED|START_PENDING|STOP_PENDING)\b/i);
  if (word) return parseInt(word[1], 10);
  return -1;
}

async function ensureServiceStopped(logger) {
  let state = await getServiceState();
  if (state === 4 || state === 2 || state === 3) {
    await runProcess(path.join(SYSTEM32, 'sc.exe'), ['stop', 'zapret'], { timeout: 20000 });
    for (let i = 0; i < 75; i++) {
      state = await getServiceState();
      if (state === 1 || state < 0) break;
      await sleep(200);
    }
    if (logger) logger.write('Служба zapret остановлена (state=' + state + ')');
  }
  await runProcess(path.join(SYSTEM32, 'sc.exe'), ['config', 'zapret', 'start=', 'demand'], { timeout: 10000 });
}

function tail(text, limit) {
  const s = String(text || '').trim();
  return s.length > limit ? s.slice(s.length - limit) : s;
}

async function hideZapretWindows(scriptPath, logger) {
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    if (logger) logger.write('hide-zapret.ps1 не найден: ' + scriptPath);
    return;
  }
  const res = await runProcess(path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { timeout: 12000 });
  if (res.code !== 0 && logger) {
    logger.write('hide-zapret.ps1: ' + tail(res.output, 400));
  }
}

function spawnBat(dir, batPath) {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    let child = null;
    let timer = null;

    const finish = (timedOut, code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({
        timedOut,
        code,
        output: decodeOutput(Buffer.concat(chunks)).slice(0, 8000)
      });
    };

    try {
      child = spawn(path.join(SYSTEM32, 'cmd.exe'),
        ['/d', '/s', '/c', `""${batPath}""`], {
          cwd: dir,
          windowsHide: true,
          windowsVerbatimArguments: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: Object.assign({}, process.env, { NO_UPDATE_CHECK: '1' })
        });
      child.stdout.on('data', (b) => {
        if (chunks.reduce((n, c) => n + c.length, 0) < 12000) chunks.push(b);
      });
      child.stderr.on('data', (b) => {
        if (chunks.reduce((n, c) => n + c.length, 0) < 12000) chunks.push(b);
      });
      child.on('error', (err) => {
        chunks.push(Buffer.from(String(err.message || err)));
        finish(false, -1);
      });
      // 'exit' fires when cmd.exe finishes; 'close' waits for inherited pipes
      // held by the started winws console and would stall for the full timeout.
      child.on('exit', (code) => finish(false, typeof code === 'number' ? code : -1));
      timer = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        finish(true, -1);
      }, 15000);
    } catch (err) {
      chunks.push(Buffer.from(String(err.message || err)));
      finish(false, -1);
    }
  });
}

class RealBackend {
  constructor(config, logger, assetsDir) {
    this.config = config;
    this.logger = logger;
    this.assetsDir = assetsDir;
  }

  get dir() {
    return this.config.get('zapretDir') || '';
  }

  get winwsPath() {
    return path.join(this.dir, 'bin', 'winws.exe');
  }

  async getInfo() {
    const [proc, service] = await Promise.all([isWinwsRunning(), getServiceState()]);
    return { winwsRunning: proc.running, winwsPid: proc.pid, serviceState: service };
  }

  async runChecks(targets) {
    return runChecks(targets);
  }

  async checkUrl(bat, url) {
    return checkHttp({ name: bat, url }, 6000);
  }

  async applyBat(bat) {
    const batPath = path.join(this.dir, bat);
    if (!fs.existsSync(batPath)) return { ok: false, error: 'Файл не найден: ' + batPath };
    if (!fs.existsSync(this.winwsPath)) return { ok: false, error: 'Не найден winws.exe: ' + this.winwsPath };

    await killWinws(this.logger);
    await sleep(400);
    await ensureServiceStopped(this.logger);

    let error = null;
    const started = await spawnBat(this.dir, batPath);
    if (started.timedOut) error = 'Батник не завершился за 15 секунд';

    let running = false;
    for (let i = 0; i < 100; i++) {
      const info = await isWinwsRunning();
      if (info.running) { running = true; break; }
      await sleep(100);
    }

    if (!running) {
      if (!error) error = 'winws.exe не запустился';
      const extra = tail(started.output, 600);
      if (extra) error += '. ' + extra;
      this.logger.write('Запуск ' + path.basename(batPath) + ': ' + error);
      return { ok: false, error, output: started.output };
    }

    await hideZapretWindows(path.join(this.assetsDir, 'hide-zapret.ps1'), this.logger);
    await sleep(900);
    this.logger.write('Подключён батник: ' + path.basename(batPath));
    return { ok: true, error: null, output: started.output };
  }

  async stop() {
    await killWinws(this.logger);
    this.logger.write('Отключено: winws.exe остановлен');
  }

  async getBats() {
    try {
      return fs.readdirSync(this.dir)
        .filter((name) => /\.bat$/i.test(name) && !/^service/i.test(name))
        .sort((a, b) => {
          const pa = a.replace(/[0-9]+/g, (m) => m.padStart(8, '0'));
          const pb = b.replace(/[0-9]+/g, (m) => m.padStart(8, '0'));
          return pa.localeCompare(pb, 'en', { sensitivity: 'base' });
        });
    } catch {
      return [];
    }
  }
}

module.exports = {
  RealBackend,
  isWinwsRunning,
  killWinws,
  getServiceState,
  ensureServiceStopped,
  runProcess,
  sleep
};
