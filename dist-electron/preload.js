import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('electronAPI', {
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
    saveFile: (path, data) => ipcRenderer.invoke('file:saveFile', { path, data }),
    saveAs: (data, defaultName) => ipcRenderer.invoke('dialog:saveAs', { data, defaultName }),
    selectFilesToMerge: () => ipcRenderer.invoke('dialog:selectFilesToMerge'),
    printFile: (path) => ipcRenderer.invoke('file:print', { path }),
});
