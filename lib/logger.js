'use strict';

const fs = require('fs');
const path = require('path');

const MAX_LOG_BYTES = 2 * 1024 * 1024;

function pad(n) {
  return String(n).padStart(2, '0');
}

function stamp(d) {
  const date = d || new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

class Logger {
  constructor(dir, onLine) {
    this.dir = dir;
    this.file = path.join(dir, 'electron.log');
    this.onLine = onLine || null;
  }

  write(message) {
    const text = String(message == null ? '' : message).replace(/[\r\n]+/g, ' ');
    const line = `[${stamp()}] ${text}`;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      let size = 0;
      try { size = fs.statSync(this.file).size; } catch { /* нет файла */ }
      if (size > MAX_LOG_BYTES) {
        const old = this.file + '.old';
        try { fs.rmSync(old, { force: true }); } catch { /* ignore */ }
        try { fs.renameSync(this.file, old); } catch { /* ignore */ }
      }
      fs.appendFileSync(this.file, line + '\r\n', 'utf8');
    } catch { /* журнал не должен ронять приложение */ }
    if (this.onLine) {
      try { this.onLine(line); } catch { /* ignore */ }
    }
  }
}

module.exports = { Logger, stamp };
