'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO = 'Flowseal/zapret-discord-youtube';
const SYSTEM32 = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32');
const { download } = require('./updater');
const githubRelease = require('./github-release');

function parseVersion(value) {
  const text = String(value == null ? '' : value).trim().replace(/^v/i, '').toLowerCase();
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)([a-z]*)/);
  if (!match) return null;
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], suffix: match[4] || '', text };
}

function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return Boolean(a && !b);
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i];
  }
  if (!a.suffix && b.suffix) return true;
  if (a.suffix && !b.suffix) return false;
  return a.suffix > b.suffix;
}

function localVersion(dir) {
  if (!dir) return '';
  try {
    const versionFile = path.join(dir, '.service', 'version.txt');
    if (fs.existsSync(versionFile)) {
      const value = fs.readFileSync(versionFile, 'utf8').trim();
      if (value) return value;
    }
  } catch { /* ignore */ }
  try {
    const service = fs.readFileSync(path.join(dir, 'service.bat'), 'utf8');
    const match = service.match(/LOCAL_VERSION=([0-9A-Za-z.]+)/);
    if (match) return match[1];
  } catch { /* ignore */ }
  return '';
}

async function checkBatsLatestApi() {
  const https = require('https');
  const get = (url, redirects) => new Promise((resolve, reject) => {
    const left = redirects == null ? 5 : redirects;
    const req = https.get(url, {
      headers: { 'User-Agent': 'ZapretMini-Updater', 'Accept': 'application/vnd.github+json' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString(), left - 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('GitHub вернул HTTP ' + res.statusCode)); return; }
      let text = '';
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { req.destroy(); reject(new Error('Ответ GitHub слишком большой')); return; }
        text += chunk;
      });
      res.on('end', () => resolve(text));
    });
    req.setTimeout(20000, () => req.destroy(new Error('Таймаут GitHub')));
    req.on('error', reject);
  });
  const text = await get('https://api.github.com/repos/' + REPO + '/releases/latest');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Некорректный ответ GitHub'); }
  const latest = String(data.tag_name || data.name || '').replace(/^v/i, '');
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const zip = assets.find((asset) => /\.zip$/i.test(asset.name || ''));
  if (!latest) throw new Error('В релизе нет номера версии');
  if (!zip) throw new Error('В релизе нет ZIP-архива');
  return {
    ok: true,
    latest,
    notes: String(data.body || '').trim(),
    htmlUrl: data.html_url || ('https://github.com/' + REPO + '/releases'),
    zip: { name: zip.name, url: zip.browser_download_url, size: Number(zip.size) || 0 }
  };
}

async function checkBatsLatestHtml() {
  const release = await githubRelease.latest(REPO);
  const zip = release.assets.find((asset) => /\.zip$/i.test(asset.name));
  if (!zip) throw new Error('В релизе Flowseal нет ZIP-сборки');
  return {
    ok: true,
    latest: release.tag.replace(/^v/i, ''),
    notes: '',
    htmlUrl: release.htmlUrl,
    zip: { name: zip.name, url: zip.url, size: zip.size || 0 }
  };
}

async function checkBatsLatest() {
  try {
    return await checkBatsLatestHtml();
  } catch (htmlErr) {
    try {
      return await checkBatsLatestApi();
    } catch (apiErr) {
      const reason = (apiErr && apiErr.message) || (htmlErr && htmlErr.message) || 'неизвестная ошибка';
      throw new Error('Не удалось получить сборку zapret с GitHub: ' + reason +
        '. Скачай вручную: https://github.com/Flowseal/zapret-discord-youtube/releases');
    }
  }
}

async function downloadZip(info, destination, onProgress) {
  if (!info || !info.zip || !info.zip.url) throw new Error('Нет ссылки на ZIP zapret');
  await download(info.zip.url, destination, onProgress);
  return destination;
}

function extractZip(zipPath, destination) {
  return new Promise((resolve, reject) => {
    try {
      fs.mkdirSync(destination, { recursive: true });
      const ps = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const script = 'Expand-Archive -LiteralPath ' + psQuote(zipPath) +
        ' -DestinationPath ' + psQuote(destination) + ' -Force';
      const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let output = '';
      child.stdout.on('data', (b) => { output += b.toString(); });
      child.stderr.on('data', (b) => { output += b.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve(destination);
        else reject(new Error('Не удалось распаковать zapret: ' + (output.trim() || ('код ' + code))));
      });
    } catch (err) {
      reject(err);
    }
  });
}

function psQuote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function findRoot(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory());
  if (dirs.length === 1 && entries.length === 1) return path.join(dir, dirs[0].name);
  return dir;
}

function parseGroupedTargets(text) {
  const groups = new Map();
  let current = 'Прочее';
  for (const line of String(text || '').split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean) continue;
    const header = clean.match(/^###\s*(.+?)\s*$/);
    if (header) { current = header[1].trim(); if (!groups.has(current)) groups.set(current, []); continue; }
    if (clean.startsWith('#')) continue;
    if (!groups.has(current)) groups.set(current, []);
    groups.get(current).push(clean);
  }
  return groups;
}

function mergeTargets(localText, newText) {
  const local = parseGroupedTargets(localText);
  const next = parseGroupedTargets(newText);
  const out = String(newText || '').split(/\r?\n/);
  const newKeys = new Set();
  for (const lines of next.values()) {
    for (const line of lines) {
      const key = line.match(/^([A-Za-z0-9_]+)\s*=/);
      if (key) newKeys.add(key[1].toLowerCase());
    }
  }
  for (const [group, lines] of local) {
    const additions = lines.filter((line) => {
      const key = line.match(/^([A-Za-z0-9_]+)\s*=/);
      return !key || !newKeys.has(key[1].toLowerCase());
    });
    if (!additions.length) continue;
    if (!next.has(group)) {
      if (out.length && out[out.length - 1].trim() !== '') out.push('');
      out.push('### ' + group);
      out.push(...additions);
      out.push('');
      continue;
    }
    let start = out.findIndex((line) => line.trim() === '### ' + group);
    if (start < 0) continue;
    let end = out.length;
    for (let i = start + 1; i < out.length; i++) {
      if (/^###\s+/.test(out[i].trim())) { end = i; break; }
    }
    let at = end;
    while (at > start + 1 && !out[at - 1].trim()) at--;
    out.splice(at, 0, ...additions);
    for (const line of additions) {
      const key = line.match(/^([A-Za-z0-9_]+)\s*=/);
      if (key) newKeys.add(key[1].toLowerCase());
    }
  }
  return out.join('\r\n').replace(/(?:\r\n)+$/, '\r\n');
}

function mergeHostlist(localText, newText) {
  const existing = new Set();
  const out = String(newText || '').split(/\r?\n/);
  for (const line of out) {
    const clean = line.trim().toLowerCase();
    if (clean && !clean.startsWith('#')) existing.add(clean);
  }
  for (const line of String(localText || '').split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) continue;
    if (existing.has(clean.toLowerCase())) continue;
    out.push(clean);
    existing.add(clean.toLowerCase());
  }
  return out.join('\r\n').replace(/(?:\r\n)+$/, '\r\n');
}

function prepareStaging(extractedRoot, localDir, stagingDir) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.cpSync(extractedRoot, stagingDir, { recursive: true });
  const mergeFile = (rel, merger) => {
    const local = path.join(localDir, rel);
    const next = path.join(stagingDir, rel);
    if (!fs.existsSync(local)) return;
    if (!fs.existsSync(next)) {
      fs.mkdirSync(path.dirname(next), { recursive: true });
      fs.copyFileSync(local, next);
      return;
    }
    const localText = fs.readFileSync(local, 'utf8');
    const newText = fs.readFileSync(next, 'utf8');
    fs.writeFileSync(next, merger(localText, newText), 'utf8');
  };
  mergeFile(path.join('utils', 'targets.txt'), mergeTargets);
  for (const name of ['list-general-user.txt', 'list-exclude-user.txt', 'ipset-exclude-user.txt']) {
    mergeFile(path.join('lists', name), mergeHostlist);
  }
  try {
    const localBats = fs.readdirSync(localDir).filter((name) => /\.bat$/i.test(name));
    for (const name of localBats) {
      const target = path.join(stagingDir, name);
      if (!fs.existsSync(target)) fs.copyFileSync(path.join(localDir, name), target);
    }
  } catch { /* ignore */ }
  return stagingDir;
}

function ensureUserLists(dir) {
  const lists = path.join(dir, 'lists');
  const defaults = {
    'ipset-exclude-user.txt': '203.0.113.113/32\r\n',
    'list-general-user.txt': '# Never leave this file empty\r\ndomain.example.abc\r\n',
    'list-exclude-user.txt': 'domain.example.abc\r\n'
  };
  fs.mkdirSync(lists, { recursive: true });
  const created = [];
  for (const [name, content] of Object.entries(defaults)) {
    const file = path.join(lists, name);
    let missing = false;
    try {
      missing = !fs.existsSync(file) || fs.statSync(file).size === 0;
    } catch {
      missing = true;
    }
    if (!missing) continue;
    fs.writeFileSync(file, content, 'utf8');
    created.push(name);
  }
  return created;
}

function validateFresh(dir) {
  if (!dir || !fs.existsSync(dir)) throw new Error('Папка zapret не найдена');
  if (!fs.existsSync(path.join(dir, 'bin', 'winws.exe'))) throw new Error('В сборке нет bin\\winws.exe');
  if (!fs.existsSync(path.join(dir, 'service.bat'))) throw new Error('В сборке нет service.bat');
  const bats = fs.readdirSync(dir).filter((name) => /\.bat$/i.test(name) && !/^service/i.test(name));
  if (!bats.length) throw new Error('В сборке нет батников');
  return bats;
}

function installFromDirectory(sourceDir, destination) {
  const bats = validateFresh(sourceDir);
  const dest = path.resolve(destination);
  if (!dest || dest.length < 8 || /^[A-Za-z]:\\?$/.test(dest)) {
    throw new Error('Некорректная папка установки');
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const backup = dest + '.old-' + Date.now();
  let moved = false;
  try {
    if (fs.existsSync(dest)) {
      try { fs.rmSync(backup, { recursive: true, force: true }); } catch { /* ignore */ }
      fs.renameSync(dest, backup);
      moved = true;
    }
    fs.cpSync(sourceDir, dest, { recursive: true });
    if (moved) {
      try { fs.rmSync(backup, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  } catch (err) {
    if (moved && !fs.existsSync(dest)) {
      try { fs.renameSync(backup, dest); } catch { /* ignore */ }
    }
    throw err;
  }
  ensureUserLists(dest);
  validateFresh(dest);
  return { dir: dest, version: localVersion(dest), bats };
}

async function downloadAndPrepareLatest(tempBase, onProgress) {
  const info = await checkBatsLatest();
  fs.rmSync(tempBase, { recursive: true, force: true });
  fs.mkdirSync(tempBase, { recursive: true });
  const zipPath = path.join(tempBase, info.zip.name);
  await downloadZip(info, zipPath, onProgress);
  const extractDir = path.join(tempBase, 'extracted');
  await extractZip(zipPath, extractDir);
  const root = findRoot(extractDir);
  validateFresh(root);
  return { info, root, zipPath, extractDir };
}

module.exports = {
  REPO,
  parseVersion,
  isNewer,
  localVersion,
  checkBatsLatest,
  checkBatsLatestHtml,
  checkBatsLatestApi,
  downloadZip,
  extractZip,
  findRoot,
  mergeTargets,
  mergeHostlist,
  prepareStaging,
  ensureUserLists,
  validateFresh,
  installFromDirectory,
  downloadAndPrepareLatest
};
