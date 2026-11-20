'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_HOSTLISTS = ['list-general.txt', 'list-google.txt'];
const DEFAULT_IPSET = 'ipset-all.txt';

function stamp() {
  const d = new Date();
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '-' + p(d.getMilliseconds(), 3);
}

function readText(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const bom = raw.charCodeAt(0) === 0xFEFF;
  return { text: bom ? raw.slice(1) : raw, bom, eol: raw.includes('\r\n') ? '\r\n' : '\n' };
}

function writeAtomic(file, text, bom) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, (bom ? '\uFEFF' : '') + text, 'utf8');
  try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
  fs.renameSync(tmp, file);
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  const target = file + '.bak-zapretmini-' + stamp();
  fs.copyFileSync(file, target);
  return target;
}

function stripLine(line) {
  return String(line || '').replace(/^\uFEFF/, '').trim();
}

function isHeader(line) {
  return /^###\s+/.test(stripLine(line));
}

function addTargetGroup(file, group, key, url) {
  const name = String(group || '').trim();
  const targetKey = String(key || '').trim();
  const targetUrl = String(url || '').trim();
  if (!name || !targetKey || !targetUrl) return { ok: false, error: 'Пустые параметры цели' };
  if (!/^[A-Za-z0-9_]+$/.test(targetKey)) return { ok: false, error: 'Некорректное имя цели' };

  const read = readText(file);
  const lines = read.text.split(/\r?\n/);
  const entry = targetKey + ' = "' + targetUrl + '"';
  const headerIndex = lines.findIndex((line) => stripLine(line) === '### ' + name);
  const exists = lines.some((line) => stripLine(line).toLowerCase().startsWith(targetKey.toLowerCase() + ' =')) ||
    lines.some((line) => stripLine(line).toLowerCase() === entry.toLowerCase());
  if (exists) return { ok: true, added: false, reason: 'exists' };

  const out = lines.slice();
  if (headerIndex >= 0) {
    let end = out.length;
    for (let i = headerIndex + 1; i < out.length; i++) {
      if (isHeader(out[i])) { end = i; break; }
    }
    let at = end;
    while (at > headerIndex + 1 && !stripLine(out[at - 1])) at--;
    out.splice(at, 0, entry);
    if (at + 1 < out.length && isHeader(out[at + 1]) && stripLine(out[at])) out.splice(at + 1, 0, '');
  } else {
    if (out.length && stripLine(out[out.length - 1]) === '' && out.length > 1 && stripLine(out[out.length - 2]) === '') {
      out.pop();
    }
    if (out.length && stripLine(out[out.length - 1]) !== '') out.push('');
    out.push('### ' + name);
    out.push(entry);
    out.push('');
  }

  const text = out.join(read.eol).replace(new RegExp('(?:' + read.eol + ')+$'), read.eol);
  const bak = backup(file);
  writeAtomic(file, text, read.bom);
  return { ok: true, added: true, backup: bak, entry };
}

function removeTargetGroup(file, group) {
  const name = String(group || '').trim();
  if (!name) return { ok: false, error: 'Не указана группа' };
  const read = readText(file);
  const lines = read.text.split(/\r?\n/);
  const start = lines.findIndex((line) => stripLine(line) === '### ' + name);
  if (start < 0) return { ok: true, removed: false };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isHeader(lines[i])) { end = i; break; }
  }
  const out = lines.slice(0, start).concat(lines.slice(end));
  while (out.length > 1 && stripLine(out[out.length - 1]) === '' && stripLine(out[out.length - 2]) === '') out.pop();
  const text = out.join(read.eol).replace(new RegExp('(?:' + read.eol + ')+$'), read.eol);
  const bak = backup(file);
  writeAtomic(file, text, read.bom);
  return { ok: true, removed: true, backup: bak };
}

function normalizeHostname(value) {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '');
}

function hostnamesForDomain(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return [];
  const base = host.replace(/^www\./, '');
  const set = new Set([base, host]);
  set.add('www.' + base);
  return Array.from(set).filter(Boolean);
}

function isHostname(value) {
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(String(value || ''));
}

function addHostnames(file, hostnames) {
  const wanted = Array.from(new Set((hostnames || []).map(normalizeHostname).filter(isHostname)));
  if (!wanted.length) return { ok: true, added: [] };
  const read = readText(file);
  const lines = read.text.split(/\r?\n/);
  const existing = new Set(lines.map((line) => stripLine(line).toLowerCase()).filter(Boolean));
  const added = [];
  for (const host of wanted) {
    if (existing.has(host)) continue;
    lines.push(host);
    existing.add(host);
    added.push(host);
  }
  if (!added.length) return { ok: true, added: [] };
  while (lines.length > 1 && stripLine(lines[lines.length - 1]) === '' && stripLine(lines[lines.length - 2]) === '') lines.pop();
  const text = lines.join(read.eol).replace(new RegExp('(?:' + read.eol + ')+$'), read.eol);
  const bak = backup(file);
  writeAtomic(file, text, read.bom);
  return { ok: true, added, backup: bak };
}

function removeHostnames(file, hostnames) {
  const wanted = new Set((hostnames || []).map(normalizeHostname).filter(isHostname));
  if (!wanted.size) return { ok: true, removed: 0 };
  const read = readText(file);
  const lines = read.text.split(/\r?\n/);
  const out = [];
  let removed = 0;
  for (const line of lines) {
    const clean = stripLine(line).toLowerCase();
    if (clean && !clean.startsWith('#') && wanted.has(clean)) {
      removed++;
      continue;
    }
    out.push(line);
  }
  if (!removed) return { ok: true, removed: 0 };
  const text = out.join(read.eol).replace(new RegExp('(?:' + read.eol + ')+$'), read.eol);
  const bak = backup(file);
  writeAtomic(file, text, read.bom);
  return { ok: true, removed, backup: bak };
}

function ipv4ToInt(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    result = (result << 8) + n;
  }
  return result >>> 0;
}

function ipInCidr(ip, cidr) {
  const [base, bitsText] = String(cidr || '').split('/');
  const bits = bitsText == null ? 32 : Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (a == null || b == null) return false;
  if (bits === 0) return true;
  const mask = (0xFFFFFFFF << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

function removeHostsEntries(file, hostnames) {
  const wanted = Array.from(new Set((hostnames || []).map(normalizeHostname).filter(Boolean)));
  if (!wanted.length || !fs.existsSync(file)) return { ok: true, removed: 0 };
  const read = readText(file);
  const lines = read.text.split(/\r?\n/);
  const out = [];
  let removed = 0;
  for (const line of lines) {
    const clean = stripLine(line);
    if (!clean || clean.startsWith('#')) {
      out.push(line);
      continue;
    }
    const parts = clean.split(/\s+/);
    if (parts.length < 2) {
      out.push(line);
      continue;
    }
    const host = parts.slice(1).join(' ').trim().toLowerCase();
    if (wanted.some((name) => host === name || host.endsWith('.' + name))) {
      removed++;
      continue;
    }
    out.push(line);
  }
  if (!removed) return { ok: true, removed: 0 };
  const bak = backup(file);
  writeAtomic(file, out.join(read.eol).replace(new RegExp('(?:' + read.eol + ')+$'), read.eol), read.bom);
  return { ok: true, removed, backup: bak };
}

function checkDefaultCoverage(dir, hostname, ip) {
  const host = normalizeHostname(hostname);
  const listsDir = path.join(dir, 'lists');
  for (const name of DEFAULT_HOSTLISTS) {
    const file = path.join(listsDir, name);
    try {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      for (const raw of lines) {
        const entry = stripLine(raw).toLowerCase().split(/\s+/)[0];
        if (!entry || entry.startsWith('#')) continue;
        if (host === entry || host.endsWith('.' + entry)) {
          return { builtin: true, source: name, entry };
        }
      }
    } catch { /* ignore */ }
  }
  if (ip) {
    const file = path.join(listsDir, DEFAULT_IPSET);
    try {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      for (const raw of lines) {
        const entry = stripLine(raw).split(/\s+/)[0];
        if (!entry || entry.startsWith('#')) continue;
        if (ipInCidr(ip, entry)) return { builtin: true, source: DEFAULT_IPSET, entry };
      }
    } catch { /* ignore */ }
  }
  return { builtin: false, source: null, entry: null };
}

function targetKeyForDomain(hostname, existingText) {
  const base = normalizeHostname(hostname).replace(/^www\./, '');
  let key = 'Site_' + base.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  if (!key || key === 'Site_') key = 'Site_domain';
  key = key.slice(0, 56);
  const text = String(existingText || '');
  const taken = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = stripLine(line).match(/^([A-Za-z0-9_]+)\s*=/);
    if (match) taken.add(match[1].toLowerCase());
  }
  let candidate = key;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = key + '_' + n;
    n++;
  }
  return candidate;
}

function slug(value) {
  return String(value || '').toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
}

function loadManifest(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!raw || !Array.isArray(raw.sites)) return null;
    return raw;
  } catch {
    return null;
  }
}

function saveManifest(file, sites) {
  const data = { version: 1, sites: Array.isArray(sites) ? sites : [] };
  writeAtomic(file, JSON.stringify(data, null, 2) + '\n', false);
  return data;
}

module.exports = {
  DEFAULT_HOSTLISTS,
  DEFAULT_IPSET,
  readText,
  writeAtomic,
  backup,
  addTargetGroup,
  removeTargetGroup,
  addHostnames,
  removeHostnames,
  normalizeHostname,
  hostnamesForDomain,
  removeHostsEntries,
  checkDefaultCoverage,
  targetKeyForDomain,
  slug,
  loadManifest,
  saveManifest
};
