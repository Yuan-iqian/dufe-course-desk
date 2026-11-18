const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('campusCard', Object.freeze({
  action: value => ipcRenderer.invoke('campus-card:action', value),
  onState: callback => ipcRenderer.on('campus-card:state', (_event,state)=>callback(state))
}));
