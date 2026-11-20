'use strict';

const fs = require('fs');
const path = require('path');

const FRIENDLY = {
  DiscordMain: 'Discord',
  DiscordGateway: 'Gateway',
  DiscordCDN: 'CDN',
  DiscordUpdates: 'Обновления',
  YouTubeWeb: 'YouTube',
  YouTubeShort: 'Короткие ссылки',
  YouTubeImage: 'Превью',
  YouTubeVideoRedirect: 'Видео',
  GoogleMain: 'Google',
  GoogleGstatic: 'Gstatic',
  CloudflareWeb: 'Cloudflare',
  CloudflareCDN: 'CDN',
  EpicWeb: 'Epic Games',
  CloudflareDNS1111: 'Cloudflare DNS',
  CloudflareDNS1001: 'Cloudflare DNS',
  GoogleDNS8888: 'Google DNS',
  GoogleDNS8844: 'Google DNS',
  Quad9DNS9999: 'Quad9'
};

const GROUP_ORDER = {
  Discord: 1,
  YouTube: 2,
  Google: 3,
  Cloudflare: 4,
  Epic: 5,
  DNS: 6
};

function displayGroup(raw) {
  if (!raw) return 'Прочее';
  if (/^Public DNS/i.test(raw)) return 'DNS';
  return raw;
}

function prettyName(t) {
  if (FRIENDLY[t.name]) return FRIENDLY[t.name];
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t.group || '')) return t.group;
  let name = t.name || '';
  const group = t.group || '';
  if (group && name.toLowerCase().startsWith(group.toLowerCase())) name = name.slice(group.length);
  if (!name) name = t.name || '';
  // Разделяем CamelCase так же, как C#-версия.
  return name.replace(/([a-zа-я])([A-ZА-Я])/g, '$1 $2').trim() || t.name;
}

function makeTarget(rawName, group, value) {
  const target = {
    name: rawName,
    group: displayGroup(group),
    sourceGroup: group || 'Прочее',
    url: '',
    pingHost: '',
    isPing: false,
    friendly: '',
    host: ''
  };
  const v = String(value || '').trim();
  if (/^PING:/i.test(v)) {
    target.isPing = true;
    target.pingHost = v.slice(5).trim();
  } else {
    target.url = v;
    try { target.pingHost = new URL(v).host; } catch { target.pingHost = ''; }
  }
  target.friendly = prettyName(target);
  target.host = target.isPing
    ? (target.pingHost ? target.pingHost + ' · ICMP' : '')
    : (target.pingHost || target.url);
  return target;
}

function defaults() {
  return [
    makeTarget('DiscordMain', 'Discord', 'https://discord.com'),
    makeTarget('DiscordGateway', 'Discord', 'https://gateway.discord.gg'),
    makeTarget('YouTubeWeb', 'YouTube', 'https://www.youtube.com'),
    makeTarget('YouTubeImage', 'YouTube', 'https://i.ytimg.com'),
    makeTarget('GoogleMain', 'Google', 'https://www.google.com'),
    makeTarget('CloudflareWeb', 'Cloudflare', 'https://www.cloudflare.com'),
    makeTarget('EpicWeb', 'Epic', 'https://www.epicgames.com'),
    makeTarget('CloudflareDNS1111', 'DNS', 'PING:1.1.1.1'),
    makeTarget('GoogleDNS8888', 'DNS', 'PING:8.8.8.8')
  ];
}

function ensureEpic(list) {
  const has = list.some((t) => t.url && /epicgames\.com/i.test(t.url));
  if (!has) {
    list.push(makeTarget('EpicWeb', 'Epic', 'https://www.epicgames.com'));
  }
}

function loadTargets(zapretDir, logger) {
  const list = [];
  try {
    const file = path.join(zapretDir || '', 'utils', 'targets.txt');
    if (zapretDir && fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      let group = 'Прочее';
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const g = line.match(/^###\s*(.+?)\s*$/);
        if (g) {
          group = g[1].trim();
          continue;
        }
        const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]+)"\s*$/);
        if (!m) continue;
        const target = makeTarget(m[1], group, m[2]);
        if (target.isPing ? target.pingHost : target.url) list.push(target);
      }
    }
  } catch (err) {
    if (logger) logger.write('targets.txt: ' + err.message);
  }

  if (!list.length) list.push(...defaults());

  list.sort((a, b) => {
    const oa = GROUP_ORDER[a.group] || 7;
    const ob = GROUP_ORDER[b.group] || 7;
    return oa - ob;
  });
  return list;
}

function summarizeTargets(targets) {
  let http = 0;
  let ping = 0;
  for (const t of targets) {
    if (t.isPing) ping++;
    else http++;
  }
  return { http, ping };
}

module.exports = { loadTargets, summarizeTargets, displayGroup, GROUP_ORDER };
