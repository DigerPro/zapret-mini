'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function isTrue(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function looksLikeZapret(dir) {
  if (!dir) return false;
  try {
    return fs.existsSync(path.join(dir, 'bin', 'winws.exe')) &&
      fs.existsSync(path.join(dir, 'service.bat'));
  } catch {
    return false;
  }
}

function candidateRoots() {
  const home = os.homedir();
  const desktop = path.join(home, 'Desktop');
  const downloads = path.join(home, 'Downloads');
  const roots = [desktop, downloads];
  if (process.env.OneDrive) {
    roots.unshift(path.join(process.env.OneDrive, 'Desktop'));
    roots.push(path.join(process.env.OneDrive, 'Downloads'));
  }
  return { desktop, downloads, roots: roots.filter(Boolean) };
}

function detectZapretDir() {
  const { desktop, downloads, roots } = candidateRoots();
  const direct = [
    path.join(desktop, 'zapret-discord-youtube-main'),
    path.join(desktop, 'zapret'),
    path.join(downloads, 'zapret-discord-youtube-main'),
    path.join(downloads, 'zapret'),
    'C:\\zapret'
  ];
  for (const dir of direct) {
    if (looksLikeZapret(dir)) return dir;
  }
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(root, entry.name);
        if (looksLikeZapret(dir)) return dir;
      }
    } catch { /* ignore */ }
  }
  return '';
}

function padNumbers(s) {
  return String(s).replace(/[0-9]+/g, (m) => m.padStart(8, '0'));
}

function getBats(zapretDir) {
  if (!zapretDir) return [];
  try {
    return fs.readdirSync(zapretDir)
      .filter((name) => /\.bat$/i.test(name) && !/^service/i.test(name))
      .sort((a, b) => padNumbers(a).localeCompare(padNumbers(b), 'en', { sensitivity: 'base' }));
  } catch {
    return [];
  }
}

function detectSelectedBat(zapretDir) {
  const bats = getBats(zapretDir);
  if (!bats.length) return '';
  const find = (name) => bats.find((b) => b.toLowerCase() === name.toLowerCase());
  return find('general (ALT9).bat') || find('general.bat') || bats[0];
}

function parseIni(file) {
  const data = {
    zapretDir: '',
    selectedBat: '',
    autostart: true,
    minimizeToTray: false,
    serviceNoticeShown: false
  };
  try {
    if (!fs.existsSync(file)) return null;
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line[0] === '#' || line[0] === ';') continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim().toLowerCase();
      const val = line.slice(eq + 1).trim();
      if (key === 'zapretdir') data.zapretDir = val;
      else if (key === 'selectedbat') data.selectedBat = val;
      else if (key === 'autostart') data.autostart = isTrue(val);
      else if (key === 'minimizetotray') data.minimizeToTray = isTrue(val);
      else if (key === 'servicenoticeshown') data.serviceNoticeShown = isTrue(val);
    }
    return data;
  } catch {
    return null;
  }
}

function normalizeWindow(w) {
  if (!w || typeof w !== 'object') return null;
  const out = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    const n = Number(w[key]);
    if (Number.isFinite(n)) out[key] = Math.round(n);
  }
  out.maximized = Boolean(w.maximized);
  if (out.width == null || out.height == null) return null;
  return out;
}

class Config {
  constructor(appDataDir, logger) {
    this.dir = path.join(appDataDir, 'ZapretMini');
    this.file = path.join(this.dir, 'electron-config.json');
    this.legacyIni = path.join(this.dir, 'config.ini');
    this.logger = logger || { write() {} };
    this.data = {
      zapretDir: '',
      selectedBat: '',
      autostart: true,
      minimizeToTray: false,
      serviceNoticeShown: false,
      window: null
    };
    this.firstRun = true;
  }

  load() {
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch { /* ignore */ }
    let raw = null;
    try {
      if (fs.existsSync(this.file)) {
        raw = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, ''));
        this.firstRun = false;
      }
    } catch (err) {
      this.logger.write('Конфиг Electron: ошибка чтения: ' + err.message);
      raw = null;
    }

    if (!raw) {
      const legacy = parseIni(this.legacyIni);
      if (legacy) {
        raw = {
          zapretDir: legacy.zapretDir,
          selectedBat: legacy.selectedBat,
          autostart: legacy.autostart,
          minimizeToTray: legacy.minimizeToTray,
          serviceNoticeShown: legacy.serviceNoticeShown
        };
        this.logger.write('Конфиг Electron: миграция из config.ini');
      }
    }

    if (raw && typeof raw === 'object') {
      if (typeof raw.zapretDir === 'string') this.data.zapretDir = raw.zapretDir.trim();
      if (typeof raw.selectedBat === 'string') this.data.selectedBat = raw.selectedBat.trim();
      if (typeof raw.autostart === 'boolean') this.data.autostart = raw.autostart;
      if (typeof raw.minimizeToTray === 'boolean') this.data.minimizeToTray = raw.minimizeToTray;
      if (typeof raw.serviceNoticeShown === 'boolean') this.data.serviceNoticeShown = raw.serviceNoticeShown;
      this.data.window = normalizeWindow(raw.window);
    }

    if (!looksLikeZapret(this.data.zapretDir)) {
      const detected = detectZapretDir();
      if (detected) {
        this.data.zapretDir = detected;
        this.logger.write('Конфиг Electron: папка zapret найдена: ' + detected);
      }
    }

    if (looksLikeZapret(this.data.zapretDir)) {
      const bats = getBats(this.data.zapretDir);
      const known = bats.some((b) => b.toLowerCase() === this.data.selectedBat.toLowerCase());
      if (!this.data.selectedBat || !known) {
        this.data.selectedBat = detectSelectedBat(this.data.zapretDir);
      }
    }

    this.save();
    return this.data;
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
  }

  update(patch) {
    Object.assign(this.data, patch || {});
    this.save();
  }

  windowState() {
    return this.data.window;
  }

  saveWindow(windowState) {
    this.data.window = normalizeWindow(windowState);
    this.save();
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const out = {
        zapretDir: this.data.zapretDir || '',
        selectedBat: this.data.selectedBat || '',
        autostart: Boolean(this.data.autostart),
        minimizeToTray: Boolean(this.data.minimizeToTray),
        serviceNoticeShown: Boolean(this.data.serviceNoticeShown),
        window: this.data.window || null
      };
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
      try { fs.rmSync(this.file, { force: true }); } catch { /* ignore */ }
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.logger.write('Конфиг Electron: ошибка записи: ' + err.message);
    }
  }
}

module.exports = {
  Config,
  looksLikeZapret,
  detectZapretDir,
  detectSelectedBat,
  getBats,
  padNumbers,
  parseIni
};
