'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('venbandUpdate', {
  onInfo: (fn) => ipcRenderer.on('update:info', (_e, info) => fn(info)),
  onProgress: (fn) => ipcRenderer.on('update:progress', (_e, p) => fn(p)),
  onReady: (fn) => ipcRenderer.on('update:ready', () => fn()),
  onError: (fn) => ipcRenderer.on('update:error', (_e, msg) => fn(msg)),
  start: () => ipcRenderer.send('update:start'),
  later: () => ipcRenderer.send('update:later'),
});
