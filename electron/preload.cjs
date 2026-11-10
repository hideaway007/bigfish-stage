const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  isNativeApp: true,
  sendCommand: (command) => ipcRenderer.send('stage-command', command),
  onMessage: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('stage-message', listener);
    return () => ipcRenderer.removeListener('stage-message', listener);
  },
  pickDirectory: () => ipcRenderer.invoke('native-pick-directory'),
});
