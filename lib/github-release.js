'use strict';

const https = require('https');

const USER_AGENT = 'ZapretMini-Updater';
const MAX_REDIRECTS = 5;
const MAX_BYTES = 5 * 1024 * 1024;

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

async function latest(repo) {
  const slug = String(repo || '').replace(/^\/+|\/+$/g, '');
  if (!slug) throw new Error('Repository is not specified');
  const page = await getText('https://github.com/' + slug + '/releases/latest');
  const tag = parseTag(page.url, page.text);
  if (!tag) throw new Error('Release tag not found');
  let assetsHtml = '';
  try {
    const expanded = await getText('https://github.com/' + slug + '/releases/expanded_assets/' + encodeURIComponent(tag));
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

module.exports = {
  getText,
  decodeHtml,
  parseTag,
  parseAssets,
  latest
};
