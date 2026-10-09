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
  /** live rich presence: what apps like VS Code / Spotify report locally */
  onActivity: (cb) => {
    const listener = (_e, activity) => cb(activity ?? null);
    ipcRenderer.on('rpc:activity', listener);
    return () => ipcRenderer.removeListener('rpc:activity', listener);
  },
  /** current bridge state: whether the IPC pipe is up and what's active */
  rpcState: () => ipcRenderer.invoke('rpc:get-state'),
  /** tell the bridge who's logged in so the handshake carries a real user */
  setRpcUser: (user) => ipcRenderer.send('rpc:set-user', user),
  /** open a Spotify / Steam / web link in the player or browser */
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
});
