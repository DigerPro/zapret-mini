'use strict';

const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, shell, screen, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns').promises;

const { Config, looksLikeZapret, detectSelectedBat } = require('./lib/config');
const { Logger } = require('./lib/logger');
const { loadTargets, summarizeTargets } = require('./lib/targets');
const { ResultStore } = require('./lib/results');
const { RealBackend } = require('./lib/zapret');
const { MockBackend, MockResults } = require('./lib/mock');
const { normalizeProbeInput, quickCandidates, rankProbeRows, bestProbeRow } = require('./lib/probe');
const siteStore = require('./lib/site-store');
const updater = require('./lib/updater');
const zapretUpdater = require('./lib/zapret-updater');
const uninstaller = require('./lib/uninstaller');
const { spawn, spawnSync } = require('child_process');
const autostart = require('./lib/autostart');

const ARGS = process.argv.slice(1);
const hasArg = (name) => ARGS.some((a) => a.toLowerCase() === name.toLowerCase());
const getArgValue = (prefix, fallback) => {
  const item = ARGS.find((a) => a.toLowerCase().startsWith(prefix.toLowerCase()));
  if (!item) return null;
  const eq = item.indexOf('=');
  return eq >= 0 ? item.slice(eq + 1) : fallback;
};

const SCREENSHOT = ARGS.some((a) => a.toLowerCase().startsWith('--screenshot'))
  ? (getArgValue('--screenshot', 'all') || 'all')
  : null;
const MOCK = hasArg('--mock') || process.env.ZAPRET_MOCK === '1' || Boolean(SCREENSHOT);
const START_HIDDEN = hasArg('--tray') && !SCREENSHOT;
const MOCK_STATE = getArgValue('--mock-state', null);
const DEVTOOLS = hasArg('--devtools');

app.setName('ZapretMini');
app.setAppUserModelId('com.zapretmini.app');

const APP_DATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const DATA_DIR = path.join(APP_DATA, 'ZapretMini');
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const MANAGED_ZAPRET_DIR = path.join(LOCAL_APP_DATA, 'ZapretMini', 'zapret');
const USER_SITES_FILE = path.join(DATA_DIR, 'user-sites.json');
const UPDATE_STATE_FILE = path.join(DATA_DIR, 'update-state.json');
const HOSTS_FILE = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
try {
  const userDataDir = path.join(DATA_DIR, 'electron');
  fs.mkdirSync(userDataDir, { recursive: true });
  app.setPath('userData', userDataDir);
} catch { /* ignore */ }

function resolveAssetsDir() {
  if (__dirname.includes('app.asar')) {
    const unpacked = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'assets');
    if (fs.existsSync(unpacked)) return unpacked;
  }
  let dir = path.join(__dirname, 'assets');
  if (!fs.existsSync(dir) && __dirname.includes('app.asar')) {
    dir = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'assets');
  }
  return dir;
}
const ASSETS_DIR = resolveAssetsDir();

let logger = null;
let win = null;
let tray = null;
let config = null;
let backend = null;
let results = null;
let ipcReady = false;
let isQuitting = false;
let operation = null; // 'apply' | 'check' | 'test' | 'stop' | 'restore' | 'probe' | 'sites'
let testing = null;
let probe = null;
let userSites = null;
let updateBusy = false;
let cancelRequested = false;
let busyText = '';
let lastInfo = { winwsRunning: false, winwsPid: null, serviceState: -1 };
let lastSelected = '';
let lastTraySignature = '';
let lastStateForTray = null;
let refreshTimer = null;
let saveBoundsTimer = null;
let balloonShown = false;

class MemoryConfig {
  constructor(values) {
    this.data = Object.assign({}, values);
    this.dir = DATA_DIR;
  }
  get(key) { return this.data[key]; }
  set(key, value) { this.data[key] = value; }
  update(patch) { Object.assign(this.data, patch || {}); }
  save() { /* mock ничего не пишет */ }
  windowState() { return null; }
  saveWindow() { /* mock ничего не пишет */ }
}

function setupConfig() {
  logger = new Logger(DATA_DIR, (line) => {
    if (win && !win.isDestroyed()) win.webContents.send('log', line);
  });
  logger.write('Запуск Zapret Mini (Electron ' + process.versions.electron + ', mock=' + MOCK + ')');

  if (MOCK) {
    config = new MemoryConfig({
      zapretDir: 'C:\\zapret',
      selectedBat: 'general (ALT4).bat',
      autostart: true,
      minimizeToTray: true
    });
    userSites = {
      version: 1,
      sites: [{
        id: 'epic',
        group: 'Epic',
        name: 'Epic Games',
        domain: 'epicgames.com',
        hostnames: ['epicgames.com', 'epicgames.dev'],
        targets: ['EpicWeb'],
        enabled: true,
        hosts: [],
        createdAt: Date.now()
      }]
    };
    return;
  }

  config = new Config(APP_DATA, logger);
  config.load();
  ensureZapretUserLists(config.get('zapretDir'));
  loadUserSites();
  recoverProbeListBackup();
}

function zapretFile(kind) {
  const dir = config && config.get ? config.get('zapretDir') : '';
  if (!dir) return '';
  if (kind === 'targets') return path.join(dir, 'utils', 'targets.txt');
  if (kind === 'userList') return path.join(dir, 'lists', 'list-general-user.txt');
  if (kind === 'lists') return path.join(dir, 'lists');
  return '';
}

function saveUserSites() {
  if (!userSites) return;
  if (MOCK) return;
  try {
    if (fs.existsSync(USER_SITES_FILE)) siteStore.backup(USER_SITES_FILE);
    siteStore.saveManifest(USER_SITES_FILE, userSites.sites);
  } catch (err) {
    logger.write('user-sites.json: ошибка записи: ' + (err && err.message ? err.message : err));
  }
}

function snapshotFile(file) {
  try {
    return { exists: true, data: fs.readFileSync(file) };
  } catch {
    return { exists: false, data: null };
  }
}

function restoreFile(file, snapshot) {
  if (!snapshot) return;
  if (snapshot.exists && snapshot.data) {
    fs.writeFileSync(file, snapshot.data);
  } else {
    try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
  }
}

function recoverProbeListBackup() {
  const userList = zapretFile('userList');
  if (!userList) return;
  const bak = userList + '.bak-probe';
  if (!fs.existsSync(bak)) return;
  try {
    fs.copyFileSync(bak, userList);
    fs.rmSync(bak, { force: true });
    logger.write('Поиск обхода: восстановлен список после незавершённой проверки');
  } catch (err) {
    logger.write('Поиск обхода: не удалось восстановить список: ' + (err && err.message ? err.message : err));
  }
}

function removeHostsForSite(site) {
  if (!site || !Array.isArray(site.hostnames) || !site.hostnames.length) return;
  siteStore.removeHostsEntries(HOSTS_FILE, site.hostnames);
}

async function applySelectedQuiet() {
  const info = await backend.getInfo();
  if (!info.winwsRunning) return { ok: true, skipped: true };
  const bat = selectedBat();
  if (!bat) return { ok: true, skipped: true };
  return backend.applyBat(bat);
}

function loadUpdateState() {
  try {
    const raw = JSON.parse(fs.readFileSync(UPDATE_STATE_FILE, 'utf8').replace(/^\uFEFF/, ''));
    return {
      lastCheck: Number(raw.lastCheck) || 0,
      skippedVersion: String(raw.skippedVersion || ''),
      lastZapretCheck: Number(raw.lastZapretCheck) || 0,
      skippedZapretVersion: String(raw.skippedZapretVersion || '')
    };
  } catch {
    return { lastCheck: 0, skippedVersion: '', lastZapretCheck: 0, skippedZapretVersion: '' };
  }
}

function ensureUninstallEntry() {
  if (MOCK || SCREENSHOT || !app.isPackaged) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const scriptPath = path.join(DATA_DIR, 'uninstall.ps1');
    fs.writeFileSync(scriptPath, '\uFEFF' + uninstaller.script(), 'utf8');
    const regExe = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'reg.exe');
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ZapretMini';
    const exe = process.execPath;
    const values = [
      ['DisplayName', 'REG_SZ', 'Zapret Mini'],
      ['DisplayVersion', 'REG_SZ', app.getVersion()],
      ['Publisher', 'REG_SZ', 'Zapret Mini'],
      ['DisplayIcon', 'REG_SZ', exe + ',0'],
      ['InstallLocation', 'REG_SZ', path.dirname(exe)],
      ['UninstallString', 'REG_SZ', 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + scriptPath + '"'],
      ['QuietUninstallString', 'REG_SZ', 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + scriptPath + '" -Silent'],
      ['NoModify', 'REG_DWORD', '1'],
      ['NoRepair', 'REG_DWORD', '1']
    ];
    for (const [name, type, value] of values) {
      spawnSync(regExe, ['add', key, '/v', name, '/t', type, '/d', value, '/f'], { windowsHide: true });
    }
  } catch (err) {
    logger.write('Удаление: ' + (err && err.message ? err.message : err));
  }
}

function saveUpdateState(state) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(UPDATE_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch { /* ignore */ }
}

async function promptUpdate(info) {
  if (!win || win.isDestroyed()) return false;
  showWindow();
  const detail = (info.notes || '').slice(0, 1800);
  const answer = await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Zapret Mini',
    message: 'Доступна версия ' + info.latest,
    detail: (detail ? detail + '\n\n' : '') + 'Текущая версия: ' + info.current,
    buttons: ['Установить', 'Позже'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (answer.response !== 0) {
    const state = loadUpdateState();
    state.skippedVersion = info.latest;
    saveUpdateState(state);
    return false;
  }
  await downloadAndInstall(info);
  return true;
}

async function downloadAndInstall(info) {
  if (!app.isPackaged) {
    await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Zapret Mini',
      message: 'Обновление доступно только в установленной версии',
      buttons: ['OK']
    });
    return;
  }
  const dir = path.join(DATA_DIR, 'update');
  let lastTick = 0;
  try {
    logger.write('Обновление: скачивание ' + info.latest);
    win.setProgressBar(0);
    if (tray) tray.setToolTip('Zapret Mini — загрузка обновления…');
    const file = await updater.downloadUpdate(info, dir, (received, total) => {
      if (!total) return;
      const now = Date.now();
      if (now - lastTick < 500) return;
      lastTick = now;
      try { win.setProgressBar(Math.max(0, Math.min(1, received / total))); } catch { /* ignore */ }
    });
    win.setProgressBar(-1);
    if (tray) tray.setToolTip('Zapret Mini');
    logger.write('Обновление: скачано и проверено ' + file.zipPath);
    const answer = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Zapret Mini',
      message: 'Обновление скачано',
      detail: 'Перезапустить приложение и установить версию ' + info.latest + '?',
      buttons: ['Установить', 'Отмена'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (answer.response !== 0) {
      try { fs.rmSync(file.zipPath, { force: true }); } catch { /* ignore */ }
      return;
    }
    await updater.installUpdate(file.zipPath, path.dirname(process.execPath), process.execPath, process.pid);
    logger.write('Обновление: установка ' + info.latest + ', выход');
    isQuitting = true;
    setTimeout(() => app.quit(), 500);
  } catch (err) {
    try { win.setProgressBar(-1); } catch { /* ignore */ }
    if (tray) tray.setToolTip('Zapret Mini');
    logger.write('Обновление: ' + (err && err.stack ? err.stack : err));
    await dialog.showMessageBox(win, {
      type: 'error',
      title: 'Zapret Mini',
      message: 'Не удалось скачать обновление',
      detail: (err && err.message) || 'Неизвестная ошибка',
      buttons: ['OK']
    });
  }
}

async function checkForUpdates(manual) {
  if (updateBusy) return { ok: false, error: 'Проверка обновлений уже идёт' };
  if (!app.isPackaged) {
    if (manual) {
      showWindow();
      await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Zapret Mini',
        message: 'Обновления проверяются в установленной версии',
        buttons: ['OK']
      });
    }
    return { ok: true, update: false, dev: true };
  }
  updateBusy = true;
  try {
    const info = await updater.checkLatest(app.getVersion());
    if (!info.ok) {
      if (manual) {
        showWindow();
        await dialog.showMessageBox(win, {
          type: 'error',
          title: 'Zapret Mini',
          message: 'Не удалось проверить обновления',
          detail: info.error || 'Неизвестная ошибка',
          buttons: ['OK']
        });
      }
      return { ok: false, update: false, error: info.error };
    }
    if (!info.update) {
      if (manual) {
        showWindow();
        await dialog.showMessageBox(win, {
          type: 'info',
          title: 'Zapret Mini',
          message: 'У тебя последняя версия',
          detail: 'Установлена ' + app.getVersion(),
          buttons: ['OK']
        });
      }
      return { ok: true, update: false, latest: info.latest };
    }
    await promptUpdate(info);
    return { ok: true, update: true, latest: info.latest };
  } catch (err) {
    logger.write('Обновления: ' + (err && err.stack ? err.stack : err));
    if (manual) {
      showWindow();
      await dialog.showMessageBox(win, {
        type: 'error',
        title: 'Zapret Mini',
        message: 'Не удалось проверить обновления',
        detail: (err && err.message) || 'Проверь интернет',
        buttons: ['OK']
      });
    }
    return { ok: false, update: false, error: (err && err.message) || 'Ошибка сети' };
  } finally {
    updateBusy = false;
  }
}

async function promptZapretUpdate(info, dir) {
  if (!win || win.isDestroyed()) return false;
  const local = zapretUpdater.localVersion(dir);
  showWindow();
  const answer = await dialog.showMessageBox(win, {
    type: 'info',
    title: 'Zapret Mini',
    message: 'Доступна сборка zapret ' + info.latest,
    detail: 'Установлена ' + (local || 'неизвестная версия') + '.\n\n' +
      'Обновятся батники, bin и стандартные списки. Твои targets.txt, пользовательские ' +
      'списки и настройки сохранятся. После обновления активная стратегия будет применена заново.',
    buttons: ['Обновить', 'Позже'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (answer.response !== 0) {
    const state = loadUpdateState();
    state.skippedZapretVersion = info.latest;
    saveUpdateState(state);
    return false;
  }
  return updateZapret(info, dir);
}

async function updateZapret(info, dir) {
  if (operation || testing || (probe && probe.active)) {
    return false;
  }
  const selectedBefore = selectedBat();
  const beforeInfo = await backend.getInfo();
  const wasRunning = Boolean(beforeInfo.winwsRunning);
  let backup = null;
  let moved = false;
  const base = path.join(DATA_DIR, 'update');
  const zipPath = path.join(base, 'zapret-' + info.latest + '.zip');
  const extractDir = path.join(base, 'zapret-' + info.latest + '-extracted');
  const stagingDir = path.join(base, 'zapret-' + info.latest + '-staging');
  setOperation('zapret', 'Обновляю zapret до ' + info.latest + '…');
  await pushState();
  try {
    fs.mkdirSync(base, { recursive: true });
    if (win) win.setProgressBar(0);
    if (tray) tray.setToolTip('Zapret Mini — загрузка zapret…');
    await zapretUpdater.downloadZip(info, zipPath, (received, total) => {
      if (!win || !total) return;
      try { win.setProgressBar(Math.max(0, Math.min(1, received / total))); } catch { /* ignore */ }
    });
    if (win) win.setProgressBar(-1);
    fs.rmSync(extractDir, { recursive: true, force: true });
    await zapretUpdater.extractZip(zipPath, extractDir);
    const root = zapretUpdater.findRoot(extractDir);
    zapretUpdater.prepareStaging(root, dir, stagingDir);
    if (!fs.existsSync(path.join(stagingDir, 'bin', 'winws.exe'))) {
      throw new Error('В новой сборке нет bin\\winws.exe');
    }

    if (wasRunning) {
      await backend.stop();
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    stopWinDivert();
    backup = dir + '.bak-zapret-' + Date.now();
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
    fs.renameSync(dir, backup);
    moved = true;
    fs.cpSync(stagingDir, dir, { recursive: true });
    ensureZapretUserLists(dir);

    const bats = await backend.getBats();
    let selected = selectedBefore;
    if (!selected || !bats.some((bat) => bat.toLowerCase() === selected.toLowerCase())) {
      selected = detectSelectedBat(dir) || bats[0] || '';
    }
    if (!selected) throw new Error('В новой сборке нет батников');
    if (wasRunning) {
      const applied = await applyBatInternal(selected, false);
      if (!applied.ok) throw new Error(applied.error || 'Не удалось применить стратегию после обновления');
    }
    config.set('selectedBat', selected);
    config.save();
    setOperation(null, '');
    await pushState();
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(zipPath, { force: true }); } catch { /* ignore */ }
    if (tray) tray.setToolTip('Zapret Mini');
    showWindow();
    await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Zapret Mini',
      message: 'Батники обновлены до ' + info.latest,
      detail: 'Активная стратегия: ' + selected + '\nРезервная копия: ' + backup,
      buttons: ['OK']
    });
    return true;
  } catch (err) {
    if (win) win.setProgressBar(-1);
    if (tray) tray.setToolTip('Zapret Mini');
    logger.write('Обновление zapret: ' + (err && err.stack ? err.stack : err));
    if (moved && backup && fs.existsSync(backup)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.renameSync(backup, dir);
        if (wasRunning) await applyBatInternal(selectedBefore, false);
      } catch (restoreErr) {
        logger.write('Обновление zapret: откат: ' + (restoreErr && restoreErr.message ? restoreErr.message : restoreErr));
      }
    }
    setOperation(null, '');
    await pushState();
    showWindow();
    await dialog.showMessageBox(win, {
      type: 'error',
      title: 'Zapret Mini',
      message: 'Не удалось обновить zapret',
      detail: (err && err.message) || 'Неизвестная ошибка',
      buttons: ['OK']
    });
    return false;
  }
}

async function checkZapretUpdates(manual) {
  if (updateBusy || operation || testing || (probe && probe.active)) {
    return { ok: false, error: 'Уже выполняется другая операция' };
  }
  if (!app.isPackaged) {
    if (manual) {
      showWindow();
      await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Zapret Mini',
        message: 'Обновление zapret доступно только в установленной версии',
        buttons: ['OK']
      });
    }
    return { ok: true, update: false, dev: true };
  }
  const dir = config.get('zapretDir') || '';
  if (!dir || !looksLikeZapret(dir)) {
    if (manual) {
      showWindow();
      await dialog.showMessageBox(win, {
        type: 'error',
        title: 'Zapret Mini',
        message: 'Папка zapret не найдена',
        buttons: ['OK']
      });
    }
    return { ok: false, error: 'Папка zapret не найдена' };
  }
  updateBusy = true;
  try {
    const local = zapretUpdater.localVersion(dir);
    const info = await zapretUpdater.checkBatsLatest();
    if (!zapretUpdater.isNewer(info.latest, local)) {
      if (manual) {
        showWindow();
        await dialog.showMessageBox(win, {
          type: 'info',
          title: 'Zapret Mini',
          message: 'Батники уже обновлены',
          detail: 'Установлена сборка ' + (local || 'неизвестной версии'),
          buttons: ['OK']
        });
      }
      return { ok: true, update: false, latest: info.latest, local };
    }
    await promptZapretUpdate(info, dir);
    return { ok: true, update: true, latest: info.latest, local };
  } catch (err) {
    logger.write('Обновление zapret: проверка: ' + (err && err.message ? err.message : err));
    if (manual) {
      showWindow();
      await dialog.showMessageBox(win, {
        type: 'error',
        title: 'Zapret Mini',
        message: 'Не удалось проверить обновление zapret',
        detail: (err && err.message) || 'Проверь интернет',
        buttons: ['OK']
      });
    }
    return { ok: false, error: (err && err.message) || 'Ошибка сети' };
  } finally {
    updateBusy = false;
  }
}

async function autoCheckZapret() {
  if (MOCK || SCREENSHOT || !app.isPackaged || updateBusy) return;
  const dir = config.get('zapretDir') || '';
  if (!dir || !looksLikeZapret(dir)) return;
  const state = loadUpdateState();
  if (Date.now() - state.lastZapretCheck < 12 * 60 * 60 * 1000) return;
  state.lastZapretCheck = Date.now();
  saveUpdateState(state);
  updateBusy = true;
  try {
    const local = zapretUpdater.localVersion(dir);
    const info = await zapretUpdater.checkBatsLatest();
    if (zapretUpdater.isNewer(info.latest, local) && info.latest !== state.skippedZapretVersion) {
      await promptZapretUpdate(info, dir);
    }
  } catch (err) {
    logger.write('Обновление zapret (авто): ' + (err && err.message ? err.message : err));
  } finally {
    updateBusy = false;
  }
}

async function uninstallApp() {
  if (!app.isPackaged) return { ok: false, error: 'Удаление доступно только в установленной версии' };
  if (operation || testing || (probe && probe.active)) {
    return { ok: false, error: 'Дождитесь завершения операции' };
  }
  showWindow();
  const answer = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Zapret Mini',
    message: 'Удалить Zapret Mini?',
    detail: 'Будут удалены приложение, настройки, список сайтов и управляемая папка zapret. ' +
      'Папка zapret, выбранная вручную вне %LOCALAPPDATA%\\ZapretMini, останется. ' +
      'Приложение закроется.',
    buttons: ['Удалить', 'Отмена'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (answer.response !== 0) return { ok: false, canceled: true };
  const scriptPath = path.join(DATA_DIR, 'uninstall.ps1');
  if (!fs.existsSync(scriptPath)) ensureUninstallEntry();
  if (!fs.existsSync(scriptPath)) return { ok: false, error: 'Не найден uninstall.ps1' };
  const child = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Silent'
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  logger.write('Удаление: запуск uninstall.ps1');
  isQuitting = true;
  setTimeout(() => app.quit(), 500);
  return { ok: true };
}

async function autoCheckUpdates() {
  if (MOCK || SCREENSHOT || !app.isPackaged || updateBusy || operation) return;
  const state = loadUpdateState();
  if (Date.now() - state.lastCheck < 12 * 60 * 60 * 1000) {
    await autoCheckZapret();
    return;
  }
  state.lastCheck = Date.now();
  saveUpdateState(state);
  let appUpdateStarted = false;
  updateBusy = true;
  try {
    const info = await updater.checkLatest(app.getVersion());
    if (info.ok && info.update && info.latest !== state.skippedVersion) {
      appUpdateStarted = await promptUpdate(info);
    }
  } catch (err) {
    logger.write('Обновления (авто): ' + (err && err.message ? err.message : err));
  } finally {
    updateBusy = false;
  }
  if (!appUpdateStarted) await autoCheckZapret();
}

function seedUserSites() {
  const userList = zapretFile('userList');
  const targetsFile = zapretFile('targets');
  let listText = '';
  let hostsText = '';
  let targetsText = '';
  try { listText = userList ? fs.readFileSync(userList, 'utf8') : ''; } catch { /* ignore */ }
  try { hostsText = fs.existsSync(HOSTS_FILE) ? fs.readFileSync(HOSTS_FILE, 'utf8') : ''; } catch { /* ignore */ }
  try { targetsText = targetsFile ? fs.readFileSync(targetsFile, 'utf8') : ''; } catch { /* ignore */ }
  if (targetsFile && !/###\s+Epic\b/i.test(targetsText)) {
    try {
      siteStore.addTargetGroup(targetsFile, 'Epic', 'EpicWeb', 'https://www.epicgames.com');
    } catch (err) {
      logger.write('Epic target: ' + (err && err.message ? err.message : err));
    }
  }
  const listed = new Set(listText.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter(Boolean));
  const hostLines = hostsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const instagramHosts = hostLines.filter((line) => {
    const host = line.split(/\s+/).slice(1).join(' ').trim().toLowerCase();
    return host === 'instagram.com' || host === 'www.instagram.com';
  });
  const sites = [
    {
      id: 'instagram',
      group: 'Instagram',
      name: 'Instagram',
      domain: 'instagram.com',
      hostnames: ['instagram.com', 'cdninstagram.com', 'facebook.com', 'fbcdn.net'],
      targets: ['InstagramWeb', 'InstagramCDN'],
      enabled: ['instagram.com', 'cdninstagram.com', 'facebook.com', 'fbcdn.net'].some((host) => listed.has(host)),
      hosts: instagramHosts,
      createdAt: Date.now()
    },
    {
      id: 'epic',
      group: 'Epic',
      name: 'Epic Games',
      domain: 'epicgames.com',
      hostnames: ['epicgames.com', 'epicgames.dev'],
      targets: ['EpicWeb'],
      enabled: ['epicgames.com', 'epicgames.dev'].some((host) => listed.has(host)),
      hosts: [],
      createdAt: Date.now()
    }
  ];
  userSites = { version: 1, sites };
  saveUserSites();
}

function loadUserSites() {
  if (MOCK) {
    userSites = { version: 1, sites: [] };
    return;
  }
  const loaded = siteStore.loadManifest(USER_SITES_FILE);
  if (loaded) {
    userSites = loaded;
    return;
  }
  seedUserSites();
}

function findUserSite(group) {
  if (!userSites) return null;
  const wanted = String(group || '').toLowerCase();
  return userSites.sites.find((site) => String(site.group || '').toLowerCase() === wanted) || null;
}

function findUserSiteByDomain(hostname) {
  if (!userSites) return null;
  const host = siteStore.normalizeHostname(hostname);
  return userSites.sites.find((site) => {
    const names = Array.isArray(site.hostnames) ? site.hostnames : [];
    return names.some((name) => host === name || host.endsWith('.' + name));
  }) || null;
}

async function setupBackend() {
  if (MOCK) {
    const mock = new MockBackend({ state: MOCK_STATE });
    await mock.init();
    backend = mock;
    results = new MockResults(mock);
    if (MOCK_STATE === 'testall') {
      testing = mock.seedTestingState();
      testing.previewResult = mock.testAllPreview();
      operation = null;
      busyText = '';
    }
  } else {
    backend = new RealBackend(config, logger, ASSETS_DIR);
    results = new ResultStore(DATA_DIR, logger);
    results.load();
  }
}

function stateTargets() {
  if (MOCK) return backend.targets.map((t) => Object.assign({}, t));
  return loadTargets(config.get('zapretDir'), logger);
}

function selectedBat() {
  return config.get('selectedBat') || '';
}

function serviceLabel(state) {
  if (state === 4) return 'работает';
  if (state === 2 || state === 3) return 'останавливается';
  if (state === 1) return 'вручную';
  return 'не найдена';
}

function filesMeta(targets) {
  const counts = summarizeTargets(targets);
  if (MOCK) {
    const now = new Date();
    const mtime = new Date(now.getFullYear(), 10, 12, 12, 0, 0).getTime();
    return {
      targets: { exists: true, mtime, http: counts.http, ping: counts.ping },
      log: { exists: true, size: Math.round(2.4 * 1024 * 1024) }
    };
  }
  const dir = config.get('zapretDir') || '';
  const targetsFile = path.join(dir, 'utils', 'targets.txt');
  const logFile = path.join(DATA_DIR, 'electron.log');
  let targetsStat = null;
  let logStat = null;
  try { targetsStat = fs.statSync(targetsFile); } catch { /* ignore */ }
  try { logStat = fs.statSync(logFile); } catch { /* ignore */ }
  return {
    targets: {
      exists: Boolean(targetsStat),
      mtime: targetsStat ? targetsStat.mtimeMs : 0,
      http: counts.http,
      ping: counts.ping
    },
    log: { exists: Boolean(logStat), size: logStat ? logStat.size : 0 }
  };
}

function publicProbe() {
  if (!probe) return null;
  const copy = Object.assign({}, probe, { results: probe.results.slice() });
  if (probe.pending) {
    const pending = Object.assign({}, probe.pending);
    delete pending.originalList;
    copy.pending = pending;
  }
  return copy;
}

async function buildState() {
  const info = await backend.getInfo();
  lastInfo = info;
  const found = MOCK ? true : looksLikeZapret(config.get('zapretDir'));
  const targets = found ? stateTargets() : [];
  const bats = await backend.getBats();
  lastSelected = selectedBat();
  return {
    mock: MOCK,
    version: app.getVersion(),
    config: {
      zapretDir: config.get('zapretDir') || '',
      autostart: Boolean(config.get('autostart')),
      minimizeToTray: Boolean(config.get('minimizeToTray'))
    },
    zapretFound: found,
    zapretVersion: found ? zapretUpdater.localVersion(config.get('zapretDir')) : '',
    bats,
    selectedBat: selectedBat(),
    winwsRunning: info.winwsRunning,
    winwsPid: info.winwsPid,
    serviceState: info.serviceState,
    serviceLabel: serviceLabel(info.serviceState),
    targets,
    results: results.all(),
    userSites: userSites && Array.isArray(userSites.sites) ? userSites.sites : [],
    testing: testing ? Object.assign({}, testing) : null,
    probe: publicProbe(),
    operation,
    busyText,
    files: filesMeta(targets)
  };
}

async function pushState() {
  if (!win || win.isDestroyed() || !ipcReady) return;
  try {
    const state = await buildState();
    lastStateForTray = state;
    win.webContents.send('state', state);
    updateTrayMenu(state);
  } catch (err) {
    logger.write('Состояние: ошибка: ' + err.message);
  }
}

function sendProgress() {
  if (!win || win.isDestroyed() || !testing) return;
  win.webContents.send('testProgress', {
    index: testing.index,
    total: testing.total,
    bat: testing.bat,
    httpOk: testing.httpOk,
    httpTotal: testing.httpTotal
  });
}

function setOperation(op, text) {
  operation = op;
  busyText = text || '';
}

async function runCheckFor(bat) {
  const targets = stateTargets();
  const rows = await backend.runChecks(targets);
  const result = {
    bat,
    checkedAt: Date.now(),
    results: rows,
    httpOk: 0,
    httpTotal: 0,
    pingOk: 0,
    pingTotal: 0
  };
  const saved = results.set(result);
  results.save();
  return saved || result;
}

async function applyBatInternal(bat, checkAfter) {
  const res = await backend.applyBat(bat);
  if (!res.ok) return { ok: false, error: res.error };
  if (checkAfter) {
    await runCheckFor(bat);
  }
  return { ok: true, error: null };
}

async function restoreBypass(restore, best) {
  const bats = await backend.getBats();
  const candidates = [];
  for (const name of [restore, best, bats[0]]) {
    if (name && !candidates.some((c) => c.toLowerCase() === name.toLowerCase()) &&
      bats.some((b) => b.toLowerCase() === name.toLowerCase())) {
      candidates.push(name);
    }
  }
  for (const bat of candidates) {
    setOperation('restore', 'Возвращаю ' + bat.replace(/\.bat$/i, '') + '…');
    await pushState();
    const applied = await applyBatInternal(bat, false);
    if (applied.ok) {
      config.set('selectedBat', bat);
      config.save();
      setOperation('check', 'Проверяю сайты…');
      await pushState();
      await runCheckFor(bat);
      return { ok: true, bat };
    }
    logger.write('Возврат ' + bat + ': ' + applied.error);
  }
  return { ok: false, error: 'Не удалось восстановить обход' };
}

async function doApply(bat) {
  if (operation) return { ok: false, error: 'Дождитесь завершения операции' };
  if (!bat) return { ok: false, error: 'Стратегия не выбрана' };
  setOperation('apply', 'Подключаю ' + bat.replace(/\.bat$/i, '') + '…');
  await pushState();

  const applied = await applyBatInternal(bat, false);
  if (!applied.ok) {
    setOperation(null, '');
    await pushState();
    return { ok: false, error: applied.error };
  }

  config.set('selectedBat', bat);
  config.save();
  await pushState();

  setOperation('check', 'Проверяю сайты…');
  await pushState();
  const result = await runCheckFor(bat);
  setOperation(null, '');
  await pushState();
  return { ok: true, error: null, result };
}

async function startupApply() {
  if (MOCK || SCREENSHOT) return;
  if (!config || !config.get) return;
  const dir = config.get('zapretDir');
  if (!dir || !looksLikeZapret(dir)) return;
  const bat = selectedBat();
  if (!bat || operation) return;
  try {
    logger.write('Старт: подключаю ' + bat);
    const res = await doApply(bat);
    if (!res.ok) logger.write('Старт: ' + (res.error || 'не удалось подключить'));
  } catch (err) {
    logger.write('Старт: ' + (err && err.stack ? err.stack : err));
  }
}

function ensureZapretUserLists(dir) {
  if (!dir || !looksLikeZapret(dir)) return;
  try {
    const created = zapretUpdater.ensureUserLists(dir);
    if (created.length) logger.write('zapret: созданы пользовательские списки: ' + created.join(', '));
  } catch (err) {
    logger.write('zapret: не удалось создать пользовательские списки: ' + (err && err.message ? err.message : err));
  }
}

function stopWinDivert() {
  const sc = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'sc.exe');
  try { spawnSync(sc, ['stop', 'WinDivert'], { windowsHide: true }); } catch { /* ignore */ }
  try { spawnSync(sc, ['delete', 'WinDivert'], { windowsHide: true }); } catch { /* ignore */ }
}

function applyUserSitesToFresh(dir) {
  if (!dir || !looksLikeZapret(dir) || !userSites || !Array.isArray(userSites.sites)) return;
  const targetsFile = path.join(dir, 'utils', 'targets.txt');
  const userList = path.join(dir, 'lists', 'list-general-user.txt');
  if (!fs.existsSync(targetsFile) || !fs.existsSync(userList)) return;
  const knownUrls = {
    InstagramWeb: 'https://www.instagram.com',
    InstagramCDN: 'https://static.cdninstagram.com',
    EpicWeb: 'https://www.epicgames.com'
  };
  for (const site of userSites.sites) {
    const keys = Array.isArray(site.targets) ? site.targets : [];
    for (const key of keys) {
      const url = knownUrls[key] || (site.domain ? 'https://' + String(site.domain).replace(/^www\./i, '') : '');
      if (!url) continue;
      try {
        siteStore.addTargetGroup(targetsFile, site.group, key, url);
      } catch (err) {
        logger.write('Сайты: не удалось добавить цель ' + key + ': ' + (err && err.message ? err.message : err));
      }
    }
    if (site.enabled) {
      try {
        siteStore.addHostnames(userList, site.hostnames);
      } catch (err) {
        logger.write('Сайты: не удалось добавить ' + (site.name || site.group || '') + ': ' + (err && err.message ? err.message : err));
      }
    }
  }
}

async function installZapret(options) {
  const opts = options || {};
  if (MOCK || SCREENSHOT) return { ok: false, error: 'Недоступно в этом режиме' };
  if (operation || testing || (probe && probe.active)) {
    return { ok: false, error: 'Дождитесь завершения операции' };
  }
  const current = config.get('zapretDir') || '';
  if (looksLikeZapret(current)) {
    return { ok: true, already: true, dir: current };
  }
  if (opts.confirm) {
    showWindow();
    const answer = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Zapret Mini',
      message: 'Скачать батники zapret?',
      detail: 'Будет скачана официальная сборка Flowseal/zapret-discord-youtube с GitHub. ' +
        'Приложение установит её в свою папку. Настройки и добавленные сайты не затрагиваются.',
      buttons: ['Скачать', 'Отмена'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (answer.response !== 0) return { ok: false, canceled: true };
  }

  setOperation('zapret-install', 'Скачиваю батники zapret…');
  await pushState();
  if (win) win.setProgressBar(0);
  const tempBase = path.join(DATA_DIR, 'update', 'zapret-fresh-' + Date.now());
  let installed = null;
  let applied = null;
  try {
    try { await backend.stop(); } catch { /* ignore */ }
    stopWinDivert();
    const prepared = await zapretUpdater.downloadAndPrepareLatest(tempBase, (received, total) => {
      if (!win || !total) return;
      try { win.setProgressBar(Math.max(0, Math.min(1, received / total))); } catch { /* ignore */ }
    });
    if (win) win.setProgressBar(-1);
    installed = zapretUpdater.installFromDirectory(prepared.root, MANAGED_ZAPRET_DIR);
    ensureZapretUserLists(MANAGED_ZAPRET_DIR);
    config.set('zapretDir', MANAGED_ZAPRET_DIR);
    config.set('selectedBat', detectSelectedBat(MANAGED_ZAPRET_DIR) || installed.bats[0] || '');
    config.save();
    applyUserSitesToFresh(MANAGED_ZAPRET_DIR);
    setOperation(null, '');
    await pushState();

    const bat = selectedBat();
    if (bat) {
      try {
        applied = await doApply(bat);
      } catch (err) {
        applied = { ok: false, error: (err && err.message) || 'неизвестная ошибка' };
      }
    }
    const version = installed.version || prepared.info.latest || '';
    const lines = [
      'Версия: ' + (version || 'неизвестна'),
      'Папка: ' + MANAGED_ZAPRET_DIR
    ];
    if (applied && applied.ok) lines.push('Стратегия: ' + bat.replace(/\.bat$/i, ''));
    if (applied && applied.ok === false) lines.push('', 'Обход не запустился: ' + (applied.error || 'неизвестная ошибка'));
    showWindow();
    await dialog.showMessageBox(win, {
      type: applied && applied.ok === false ? 'warning' : 'info',
      title: 'Zapret Mini',
      message: applied && applied.ok === false ? 'Батники установлены, но обход не запустился' : 'Батники zapret установлены',
      detail: lines.join('\n'),
      buttons: ['OK']
    });
    return { ok: true, version, dir: MANAGED_ZAPRET_DIR, applied: applied ? Boolean(applied.ok) : null };
  } catch (err) {
    setOperation(null, '');
    await pushState();
    if (win) win.setProgressBar(-1);
    logger.write('Установка zapret: ' + (err && err.stack ? err.stack : err));
    showWindow();
    await dialog.showMessageBox(win, {
      type: 'error',
      title: 'Zapret Mini',
      message: 'Не удалось скачать батники',
      detail: (err && err.message) || 'Неизвестная ошибка',
      buttons: ['OK']
    });
    return { ok: false, error: (err && err.message) || 'Неизвестная ошибка' };
  } finally {
    try { fs.rmSync(tempBase, { recursive: true, force: true }); } catch { /* ignore */ }
    if (win) {
      try { win.setProgressBar(-1); } catch { /* ignore */ }
    }
  }
}

async function offerZapretInstallOnStartup() {
  if (MOCK || SCREENSHOT) return false;
  if (!config || !config.get) return false;
  const dir = config.get('zapretDir') || '';
  if (looksLikeZapret(dir)) return false;
  showWindow();
  const answer = await dialog.showMessageBox(win, {
    type: 'question',
    title: 'Zapret Mini',
    message: 'Батники zapret не найдены',
    detail: 'Скачать официальную сборку Flowseal/zapret-discord-youtube?\n\n' +
      'Приложение скачает последнюю версию с GitHub и установит её в свою папку. ' +
      'Настройки и добавленные сайты не затрагиваются.',
    buttons: ['Скачать', 'Позже'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (answer.response !== 0) return false;
  const res = await installZapret();
  return Boolean(res && res.ok);
}

async function doToggle() {
  if (operation) return { ok: false, error: 'Дождитесь завершения операции' };
  const info = await backend.getInfo();
  if (info.winwsRunning) {
    setOperation('stop', 'Отключаю обход…');
    await pushState();
    await backend.stop();
    setOperation(null, '');
    await pushState();
    return { ok: true, running: false };
  }
  return doApply(selectedBat());
}

async function doCheckCurrent() {
  if (operation) return { ok: false, error: 'Дождитесь завершения операции' };
  const info = await backend.getInfo();
  const bat = selectedBat();
  if (!info.winwsRunning) {
    return doApply(bat);
  }
  setOperation('check', 'Проверяю ' + bat.replace(/\.bat$/i, '') + '…');
  await pushState();
  const result = await runCheckFor(bat);
  setOperation(null, '');
  await pushState();
  return { ok: true, result };
}

async function doTestAll() {
  if (operation) return { ok: false, error: 'Уже выполняется другая операция' };
  const bats = await backend.getBats();
  if (!bats.length) return { ok: false, error: 'Нет батников' };

  let restore = selectedBat();
  if (!bats.some((b) => b.toLowerCase() === restore.toLowerCase())) restore = bats[0];

  cancelRequested = false;
  setOperation('test', '');
  testing = {
    active: true,
    index: 0,
    total: bats.length,
    bat: restore,
    httpOk: 0,
    httpTotal: 0,
    cancelRequested: false,
    startedAt: Date.now()
  };
  await pushState();
  sendProgress();
  if (backend.setTestAllMode) backend.setTestAllMode(true);

  let best = null;
  let bestOk = -1;
  let bestTotal = 0;
  let failure = null;

  try {
    for (let i = 0; i < bats.length; i++) {
      if (cancelRequested) break;
      const bat = bats[i];
      const prev = results.get(bat);
      testing.index = i + 1;
      testing.bat = bat;
      testing.httpOk = prev ? prev.httpOk : 0;
      testing.httpTotal = prev ? prev.httpTotal : 0;
      testing.cancelRequested = cancelRequested;
      await pushState();
      sendProgress();

      const applied = await backend.applyBat(bat);
      let result;
      if (applied.ok) {
        result = await runCheckFor(bat);
      } else {
        logger.write('Тест всех: ' + bat + ': ' + applied.error);
        result = results.set({
          bat,
          checkedAt: Date.now(),
          results: [],
          httpOk: 0,
          httpTotal: 0,
          pingOk: 0,
          pingTotal: 0
        });
        results.save();
      }
      if (result && result.httpTotal > 0 && result.httpOk > bestOk) {
        bestOk = result.httpOk;
        bestTotal = result.httpTotal;
        best = bat;
      }
      testing.httpOk = result ? result.httpOk : 0;
      testing.httpTotal = result ? result.httpTotal : 0;
      testing.cancelRequested = cancelRequested;
      await pushState();
      sendProgress();
    }
  } catch (err) {
    failure = err;
    logger.write('Тест всех: ' + err.stack);
  }

  const canceled = cancelRequested;
  if (backend.setTestAllMode) backend.setTestAllMode(false);
  testing = null;
  cancelRequested = false;
  busyText = '';
  await pushState();

  const restored = await restoreBypass(restore, best);
  setOperation(null, '');
  await pushState();
  if (win && !win.isDestroyed()) {
    win.webContents.send('testProgress', { done: true, canceled, best, bestOk, bestTotal, restored: restored.ok });
  }
  if (!restored.ok) {
    return { ok: false, error: (failure ? failure.message + '. ' : '') + restored.error };
  }
  return {
    ok: true,
    canceled,
    best,
    bestOk,
    bestTotal,
    error: failure ? failure.message : null
  };
}

function cancelTest() {
  if (!testing) return { ok: false, error: 'Тест не идёт' };
  cancelRequested = true;
  testing.cancelRequested = true;
  pushState();
  return { ok: true };
}

async function resolveProbeValue(value) {
  const parsed = normalizeProbeInput(value);
  if (parsed.error) return { ok: false, error: parsed.error };
  const literal = /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname) || parsed.hostname.includes(':');
  if (literal) {
    return { ok: true, url: parsed.url, host: parsed.host, address: parsed.hostname, warning: null };
  }
  try {
    const found = await dns.lookup(parsed.hostname);
    return {
      ok: true,
      url: parsed.url,
      host: parsed.host,
      address: found.address,
      warning: found.address === '0.0.0.0' ? 'zero' : null
    };
  } catch {
    return {
      ok: false,
      error: 'Домен не резолвится. Это DNS или hosts — стратегии zapret тут не помогут.',
      code: 'DNS',
      url: parsed.url,
      host: parsed.host
    };
  }
}

async function restoreAfterProbe(previous, best, bats) {
  const order = [];
  for (const name of [previous, best, bats[0]]) {
    if (!name) continue;
    if (order.some((item) => item.toLowerCase() === name.toLowerCase())) continue;
    if (!bats.some((bat) => bat.toLowerCase() === name.toLowerCase())) continue;
    order.push(name);
  }
  for (const bat of order) {
    const applied = await backend.applyBat(bat);
    if (applied.ok) {
      config.set('selectedBat', bat);
      config.save();
      return { ok: true, bat };
    }
    logger.write('Поиск обхода: возврат ' + bat + ': ' + applied.error);
  }
  return { ok: false, error: 'ни одна стратегия не запустилась' };
}

function isBuiltinHost(host) {
  const wanted = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!wanted) return false;
  const groups = new Set(['Discord', 'YouTube', 'Google', 'Cloudflare', 'DNS']);
  for (const target of stateTargets()) {
    if (!groups.has(target.group)) continue;
    let name = '';
    try { name = target.url ? new URL(target.url).hostname : target.pingHost; } catch { name = target.pingHost; }
    name = String(name || '').toLowerCase().replace(/^www\./, '');
    if (!name) continue;
    if (wanted === name || wanted.endsWith('.' + name) || name.endsWith('.' + wanted)) return true;
  }
  return false;
}

async function doProbe(payload) {
  if (operation || testing || (probe && probe.active)) {
    return { ok: false, error: 'Уже выполняется другая операция' };
  }
  const input = payload || {};
  const resolved = await resolveProbeValue(input.value);
  if (!resolved.ok) return { ok: false, error: resolved.error, code: resolved.code || null };

  const bats = await backend.getBats();
  if (!bats.length) return { ok: false, error: 'Не найдено ни одного батника' };

  const host = siteStore.normalizeHostname(resolved.hostname);
  const targetsFile = zapretFile('targets');
  const userList = zapretFile('userList');
  if (!MOCK && (!targetsFile || !fs.existsSync(targetsFile))) {
    return { ok: false, error: 'Не найден utils\\targets.txt в папке zapret' };
  }
  if (!MOCK && (!userList || !fs.existsSync(userList))) {
    return { ok: false, error: 'Не найден lists\\list-general-user.txt в папке zapret' };
  }

  const existingSite = findUserSiteByDomain(host);
  const coverage = siteStore.checkDefaultCoverage(config.get('zapretDir'), host, resolved.address);
  const builtinTarget = !existingSite && isBuiltinHost(host);
  let targetText = '';
  try { targetText = targetsFile ? fs.readFileSync(targetsFile, 'utf8') : ''; } catch { /* ignore */ }
  const targetLower = targetText.toLowerCase();
  const urlNeedle = '= "' + resolved.url.toLowerCase() + '"';
  const alreadyInTargets = targetLower.includes('### ' + host.replace(/^www\./, '').toLowerCase()) ||
    targetLower.includes(urlNeedle);
  const hostnames = existingSite && Array.isArray(existingSite.hostnames) && existingSite.hostnames.length
    ? existingSite.hostnames.slice()
    : siteStore.hostnamesForDomain(host);
  const builtin = coverage.builtin || builtinTarget;
  const needTemp = !MOCK && !builtin && (!existingSite || !existingSite.enabled);
  let tempAdded = false;
  let originalList = null;
  if (needTemp && userList) {
    try {
      originalList = snapshotFile(userList);
      fs.copyFileSync(userList, userList + '.bak-probe');
      siteStore.addHostnames(userList, hostnames);
      tempAdded = true;
    } catch (err) {
      logger.write('Поиск обхода: временное добавление: ' + (err && err.message ? err.message : err));
      return { ok: false, error: 'Не удалось временно добавить домен в список обхода' };
    }
  }

  const pending = {
    domain: host.replace(/^www\./, ''),
    hostname: host,
    url: resolved.url,
    hostnames,
    targetKey: siteStore.targetKeyForDomain(host, targetText),
    group: existingSite ? existingSite.group : host.replace(/^www\./, ''),
    builtin,
    builtinSource: coverage.source || (builtinTarget ? 'targets.txt' : null),
    already: Boolean(existingSite),
    enabled: existingSite ? Boolean(existingSite.enabled) : true,
    alreadyInTargets,
    tempAdded,
    originalList,
    restored: false,
    saved: false,
    mock: MOCK
  };

  const mode = input.mode === 'all' ? 'all' : 'quick';
  const resume = Boolean(input.resume) && Boolean(probe) && probe.finished && probe.url === resolved.url;
  const previous = selectedBat();
  const rows = resume ? probe.results.slice() : [];
  const known = new Set(rows.map((row) => row.bat.toLowerCase()));

  let candidates;
  if (mode === 'all') {
    candidates = bats.filter((bat) => !known.has(bat.toLowerCase()));
  } else {
    candidates = quickCandidates(bats, results.all(), previous)
      .filter((bat) => !known.has(bat.toLowerCase()));
  }

  probe = {
    active: true,
    finished: false,
    canceled: false,
    domain: resolved.host,
    url: resolved.url,
    mode,
    index: rows.length,
    total: mode === 'all' ? bats.length : Math.max(rows.length + candidates.length, 1),
    tested: rows.length,
    bat: '',
    dns: resolved.address || '',
    results: rows,
    best: null,
    previousBat: previous,
    pending,
    error: null,
    cancelRequested: false,
    startedAt: Date.now()
  };

  setOperation('probe', 'Ищу обход для ' + resolved.host + '…');
  await pushState();

  let applyFails = 0;
  let failure = null;

  try {
    for (const bat of candidates) {
      if (probe.cancelRequested) break;
      probe.bat = bat;
      await pushState();

      const applied = await backend.applyBat(bat);
      let row;
      if (!applied.ok) {
        applyFails++;
        row = {
          bat,
          ok: false,
          ms: 0,
          status: 'Не запустилась',
          error: applied.error || ''
        };
        probe.results.push(row);
        probe.tested = probe.results.length;
        probe.index = probe.tested;
        await pushState();
        if (applyFails >= 3) {
          probe.error = 'winws не запускается: ' + (applied.error || 'неизвестная ошибка');
          break;
        }
        continue;
      }

      applyFails = 0;
      const check = await backend.checkUrl(bat, resolved.url);
      row = {
        bat,
        ok: Boolean(check && check.ok),
        ms: Math.max(0, Number(check && check.ms) || 0),
        status: String((check && check.status) || 'Ошибка')
      };
      probe.results.push(row);
      probe.tested = probe.results.length;
      probe.index = probe.tested;
      await pushState();
    }
  } catch (err) {
    failure = err;
    logger.write('Поиск обхода: ' + (err && err.stack ? err.stack : err));
    probe.error = (err && err.message) || 'Неизвестная ошибка';
  }

  const canceled = Boolean(probe.cancelRequested);
  const ranked = rankProbeRows(probe.results);
  const best = bestProbeRow(ranked);

  if (probe.pending && probe.pending.tempAdded && !probe.pending.restored && userList) {
    try {
      restoreFile(userList, probe.pending.originalList);
      fs.rmSync(userList + '.bak-probe', { force: true });
      probe.pending.restored = true;
      logger.write('Поиск обхода: временная запись в списке обхода убрана');
    } catch (err) {
      logger.write('Поиск обхода: не удалось убрать временную запись: ' + (err && err.message ? err.message : err));
      probe.error = (probe.error ? probe.error + '. ' : '') + 'Не удалось восстановить список обхода';
    }
  }

  setOperation('probe', 'Возвращаю ' + (previous || 'стратегию') + '…');
  await pushState();
  const restored = await restoreAfterProbe(previous, best ? best.bat : null, bats);

  if (!restored.ok) {
    probe.error = (probe.error ? probe.error + '. ' : '') +
      'Не удалось вернуть прежнюю стратегию: ' + restored.error;
  }
  probe.active = false;
  probe.finished = true;
  probe.canceled = canceled;
  probe.bat = '';
  probe.results = ranked;
  probe.best = best ? best.bat : null;
  probe.tested = ranked.length;
  probe.previousBat = restored.bat || previous;
  setOperation(null, '');
  await pushState();

  if (!restored.ok) {
    return { ok: false, error: 'Не удалось вернуть прежнюю стратегию: ' + restored.error };
  }
  return {
    ok: true,
    canceled,
    best: probe.best,
    error: probe.error || (failure ? failure.message : null)
  };
}

function cancelProbe() {
  if (!probe || !probe.active) return { ok: false, error: 'Поиск не идёт' };
  probe.cancelRequested = true;
  pushState();
  return { ok: true };
}

async function clearProbe() {
  if (probe && probe.active) return { ok: false, error: 'Сначала отмени поиск' };
  probe = null;
  await pushState();
  return { ok: true };
}

async function setUserSiteEnabled(group, enabled) {
  if (operation || testing || (probe && probe.active)) {
    return { ok: false, error: 'Уже выполняется другая операция' };
  }
  const site = findUserSite(group);
  if (!site) return { ok: false, error: 'Этот сервис встроенный — его нельзя отключать' };
  if (Boolean(site.enabled) === Boolean(enabled)) return { ok: true, enabled: Boolean(enabled) };
  const userList = zapretFile('userList');
  if (!MOCK && (!userList || !fs.existsSync(userList))) {
    return { ok: false, error: 'Не найден list-general-user.txt' };
  }
  const beforeList = !MOCK ? snapshotFile(userList) : null;
  const beforeSites = JSON.parse(JSON.stringify(userSites));
  setOperation('sites', enabled ? 'Включаю обход для ' + site.name + '…' : 'Отключаю обход для ' + site.name + '…');
  await pushState();
  try {
    if (!MOCK) {
      if (enabled) siteStore.addHostnames(userList, site.hostnames);
      else siteStore.removeHostnames(userList, site.hostnames);
    }
    site.enabled = Boolean(enabled);
    saveUserSites();
    const applied = await applySelectedQuiet();
    if (applied && applied.ok === false) throw new Error(applied.error || 'winws не запустился');
    setOperation(null, '');
    await pushState();
    return { ok: true, enabled: Boolean(enabled) };
  } catch (err) {
    if (!MOCK) restoreFile(userList, beforeList);
    userSites = beforeSites;
    saveUserSites();
    try { await applySelectedQuiet(); } catch { /* ignore */ }
    setOperation(null, '');
    await pushState();
    return { ok: false, error: (err && err.message) || 'Не удалось изменить обход' };
  }
}

async function deleteUserSite(group) {
  if (operation || testing || (probe && probe.active)) {
    return { ok: false, error: 'Уже выполняется другая операция' };
  }
  const site = findUserSite(group);
  if (!site) return { ok: false, error: 'Этот сервис встроенный — его нельзя удалить' };
  const targetsFile = zapretFile('targets');
  const userList = zapretFile('userList');
  if (!MOCK && (!targetsFile || !userList)) return { ok: false, error: 'Не найдены файлы zapret' };
  const beforeTargets = !MOCK ? snapshotFile(targetsFile) : null;
  const beforeList = !MOCK ? snapshotFile(userList) : null;
  const beforeHosts = !MOCK ? snapshotFile(HOSTS_FILE) : null;
  const beforeSites = JSON.parse(JSON.stringify(userSites));
  setOperation('sites', 'Удаляю ' + site.name + '…');
  await pushState();
  try {
    if (!MOCK) {
      siteStore.removeTargetGroup(targetsFile, site.group);
      siteStore.removeHostnames(userList, site.hostnames);
      removeHostsForSite(site);
    }
    userSites.sites = userSites.sites.filter((item) => item !== site);
    saveUserSites();
    const applied = await applySelectedQuiet();
    if (applied && applied.ok === false) throw new Error(applied.error || 'winws не запустился');
    setOperation(null, '');
    await pushState();
    return { ok: true };
  } catch (err) {
    if (!MOCK) {
      restoreFile(targetsFile, beforeTargets);
      restoreFile(userList, beforeList);
      restoreFile(HOSTS_FILE, beforeHosts);
    }
    userSites = beforeSites;
    saveUserSites();
    try { await applySelectedQuiet(); } catch { /* ignore */ }
    setOperation(null, '');
    await pushState();
    return { ok: false, error: (err && err.message) || 'Не удалось удалить сайт' };
  }
}

async function saveProbeSite() {
  if (!probe || !probe.finished || probe.active) return { ok: false, error: 'Поиск ещё не завершён' };
  if (probe.saved) return { ok: false, error: 'Сайт уже добавлен' };
  const pending = probe.pending;
  if (!pending) return { ok: false, error: 'Нет данных для добавления' };
  if (pending.builtin) {
    return { ok: false, error: 'Домен уже входит в стандартную сборку — добавлять его не нужно' };
  }
  if (pending.alreadyInTargets && !pending.already) {
    return { ok: false, error: 'Сайт уже есть в targets.txt, но не управляется приложением' };
  }
  if (!probe.best) return { ok: false, error: 'Ни одна стратегия не открыла сайт' };
  if (MOCK) return { ok: false, error: 'В демо-режиме добавление недоступно' };

  const targetsFile = zapretFile('targets');
  const userList = zapretFile('userList');
  if (!targetsFile || !userList) return { ok: false, error: 'Не найдены файлы zapret' };
  const beforeTargets = snapshotFile(targetsFile);
  const beforeList = snapshotFile(userList);
  const beforeSites = JSON.parse(JSON.stringify(userSites));
  setOperation('sites', 'Добавляю ' + pending.domain + '…');
  await pushState();

  try {
    if (pending.already) {
      const site = findUserSite(pending.group);
      if (!site) throw new Error('Сайт не найден в списке');
      siteStore.addHostnames(userList, site.hostnames);
      site.enabled = true;
    } else {
      const added = siteStore.addTargetGroup(targetsFile, pending.group, pending.targetKey, pending.url);
      if (!added.ok) throw new Error(added.error || 'Не удалось добавить цель');
      siteStore.addHostnames(userList, pending.hostnames);
      userSites.sites.push({
        id: siteStore.slug(pending.domain),
        group: pending.group,
        name: pending.domain,
        domain: pending.domain,
        hostnames: pending.hostnames.slice(),
        targets: [pending.targetKey],
        enabled: true,
        hosts: [],
        createdAt: Date.now()
      });
    }
    saveUserSites();
    setOperation(null, '');
    await pushState();
    const applied = await doApply(probe.best);
    if (!applied || !applied.ok) throw new Error((applied && applied.error) || 'Не удалось применить стратегию');
    probe.saved = true;
    pending.saved = true;
    await pushState();
    return { ok: true, group: pending.group, best: probe.best };
  } catch (err) {
    restoreFile(targetsFile, beforeTargets);
    restoreFile(userList, beforeList);
    userSites = beforeSites;
    saveUserSites();
    try { await applySelectedQuiet(); } catch { /* ignore */ }
    setOperation(null, '');
    await pushState();
    return { ok: false, error: (err && err.message) || 'Не удалось добавить сайт' };
  }
}

async function saveSettings(patch) {
  if (operation) return { ok: false, error: 'Сначала дождись окончания операции' };
  const input = patch || {};
  const before = {
    zapretDir: config.get('zapretDir'),
    autostart: Boolean(config.get('autostart')),
    minimizeToTray: Boolean(config.get('minimizeToTray'))
  };
  let autostartError = null;
  let dirChanged = false;

  if (typeof input.zapretDir === 'string' && input.zapretDir.trim() !== before.zapretDir) {
    const dir = input.zapretDir.trim();
    if (!looksLikeZapret(dir)) {
      return { ok: false, error: 'В папке нет bin\\winws.exe или service.bat' };
    }
    dirChanged = true;
    config.set('zapretDir', dir);
    ensureZapretUserLists(dir);
    applyUserSitesToFresh(dir);
    const bats = await backend.getBats();
    if (!bats.some((b) => b.toLowerCase() === selectedBat().toLowerCase())) {
      config.set('selectedBat', MOCK ? (bats[0] || '') : (detectSelectedBat(dir) || (bats[0] || '')));
    }
  }

  if (typeof input.minimizeToTray === 'boolean') {
    config.set('minimizeToTray', input.minimizeToTray);
  }

  if (typeof input.autostart === 'boolean' && input.autostart !== before.autostart) {
    config.set('autostart', input.autostart);
    if (!MOCK) {
      if (!app.isPackaged) {
        autostartError = 'Автозапуск настраивается в установленной версии (electron-builder --dir).';
        config.set('autostart', before.autostart);
      } else {
        const res = input.autostart
          ? await autostart.enable(DATA_DIR, process.execPath, logger)
          : await autostart.disable(logger);
        if (!res.ok) {
          autostartError = res.error;
          config.set('autostart', before.autostart);
        }
      }
    }
  }

  config.save();
  await pushState();

  if (dirChanged) {
    try { await backend.stop(); } catch { /* ignore */ }
    const bat = selectedBat();
    if (bat) {
      const applied = await doApply(bat);
      if (!applied.ok) return { ok: false, error: applied.error, state: await buildState() };
    }
  }

  return { ok: true, autostartError, state: await buildState() };
}

function normalizeBounds(saved) {
  const defaults = { width: 1180, height: 760 };
  if (!saved || !saved.width || !saved.height) return defaults;
  const bounds = {
    width: Math.max(980, Math.min(saved.width, 4096)),
    height: Math.max(640, Math.min(saved.height, 4096))
  };
  const displays = screen.getAllDisplays();
  const visible = displays.some((d) => {
    const a = d.workArea;
    return saved.x + bounds.width > a.x + 80 &&
      saved.x < a.x + a.width - 80 &&
      saved.y + 44 > a.y &&
      saved.y < a.y + a.height - 80;
  });
  if (visible && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    bounds.x = saved.x;
    bounds.y = saved.y;
  }
  return bounds;
}

function rememberBounds() {
  if (MOCK || !win || win.isDestroyed()) return;
  const saved = config.windowState() || {};
  const normal = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
  config.saveWindow({
    x: normal.x,
    y: normal.y,
    width: normal.width,
    height: normal.height,
    maximized: win.isMaximized()
  });
}

function scheduleBoundsSave() {
  if (MOCK) return;
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(rememberBounds, 500);
}

function createWindow() {
  const bounds = MOCK ? { width: 1180, height: 760 } : normalizeBounds(config.windowState());
  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0B0E12',
    show: false,
    frame: false,
    title: 'Zapret Mini',
    icon: path.join(ASSETS_DIR, 'app.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: !(SCREENSHOT || DEVTOOLS),
      devTools: DEVTOOLS
    }
  });

  if (process.platform === 'win32') {
    try { win.setVisualZoomLevelLimits(1, 1); } catch { /* ignore */ }
  }

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  win.webContents.on('did-fail-load', (event, code, desc, url, isMainFrame) => {
    if (logger) logger.write('did-fail-load: ' + code + ' ' + desc + ' ' + url);
    if (isMainFrame === false) return;
    if (win && !win.isDestroyed()) {
      win.show();
      try {
        dialog.showErrorBox('Zapret Mini', 'Не удалось загрузить интерфейс.\r\n' + desc + ' (' + code + ')');
      } catch { /* ignore */ }
    }
  });
  win.webContents.on('render-process-gone', (event, details) => {
    if (logger) logger.write('render-process-gone: ' + JSON.stringify(details));
  });
  win.webContents.on('preload-error', (event, preloadPath, error) => {
    if (logger) logger.write('preload-error: ' + preloadPath + ' ' + (error && error.stack ? error.stack : error));
  });
  win.webContents.on('dom-ready', () => {
    if (logger) logger.write('dom-ready: ' + win.webContents.getURL());
  });
  win.webContents.on('console-message', (event) => {
    if (!logger || !event) return;
    if (event.level === 'error' || event.level === 3) {
      logger.write('console error: ' + (event.message || JSON.stringify(event)));
    }
  });

  win.once('ready-to-show', () => {
    const wantMax = !MOCK && config.windowState() && config.windowState().maximized;
    if (SCREENSHOT) {
      win.show();
    } else if (START_HIDDEN) {
      // старт в трее: окно остаётся скрытым
    } else {
      let shown = false;
      const reveal = () => {
        if (shown || !win || win.isDestroyed()) return;
        shown = true;
        if (wantMax) win.maximize();
        win.show();
      };
      win.webContents.executeJavaScript('document.fonts.ready.then(() => true)', true)
        .then(reveal)
        .catch(reveal);
      setTimeout(reveal, 1500);
    }
    win.webContents.send('window:maximized', win.isMaximized());
  });

  win.on('maximize', () => {
    if (win && !win.isDestroyed()) win.webContents.send('window:maximized', true);
    scheduleBoundsSave();
  });
  win.on('unmaximize', () => {
    if (win && !win.isDestroyed()) win.webContents.send('window:maximized', false);
    scheduleBoundsSave();
  });
  win.on('move', scheduleBoundsSave);
  win.on('resize', scheduleBoundsSave);
  win.on('session-end', () => { isQuitting = true; });

  win.on('close', (event) => {
    if (isQuitting || SCREENSHOT) return;
    if (config.get('minimizeToTray')) {
      event.preventDefault();
      win.hide();
      if (!balloonShown && tray) {
        balloonShown = true;
        try {
          tray.displayBalloon({
            title: 'Zapret Mini',
            content: 'Свёрнуто в трей. Обход продолжает работать.',
            iconType: 'info'
          });
        } catch { /* ignore */ }
      }
      return;
    }
    if (operation || testing) {
      event.preventDefault();
      showWindow();
      try {
        dialog.showMessageBox(win, {
          type: 'info',
          title: 'Zapret Mini',
          message: 'Дождитесь завершения операции',
          detail: 'Идёт применение батника или тест. Нажмите «Отмена» в окне и дождитесь завершения.',
          buttons: ['OK']
        });
      } catch { /* ignore */ }
      return;
    }
    isQuitting = true;
  });

  win.on('closed', () => {
    win = null;
  });

  return win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!MOCK && config.windowState() && config.windowState().maximized && !win.isMaximized()) {
    win.maximize();
  }
  win.show();
  win.focus();
}

function quitApp() {
  if (operation || testing) {
    showWindow();
    try {
      dialog.showMessageBox(win, {
        type: 'info',
        title: 'Zapret Mini',
        message: 'Дождитесь завершения операции',
        detail: 'Идёт применение батника или тест. Нажмите «Отмена» в окне и дождитесь завершения.',
        buttons: ['OK']
      });
    } catch { /* ignore */ }
    return;
  }
  isQuitting = true;
  if (tray) {
    try { tray.destroy(); } catch { /* ignore */ }
    tray = null;
  }
  app.quit();
}

function createTray() {
  let icon = nativeImage.createFromPath(path.join(ASSETS_DIR, 'tray.ico'));
  if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(ASSETS_DIR, 'icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('Zapret Mini');
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  updateTrayMenu(lastStateForTray);
}

function updateTrayMenu(state) {
  if (!tray) return;
  const running = state ? state.winwsRunning : lastInfo.winwsRunning;
  const selected = state ? state.selectedBat : selectedBat();
  const mock = state ? state.mock : MOCK;
  const busy = Boolean(operation || testing || (state && (state.operation || state.testing)));
  const signature = [running, selected, mock, busy].join('|');
  if (signature === lastTraySignature) {
    tray.setToolTip('Zapret Mini — ' + (selected || '—') + (running ? ' · обход включён' : ' · обход выключен'));
    return;
  }
  lastTraySignature = signature;
  const menu = Menu.buildFromTemplate([
    { label: 'Открыть', click: showWindow },
    { type: 'separator' },
    {
      label: running ? 'Отключить обход' : 'Включить обход',
      enabled: !busy,
      click: () => { safeAction(doToggle); }
    },
    {
      label: 'Настройки',
      click: () => {
        showWindow();
        if (win && !win.isDestroyed()) win.webContents.send('open-settings');
      }
    },
    { type: 'separator' },
    { label: 'Выход', click: quitApp }
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip('Zapret Mini — ' + (selected || '—') + (running ? ' · обход включён' : ' · обход выключен'));
}

async function safeAction(fn) {
  try {
    return await fn();
  } catch (err) {
    logger.write('Действие: ' + err.stack);
    setOperation(null, '');
    await pushState();
    return { ok: false, error: err.message };
  }
}

function setupIpc() {
  if (ipcReady) return;
  ipcReady = true;

  ipcMain.handle('state:get', () => buildState());

  ipcMain.handle('bat:apply', (event, bat) => safeAction(async () => {
    if (operation) return { ok: false, error: 'Уже выполняется другая операция' };
    const bats = await backend.getBats();
    if (!bats.includes(bat)) return { ok: false, error: 'Батник не найден: ' + bat };
    return doApply(bat);
  }));

  ipcMain.handle('obhod:toggle', () => safeAction(async () => {
    if (operation) return { ok: false, error: 'Уже выполняется другая операция' };
    return doToggle();
  }));

  ipcMain.handle('sites:check', () => safeAction(async () => {
    if (operation) return { ok: false, error: 'Уже выполняется другая операция' };
    return doCheckCurrent();
  }));

  ipcMain.handle('test:all', () => safeAction(() => doTestAll()));

  ipcMain.handle('test:cancel', () => cancelTest());

  ipcMain.handle('probe:run', (event, payload) => safeAction(() => doProbe(payload)));
  ipcMain.handle('probe:cancel', () => cancelProbe());
  ipcMain.handle('probe:clear', () => safeAction(() => clearProbe()));
  ipcMain.handle('probe:resolve', (event, value) => safeAction(() => resolveProbeValue(value)));
  ipcMain.handle('probe:save', () => safeAction(() => saveProbeSite()));
  ipcMain.handle('site:set-enabled', (event, group, enabled) => safeAction(() => setUserSiteEnabled(group, enabled)));
  ipcMain.handle('site:delete', (event, group) => safeAction(() => deleteUserSite(group)));
  ipcMain.handle('update:check', () => safeAction(() => checkForUpdates(true)));
  ipcMain.handle('zapret:check', () => safeAction(() => checkZapretUpdates(true)));
  ipcMain.handle('zapret:install', () => safeAction(() => installZapret({ confirm: true })));
  ipcMain.handle('app:uninstall', () => safeAction(() => uninstallApp()));

  ipcMain.handle('settings:save', (event, patch) => safeAction(() => saveSettings(patch)));

  ipcMain.handle('dialog:dir', async () => {
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, {
      title: 'Папка сборки zapret',
      defaultPath: config.get('zapretDir') || undefined,
      properties: ['openDirectory']
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('path:open', async (event, kind) => {
    const dir = config.get('zapretDir') || '';
    let target = null;
    if (kind === 'targets') target = path.join(dir, 'utils', 'targets.txt');
    else if (kind === 'log') target = path.join(DATA_DIR, 'electron.log');
    else if (kind === 'folder') target = dir || DATA_DIR;
    else return { ok: false, error: 'Неизвестный путь' };
    if (!target || !fs.existsSync(target)) {
      if (kind === 'folder' && fs.existsSync(DATA_DIR)) target = DATA_DIR;
      else return { ok: false, error: 'Файл не найден: ' + target };
    }
    const error = await shell.openPath(target);
    return error ? { ok: false, error } : { ok: true };
  });

  ipcMain.handle('window:minimize', () => { if (win) win.minimize(); });
  ipcMain.handle('window:maximize', () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle('window:close', () => { if (win) win.close(); });
  ipcMain.handle('window:is-maximized', () => Boolean(win && win.isMaximized()));
}

function startRefreshLoop() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    if (operation || !win || win.isDestroyed()) return;
    try {
      const info = await backend.getInfo();
      const changed = info.winwsRunning !== lastInfo.winwsRunning ||
        info.winwsPid !== lastInfo.winwsPid ||
        info.serviceState !== lastInfo.serviceState ||
        selectedBat() !== lastSelected;
      if (changed) {
        await pushState();
      }
    } catch { /* ignore */ }
  }, 10000);
}

async function captureShots() {
  const outDir = __dirname.includes('app.asar')
    ? path.join(path.dirname(process.execPath), 'screenshots')
    : path.join(__dirname, 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function ready() {
    for (let i = 0; i < 60; i++) {
      const ok = await win.webContents.executeJavaScript('Boolean(window.__zapretReady)', true).catch(() => false);
      if (ok) return true;
      await wait(100);
    }
    const diag = await win.webContents.executeJavaScript(
      'JSON.stringify({ready:document.readyState,api:Boolean(window.api),flag:Boolean(window.__zapretReady),body:document.body?document.body.innerText.slice(0,120):"",scripts:[...document.scripts].map(s=>s.src)})',
      true).catch((err) => String(err));
    logger.write('Скриншоты: готовность не дождались: ' + diag);
    return false;
  }

  async function capture(name) {
    await win.webContents.executeJavaScript('document.documentElement.classList.add("no-motion"); true', true);
    try {
      win.show();
      win.moveTop();
    } catch { /* ignore */ }
    await wait(180);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, name + '.png'), image.toPNG());
    logger.write('Скриншот: screenshots/' + name + '.png');
  }

  await ready();
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)', true);
  await wait(300);

  const want = SCREENSHOT || 'all';
  const all = want === 'all';

  if (all || want === 'main') {
    await capture('main');
  }

  if (all || want === 'settings') {
    await win.webContents.executeJavaScript('document.getElementById("btn-settings").click(); true', true);
    await wait(300);
    await capture('settings');
    await win.webContents.executeJavaScript('document.getElementById("set-close").click(); true', true);
    await wait(260);
  }

  if (all || want === 'min') {
    await win.webContents.executeJavaScript('document.activeElement && document.activeElement.blur(); true', true);
    win.setSize(980, 640);
    await wait(450);
    await capture('min');
    win.setSize(1180, 760);
    await wait(350);
  }

  if (all || want === 'testall') {
    testing = backend && typeof backend.seedTestingState === 'function' ? backend.seedTestingState() : {
      active: true, index: 7, total: 20, bat: 'general (ALT6).bat',
      httpOk: 12, httpTotal: 13, cancelRequested: false, startedAt: Date.now() - 7 * 28000
    };
    if (backend && typeof backend.testAllPreview === 'function') {
      testing.previewResult = backend.testAllPreview();
    }
    setOperation(null, '');
    await pushState();
    await wait(400);
    await capture('testall');
  }

  if (all || want === 'summary') {
    if (testing) {
      testing = null;
      await pushState();
      await wait(350);
    }
    const opened = await win.webContents.executeJavaScript(
      '(function () { if (!window.__zapretMock) return false; window.__zapretMock.summary(); return true; })()',
      true).catch(() => false);
    if (opened) {
      await wait(350);
      await capture('summary');
      await win.webContents.executeJavaScript('document.getElementById("sum-close").click(); true', true);
      await wait(260);
    } else {
      logger.write('Скриншот summary: демо-хук недоступен');
    }
  }

  if (want === 'site-off') {
    await win.webContents.executeJavaScript(
      'document.querySelector(\'[data-user-toggle="Epic"]\').click(); true', true);
    await wait(900);
    await capture('site-off');
    await win.webContents.executeJavaScript(
      'document.querySelector(\'[data-user-toggle="Epic"]\').click(); true', true);
    await wait(700);
  }

  if (all || want === 'probe-form') {
    await win.webContents.executeJavaScript('document.getElementById("btn-probe").click(); true', true);
    await wait(350);
    await capture('probe-form');
    await win.webContents.executeJavaScript('document.getElementById("probe-close").click(); true', true);
    await wait(280);
  }

  if (all || want === 'probe-min') {
    await win.webContents.executeJavaScript('document.activeElement && document.activeElement.blur(); true', true);
    win.setSize(980, 640);
    await wait(400);
    await win.webContents.executeJavaScript('document.getElementById("btn-probe").click(); true', true);
    await wait(320);
    await capture('probe-min');
    await win.webContents.executeJavaScript('document.getElementById("probe-close").click(); true', true);
    await wait(280);
    win.setSize(1180, 760);
    await wait(350);
  }

  if (want === 'probe-live') {
    await win.webContents.executeJavaScript('document.getElementById("btn-probe").click(); true', true);
    await wait(300);
    await win.webContents.executeJavaScript(
      '(function () { const input = document.getElementById("probe-input"); input.value = "example.com"; input.dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("probe-start").click(); return true; })()',
      true);
    for (let i = 0; i < 60; i++) {
      const running = await win.webContents.executeJavaScript(
        'document.getElementById("probe-title").textContent === "Ищу обход"', true).catch(() => false);
      if (!running) break;
      await wait(250);
    }
    await wait(350);
    await capture('probe-live');
    await win.webContents.executeJavaScript(
      '(function () { const cancel = document.getElementById("probe-cancel"); if (cancel && !cancel.hidden) cancel.click(); return true; })()',
      true);
    await wait(1200);
    await win.webContents.executeJavaScript(
      '(function () { const close = document.getElementById("probe-close"); if (close && !close.disabled) close.click(); return true; })()',
      true);
    await wait(400);
  }

  if (want === 'probe-dns') {
    await win.webContents.executeJavaScript('document.getElementById("btn-probe").click(); true', true);
    await wait(300);
    await win.webContents.executeJavaScript(
      '(function () { const input = document.getElementById("probe-input"); input.value = "no-such-host-zzz-12345.invalid"; input.dispatchEvent(new Event("input", { bubbles: true })); return true; })()',
      true);
    await wait(1400);
    await capture('probe-dns');
  }

  if (want === 'probe-cancel') {
    await win.webContents.executeJavaScript('document.getElementById("btn-probe").click(); true', true);
    await wait(300);
    await win.webContents.executeJavaScript(
      '(function () { const input = document.getElementById("probe-input"); input.value = "example.com"; input.dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("probe-mode-all").click(); document.getElementById("probe-start").click(); return true; })()',
      true);
    await wait(1800);
    await capture('probe-run');
    await win.webContents.executeJavaScript('document.getElementById("probe-cancel").click(); true', true);
    for (let i = 0; i < 60; i++) {
      const running = await win.webContents.executeJavaScript(
        'document.getElementById("probe-title").textContent === "Ищу обход"', true).catch(() => false);
      if (!running) break;
      await wait(250);
    }
    await wait(300);
    await capture('probe-cancel');
    await win.webContents.executeJavaScript(
      '(function () { const close = document.getElementById("probe-close"); if (close && !close.disabled) close.click(); return true; })()',
      true);
    await wait(400);
  }

  if (all || want === 'probe') {
    if (testing) {
      testing = null;
      await pushState();
      await wait(250);
    }
    await wait(350);
    probe = backend && typeof backend.seedProbe === 'function' ? backend.seedProbe() : null;
    setOperation(null, '');
    await pushState();
    await wait(300);
    await win.webContents.executeJavaScript('document.getElementById("btn-probe").click(); true', true);
    await wait(350);
    await capture('probe');
  }

  await wait(100);
  quitApp();
}

async function syncAutostart() {
  if (MOCK || !app.isPackaged) return;
  try {
    const enabled = await autostart.isEnabled();
    const wanted = Boolean(config.get('autostart'));
    if (wanted && !enabled) {
      logger.write('Автозапуск: задачи нет, создаю');
      const res = await autostart.enable(DATA_DIR, process.execPath, logger);
      if (!res.ok) logger.write('Автозапуск: ' + res.error);
      return;
    }
    if (!wanted && enabled) {
      await autostart.disable(logger);
      return;
    }
    if (wanted && enabled && typeof autostart.matches === 'function') {
      const match = await autostart.matches(process.execPath);
      if (!match) {
        logger.write('Автозапуск: путь задачи устарел, пересоздаю');
        const res = await autostart.enable(DATA_DIR, process.execPath, logger);
        if (!res.ok) logger.write('Автозапуск: ' + res.error);
      }
    }
  } catch (err) {
    logger.write('Автозапуск: ' + (err && err.stack ? err.stack : err));
  }
}

function maybeServiceNotice() {
  if (MOCK || !config || !config.get) return;
  if (config.get('serviceNoticeShown')) return;
  config.set('serviceNoticeShown', true);
  config.save();
  const message = 'Служба zapret остановлена и переведена в ручной режим, чтобы не конфликтовать с winws. Вернуть её можно через service.bat → Install Service.';
  try {
    if (START_HIDDEN && tray) {
      tray.displayBalloon({ title: 'Zapret Mini', content: message, iconType: 'info' });
    } else if (win && !win.isDestroyed()) {
      dialog.showMessageBox(win, { type: 'info', title: 'Zapret Mini', message, buttons: ['OK'] });
    }
  } catch { /* ignore */ }
}

function start() {
  setupConfig();
  process.on('uncaughtException', (err) => {
    if (logger) logger.write('uncaughtException: ' + (err && err.stack ? err.stack : err));
  });
  process.on('unhandledRejection', (err) => {
    if (logger) logger.write('unhandledRejection: ' + (err && err.stack ? err.stack : err));
  });
  app.whenReady().then(async () => {
    if (logger) logger.write('app ready');
    Menu.setApplicationMenu(null);
    await setupBackend();
    if (logger) logger.write('backend ready');
    setupIpc();
    createWindow();
    if (logger) logger.write('window created');
    createTray();
    if (logger) logger.write('tray created');
    if (!MOCK && !SCREENSHOT) {
      syncAutostart();
      maybeServiceNotice();
      ensureUninstallEntry();
    }
    startRefreshLoop();
    setTimeout(() => { pushState(); }, 600);
    if (!MOCK && !SCREENSHOT) {
      setTimeout(async () => {
        try {
          const installed = await offerZapretInstallOnStartup();
          if (!installed) await startupApply();
        } catch (err) {
          logger.write('Старт: ' + (err && err.stack ? err.stack : err));
          await startupApply();
        }
        setTimeout(() => { autoCheckUpdates(); }, 3000);
      }, 900);
    }

    if (SCREENSHOT) {
      setTimeout(() => {
        if (logger) logger.write('screenshots start');
        captureShots().catch((err) => {
          if (logger) logger.write('Скриншоты: ' + (err && err.stack ? err.stack : err));
          quitApp();
        });
      }, 900);
    }
  }).catch((err) => {
    if (logger) logger.write('whenReady: ' + (err && err.stack ? err.stack : err));
    app.quit();
  });
}

if (MOCK) {
  start();
} else {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      showWindow();
    });
    start();
  }
}

app.on('before-quit', () => {
  isQuitting = true;
  if (refreshTimer) clearInterval(refreshTimer);
});

app.on('window-all-closed', () => {
  if (isQuitting || SCREENSHOT) {
    app.quit();
    return;
  }
  if (!config || !config.get) return;
  if (!config.get('minimizeToTray')) app.quit();
});

app.on('quit', () => {
  if (tray) {
    try { tray.destroy(); } catch { /* ignore */ }
    tray = null;
  }
});
