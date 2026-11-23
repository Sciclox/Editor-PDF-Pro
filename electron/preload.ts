import { contextBridge, ipcRenderer } from 'electron';

// Extract pure ArrayBuffer from any TypedArray/ArrayBuffer to avoid plain object serialization through bridge
const toArrayBuffer = (data: any): any => {
  if (!data) return data;
  if (data instanceof ArrayBuffer || (data.constructor && data.constructor.name === 'ArrayBuffer') || Object.prototype.toString.call(data) === '[object ArrayBuffer]') {
    return data;
  }
  if (ArrayBuffer.isView(data) || (data.constructor && data.constructor.name === 'Uint8Array') || Object.prototype.toString.call(data) === '[object Uint8Array]') {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  return data;
};

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openImage: () => ipcRenderer.invoke('dialog:openImage'),
  saveFile: (path: string, data: Uint8Array) => ipcRenderer.invoke('file:saveFile', { path, data: toArrayBuffer(data) }),
  saveAs: (data: Uint8Array, defaultName: string) => ipcRenderer.invoke('dialog:saveAs', { data: toArrayBuffer(data), defaultName }),
  selectFilesToMerge: () => ipcRenderer.invoke('dialog:selectFilesToMerge'),
  printFile: (path: string) => ipcRenderer.invoke('file:print', { path }),
  encryptPdf: (data: Uint8Array, userPassword: string, ownerPassword: string) => ipcRenderer.invoke('pdf:encrypt', { data: toArrayBuffer(data), userPassword, ownerPassword }),
});
