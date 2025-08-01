const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  exportRecipes: (urls) => ipcRenderer.invoke('export-recipes', urls)
});
