export interface ElectronAPI {
  openFile: () => Promise<{ name: string; path: string; data: Uint8Array } | null>;
  openImage: () => Promise<{ name: string; path: string; data: Uint8Array } | null>;
  saveFile: (path: string, data: Uint8Array) => Promise<{ success: boolean; error?: string }>;
  saveAs: (data: Uint8Array, defaultName: string) => Promise<{ success: boolean; path?: string; name?: string; error?: string }>;
  selectFilesToMerge: () => Promise<Array<{ name: string; path: string; data: Uint8Array }> | null>;
  printFile: (path: string) => Promise<{ success: boolean }>;
  encryptPdf: (data: Uint8Array, userPassword: string, ownerPassword: string) => Promise<{ success: boolean; data?: Uint8Array; error?: string }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
