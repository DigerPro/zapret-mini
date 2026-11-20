'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const githubRelease = require('./github-release');

const REPO = 'DigerPro/zapret-mini';
const USER_AGENT = 'ZapretMini-Updater';
const SYSTEM32 = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32');
let cacheFile = '';

function setCacheFile(file) {
  cacheFile = file || '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseVersion(value) {
  const text = String(value == null ? '' : value).trim().replace(/^v/i, '');
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function selectAssets(release) {
  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  const zip = assets.find((asset) => /^ZapretMini-.*-win-x64\.zip$/i.test(asset.name || ''));
  const sha = zip ? assets.find((asset) => asset.name === zip.name + '.sha256') : null;
  return { zip: zip || null, sha: sha || null };
}

function request(url, redirects) {
  return new Promise((resolve, reject) => {
    const left = redirects == null ? 5 : redirects;
    let req = null;
    try {
      req = https.get(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/vnd.github+json'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
          res.resume();
          resolve(request(new URL(res.headers.location, url).toString(), left - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error('GitHub вернул HTTP ' + res.statusCode));
          return;
        }
        resolve(res);
      });
      req.setTimeout(20000, () => req.destroy(new Error('Таймаут GitHub')));
      req.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

async function readLimited(res, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of res) {
    size += chunk.length;
    if (size > limit) throw new Error('Ответ GitHub слишком большой');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function getJson(url) {
  const res = await request(url);
  const text = await readLimited(res, 2 * 1024 * 1024);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Некорректный ответ GitHub');
  }
}

async function getText(url, limit) {
  const res = await request(url);
  return readLimited(res, limit || 64 * 1024);
}

async function checkLatestApi(currentVersion, repo) {
  const slug = repo || REPO;
  const data = await getJson('https://api.github.com/repos/' + slug + '/releases/latest');
  const latest = String(data.tag_name || data.name || '').replace(/^v/i, '');
  const assets = selectAssets(data);
  if (!latest) return { ok: false, error: 'В релизе нет номера версии' };
  if (!assets.zip) return { ok: false, error: 'В релизе нет ZapretMini-*-win-x64.zip' };
  if (!assets.sha) return { ok: false, error: 'В релизе нет SHA256 для архива' };
  const result = {
    ok: true,
    repo: slug,
    latest,
    current: currentVersion,
    update: isNewer(latest, currentVersion),
    notes: String(data.body || '').trim(),
    htmlUrl: data.html_url || ('https://github.com/' + slug + '/releases'),
    zip: {
      name: assets.zip.name,
      url: assets.zip.browser_download_url,
      size: Number(assets.zip.size) || 0
    },
    sha: {
      name: assets.sha.name,
      url: assets.sha.browser_download_url
    }
  };
  if (cacheFile) {
    githubRelease.writeCache(cacheFile, slug, {
      tag: 'v' + latest,
      htmlUrl: result.htmlUrl,
      assets: [
        { name: result.zip.name, url: result.zip.url, size: result.zip.size },
        { name: result.sha.name, url: result.sha.url, size: 0 }
      ]
    });
  }
  return result;
}

async function checkLatestHtml(currentVersion, repo) {
  const slug = repo || REPO;
  const release = await githubRelease.latestCached(slug, cacheFile, slug);
  const latest = String(release.tag || '').replace(/^v/i, '');
  const zip = release.assets.find((asset) => /^ZapretMini-.*-win-x64\.zip$/i.test(asset.name));
  const sha = zip ? release.assets.find((asset) => asset.name === zip.name + '.sha256') : null;
  if (!latest) return { ok: false, error: 'В релизе нет номера версии' };
  if (!zip) return { ok: false, error: 'В релизе нет ZapretMini-*-win-x64.zip' };
  if (!sha) return { ok: false, error: 'В релизе нет SHA256 для архива' };
  return {
    ok: true,
    repo: slug,
    latest,
    current: currentVersion,
    update: isNewer(latest, currentVersion),
    notes: '',
    htmlUrl: release.htmlUrl,
    zip: { name: zip.name, url: zip.url, size: zip.size || 0 },
    sha: { name: sha.name, url: sha.url }
  };
}

async function checkLatest(currentVersion, repo) {
  const slug = repo || REPO;
  try {
    return await checkLatestHtml(currentVersion, slug);
  } catch (htmlErr) {
    try {
      return await checkLatestApi(currentVersion, slug);
    } catch (apiErr) {
      return { ok: false, error: (htmlErr && htmlErr.message) || (apiErr && apiErr.message) || 'Ошибка сети' };
    }
  }
}

function download(url, destination, onProgress) {
  return new Promise((resolve, reject) => {
    let req = null;
    let file = null;
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (file) { try { file.close(); } catch { /* ignore */ } }
      if (err) {
        try { fs.rmSync(destination, { force: true }); } catch { /* ignore */ }
        reject(err);
      } else {
        resolve(destination);
      }
    };
    try {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      file = fs.createWriteStream(destination);
      req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          settled = true;
          try { file.close(); } catch { /* ignore */ }
          file = null;
          download(new URL(res.headers.location, url).toString(), destination, onProgress)
            .then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          finish(new Error('Скачивание: HTTP ' + res.statusCode));
          return;
        }
        const total = Number(res.headers['content-length']) || 0;
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress) {
            try { onProgress(received, total); } catch { /* ignore */ }
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => finish(null));
        });
        file.on('error', finish);
        res.on('error', finish);
      });
      req.setTimeout(180000, () => req.destroy(new Error('Таймаут скачивания')));
      req.on('error', finish);
    } catch (err) {
      finish(err);
    }
  });
}

async function downloadWithRetry(url, destination, onProgress, attempts) {
  const max = attempts || 3;
  let last = null;
  for (let i = 0; i < max; i++) {
    try {
      return await download(url, destination, onProgress);
    } catch (err) {
      last = err;
      if (i < max - 1) await sleep(1200 * (i + 1));
    }
  }
  throw last || new Error('Скачивание не удалось');
}

async function getTextWithRetry(url, limit, attempts) {
  const max = attempts || 3;
  let last = null;
  for (let i = 0; i < max; i++) {
    try {
      return await getText(url, limit);
    } catch (err) {
      last = err;
      if (i < max - 1) await sleep(800 * (i + 1));
    }
  }
  throw last || new Error('Не удалось прочитать ответ GitHub');
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
  });
}

async function downloadUpdate(release, tempDir, onProgress) {
  if (!release || !release.zip || !release.sha) throw new Error('Нет данных обновления');
  const dir = tempDir || path.join(process.env.TEMP || '.', 'ZapretMini-update');
  const zipPath = path.join(dir, release.zip.name);
  try { fs.rmSync(zipPath, { force: true }); } catch { /* ignore */ }
  await downloadWithRetry(release.zip.url, zipPath, onProgress);
  const shaText = await getTextWithRetry(release.sha.url, 128 * 1024);
  const expected = String(shaText).trim().split(/\s+/)[0].toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Некорректный SHA256 в релизе');
  const actual = await sha256File(zipPath);
  if (actual !== expected) throw new Error('SHA256 не совпал — обновление отменено');
  return { zipPath, sha256: actual };
}

function helperScript() {
  return [
    'param([int]$ParentPid,[string]$Zip,[string]$AppDir,[string]$Exe)',
    '$ErrorActionPreference = "Stop"',
    'for ($i = 0; $i -lt 180; $i++) {',
    '  if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }',
    '  Start-Sleep -Milliseconds 500',
    '}',
    'Start-Sleep -Milliseconds 700',
    '$old = $AppDir + ".old"',
    'try {',
    '  if (Test-Path $old) { Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue }',
    '  if (Test-Path $AppDir) { Rename-Item $AppDir $old -ErrorAction Stop }',
    '  New-Item -ItemType Directory -Force -Path $AppDir | Out-Null',
    '  Expand-Archive -Path $Zip -DestinationPath $AppDir -Force -ErrorAction Stop',
    '  Start-Process -FilePath $Exe',
    '  Start-Sleep -Seconds 2',
    '  Remove-Item $Zip -Force -ErrorAction SilentlyContinue',
    '  Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue',
    '} catch {',
    '  if ((Test-Path $AppDir) -and (Test-Path $old)) { Remove-Item $AppDir -Recurse -Force -ErrorAction SilentlyContinue }',
    '  if ((-not (Test-Path $AppDir)) -and (Test-Path $old)) { Rename-Item $old $AppDir -ErrorAction SilentlyContinue }',
    '  throw',
    '}'
  ].join('\r\n');
}

function installUpdate(zipPath, appDir, exePath, parentPid) {
  return new Promise((resolve, reject) => {
    try {
      if (!fs.existsSync(zipPath)) throw new Error('Архив обновления не найден');
      if (!appDir || !fs.existsSync(appDir)) throw new Error('Папка приложения не найдена');
      if (!exePath || !fs.existsSync(exePath)) throw new Error('ZapretMini.exe не найден');
      const dir = path.join(process.env.TEMP || '.', 'ZapretMini-update');
      fs.mkdirSync(dir, { recursive: true });
      const scriptPath = path.join(dir, 'apply-update.ps1');
      fs.writeFileSync(scriptPath, helperScript(), 'utf8');
      const child = spawn(path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath,
        '-ParentPid', String(parentPid || process.pid),
        '-Zip', zipPath,
        '-AppDir', appDir,
        '-Exe', exePath
      ], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.on('error', reject);
      child.unref();
      resolve({ ok: true, helperPid: child.pid });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  REPO,
  parseVersion,
  isNewer,
  selectAssets,
  setCacheFile,
  checkLatest,
  checkLatestHtml,
  download,
  downloadWithRetry,
  getTextWithRetry,
  downloadUpdate,
  installUpdate,
  sha256File
};
