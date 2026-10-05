// The only things venband.com can ask the desktop app to do.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('venbandDesktop', {
  isDesktop: true,
  /** unread count on the taskbar / dock */
  setBadge: (count) => ipcRenderer.send('venband:badge', Number(count) || 0),
  /** flash the taskbar button (incoming call, mention) */
  flash: () => ipcRenderer.send('venband:flash'),
  info: () => ipcRenderer.invoke('venband:info'),
});
