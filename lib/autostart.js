'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runProcess } = require('./zapret');

const SYSTEM32 = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32');
const TASK_NAME = 'ZapretMini';

function xmlEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function currentUser() {
  if (process.env.USERDOMAIN && process.env.USERNAME) {
    return process.env.USERDOMAIN + '\\' + process.env.USERNAME;
  }
  try { return os.userInfo().username; } catch { return ''; }
}

function buildXml(exePath) {
  const user = xmlEscape(currentUser());
  const exe = xmlEscape(exePath);
  return '<?xml version="1.0" encoding="UTF-16"?>\r\n' +
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\r\n' +
    '  <RegistrationInfo><Description>Zapret Mini</Description></RegistrationInfo>\r\n' +
    '  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>' + user + '</UserId></LogonTrigger></Triggers>\r\n' +
    '  <Principals><Principal id="Author"><UserId>' + user + '</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>\r\n' +
    '  <Settings>\r\n' +
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\r\n' +
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\r\n' +
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\r\n' +
    '    <AllowHardTerminate>true</AllowHardTerminate>\r\n' +
    '    <StartWhenAvailable>true</StartWhenAvailable>\r\n' +
    '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>\r\n' +
    '    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>\r\n' +
    '    <AllowStartOnDemand>true</AllowStartOnDemand>\r\n' +
    '    <Enabled>true</Enabled><Hidden>false</Hidden><RunOnlyIfIdle>false</RunOnlyIfIdle>\r\n' +
    '    <WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>7</Priority>\r\n' +
    '  </Settings>\r\n' +
    '  <Actions Context="Author"><Exec><Command>' + exe + '</Command><Arguments>--tray</Arguments></Exec></Actions>\r\n' +
    '</Task>\r\n';
}

function writeTaskXml(dir, xml) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'task-electron.xml');
  const bom = Buffer.from([0xFF, 0xFE]);
  const body = Buffer.from(xml, 'utf16le');
  fs.writeFileSync(file, Buffer.concat([bom, body]));
  return file;
}

async function isEnabled() {
  const res = await runProcess(path.join(SYSTEM32, 'schtasks.exe'),
    ['/Query', '/TN', TASK_NAME], { timeout: 20000 });
  return res.code === 0;
}

async function matches(exePath) {
  const res = await runProcess(path.join(SYSTEM32, 'schtasks.exe'),
    ['/Query', '/TN', TASK_NAME, '/XML'], { timeout: 20000 });
  if (res.code !== 0) return false;
  const needle = String(exePath || '').toLowerCase();
  if (!needle) return false;
  return (res.output || '').toLowerCase().indexOf(needle) >= 0;
}

async function enable(appDataDir, exePath, logger) {
  try {
    const xml = buildXml(exePath);
    const file = writeTaskXml(appDataDir, xml);
    const res = await runProcess(path.join(SYSTEM32, 'schtasks.exe'),
      ['/Create', '/TN', TASK_NAME, '/XML', file, '/F'], { timeout: 25000 });
    if (res.code !== 0) {
      if (logger) logger.write('Автозапуск: schtasks вернул ' + res.code + ': ' + res.output);
      return { ok: false, error: (res.output || 'schtasks не смог создать задачу').trim() };
    }
    if (logger) logger.write('Автозапуск включён: ' + exePath);
    return { ok: true, error: null };
  } catch (err) {
    if (logger) logger.write('Автозапуск: ошибка: ' + err.message);
    return { ok: false, error: err.message };
  }
}

async function disable(logger) {
  const res = await runProcess(path.join(SYSTEM32, 'schtasks.exe'),
    ['/Delete', '/TN', TASK_NAME, '/F'], { timeout: 20000 });
  if (res.code !== 0) {
    const still = await isEnabled();
    if (still) {
      if (logger) logger.write('Автозапуск: не удалось удалить: ' + res.output);
      return { ok: false, error: (res.output || 'не удалось удалить задачу').trim() };
    }
  }
  if (logger) logger.write('Автозапуск выключен');
  return { ok: true, error: null };
}

module.exports = { isEnabled, matches, enable, disable, buildXml, TASK_NAME };
