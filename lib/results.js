'use strict';

const fs = require('fs');
const path = require('path');

const DOTNET_EPOCH_TICKS = 621355968000000000;

function ticksToMs(ticks) {
  const n = Number(ticks);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // C# DateTime.Now.Ticks stores local wall-clock time. Treat the value as
  // UTC first, then shift it back by the local offset for that date so the
  // imported timestamps display in the original local time instead of +TZ.
  const wall = (n - DOTNET_EPOCH_TICKS) / 10000;
  if (!Number.isFinite(wall) || wall <= 0) return 0;
  const offset = new Date(wall).getTimezoneOffset();
  const local = wall + offset * 60000;
  return local > 0 ? Math.round(local) : 0;
}

function recalc(result) {
  let httpOk = 0;
  let httpTotal = 0;
  let pingOk = 0;
  let pingTotal = 0;
  for (const row of result.results || []) {
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

function emptyResult(bat, checkedAt) {
  return recalc({
    bat,
    checkedAt: checkedAt || Date.now(),
    results: [],
    httpOk: 0,
    httpTotal: 0,
    pingOk: 0,
    pingTotal: 0
  });
}

function normalizeResult(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const bat = String(raw.bat || '').trim();
  if (!bat) return null;
  const result = {
    bat,
    checkedAt: Number.isFinite(Number(raw.checkedAt)) ? Number(raw.checkedAt) : Date.now(),
    results: []
  };
  for (const row of Array.isArray(raw.results) ? raw.results : []) {
    if (!row || !row.name) continue;
    result.results.push({
      name: String(row.name),
      ok: Boolean(row.ok),
      ms: Number.isFinite(Number(row.ms)) ? Math.max(0, Math.round(Number(row.ms))) : 0,
      status: String(row.status == null ? '' : row.status),
      ping: Boolean(row.ping)
    });
  }
  return recalc(result);
}

class ResultStore {
  constructor(dir, logger) {
    this.dir = dir;
    this.file = path.join(dir, 'results.json');
    this.legacyTsv = path.join(dir, 'results.tsv');
    this.logger = logger || { write() {} };
    this.map = new Map();
    this.existsAtLoad = false;
  }

  load() {
    this.map.clear();
    try {
      if (fs.existsSync(this.file)) {
        this.existsAtLoad = true;
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, ''));
        const entries = raw && typeof raw === 'object' ? (raw.results || raw) : {};
        for (const value of Object.values(entries)) {
          const result = normalizeResult(value);
          if (result) this.map.set(result.bat.toLowerCase(), result);
        }
        return;
      }
    } catch (err) {
      this.logger.write('results.json: ошибка чтения: ' + err.message);
    }

    // Первый запуск: импорт результатов C#-версии.
    try {
      if (fs.existsSync(this.legacyTsv)) {
        this.importTsv();
        this.logger.write('results.json: импортировано из results.tsv');
      }
    } catch (err) {
      this.logger.write('results.tsv: ошибка импорта: ' + err.message);
      this.map.clear();
    }
  }

  importTsv() {
    const text = fs.readFileSync(this.legacyTsv, 'utf8').replace(/^\uFEFF/, '');
    for (const raw of text.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const parts = raw.split('\t');
      if (parts.length < 6) continue;
      const bat = parts[0];
      const site = parts[1];
      const ok = parts[2] === '1';
      const ms = parseInt(parts[3], 10) || 0;
      const status = (parts[4] || '').replace(/\t/g, ' ');
      const checkedAt = ticksToMs(parts[5]);
      if (!bat || !site || !checkedAt) continue;
      const ping = parts.length >= 7 && parts[6] === '1';
      const key = bat.toLowerCase();
      let result = this.map.get(key);
      if (!result) {
        result = emptyResult(bat, checkedAt);
        this.map.set(key, result);
      }
      result.results.push({ name: site, ok, ms, status, ping });
    }
    for (const result of this.map.values()) recalc(result);
  }

  get(bat) {
    if (!bat) return null;
    return this.map.get(String(bat).toLowerCase()) || null;
  }

  set(result) {
    if (!result || !result.bat) return null;
    const normalized = normalizeResult(result);
    if (!normalized) return null;
    this.map.set(normalized.bat.toLowerCase(), normalized);
    return normalized;
  }

  delete(bat) {
    this.map.delete(String(bat).toLowerCase());
  }

  all() {
    return Array.from(this.map.values());
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const results = {};
      for (const result of this.map.values()) results[result.bat] = result;
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, results }, null, 2), 'utf8');
      try { fs.rmSync(this.file, { force: true }); } catch { /* ignore */ }
      fs.renameSync(tmp, this.file);
      this.existsAtLoad = true;
    } catch (err) {
      this.logger.write('results.json: ошибка записи: ' + err.message);
    }
  }
}

module.exports = { ResultStore, recalc, emptyResult, normalizeResult, ticksToMs };
