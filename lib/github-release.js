'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const USER_AGENT = 'ZapretMini-Updater';
const MAX_REDIRECTS = 5;
const MAX_BYTES = 5 * 1024 * 1024;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getText(url, redirects) {
  const left = redirects == null ? MAX_REDIRECTS : redirects;
  return new Promise((resolve, reject) => {
    let req = null;
    try {
      req = https.get(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Encoding': 'identity'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
          res.resume();
          resolve(getText(new URL(res.headers.location, url).toString(), left - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error('GitHub returned HTTP ' + res.statusCode));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy(new Error('GitHub response is too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ url, text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      });
      req.setTimeout(20000, () => req.destroy(new Error('GitHub timeout')));
      req.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

async function getTextRetry(url, attempts) {
  const max = attempts || 3;
  let last = null;
  for (let i = 0; i < max; i++) {
    try {
      return await getText(url);
    } catch (err) {
      last = err;
      const message = String(err && err.message ? err.message : err);
      if (/HTTP (403|404)/i.test(message)) break;
      if (i < max - 1) await sleep(700 * (i + 1));
    }
  }
  throw last || new Error('GitHub request failed');
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseTag(url, html) {
  const fromUrl = String(url || '').match(/\/releases\/tag\/([^/?#]+)/);
  if (fromUrl) return decodeURIComponent(fromUrl[1]);
  const fromHtml = String(html || '').match(/\/releases\/tag\/([A-Za-z0-9._-]+)/);
  return fromHtml ? decodeURIComponent(fromHtml[1]) : '';
}

function parseAssets(html, repo) {
  const out = new Map();
  const text = String(html || '');
  const re = /href="([^"]+)"/gi;
  let match;
  while ((match = re.exec(text))) {
    const href = decodeHtml(match[1]);
    if (!/\/releases\/download\//i.test(href)) continue;
    if (repo && !href.includes('/' + repo + '/releases/download/')) continue;
    let absolute;
    try {
      absolute = href.startsWith('http') ? href : new URL(href, 'https://github.com').toString();
    } catch {
      continue;
    }
    let name = '';
    try {
      name = decodeURIComponent(new URL(absolute).pathname.split('/').pop() || '');
    } catch {
      continue;
    }
    if (!name) continue;
    out.set(name, { name, url: absolute, size: 0 });
  }
  return Array.from(out.values());
}

function readCache(file, key) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const item = raw && raw[key];
    if (!item || !item.tag || !Array.isArray(item.assets) || !item.assets.length) return null;
    const assets = item.assets
      .filter((asset) => asset && typeof asset.name === 'string' && typeof asset.url === 'string')
      .map((asset) => ({ name: asset.name, url: asset.url, size: Number(asset.size) || 0 }));
    if (!assets.length) return null;
    return { tag: String(item.tag), htmlUrl: String(item.htmlUrl || ''), assets, cached: true };
  } catch {
    return null;
  }
}

function writeCache(file, key, value) {
  if (!file || !key || !value || !value.tag || !Array.isArray(value.assets)) return false;
  try {
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) || {};
    } catch { /* ignore */ }
    raw[key] = {
      tag: value.tag,
      htmlUrl: value.htmlUrl || '',
      assets: value.assets,
      savedAt: Date.now()
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

async function latest(repo) {
  const slug = String(repo || '').replace(/^\/+|\/+$/g, '');
  if (!slug) throw new Error('Repository is not specified');
  const page = await getTextRetry('https://github.com/' + slug + '/releases/latest');
  const tag = parseTag(page.url, page.text);
  if (!tag) throw new Error('Release tag not found');
  let assetsHtml = '';
  try {
    const expanded = await getTextRetry('https://github.com/' + slug + '/releases/expanded_assets/' + encodeURIComponent(tag));
    assetsHtml = expanded.text;
  } catch {
    assetsHtml = page.text;
  }
  let assets = parseAssets(assetsHtml, slug);
  if (!assets.length) assets = parseAssets(page.text, slug);
  return {
    tag,
    htmlUrl: 'https://github.com/' + slug + '/releases/tag/' + encodeURIComponent(tag),
    assets
  };
}

async function latestCached(repo, cacheFile, cacheKey) {
  const key = cacheKey || repo;
  try {
    const release = await latest(repo);
    if (cacheFile) writeCache(cacheFile, key, release);
    return release;
  } catch (err) {
    if (cacheFile) {
      const cached = readCache(cacheFile, key);
      if (cached) return cached;
    }
    throw err;
  }
}

module.exports = {
  getText,
  getTextRetry,
  decodeHtml,
  parseTag,
  parseAssets,
  latest,
  latestCached,
  readCache,
  writeCache
};
