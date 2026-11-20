'use strict';

(function () {
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const api = window.api;

  const els = {
    app: $('#app'),
    dot: $('#st-dot'),
    label: $('#st-label'),
    name: $('#st-name'),
    arg: $('#st-arg'),
    segments: $('#segments'),
    count: $('#st-count'),
    countSr: $('#st-count-sr'),
    time: $('#st-time'),
    testSegments: $('#test-segments'),
    progress: $('#st-progress'),
    remain: $('#st-remain'),
    btnCheck: $('#btn-check'),
    btnPower: $('#btn-power'),
    btnApply: $('#btn-apply'),
    btnTestAll: $('#btn-testall'),
    btnSummary: $('#btn-summary'),
    btnProbe: $('#btn-probe'),
    btnSettings: $('#btn-settings'),
    railCount: $('#rail-count'),
    search: $('#search'),
    list: $('#strategy-list'),
    empty: $('#empty'),
    mainSub: $('#main-sub'),
    sites: $('#sites'),
    expandAll: $('#expand-all'),
    collapseAll: $('#collapse-all'),
    bbIdleLeft: $('#bb-idle-left'),
    bbIdleRight: $('#bb-idle-right'),
    bbWinws: $('#bb-winws'),
    bbPdot: $('#bb-pdot'),
    bbService: $('#bb-service'),
    bbMode: $('#bb-mode'),
    bbCurrent: $('#bb-current'),
    bbTrack: $('#bb-track'),
    bbCount: $('#bb-count'),
    bbRemain: $('#bb-remain'),
    bbCancel: $('#bb-cancel'),
    settingsLayer: $('#settings-layer'),
    settingsPanel: $('#settings-panel'),
    setClose: $('#set-close'),
    setPath: $('#set-path'),
    setPick: $('#set-pick'),
    setHint: $('#set-hint'),
    setHintDot: $('#set-hint-dot'),
    setMsg: $('#set-msg'),
    setDownloadRow: $('#set-download-row'),
    setDownload: $('#set-download'),
    setAutostart: $('#set-autostart'),
    setTray: $('#set-tray'),
    setTargets: $('#set-targets'),
    setLog: $('#set-log'),
    setTargetsSub: $('#set-targets-sub'),
    setLogSub: $('#set-log-sub'),
    setService: $('#set-service'),
    setVersion: $('#set-version'),
    setUpdate: $('#set-update'),
    setUpdateStatus: $('#set-update-status'),
    setZapretUpdate: $('#set-zapret-update'),
    setZapretStatus: $('#set-zapret-status'),
    setUninstall: $('#set-uninstall'),
    setFolder: $('#set-folder'),
    summaryLayer: $('#summary-layer'),
    summaryPanel: $('#summary-panel'),
    summaryTitle: $('#sum-title'),
    summarySub: $('#sum-sub'),
    summaryList: $('#sum-list'),
    summaryNote: $('#sum-note'),
    summaryClose: $('#sum-close'),
    summaryDismiss: $('#sum-dismiss'),
    summaryApply: $('#sum-apply'),
    probeLayer: $('#probe-layer'),
    probePanel: $('#probe-panel'),
    probeTitle: $('#probe-title'),
    probeSub: $('#probe-sub'),
    probeClose: $('#probe-close'),
    probeForm: $('#probe-form'),
    probeInput: $('#probe-input'),
    probeDns: $('#probe-dns'),
    probeModeQuick: $('#probe-mode-quick'),
    probeModeAll: $('#probe-mode-all'),
    probeQuickSub: $('#probe-quick-sub'),
    probeAllSub: $('#probe-all-sub'),
    probeError: $('#probe-error'),
    probeRun: $('#probe-run'),
    probeBar: $('#probe-bar'),
    probeRunText: $('#probe-run-text'),
    probeRemain: $('#probe-remain'),
    probeList: $('#probe-list'),
    probeAlert: $('#probe-alert'),
    probeMore: $('#probe-more'),
    probeFull: $('#probe-full'),
    probeNote: $('#probe-note'),
    probeReset: $('#probe-reset'),
    probeCancel: $('#probe-cancel'),
    probeStart: $('#probe-start'),
    probeApply: $('#probe-apply'),
    notice: $('#notice'),
    noticeText: $('#notice-text'),
    noticeClose: $('#notice-close'),
    winMin: $('#win-min'),
    winMax: $('#win-max'),
    winClose: $('#win-close'),
    icoMax: $('.ico-max'),
    icoRestore: $('.ico-restore')
  };

  const state = {
    data: null,
    results: new Map(),
    viewed: null,
    search: '',
    expanded: {},
    collapsedGroups: {},
    sitesInitialized: false,
    lastTesting: false,
    ready: false,
    settingsOpen: false,
    settingsTimer: null,
    summaryOpen: false,
    summaryTimer: null,
    summaryBest: null,
    summaryReturnFocus: null,
    probeOpen: false,
    probeView: 'form',
    probeMode: 'quick',
    probeStarting: false,
    probeTimer: null,
    probeReturnFocus: null,
    probeDnsText: 'DNS проверится перед запуском',
    probeDnsClass: '',
    probeDnsTimer: null,
    probeDnsToken: 0,
    noticeTimer: null,
    maxed: false,
    rowNames: []
  };

  const STRATEGY_GROUPS = ['ОСНОВНЫЕ', 'FAKE TLS AUTO', 'SIMPLE FAKE'];
  const GROUP_ORDER = { Discord: 1, YouTube: 2, Instagram: 3, Google: 4, Cloudflare: 5, Epic: 6, DNS: 8 };
  const CUSTOM_ICON = { file: 'site.svg', size: 22 };
  const ICONS = {
    Discord: { file: 'discord.svg', size: 22 },
    YouTube: { file: 'youtube.svg', size: 22 },
    Instagram: { file: 'instagram.svg', size: 22 },
    Google: { file: 'google.svg', size: 22 },
    Cloudflare: { file: 'cloudflare.svg', size: 22 },
    Epic: { file: 'epicgames.svg', size: 21 },
    DNS: { file: 'dns.svg', size: 20 }
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function prettyBat(name) {
    return String(name || '').replace(/\.bat$/i, '');
  }

  function splitName(name) {
    const full = prettyBat(name);
    const match = full.match(/^(.*?)\s*(\([^)]*\))\s*$/);
    if (match) return { base: match[1], arg: match[2] };
    return { base: full, arg: '' };
  }

  function strategyGroup(name) {
    const full = prettyBat(name).toUpperCase();
    if (full.includes('SIMPLE FAKE')) return 'SIMPLE FAKE';
    if (full.includes('FAKE TLS AUTO')) return 'FAKE TLS AUTO';
    return 'ОСНОВНЫЕ';
  }

  function strategyKey(name, group) {
    const full = prettyBat(name);
    const argMatch = full.match(/\(([^)]*)\)\s*$/);
    if (!argMatch) return { rank: 0, num: 0 };
    const arg = argMatch[1].trim().toUpperCase();
    if (arg === group) return { rank: 0, num: 0 };
    const alt = arg.match(/(?:^|\s)ALT\s*(\d*)$/);
    if (alt) return { rank: alt[1] ? 2 : 1, num: alt[1] ? Number(alt[1]) : 0 };
    return { rank: 3, num: 0 };
  }

  function strategyOrder(a, b) {
    const groupA = strategyGroup(a);
    const groupB = strategyGroup(b);
    const ga = STRATEGY_GROUPS.indexOf(groupA);
    const gb = STRATEGY_GROUPS.indexOf(groupB);
    if (ga !== gb) return ga - gb;
    const oa = strategyKey(a, groupA);
    const ob = strategyKey(b, groupB);
    if (oa.rank !== ob.rank) return oa.rank - ob.rank;
    if (oa.num !== ob.num) return oa.num - ob.num;
    return prettyBat(a).localeCompare(prettyBat(b), 'ru', { sensitivity: 'base' });
  }

  function getResult(bat) {
    if (!bat) return null;
    return state.results.get(String(bat).toLowerCase()) || null;
  }

  function displayBat() {
    const st = state.data;
    if (st && st.testing) return st.testing.bat;
    return state.viewed;
  }

  function displayResult() {
    const st = state.data;
    if (st && st.testing && st.testing.previewResult) return st.testing.previewResult;
    return getResult(displayBat());
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function timeText(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function dateText(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1);
  }

  function sizeText(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1).replace('.', ',') + ' МБ';
    if (n >= 1024) return Math.round(n / 1024) + ' КБ';
    return n + ' Б';
  }

  function allOk(result) {
    return Boolean(result && result.httpTotal > 0 && result.httpOk === result.httpTotal);
  }

  function scoreClass(result) {
    if (!result || result.httpTotal === 0) return 'none';
    if (result.httpOk === result.httpTotal) return 'ok';
    if (result.httpOk >= result.httpTotal - 2 && result.httpOk > 0) return 'warn';
    return 'bad';
  }

  function categoryScoreClass(rows, resultRows) {
    if (!resultRows) return 'muted';
    const total = rows.length;
    let ok = 0;
    for (const row of rows) {
      const found = resultRows.get(row.name);
      if (found && found.ok) ok++;
    }
    return ok === total ? '' : 'bad';
  }

  function httpTargets() {
    return state.data ? state.data.targets.filter((t) => !t.isPing) : [];
  }

  function ensureSegments(container, count, test) {
    const current = container.children.length;
    if (current < count) {
      const frag = document.createDocumentFragment();
      for (let i = current; i < count; i++) {
        const span = document.createElement('span');
        span.className = test ? 'segment' : 'segment dim';
        frag.appendChild(span);
      }
      container.appendChild(frag);
    } else if (current > count) {
      for (let i = current - 1; i >= count; i--) container.removeChild(container.children[i]);
    }
  }

  function remainingText(testing, fallbackMs) {
    if (!testing) return '';
    const index = Math.max(1, Number(testing.index) || 1);
    const total = Number(testing.total) || 0;
    const elapsed = Math.max(0, Date.now() - (Number(testing.startedAt) || Date.now()));
    const per = index > 1 && elapsed > 500 ? elapsed / index : (Number(fallbackMs) || 28000);
    const remaining = Math.max(0, Math.round(per * (total - index) / 60000));
    if (total - index <= 0) return 'завершаю';
    if (remaining <= 0) return 'меньше минуты';
    return 'осталось ≈ ' + remaining + ' мин';
  }

  function renderStatus() {
    const st = state.data;
    if (!st) return;
    const probe = st.probe && st.probe.active ? st.probe : null;
    const testing = probe ? null : st.testing;
    const busyOp = st.operation === 'check' || st.operation === 'apply' || st.operation === 'restore' ||
      st.operation === 'zapret-install' || st.operation === 'sites';
    const currentBat = probe ? probe.domain : (testing ? testing.bat : st.selectedBat);
    const currentResult = probe ? null : (testing ? displayResult() : getResult(currentBat));
    const parts = splitName(currentBat || '—');

    els.app.dataset.mode = probe ? 'probing' : (testing ? 'testing' : 'idle');
    els.name.textContent = parts.base || '—';
    els.arg.textContent = parts.arg || '';
    els.name.title = prettyBat(currentBat || '');

    els.dot.className = 'status-dot';
    els.label.className = 'status-label';

    if (probe) {
      els.label.textContent = 'Поиск обхода';
      els.label.classList.add('amber');
      els.dot.classList.add('amber');
    } else if (testing) {
      els.label.textContent = 'Тест всех';
      els.label.classList.add('amber');
      els.dot.classList.add('amber');
    } else if (busyOp) {
      els.label.textContent = 'Проверяем сайты';
      els.label.classList.add('amber');
      els.dot.classList.add('amber');
    } else if (!st.winwsRunning) {
      els.label.textContent = 'Обход выключен';
      els.label.classList.add('red');
      els.dot.classList.add('red');
    } else {
      els.label.textContent = 'Обход работает';
      if (currentResult && !allOk(currentResult)) els.dot.classList.add('amber');
      else if (!currentResult) els.dot.classList.add('amber');
    }

    const targets = httpTargets();
    ensureSegments(els.segments, targets.length, false);
    ensureSegments(els.testSegments, probe ? (probe.total || 0) : (testing ? (testing.total || 0) : 0), true);

    if (probe) {
      const total = Number(probe.total) || 0;
      const done = Number(probe.tested) || 0;
      els.progress.textContent = done + ' / ' + total;
      for (let i = 0; i < els.testSegments.children.length; i++) {
        els.testSegments.children[i].className = 'segment' + (i < done ? ' on' : '');
      }
      els.remain.textContent = remainingText({ index: done + 1, total, startedAt: probe.startedAt }, 9000);
      els.time.textContent = probe.bat ? 'проверяю ' + prettyBat(probe.bat) : 'проверяю DNS';
      els.countSr.textContent = 'идёт поиск обхода, ' + done + ' из ' + total;
      return;
    }

    if (testing) {
      const total = Number(testing.total) || 0;
      const index = Number(testing.index) || 0;
      els.progress.textContent = index + ' / ' + total;
      for (let i = 0; i < els.testSegments.children.length; i++) {
        const on = i < index;
        els.testSegments.children[i].className = 'segment' + (on ? ' on' : '');
      }
      els.remain.textContent = remainingText(testing);
      els.time.textContent = 'проверено ' + timeText(currentResult ? currentResult.checkedAt : 0);
      els.countSr.textContent = 'идет тест всех, ' + index + ' из ' + total;
      return;
    }

    const resultMap = new Map();
    if (currentResult) {
      for (const row of currentResult.results) resultMap.set(row.name, row);
    }
    const dimAll = Boolean(st.operation) || !currentResult;
    for (let i = 0; i < els.segments.children.length; i++) {
      const target = targets[i];
      const row = resultMap.get(target.name);
      let cls = 'segment';
      if (dimAll || !row) cls += ' dim';
      else if (!row.ok) cls += ' off';
      els.segments.children[i].className = cls;
    }

    els.count.className = 'status-count';
    if (!currentResult) {
      els.count.textContent = '—/' + (targets.length || '—');
      els.count.classList.add('dim');
      els.countSr.textContent = 'нет данных';
    } else {
      els.count.textContent = currentResult.httpOk + '/' + currentResult.httpTotal;
      const sc = scoreClass(currentResult);
      if (sc === 'warn') els.count.classList.add('amber');
      else if (sc === 'bad') els.count.classList.add('red');
      else if (sc === 'none') els.count.classList.add('dim');
      els.countSr.textContent = currentResult.httpOk + ' из ' + currentResult.httpTotal;
    }
    els.time.textContent = currentResult ? 'проверено ' + timeText(currentResult.checkedAt) : 'ещё не проверялось';
  }

  function renderMainSub() {
    const st = state.data;
    if (!st) return;
    if (st.operation === 'zapret-install') {
      els.mainSub.textContent = st.busyText || 'Скачиваю батники zapret…';
      return;
    }
    if (!st.zapretFound) {
      els.mainSub.textContent = 'Батники zapret не найдены — открой настройки';
      return;
    }
    const testing = st.testing;
    if (testing) {
      let html = 'идёт перебор · HTTP <span class="ok">' +
        Number(testing.httpOk || 0) + '/' + Number(testing.httpTotal || 0) + '</span>';
      const r = displayResult();
      if (r && r.pingTotal > 0) html += ' · ping ' + r.pingOk + '/' + r.pingTotal;
      els.mainSub.innerHTML = html;
      return;
    }
    const result = getResult(state.viewed);
    if (!result) {
      els.mainSub.textContent = state.viewed ? 'ещё не проверялось' : 'нет данных';
      return;
    }
    let html = 'проверено ' + timeText(result.checkedAt) + ' · HTTP <span class="ok">' +
      result.httpOk + '/' + result.httpTotal + '</span>';
    if (result.pingTotal > 0) html += ' · ping ' + result.pingOk + '/' + result.pingTotal;
    els.mainSub.innerHTML = html;
  }

  function updateRow(rowEl) {
    const st = state.data;
    const bat = rowEl.dataset.name;
    const result = getResult(bat);
    const applied = st.selectedBat;
    const current = Boolean(applied) && applied.toLowerCase() === bat.toLowerCase();
    const selected = Boolean(state.viewed) && state.viewed.toLowerCase() === bat.toLowerCase();

    const dot = $('.s-dot', rowEl);
    dot.className = 's-dot';
    const sc = scoreClass(result);
    if (sc === 'ok') dot.classList.add('ok');
    else if (sc === 'warn') dot.classList.add('warn');
    else if (sc === 'bad') dot.classList.add('bad');

    $('.s-name', rowEl).textContent = prettyBat(bat);
    rowEl.title = prettyBat(bat);

    const sub = $('.s-sub', rowEl);
    sub.className = 's-sub';
    if (current) {
      sub.classList.add('live');
      sub.textContent = result ? 'подключён · ' + timeText(result.checkedAt) : 'подключён';
    } else if (result) {
      sub.textContent = 'проверен ' + timeText(result.checkedAt);
    } else {
      sub.textContent = 'не проверялся';
    }

    const score = $('.s-score', rowEl);
    score.className = 's-score';
    if (!result || result.httpTotal === 0) {
      score.textContent = '—';
      score.classList.add('none');
    } else {
      score.textContent = result.httpOk + '/' + result.httpTotal;
      const cls = scoreClass(result);
      if (cls === 'ok') score.classList.add('ok');
      else if (cls === 'warn') score.classList.add('warn');
      else if (cls === 'bad') score.classList.add('bad');
    }

    rowEl.setAttribute('aria-checked', selected ? 'true' : 'false');
    rowEl.tabIndex = selected ? 0 : -1;
    rowEl.dataset.current = current ? 'true' : 'false';
  }

  function buildRow(bat) {
    const btn = document.createElement('button');
    btn.className = 'strategy';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.tabIndex = -1;
    btn.dataset.name = bat;
    btn.dataset.current = 'false';
    btn.innerHTML = '<span class="s-dot"></span>' +
      '<span><span class="s-name"></span><span class="s-sub"></span></span>' +
      '<span class="s-score"></span>';
    return btn;
  }

  function rebuildRows(names) {
    const existing = new Map();
    for (const node of $$('.strategy', els.list)) existing.set(node.dataset.name, node);
    const counts = new Map();
    for (const name of names) {
      const group = strategyGroup(name);
      counts.set(group, (counts.get(group) || 0) + 1);
    }
    const frag = document.createDocumentFragment();
    let currentGroup = null;
    for (const name of names) {
      const group = strategyGroup(name);
      if (group !== currentGroup) {
        currentGroup = group;
        const head = document.createElement('div');
        head.className = 'strategy-group';
        head.setAttribute('role', 'presentation');
        head.dataset.group = group;
        head.innerHTML = '<span class="sg-label"></span><span class="sg-line"></span><span class="sg-count"></span>';
        $('.sg-label', head).textContent = group;
        $('.sg-count', head).textContent = String(counts.get(group) || 0);
        frag.appendChild(head);
      }
      frag.appendChild(existing.get(name) || buildRow(name));
    }
    frag.appendChild(els.empty);
    els.list.innerHTML = '';
    els.list.appendChild(frag);
    for (const rowEl of $$('.strategy', els.list)) updateRow(rowEl);
  }

  function visibleNames() {
    if (!state.data) return [];
    const q = state.search.trim().toLowerCase();
    return state.data.bats
      .filter((b) => !q || prettyBat(b).toLowerCase().includes(q))
      .sort(strategyOrder);
  }

  function renderStrategies(forceRebuild) {
    const st = state.data;
    if (!st) return;
    const names = visibleNames();
    const same = !forceRebuild && names.length === state.rowNames.length &&
      names.every((n, i) => n === state.rowNames[i]) && $$('.strategy', els.list).length === names.length;
    if (!same) {
      rebuildRows(names);
      state.rowNames = names;
    } else {
      for (const rowEl of $$('.strategy', els.list)) updateRow(rowEl);
    }
    els.railCount.textContent = String(st.bats.length);
    els.empty.hidden = names.length > 0;
    els.empty.textContent = st.bats.length ? 'Ничего не найдено' : 'Нет батников';
  }

  function selectBat(name, focusRow) {
    if (!name) return;
    state.viewed = name;
    renderStrategies(false);
    renderSites(false);
    renderMainSub();
    if (focusRow) {
      const rowEl = $$('.strategy', els.list).find((r) => r.dataset.name === name);
      if (rowEl) rowEl.focus();
    }
  }

  function groupName(group) {
    return group === 'Epic' ? 'Epic Games' : group;
  }

  function sortGroups(groups) {
    return groups.sort((a, b) => {
      const oa = GROUP_ORDER[a] || 7;
      const ob = GROUP_ORDER[b] || 7;
      return oa - ob;
    });
  }

  function renderSites(force) {
    const st = state.data;
    if (!st) return;
    if (!st.targets.length) {
      els.sites.innerHTML = '<div class="sites-empty"><b>Пока нет данных</b>' +
        'Выбери папку zapret в настройках — цели появятся здесь.</div>';
      return;
    }

    const userByGroup = new Map();
    for (const site of st.userSites || []) {
      if (site && site.group) userByGroup.set(String(site.group).toLowerCase(), site);
    }
    const result = displayResult();
    const resultRows = result ? new Map(result.results.map((r) => [r.name, r])) : null;

    if (st.mock && !st.testing && !state.sitesInitialized) {
      state.expanded.YouTube = true;
    }
    if (result) {
      for (const target of st.targets) {
        const row = resultRows.get(target.name);
        if (row && !row.ok && !state.collapsedGroups[target.group]) {
          state.expanded[target.group] = true;
        }
      }
    }
    state.sitesInitialized = true;

    const signature = [
      displayBat() || '',
      result ? result.checkedAt : 0,
      result ? result.httpOk : -1,
      result ? result.httpTotal : -1,
      st.testing ? 1 : 0,
      st.targets.length,
      (st.userSites || []).map((site) => site.group + ':' + (site.enabled ? 1 : 0)).join(','),
      Object.keys(state.expanded).sort().map((k) => k + ':' + (state.expanded[k] ? 1 : 0)).join(',')
    ].join('|');
    if (!force && signature === state.sitesSignature) return;
    state.sitesSignature = signature;

    const groups = [];
    const byGroup = new Map();
    for (const target of st.targets) {
      if (!byGroup.has(target.group)) {
        byGroup.set(target.group, []);
        groups.push(target.group);
      }
      byGroup.get(target.group).push(target);
    }
    sortGroups(groups);

    let html = '';
    groups.forEach((group, index) => {
      const rows = byGroup.get(group);
      const userSite = userByGroup.get(String(group).toLowerCase()) || null;
      const enabled = userSite ? Boolean(userSite.enabled) : true;
      const icon = ICONS[group] || (userSite ? CUSTOM_ICON : null);
      const open = Boolean(state.expanded[group]);
      let ok = 0;
      let msSum = 0;
      let msCount = 0;
      let anyTimeout = false;
      let allPing = true;
      for (const target of rows) {
        if (!target.isPing) allPing = false;
        const row = resultRows ? resultRows.get(target.name) : null;
        if (row && row.ok) {
          ok++;
          if (row.ms > 0) { msSum += row.ms; msCount++; }
        } else if (row && !row.ok) {
          if (/таймаут|timeout/i.test(row.status || '')) anyTimeout = true;
        }
      }
      const total = rows.length;
      const avg = msCount ? Math.floor(msSum / msCount) : 0;
      let meta;
      if (userSite && !enabled) meta = 'обход выключен · напрямую';
      else if (!result) meta = 'нет данных';
      else if (ok === total) meta = ok + ' из ' + total + ' · ' + (allPing ? 'пинг ' : '') + '~' + avg + ' мс';
      else if (anyTimeout) meta = ok + ' из ' + total + ' · таймаут';
      else meta = ok + ' из ' + total + ' · есть сбои';
      const sc = userSite && !enabled ? 'off' : categoryScoreClass(rows, resultRows);
      const score = userSite && !enabled ? '—' : (result ? ok + '/' + total : '—');
      const iconHtml = icon
        ? '<img src="assets/icons/' + icon.file + '" width="' + icon.size + '" height="' + icon.size + '" alt="">'
        : '';
      const control = userSite
        ? '<span class="cat-switch" role="switch" aria-checked="' + (enabled ? 'true' : 'false') +
          '" tabindex="0" data-user-toggle="' + esc(group) + '" aria-label="Обход ' + esc(groupName(group)) + '"></span>'
        : '<span class="cat-lock" title="Встроенный сервис zapret" aria-label="Встроенный сервис">' +
          '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="3" y="6" width="8" height="6" rx="1.4"/><path d="M4.5 6V4.6a2.5 2.5 0 015 0V6" stroke-linecap="round"/></svg></span>';
      const manage = userSite
        ? '<div class="cat-manage"><span>Добавлен вами</span><button class="btn btn-ghost btn-danger" data-user-delete="' +
          esc(group) + '">Удалить сайт</button></div>'
        : '';

      html += '<section class="cat' + (open ? ' open' : '') + (userSite && !enabled ? ' off' : '') +
        '" data-group="' + esc(group) + '"' + (userSite ? ' data-on="' + (enabled ? 'true' : 'false') + '"' : '') + '>' +
        '<button class="cat-head" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="body-' + index + '">' +
        '<span class="cat-ic">' + iconHtml + '</span>' +
        '<span class="cat-name">' + esc(groupName(group)) + '</span>' +
        '<span class="cat-meta">' + esc(meta) + '</span>' +
        '<span class="cat-score ' + sc + '">' + esc(score) + '</span>' +
        control +
        '<svg class="chev" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M3.2 5.2L7 9l3.8-3.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
        '<div class="cat-body" id="body-' + index + '" aria-hidden="' + (open ? 'false' : 'true') + '"><div class="cat-inner">' +
        '<div class="colhead" aria-hidden="true"><span></span><span>Сайт</span><span>Хост</span><span></span><span>Отклик</span><span>Код</span></div>';

      for (const target of rows) {
        const row = resultRows ? resultRows.get(target.name) : null;
        let cls = 'hit';
        let lat;
        let code;
        let bar = '';
        let width = 0;
        if (!row) {
          cls += ' nodata';
          lat = '—';
          code = '—';
        } else if (row.ok) {
          lat = row.ms + ' <span class="u">мс</span>';
          code = row.status || '—';
          width = Math.max(2, Math.min(100, (row.ms / 300) * 100));
          if (row.ms <= 140) bar = ' class="fast"';
          else if (row.ms >= 450) bar = ' class="slow"';
        } else {
          cls += ' fail';
          lat = 'таймаут';
          code = '—';
          width = 0;
        }
        html += '<div class="' + cls + '">' +
          '<span class="hit-dot"></span>' +
          '<span class="hit-name" title="' + esc(target.friendly) + '">' + esc(target.friendly) + '</span>' +
          '<span class="hit-host" title="' + esc(target.host) + '">' + esc(target.host) + '</span>' +
          '<span class="hit-bar"><i' + bar + ' data-w="' + width.toFixed(1) + '"></i></span>' +
          '<span class="hit-lat">' + lat + '</span>' +
          '<span class="hit-code">' + esc(code) + '</span>' +
          '</div>';
      }
      html += manage + '</div></div></section>';
    });

    els.sites.innerHTML = html;
    for (const bar of $$('.hit-bar i', els.sites)) {
      const width = Number(bar.dataset.w) || 0;
      bar.style.setProperty('--w', width.toFixed(1) + '%');
    }
  }

  function renderBottom() {
    const st = state.data;
    if (!st) return;
    const probe = st.probe && st.probe.active ? st.probe : null;
    if (probe) {
      els.bbMode.textContent = 'Поиск обхода';
      els.bbCurrent.textContent = probe.domain;
      const total = Number(probe.total) || 1;
      const done = Number(probe.tested) || 0;
      els.bbTrack.style.width = Math.max(0, Math.min(100, (done / total) * 100)) + '%';
      els.bbCount.textContent = done + '/' + total;
      const remain = remainingText({ index: done + 1, total, startedAt: probe.startedAt }, 9000);
      els.bbRemain.textContent = remain.replace('осталось ', '');
      els.bbCancel.disabled = Boolean(probe.cancelRequested);
      els.bbCancel.textContent = probe.cancelRequested ? 'Отмена…' : 'Отмена';
      return;
    }
    const testing = st.testing;
    if (testing) {
      els.bbMode.textContent = 'Тест всех';
      const parts = splitName(testing.bat);
      els.bbCurrent.textContent = parts.base + (parts.arg ? ' ' + parts.arg : '');
      const total = Number(testing.total) || 1;
      const index = Number(testing.index) || 0;
      els.bbTrack.style.width = Math.max(0, Math.min(100, (index / total) * 100)) + '%';
      els.bbCount.textContent = index + '/' + total;
      const remain = remainingText(testing);
      els.bbRemain.textContent = remain.replace('осталось ', '');
      els.bbCancel.disabled = Boolean(testing.cancelRequested);
      els.bbCancel.textContent = testing.cancelRequested ? 'Отмена…' : 'Отмена';
      return;
    }

    const result = getResult(st.selectedBat);
    let left;
    if (st.operation && st.busyText) {
      left = esc(st.busyText);
    } else if (!st.zapretFound) {
      left = 'Папка zapret не найдена';
    } else if (result) {
      const cls = result.httpTotal > 0 && result.httpOk === result.httpTotal ? 'ok' : 'amber';
      left = 'Проверено ' + timeText(result.checkedAt) +
        ' <span class="bb-sep">·</span> HTTP <span class="' + cls + '">' + result.httpOk + '/' + result.httpTotal + '</span>';
      if (result.pingTotal > 0) left += ' <span class="bb-sep">·</span> ping ' + result.pingOk + '/' + result.pingTotal;
    } else {
      left = 'Ещё не проверялось';
    }
    els.bbIdleLeft.innerHTML = left;

    els.bbPdot.className = 'pdot' + (st.winwsRunning ? '' : ' off');
    els.bbWinws.textContent = st.winwsRunning
      ? 'winws.exe · PID ' + (st.winwsPid || '—')
      : 'winws.exe · не запущен';
    els.bbService.innerHTML = 'служба zapret — <b>' + esc(st.serviceLabel) + '</b>';
  }

  function renderSettings() {
    const st = state.data;
    if (!st) return;
    const path = st.config.zapretDir || '—';
    els.setPath.textContent = path;
    els.setPath.title = path;
    els.setHint.textContent = st.zapretFound
      ? 'bin\\winws.exe найден · ' + st.bats.length + ' батников'
      : 'bin\\winws.exe не найден';
    els.setHintDot.className = 'hdot' + (st.zapretFound ? '' : ' bad');
    if (els.setDownloadRow) els.setDownloadRow.hidden = st.zapretFound;
    els.setAutostart.setAttribute('aria-checked', st.config.autostart ? 'true' : 'false');
    els.setTray.setAttribute('aria-checked', st.config.minimizeToTray ? 'true' : 'false');
    els.setService.textContent = st.serviceLabel;
    els.setVersion.textContent = 'Zapret Mini ' + st.version;
    els.setUpdateStatus.textContent = 'версия ' + st.version + ' · проверка при запуске';
    els.setZapretStatus.textContent = st.zapretVersion ? 'версия ' + st.zapretVersion : 'версия не определена';

    const files = st.files || {};
    const t = files.targets || {};
    els.setTargetsSub.textContent = t.exists
      ? (t.http + ' HTTP · ' + t.ping + ' ICMP' + (t.mtime ? ' · изменён ' + dateText(t.mtime) : ''))
      : 'файл не найден';
    const log = files.log || {};
    els.setLogSub.textContent = log.exists ? 'electron.log · ' + sizeText(log.size) : 'electron.log · ещё пуст';
  }

  function updateControls() {
    const st = state.data;
    if (!st) return;
    const busy = Boolean(st.operation) || Boolean(st.testing) || Boolean(st.probe && st.probe.active);
    els.btnCheck.disabled = busy || !st.zapretFound;
    els.btnApply.disabled = busy || !state.viewed;
    els.btnTestAll.disabled = !st.bats.length || busy;
    els.btnSummary.disabled = busy || currentResults().length === 0;
    els.btnProbe.disabled = busy || !st.zapretFound;
    els.btnSettings.disabled = busy;
    if (els.setUninstall) els.setUninstall.disabled = busy;
    if (els.setDownload) els.setDownload.disabled = busy;

    els.btnPower.className = 'btn ' + (st.testing ? 'btn-danger' : (st.winwsRunning ? 'btn-danger' : 'btn-primary'));
    if (st.testing) {
      els.btnPower.textContent = 'Отмена';
      els.btnPower.disabled = false;
    } else {
      els.btnPower.textContent = st.winwsRunning ? 'Отключить' : 'Включить';
      els.btnPower.disabled = Boolean(st.operation);
    }
  }

  function renderAll(forceSites) {
    renderStatus();
    renderStrategies(false);
    renderSites(Boolean(forceSites));
    renderMainSub();
    renderBottom();
    renderSettings();
    updateControls();
  }

  function applyState(st) {
    if (!st) return;
    const first = !state.data;
    const testingStarted = Boolean(st.testing) && !state.lastTesting;
    state.data = st;
    state.results = new Map();
    for (const result of st.results || []) {
      if (result && result.bat) state.results.set(result.bat.toLowerCase(), result);
    }

    if (testingStarted) {
      state.expanded = {};
      state.collapsedGroups = {};
      state.sitesInitialized = false;
    }

    if (st.testing) {
      // Список остаётся на выбранной стратегии; панель сайтов показывает текущий тест.
    } else if (state.lastTesting) {
      state.viewed = st.selectedBat;
      state.collapsedGroups = {};
      state.sitesInitialized = false;
    }

    if (!state.viewed || !st.bats.some((b) => b.toLowerCase() === state.viewed.toLowerCase())) {
      state.viewed = st.selectedBat || st.bats[0] || null;
    }

    state.lastTesting = Boolean(st.testing);
    renderAll(false);
    if (state.probeOpen) renderProbe();

    if (st.mock && !window.__zapretMock) {
      window.__zapretMock = {
        summary: () => openSummary(buildSummary({
          results: Array.from(state.results.values()),
          allResults: true,
          total: st.bats.length
        }))
      };
    }

    if (!state.ready) {
      state.ready = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.__zapretReady = true;
      }));
    }
    if (first && state.search) {
      // Первый рендер уже учёл поиск.
      renderStrategies(true);
    }
  }

  function showNotice(message, kind) {
    if (!message) return;
    els.notice.className = 'notice' + (kind === 'info' ? ' info' : '');
    els.noticeText.textContent = String(message);
    els.notice.hidden = false;
    if (state.noticeTimer) clearTimeout(state.noticeTimer);
    state.noticeTimer = setTimeout(() => { els.notice.hidden = true; }, 9000);
  }

  function setSettingsMessage(message) {
    if (!message) {
      els.setMsg.hidden = true;
      els.setMsg.textContent = '';
      return;
    }
    els.setMsg.textContent = message;
    els.setMsg.hidden = false;
  }

  /* ---------- итог теста всех ---------- */
  function avgMs(result) {
    const rows = (result && result.results) || [];
    let sum = 0;
    let count = 0;
    for (const row of rows) {
      if (row && row.ok && !row.ping && Number(row.ms) > 0) {
        sum += Number(row.ms);
        count++;
      }
    }
    return count ? Math.round(sum / count) : null;
  }

  function summaryOrder(a, b) {
    const ar = a.httpTotal ? a.httpOk / a.httpTotal : 0;
    const br = b.httpTotal ? b.httpOk / b.httpTotal : 0;
    if (br !== ar) return br - ar;
    if (b.httpOk !== a.httpOk) return b.httpOk - a.httpOk;
    const ap = a.pingTotal ? a.pingOk / a.pingTotal : 0;
    const bp = b.pingTotal ? b.pingOk / b.pingTotal : 0;
    if (bp !== ap) return bp - ap;
    const am = avgMs(a);
    const bm = avgMs(b);
    return (am == null ? Number.MAX_SAFE_INTEGER : am) - (bm == null ? Number.MAX_SAFE_INTEGER : bm);
  }

  function currentResults() {
    const names = new Set((state.data ? state.data.bats : []).map((bat) => bat.toLowerCase()));
    return Array.from(state.results.values()).filter((result) =>
      result && result.bat && names.has(result.bat.toLowerCase()));
  }

  function buildSummary(options) {
    const opts = options || {};
    const all = opts.results || currentResults();
    const since = Number(opts.since) || 0;
    const fresh = all.filter((result) => result && result.bat &&
      (opts.allResults || !since || Number(result.checkedAt) >= since));
    const rows = fresh
      .filter((result) => Number(result.httpTotal) > 0)
      .sort(summaryOrder);
    return {
      title: opts.title || '',
      canceled: Boolean(opts.canceled),
      total: Number(opts.total) || 0,
      checked: fresh.length,
      failed: fresh.filter((result) => !Number(result.httpTotal) || Number(result.httpOk) === 0).length,
      rows: rows.slice(0, 6),
      best: rows.length && rows[0].httpOk > 0 ? rows[0].bat : null
    };
  }

  function summaryRowHtml(result, index, bestBat, currentBat) {
    const isBest = Boolean(bestBat) && result.bat.toLowerCase() === bestBat.toLowerCase();
    const isCurrent = Boolean(currentBat) && result.bat.toLowerCase() === currentBat.toLowerCase();
    const avg = avgMs(result);
    const meta = 'HTTP ' + result.httpOk + '/' + result.httpTotal +
      (result.pingTotal > 0 ? ' · ping ' + result.pingOk + '/' + result.pingTotal : '') +
      (avg == null ? '' : ' · ~' + avg + ' мс');
    const badges = (isBest ? '<span class="sum-badge best">лучший</span>' : '') +
      (isCurrent ? '<span class="sum-badge live">сейчас</span>' : '');
    return '<div class="sum-row' + (isBest ? ' best' : '') + '">' +
      '<span class="sum-rank">' + pad2(index + 1) + '</span>' +
      '<div class="sum-main">' +
      '<div class="sum-line"><span class="sum-name">' + esc(prettyBat(result.bat)) + '</span>' + badges + '</div>' +
      '<div class="sum-meta">' + esc(meta) + '</div>' +
      '</div>' +
      '<span class="sum-score ' + scoreClass(result) + '">' + result.httpOk + '/' + result.httpTotal + '</span>' +
      '</div>';
  }

  function openSummary(model) {
    if (!model) return;
    state.summaryBest = model.best || null;
    state.summaryReturnFocus = document.activeElement && document.activeElement.focus
      ? document.activeElement
      : els.btnTestAll;
    state.summaryOpen = true;
    if (state.summaryTimer) clearTimeout(state.summaryTimer);

    els.notice.hidden = true;
    els.summaryTitle.textContent = model.title || (model.canceled ? 'Тест остановлен' : 'Тест завершён');
    if (!model.checked) {
      els.summarySub.textContent = 'Нет завершённых проверок';
    } else if (model.canceled) {
      els.summarySub.textContent = 'Проверено ' + model.checked + ' из ' + (model.total || model.checked);
    } else {
      els.summarySub.textContent = 'Проверено ' + model.checked + ' из ' + (model.total || model.checked) +
        (model.failed ? ' · сбоев: ' + model.failed : '');
    }

    const current = state.data && state.data.selectedBat;
    let html = '';
    model.rows.forEach((result, index) => {
      html += summaryRowHtml(result, index, model.best, current);
    });
    if (!html) {
      html = '<div class="sum-empty"><b>Нет успешных проверок</b>' +
        (model.checked ? 'Ни один батник не дал ответа. Обход восстановлен на прежней стратегии.' : 'Запусти «Тест всех», чтобы сравнить стратегии.') +
        '</div>';
    }
    els.summaryList.innerHTML = html;
    els.summaryList.scrollTop = 0;

    const bestIsCurrent = Boolean(model.best) && Boolean(current) &&
      model.best.toLowerCase() === current.toLowerCase();
    els.summaryApply.disabled = !model.best || bestIsCurrent;
    els.summaryApply.textContent = bestIsCurrent ? 'Уже применён' : 'Применить лучший';

    els.summaryLayer.hidden = false;
    requestAnimationFrame(() => {
      els.summaryLayer.classList.add('open');
      els.summaryPanel.focus();
    });
  }

  function closeSummary(focus) {
    if (!state.summaryOpen) return;
    state.summaryOpen = false;
    els.summaryLayer.classList.remove('open');
    if (state.summaryTimer) clearTimeout(state.summaryTimer);
    state.summaryTimer = setTimeout(() => {
      if (!state.summaryOpen) els.summaryLayer.hidden = true;
    }, 180);
    if (focus) {
      const target = state.summaryReturnFocus;
      if (target && target.isConnected && !target.disabled) target.focus();
      else els.btnTestAll.focus();
    }
  }

  /* ---------- поиск обхода ---------- */
  function probeData() {
    return state.data && state.data.probe ? state.data.probe : null;
  }

  function strategyWord(count) {
    const n = Math.abs(Number(count) || 0) % 100;
    if (n >= 11 && n <= 14) return 'стратегий';
    const last = n % 10;
    if (last === 1) return 'стратегия';
    if (last >= 2 && last <= 4) return 'стратегии';
    return 'стратегий';
  }

  function probeQuickCount() {
    return Math.min(6, state.data ? state.data.bats.length : 6);
  }

  function setProbeDns(text, cls) {
    state.probeDnsText = text || '';
    state.probeDnsClass = cls || '';
    if (!els.probeDns) return;
    els.probeDns.textContent = state.probeDnsText;
    els.probeDns.className = 'probe-dns' + (state.probeDnsClass ? ' ' + state.probeDnsClass : '');
  }

  function setProbeError(message) {
    const text = String(message || '');
    els.probeError.textContent = text;
    els.probeError.hidden = !text;
  }

  function setProbeMode(mode) {
    state.probeMode = mode === 'all' ? 'all' : 'quick';
    els.probeModeQuick.setAttribute('aria-checked', String(state.probeMode === 'quick'));
    els.probeModeAll.setAttribute('aria-checked', String(state.probeMode === 'all'));
  }

  function scheduleProbeDns(value) {
    if (state.probeDnsTimer) clearTimeout(state.probeDnsTimer);
    const token = ++state.probeDnsToken;
    const text = String(value || '').trim();
    if (!text) {
      setProbeDns('DNS проверится перед запуском', '');
      return;
    }
    const hostPart = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0];
    if (!hostPart.includes('.') && !hostPart.includes(':') && hostPart.toLowerCase() !== 'localhost') {
      setProbeDns('DNS проверится после ввода домена', '');
      return;
    }
    setProbeDns('Проверяю DNS…', '');
    state.probeDnsTimer = setTimeout(async () => {
      const res = await api.probeResolve(text).catch(() => null);
      if (token !== state.probeDnsToken || !state.probeOpen || state.probeView !== 'form') return;
      if (!res || !res.ok) {
        setProbeDns((res && res.error) || 'Домен не резолвится', 'bad');
        return;
      }
      if (res.address === '0.0.0.0') {
        setProbeDns('DNS: 0.0.0.0 · похоже, домен заглушен через hosts', 'warn');
      } else {
        setProbeDns('DNS: ' + res.address + (res.host ? ' · ' + res.host : ''), 'ok');
      }
    }, 450);
  }

  function openProbe() {
    if (state.probeOpen) return;
    if (state.settingsOpen) closeSettings(false);
    if (state.summaryOpen) closeSummary(false);
    state.probeOpen = true;
    state.probeReturnFocus = document.activeElement && document.activeElement.focus
      ? document.activeElement
      : els.btnProbe;
    const p = probeData();
    state.probeView = p && p.active ? 'run' : (p && p.finished ? 'result' : 'form');
    if (state.probeView === 'form') setProbeError('');
    if (!els.probeInput.value) els.probeInput.value = p && p.url ? p.url : '';
    els.probeLayer.hidden = false;
    renderProbe();
    if (state.probeView === 'form') scheduleProbeDns(els.probeInput.value);
    requestAnimationFrame(() => {
      els.probeLayer.classList.add('open');
      if (state.probeView === 'form') {
        els.probeInput.focus();
        els.probeInput.select();
      } else {
        els.probePanel.focus();
      }
    });
  }

  function closeProbe(focus) {
    if (!state.probeOpen) return;
    const p = probeData();
    if (state.probeStarting || (p && p.active) || (state.data && state.data.operation)) return;
    state.probeOpen = false;
    els.probeLayer.classList.remove('open');
    if (state.probeDnsTimer) clearTimeout(state.probeDnsTimer);
    if (state.probeTimer) clearTimeout(state.probeTimer);
    state.probeTimer = setTimeout(() => {
      if (!state.probeOpen) els.probeLayer.hidden = true;
    }, 180);
    if (p) api.probeClear().catch(() => {});
    if (focus) {
      const target = state.probeReturnFocus;
      if (target && target.isConnected && !target.disabled) target.focus();
      else els.btnProbe.focus();
    }
  }

  function probeRowHtml(row, index, bestBat, currentBat) {
    const isBest = Boolean(bestBat) && row.bat.toLowerCase() === bestBat.toLowerCase();
    const isCurrent = Boolean(currentBat) && row.bat.toLowerCase() === currentBat.toLowerCase();
    const ok = Boolean(row.ok);
    const status = String(row.status || '');
    const level = ok ? (/^[23]\d\d$/.test(status) ? 'ok' : 'warn') : 'fail';
    const badges = (isBest ? '<span class="sum-badge best">лучший</span>' : '') +
      (isCurrent ? '<span class="sum-badge live">сейчас</span>' : '');
    const meta = ok
      ? 'HTTP ' + status + ' · ' + (Number(row.ms) || 0) + ' мс'
      : (status || 'Ошибка') + (row.error ? ' · ' + row.error : '');
    const mark = ok
      ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 6.2l2.7 2.7L10 3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" stroke-linecap="round"/></svg>';
    return '<div class="probe-row ' + level + (isBest ? ' best' : '') + '">' +
      '<span class="probe-rank">' + pad2(index + 1) + '</span>' +
      '<span class="probe-dot"></span>' +
      '<div class="probe-main">' +
      '<div class="probe-line"><span class="probe-name">' + esc(prettyBat(row.bat)) + '</span>' + badges + '</div>' +
      '<div class="probe-meta">' + esc(meta) + '</div>' +
      '</div>' +
      '<span class="probe-mark">' + mark + '</span>' +
      '</div>';
  }

  function renderProbe() {
    if (!state.probeOpen) return;
    const p = probeData();
    const active = Boolean(p && p.active);
    if (active) state.probeView = 'run';
    else if (p && p.finished && state.probeView === 'run') state.probeView = 'result';
    if (!p && state.probeView !== 'form' && !state.probeStarting) state.probeView = 'form';

    const view = state.probeView;
    const form = view === 'form';
    const running = view === 'run';
    const result = view === 'result';
    const quick = probeQuickCount();
    const allCount = state.data ? state.data.bats.length : 0;

    els.probeForm.hidden = !form;
    els.probeRun.hidden = form;
    els.probeStart.hidden = !form;
    els.probeReset.hidden = !result;
    els.probeCancel.hidden = !running || !p || !p.active;
    els.probeApply.hidden = !result || !p || !p.best;
    els.probeClose.disabled = active || state.probeStarting || Boolean(state.data && state.data.operation);
    els.probeClose.title = active || state.probeStarting
      ? 'Идёт поиск — сначала отмените'
      : 'Закрыть поиск';
    els.probePanel.setAttribute('aria-busy', String(active));
    els.probeQuickSub.textContent = quick + ' ' + strategyWord(quick) + ' · ~1 мин';
    els.probeAllSub.textContent = allCount + ' ' + strategyWord(allCount) + ' · ~3–4 мин';
    els.probeModeQuick.setAttribute('aria-checked', String(state.probeMode === 'quick'));
    els.probeModeAll.setAttribute('aria-checked', String(state.probeMode === 'all'));
    els.probeError.hidden = !form || !els.probeError.textContent;
    els.probeAlert.hidden = !p || !p.error;
    if (p && p.error) els.probeAlert.textContent = p.error;

    if (form) {
      els.probeTitle.textContent = 'Найти обход';
      els.probeSub.textContent = 'Проверю, какая стратегия открывает сайт';
      els.probeNote.textContent = 'результаты не меняют общую статистику';
      setProbeDns(state.probeDnsText, state.probeDnsClass);
      return;
    }

    const done = p ? Number(p.tested) || 0 : 0;
    const total = p ? Number(p.total) || 0 : 0;
    const best = p ? p.best : null;
    const width = total ? Math.min(100, (done / total) * 100) : 0;
    els.probeBar.style.width = width.toFixed(1) + '%';

    if (running) {
      els.probeTitle.textContent = 'Ищу обход';
      els.probeSub.textContent = (p && p.domain ? p.domain + ' · ' : '') +
        (p && p.mode === 'all' ? 'все стратегии' : 'быстрый список');
      els.probeRunText.textContent = p && p.bat
        ? 'Проверяю ' + Math.min(done + 1, total) + ' из ' + total + ' · ' + prettyBat(p.bat)
        : 'Проверяю ' + done + ' из ' + total;
      els.probeRemain.textContent = p
        ? remainingText({ index: done + 1, total, startedAt: p.startedAt }, 9000).replace('осталось ', '')
        : '';
      els.probeCancel.disabled = Boolean(p && p.cancelRequested);
      els.probeCancel.textContent = p && p.cancelRequested ? 'Отмена…' : 'Отмена';
      els.probeNote.textContent = 'идёт поиск · можно отменить';
    } else {
      const aborted = Boolean(p && p.error && done < total);
      els.probeTitle.textContent = p && p.canceled
        ? 'Поиск остановлен'
        : (aborted ? 'Поиск прерван' : 'Поиск завершён');
      els.probeSub.textContent = 'Проверено ' + done + ' из ' + total +
        ' · ' + (p && p.mode === 'all' ? 'все стратегии' : 'быстрый список') +
        (best ? ' · лучший: ' + prettyBat(best) : ' · ответа нет');
      els.probeRunText.textContent = 'Проверено ' + done + ' из ' + total;
      els.probeRemain.textContent = p && p.canceled ? 'остановлено' : 'готово';
      els.probeNote.textContent = 'результаты не меняют общую статистику';
    }

    const current = state.data && state.data.selectedBat;
    const rows = p && Array.isArray(p.results) ? p.results : [];
    let html = '';
    rows.forEach((row, index) => {
      if (row && row.bat) html += probeRowHtml(row, index, best, current);
    });
    if (running && p && p.bat && !rows.some((row) => row.bat && row.bat.toLowerCase() === p.bat.toLowerCase())) {
      html += '<div class="probe-row current">' +
        '<span class="probe-rank">' + pad2(rows.length + 1) + '</span>' +
        '<span class="probe-dot"></span>' +
        '<div class="probe-main"><div class="probe-line"><span class="probe-name">' +
        esc(prettyBat(p.bat)) + '</span></div><div class="probe-meta">проверяю…</div></div>' +
        '<span class="probe-mark"></span>' +
        '</div>';
    }
    if (!html) {
      const emptyText = running
        ? 'Проверяю первую стратегию…'
        : (p && p.canceled ? 'Поиск отменён до первой проверки.' : 'Ни одна стратегия не дала ответа.');
      html = '<div class="sum-empty"><b>Пока нет результатов</b>' + emptyText + '</div>';
    }
    els.probeList.innerHTML = html;
    if (running) els.probeList.scrollTop = els.probeList.scrollHeight;

    const canCheckMore = result && p && p.mode === 'quick' && !best && allCount > done;
    els.probeMore.hidden = !canCheckMore;
    if (canCheckMore) els.probeFull.textContent = 'Проверить все ' + allCount;

    if (result && p) {
      const pending = p.pending || null;
      const saved = Boolean(p.saved);
      const bestIsCurrent = Boolean(best) && Boolean(current) &&
        best.toLowerCase() === current.toLowerCase();
      const blockedTarget = Boolean(pending && pending.alreadyInTargets && !pending.already);
      let label = 'Применить лучший';
      let disabled = !best || bestIsCurrent;
      let note = 'результаты не меняют общую статистику';

      if (saved) {
        label = 'Добавлено';
        disabled = true;
        note = 'Сайт добавлен.';
      } else if (pending && pending.builtin) {
        label = bestIsCurrent ? 'Уже применён' : 'Применить лучший';
        disabled = !best || bestIsCurrent;
        note = 'Домен уже в стандартной сборке.';
      } else if (blockedTarget) {
        label = 'Уже в списке';
        disabled = true;
        note = 'Сайт уже в targets.txt.';
      } else if (pending && pending.already) {
        if (!pending.enabled) {
          label = 'Включить и применить';
          disabled = !best;
          note = 'Сайт добавлен; обход выключен.';
        } else if (bestIsCurrent) {
          label = 'Уже применён';
          disabled = true;
          note = 'Сайт уже добавлен.';
        } else {
          label = 'Применить лучший';
          disabled = !best;
          note = 'Сайт уже в «Моих сайтах».';
        }
      } else if (pending) {
        label = 'Добавить и применить';
        disabled = !best;
        note = 'Сайт попадёт в «Мои сайты» и обход.';
      }

      els.probeApply.disabled = disabled || Boolean(state.data && state.data.operation);
      els.probeApply.textContent = label;
      els.probeNote.textContent = note;
    }
  }

  async function startProbe(resume) {
    if (state.probeStarting) return;
    const p = probeData();
    const value = resume && p ? p.url : els.probeInput.value;
    if (!String(value || '').trim()) {
      setProbeError('Введи домен или ссылку');
      els.probeInput.focus();
      return;
    }
    setProbeError('');
    state.probeStarting = true;
    state.probeView = 'run';
    renderProbe();
    const res = await api.probeRun({
      value,
      mode: resume ? 'all' : state.probeMode,
      resume: Boolean(resume)
    });
    state.probeStarting = false;
    const now = probeData();
    if (now && now.finished) {
      state.probeView = 'result';
      renderProbe();
      if (res && res.error && !now.error) showNotice(res.error);
      return;
    }
    state.probeView = 'form';
    renderProbe();
    setProbeError((res && res.error) || 'Не удалось начать поиск');
  }

  async function resetProbe() {
    const p = probeData();
    const url = p && p.url ? p.url : '';
    await api.probeClear().catch(() => null);
    state.probeView = 'form';
    state.probeStarting = false;
    setProbeError('');
    if (url) els.probeInput.value = url;
    setProbeDns('DNS проверится перед запуском', '');
    renderProbe();
    scheduleProbeDns(els.probeInput.value);
    els.probeInput.focus();
    els.probeInput.select();
  }

  /* ---------- настройки ---------- */
  function openSettings(focus) {
    if (state.settingsOpen) return;
    state.settingsOpen = true;
    if (state.settingsTimer) clearTimeout(state.settingsTimer);
    els.settingsLayer.hidden = false;
    requestAnimationFrame(() => els.settingsLayer.classList.add('open'));
    els.btnSettings.setAttribute('aria-expanded', 'true');
    if (focus) els.setClose.focus();
  }

  function closeSettings(focus) {
    if (!state.settingsOpen) return;
    state.settingsOpen = false;
    els.settingsLayer.classList.remove('open');
    els.btnSettings.setAttribute('aria-expanded', 'false');
    if (state.settingsTimer) clearTimeout(state.settingsTimer);
    state.settingsTimer = setTimeout(() => {
      if (!state.settingsOpen) els.settingsLayer.hidden = true;
    }, 200);
    if (focus) els.btnSettings.focus();
  }

  function trapFocus(event, panel) {
    if (event.key !== 'Tab' || !panel) return;
    const nodes = $$('button, input, [href], [tabindex]:not([tabindex="-1"])', panel)
      .filter((node) => !node.disabled && !node.hidden && node.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (document.activeElement === panel) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function setMaximized(maxed) {
    state.maxed = Boolean(maxed);
    if (els.icoMax && els.icoRestore) {
      els.icoMax.hidden = state.maxed;
      els.icoRestore.hidden = !state.maxed;
    }
    els.winMax.setAttribute('aria-label', state.maxed ? 'Восстановить' : 'Развернуть');
    els.winMax.title = state.maxed ? 'Восстановить' : 'Развернуть';
  }

  async function savePatch(patch, switchEl) {
    const res = await api.saveSettings(patch);
    if (!res || !res.ok) {
      if (switchEl) switchEl.setAttribute('aria-checked', switchEl.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
      showNotice((res && res.error) || 'Не удалось сохранить настройки');
      return;
    }
    if (res.autostartError) setSettingsMessage(res.autostartError);
    else if ('autostart' in patch) setSettingsMessage('');
    if (res.state) applyState(res.state);
  }

  function bindEvents() {
    els.btnSettings.addEventListener('click', () => {
      if (state.settingsOpen) closeSettings(true);
      else openSettings(true);
    });
    els.setClose.addEventListener('click', () => closeSettings(true));
    $('#scrim').addEventListener('click', () => closeSettings(true));
    els.settingsLayer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeSettings(true); return; }
      trapFocus(event, els.settingsPanel);
    });

    els.summaryClose.addEventListener('click', () => closeSummary(true));
    els.summaryDismiss.addEventListener('click', () => closeSummary(true));
    $('#summary-scrim').addEventListener('click', () => closeSummary(true));
    els.summaryLayer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeSummary(true); return; }
      trapFocus(event, els.summaryPanel);
    });
    els.summaryApply.addEventListener('click', async () => {
      const best = state.summaryBest;
      if (!best) return;
      els.summaryApply.disabled = true;
      const res = await api.applyBat(best);
      if (!res || !res.ok) {
        els.summaryApply.disabled = false;
        showNotice('Не удалось применить: ' + ((res && res.error) || 'неизвестная ошибка'));
        return;
      }
      closeSummary(true);
      showNotice('Подключён лучший: ' + prettyBat(best), 'info');
    });

    els.btnProbe.addEventListener('click', openProbe);
    els.probeClose.addEventListener('click', () => closeProbe(true));
    $('#probe-scrim').addEventListener('click', () => closeProbe(true));
    els.probeLayer.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        const p = probeData();
        if (!state.probeStarting && !(p && p.active)) closeProbe(true);
        return;
      }
      trapFocus(event, els.probePanel);
    });
    els.probeStart.addEventListener('click', () => startProbe(false));
    els.probeModeQuick.addEventListener('click', () => setProbeMode('quick'));
    els.probeModeAll.addEventListener('click', () => setProbeMode('all'));
    els.probeInput.addEventListener('input', () => {
      setProbeError('');
      scheduleProbeDns(els.probeInput.value);
    });
    els.probeInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      startProbe(false);
    });
    els.probeCancel.addEventListener('click', () => { api.probeCancel(); });
    els.probeFull.addEventListener('click', () => startProbe(true));
    els.probeReset.addEventListener('click', () => { resetProbe(); });
    els.probeApply.addEventListener('click', async () => {
      const p = probeData();
      if (!p || !p.best || p.saved) return;
      const pending = p.pending || null;
      const shouldSave = Boolean(pending && !pending.builtin &&
        (pending.already || !pending.alreadyInTargets));
      els.probeApply.disabled = true;
      const res = shouldSave ? await api.probeSave() : await api.applyBat(p.best);
      if (!res || !res.ok) {
        els.probeApply.disabled = false;
        renderProbe();
        showNotice((res && res.error) || 'Не удалось применить стратегию');
        return;
      }
      const name = pending ? pending.group : prettyBat(p.best);
      closeProbe(true);
      if (shouldSave) {
        showNotice((pending && pending.already ? 'Сайт включён: ' : 'Сайт добавлен: ') + name, 'info');
      } else {
        showNotice('Подключён лучший: ' + prettyBat(p.best), 'info');
      }
    });

    els.setAutostart.addEventListener('click', () => {
      const el = els.setAutostart;
      const next = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', String(next));
      savePatch({ autostart: next }, el);
    });
    els.setTray.addEventListener('click', () => {
      const el = els.setTray;
      const next = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', String(next));
      savePatch({ minimizeToTray: next }, el);
    });
    els.setPick.addEventListener('click', async () => {
      const dir = await api.pickDirectory();
      if (dir) savePatch({ zapretDir: dir }, null);
    });
    els.setTargets.addEventListener('click', async () => {
      const res = await api.openPath('targets');
      if (!res || !res.ok) showNotice((res && res.error) || 'Не удалось открыть targets.txt');
    });
    els.setLog.addEventListener('click', async () => {
      const res = await api.openPath('log');
      if (!res || !res.ok) showNotice((res && res.error) || 'Не удалось открыть журнал');
    });
    els.setFolder.addEventListener('click', async () => {
      const res = await api.openPath('folder');
      if (!res || !res.ok) showNotice((res && res.error) || 'Не удалось открыть папку');
    });
    els.setUpdate.addEventListener('click', async () => {
      els.setUpdate.disabled = true;
      els.setUpdateStatus.textContent = 'проверяю обновление…';
      const res = await api.checkUpdates().catch(() => null);
      els.setUpdate.disabled = false;
      els.setUpdateStatus.textContent = res && res.ok
        ? (res.update ? 'доступна версия ' + res.latest : 'установлена последняя версия')
        : ((res && res.error) || 'не удалось проверить');
    });
    els.setZapretUpdate.addEventListener('click', async () => {
      els.setZapretUpdate.disabled = true;
      els.setZapretStatus.textContent = 'проверяю сборку…';
      const res = await api.checkZapretUpdates().catch(() => null);
      els.setZapretUpdate.disabled = false;
      els.setZapretStatus.textContent = res && res.ok
        ? (res.update ? 'доступна сборка ' + res.latest : 'сборка актуальна')
        : ((res && res.error) || 'не удалось проверить');
    });
    els.setUninstall.addEventListener('click', async () => {
      const res = await api.uninstallApp().catch(() => null);
      if (!res || !res.ok) {
        if (!res || !res.canceled) showNotice((res && res.error) || 'Не удалось запустить удаление');
      }
    });
    if (els.setDownload) {
      els.setDownload.addEventListener('click', async () => {
        els.setDownload.disabled = true;
        closeSettings(false);
        const res = await api.installZapret().catch(() => null);
        els.setDownload.disabled = false;
        if (!res || !res.ok) {
          if (!res || !res.canceled) showNotice((res && res.error) || 'Не удалось скачать батники');
        }
      });
    }

    els.btnApply.addEventListener('click', async () => {
      if (!state.viewed) return;
      const res = await api.applyBat(state.viewed);
      if (!res || !res.ok) showNotice('Не удалось подключить: ' + ((res && res.error) || 'неизвестная ошибка'));
    });
    els.btnTestAll.addEventListener('click', async () => {
      if (state.data && (state.data.testing || state.data.operation)) return;
      const startedAt = Date.now() - 1000;
      const res = await api.testAll();
      if (!res || !res.ok) {
        showNotice('Тест всех не завершён: ' + ((res && res.error) || 'неизвестная ошибка'));
        return;
      }
      const fresh = await api.getState().catch(() => null);
      if (fresh) applyState(fresh);
      const summary = buildSummary({
        since: startedAt,
        canceled: Boolean(res.canceled),
        total: state.data ? state.data.bats.length : 0
      });
      if (summary.checked > 0) {
        openSummary(summary);
      } else if (res.canceled) {
        showNotice('Тест отменён. Обход восстановлен.', 'info');
      } else if (res.best) {
        showNotice('Тест завершён. Лучший: ' + prettyBat(res.best) + ' (' + res.bestOk + '/' + res.bestTotal + ')', 'info');
      } else {
        showNotice('Тест завершён. Ни один батник не запустился.');
      }
    });
    els.btnSummary.addEventListener('click', () => {
      if (!state.data) return;
      const results = currentResults();
      if (!results.length) {
        showNotice('Пока нет результатов проверок', 'info');
        return;
      }
      openSummary(buildSummary({
        total: state.data.bats.length,
        title: 'Последние результаты'
      }));
    });
    els.btnCheck.addEventListener('click', async () => {
      const res = await api.checkCurrent();
      if (!res || !res.ok) showNotice('Проверка не выполнена: ' + ((res && res.error) || 'неизвестная ошибка'));
    });
    els.btnPower.addEventListener('click', async () => {
      if (state.data && state.data.testing) {
        await api.cancelTest();
        return;
      }
      const res = await api.toggle();
      if (!res || !res.ok) showNotice('Не удалось переключить обход: ' + ((res && res.error) || 'неизвестная ошибка'));
    });
    els.bbCancel.addEventListener('click', () => {
      const p = state.data && state.data.probe;
      if (p && p.active) api.probeCancel();
      else api.cancelTest();
    });

    els.expandAll.addEventListener('click', () => {
      if (!state.data) return;
      state.collapsedGroups = {};
      for (const target of state.data.targets) state.expanded[target.group] = true;
      renderSites(true);
    });
    els.collapseAll.addEventListener('click', () => {
      state.expanded = {};
      if (state.data) {
        for (const target of state.data.targets) state.collapsedGroups[target.group] = true;
      }
      renderSites(true);
    });
    els.sites.addEventListener('click', async (event) => {
      const toggle = event.target.closest('[data-user-toggle]');
      if (toggle) {
        event.preventDefault();
        event.stopPropagation();
        const group = toggle.dataset.userToggle;
        const enabled = toggle.getAttribute('aria-checked') === 'true';
        const res = await api.setUserSite(group, !enabled);
        if (!res || !res.ok) showNotice((res && res.error) || 'Не удалось изменить обход');
        else showNotice((enabled ? 'Обход выключен: ' : 'Обход включён: ') + groupName(group), 'info');
        return;
      }
      const del = event.target.closest('[data-user-delete]');
      if (del) {
        event.preventDefault();
        event.stopPropagation();
        const group = del.dataset.userDelete;
        if (!confirm('Удалить «' + groupName(group) + '» из списка сайтов и обхода?')) return;
        const res = await api.deleteUserSite(group);
        if (!res || !res.ok) showNotice((res && res.error) || 'Не удалось удалить сайт');
        else showNotice('Сайт удалён: ' + groupName(group), 'info');
        return;
      }
      const head = event.target.closest('.cat-head');
      if (!head) return;
      const card = head.closest('.cat');
      const group = card.dataset.group;
      const open = !card.classList.contains('open');
      card.classList.toggle('open', open);
      head.setAttribute('aria-expanded', String(open));
      $('.cat-body', card).setAttribute('aria-hidden', String(!open));
      state.expanded[group] = open;
      if (open) delete state.collapsedGroups[group];
      else state.collapsedGroups[group] = true;
    });
    els.sites.addEventListener('keydown', (event) => {
      const toggle = event.target.closest('[data-user-toggle]');
      if (!toggle || (event.key !== ' ' && event.key !== 'Enter')) return;
      event.preventDefault();
      event.stopPropagation();
      toggle.click();
    });

    els.list.addEventListener('click', (event) => {
      const row = event.target.closest('.strategy');
      if (!row) return;
      selectBat(row.dataset.name, false);
    });
    els.list.addEventListener('dblclick', (event) => {
      const row = event.target.closest('.strategy');
      if (!row) return;
      selectBat(row.dataset.name, false);
      api.applyBat(row.dataset.name).then((res) => {
        if (!res || !res.ok) showNotice('Не удалось подключить: ' + ((res && res.error) || 'неизвестная ошибка'));
      });
    });
    els.list.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const rows = $$('.strategy', els.list);
      if (!rows.length) return;
      event.preventDefault();
      let index = rows.findIndex((r) => r.dataset.name === state.viewed);
      if (index < 0) index = 0;
      if (event.key === 'ArrowDown') index = Math.min(rows.length - 1, index + 1);
      if (event.key === 'ArrowUp') index = Math.max(0, index - 1);
      if (event.key === 'Home') index = 0;
      if (event.key === 'End') index = rows.length - 1;
      selectBat(rows[index].dataset.name, true);
    });

    els.search.addEventListener('input', () => {
      state.search = els.search.value;
      const names = visibleNames();
      if (names.length && !names.some((n) => state.viewed && n.toLowerCase() === state.viewed.toLowerCase())) {
        state.viewed = names[0];
      }
      renderStrategies(true);
      renderSites(false);
      renderMainSub();
    });
    els.search.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      els.search.value = '';
      state.search = '';
      renderStrategies(true);
      renderSites(false);
      renderMainSub();
      const row = $$('.strategy', els.list).find((r) => r.dataset.name === state.viewed);
      if (row) row.focus();
      else els.list.focus();
    });

    document.addEventListener('keydown', (event) => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if (event.key === '/' && !typing && !state.settingsOpen && !state.summaryOpen && !state.probeOpen) {
        event.preventDefault();
        els.search.focus();
        els.search.select();
        return;
      }
      if (event.key === 'Escape') {
        if (state.probeOpen) {
          event.preventDefault();
          const p = state.data && state.data.probe;
          if (!state.probeStarting && !(p && p.active)) closeProbe(true);
          return;
        }
        if (state.summaryOpen) {
          event.preventDefault();
          closeSummary(true);
          return;
        }
        if (state.settingsOpen) {
          event.preventDefault();
          closeSettings(true);
          return;
        }
        if (els.search.value) {
          event.preventDefault();
          els.search.value = '';
          state.search = '';
          renderStrategies(true);
          renderSites(false);
          renderMainSub();
        }
        return;
      }
      if (event.key === 'F5' && !state.settingsOpen && !state.summaryOpen && !state.probeOpen) {
        event.preventDefault();
        if (!els.btnCheck.disabled) els.btnCheck.click();
      }
    });

    els.noticeClose.addEventListener('click', () => { els.notice.hidden = true; });
    els.winMin.addEventListener('click', () => api.windowMinimize());
    els.winMax.addEventListener('click', () => api.windowMaximize());
    els.winClose.addEventListener('click', () => api.windowClose());

    api.onState(applyState);
    api.onTestProgress((payload) => {
      if (!payload) return;
      if (payload.done) return;
      const st = state.data;
      if (!st || !st.testing) return;
      Object.assign(st.testing, payload);
      renderStatus();
      renderBottom();
      updateControls();
    });
    api.onWindowMaximized(setMaximized);
    api.onOpenSettings(() => openSettings(true));
    api.onLog(() => { /* журнал доступен через файл; событие оставлено для отладки */ });
  }

  bindEvents();
  api.isMaximized().then(setMaximized).catch(() => {});
  api.getState().then(applyState).catch((err) => {
    showNotice('Не удалось получить состояние: ' + (err && err.message ? err.message : err));
  });
})();
