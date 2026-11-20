'use strict';

const QUICK_LIMIT = 6;
const FAMILIES = ['ОСНОВНЫЕ', 'FAKE TLS AUTO', 'SIMPLE FAKE'];
const DEFAULT_QUICK = [
  'general (ALT9).bat',
  'general (ALT4).bat',
  'general (FAKE TLS AUTO).bat',
  'general (SIMPLE FAKE).bat',
  'general (ALT).bat',
  'general (ALT2).bat'
];

function normalizeProbeInput(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return { error: 'Введи домен или ссылку' };
  if (raw.length > 2048) return { error: 'Слишком длинная ссылка' };

  let candidate = raw;
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme && !/^https?$/i.test(scheme[1])) {
    return { error: 'Поддерживаются только http и https' };
  }
  if (!scheme && /^(javascript|data|file|ftp|mailto|ws|wss):/i.test(raw)) {
    return { error: 'Поддерживаются только http и https' };
  }
  if (!scheme) candidate = 'https://' + raw;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { error: 'Не получается разобрать ссылку' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'Поддерживаются только http и https' };
  }
  if (url.username || url.password) {
    return { error: 'Убери логин и пароль из ссылки' };
  }
  if (!url.hostname) return { error: 'В ссылке нет домена' };
  url.hash = '';

  return {
    url: url.toString(),
    host: url.host,
    hostname: url.hostname,
    protocol: url.protocol
  };
}

function familyOf(name) {
  const full = String(name || '').replace(/\.bat$/i, '').toUpperCase();
  if (full.includes('SIMPLE FAKE')) return 'SIMPLE FAKE';
  if (full.includes('FAKE TLS AUTO')) return 'FAKE TLS AUTO';
  return 'ОСНОВНЫЕ';
}

function avgHttpMs(result) {
  const rows = (result && result.results) || [];
  let sum = 0;
  let count = 0;
  for (const row of rows) {
    if (row && row.ok && !row.ping && Number(row.ms) > 0) {
      sum += Number(row.ms);
      count++;
    }
  }
  return count ? sum / count : Number.MAX_SAFE_INTEGER;
}

function historyScore(result) {
  if (!result || !Number(result.httpTotal)) {
    return { tested: false, http: 0, ping: 0, ms: Number.MAX_SAFE_INTEGER };
  }
  return {
    tested: true,
    http: Number(result.httpOk || 0) / Number(result.httpTotal),
    ping: result.pingTotal ? Number(result.pingOk || 0) / Number(result.pingTotal) : 0,
    ms: avgHttpMs(result)
  };
}

function historyOrder(bats, results) {
  const byBat = new Map();
  for (const result of results || []) {
    if (result && result.bat) byBat.set(String(result.bat).toLowerCase(), result);
  }
  return bats.slice().sort((a, b) => {
    const sa = historyScore(byBat.get(a.toLowerCase()));
    const sb = historyScore(byBat.get(b.toLowerCase()));
    if (sa.tested !== sb.tested) return sa.tested ? -1 : 1;
    if (sb.http !== sa.http) return sb.http - sa.http;
    if (sb.ping !== sa.ping) return sb.ping - sa.ping;
    if (sa.ms !== sb.ms) return sa.ms - sb.ms;
    return 0;
  });
}

function quickCandidates(bats, results, current, limit) {
  const all = Array.from(new Set((bats || []).filter(Boolean)));
  if (!all.length) return [];
  const max = Math.max(1, Math.min(Number(limit) || QUICK_LIMIT, all.length));
  const picked = [];
  const add = (name) => {
    if (!name || picked.length >= max) return;
    if (!all.some((bat) => bat.toLowerCase() === name.toLowerCase())) return;
    if (picked.some((bat) => bat.toLowerCase() === name.toLowerCase())) return;
    picked.push(name);
  };

  add(current);

  const ranked = historyOrder(all, results);
  const history = new Map();
  for (const result of results || []) {
    if (result && result.bat) history.set(String(result.bat).toLowerCase(), result);
  }
  const hasHistory = ranked.some((name) => historyScore(history.get(name.toLowerCase())).tested);

  if (hasHistory) {
    for (const name of ranked.slice(0, 2)) add(name);
    for (const family of FAMILIES) {
      const best = ranked.find((name) => familyOf(name) === family);
      add(best);
    }
  }

  for (const wanted of DEFAULT_QUICK) {
    const actual = all.find((bat) => bat.toLowerCase() === wanted.toLowerCase());
    add(actual);
  }
  for (const name of ranked) add(name);
  for (const name of all) add(name);
  return picked.slice(0, max);
}

function statusRank(status) {
  const text = String(status == null ? '' : status).trim();
  if (/^[23]\d\d$/.test(text)) return 0;
  if (/^4\d\d$/.test(text)) return 1;
  if (/^5\d\d$/.test(text)) return 2;
  return 3;
}

function rankProbeRows(rows) {
  return (rows || []).slice().sort((a, b) => {
    const ar = a && a.ok ? statusRank(a.status) : 3;
    const br = b && b.ok ? statusRank(b.status) : 3;
    if (ar !== br) return ar - br;
    if (!a || !a.ok || !b || !b.ok) return 0;
    return (Number(a.ms) || 0) - (Number(b.ms) || 0);
  });
}

function bestProbeRow(rows) {
  const best = rankProbeRows(rows).find((row) => row && row.ok);
  return best || null;
}

module.exports = {
  QUICK_LIMIT,
  normalizeProbeInput,
  familyOf,
  quickCandidates,
  statusRank,
  rankProbeRows,
  bestProbeRow
};
