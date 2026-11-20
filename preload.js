'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (event, payload) => {
    try { callback(payload); } catch { /* ignore */ }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  applyBat: (bat) => ipcRenderer.invoke('bat:apply', bat),
  toggle: () => ipcRenderer.invoke('obhod:toggle'),
  checkCurrent: () => ipcRenderer.invoke('sites:check'),
  testAll: () => ipcRenderer.invoke('test:all'),
  cancelTest: () => ipcRenderer.invoke('test:cancel'),
  probeRun: (payload) => ipcRenderer.invoke('probe:run', payload),
  probeCancel: () => ipcRenderer.invoke('probe:cancel'),
  probeClear: () => ipcRenderer.invoke('probe:clear'),
  probeResolve: (value) => ipcRenderer.invoke('probe:resolve', value),
  probeSave: () => ipcRenderer.invoke('probe:save'),
  setUserSite: (group, enabled) => ipcRenderer.invoke('site:set-enabled', group, enabled),
  deleteUserSite: (group) => ipcRenderer.invoke('site:delete', group),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  checkZapretUpdates: () => ipcRenderer.invoke('zapret:check'),
  uninstallApp: () => ipcRenderer.invoke('app:uninstall'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  pickDirectory: () => ipcRenderer.invoke('dialog:dir'),
  openPath: (kind) => ipcRenderer.invoke('path:open', kind),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onState: (cb) => subscribe('state', cb),
  onTestProgress: (cb) => subscribe('testProgress', cb),
  onLog: (cb) => subscribe('log', cb),
  onWindowMaximized: (cb) => subscribe('window:maximized', cb),
  onOpenSettings: (cb) => subscribe('open-settings', cb)
});
