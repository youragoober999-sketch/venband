'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('venbandPicker', {
  onSources: (fn) => ipcRenderer.on('picker:sources', (_e, list) => fn(list)),
  choose: (id) => ipcRenderer.send('picker:choose', id),
});
