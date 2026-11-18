const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('reminder', Object.freeze({
  onOpenCampus: callback => { const listener=()=>callback();ipcRenderer.on('reminder:open-campus',listener);return ()=>ipcRenderer.removeListener('reminder:open-campus',listener); },
  invoke: (action, payload) => ipcRenderer.invoke('reminder:action', action, payload),
  onCampusSession: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('reminder:campus-session', listener); return () => ipcRenderer.removeListener('reminder:campus-session', listener); },
  onState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('reminder:state', listener); return () => ipcRenderer.removeListener('reminder:state', listener); },
  onSound: callback => { const listener = () => callback(); ipcRenderer.on('reminder:sound', listener); return () => ipcRenderer.removeListener('reminder:sound', listener); }
}));
