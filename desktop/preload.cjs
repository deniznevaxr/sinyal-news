// The page's only bridge to the desktop shell: it reports its theme setting so the
// window's title bar can follow it. Nothing else from Electron or Node is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sinyalDesktop', {
  setTheme: theme => ipcRenderer.send('sinyal:theme', String(theme)),
});
