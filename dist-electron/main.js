import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let mainWindow = null;
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 720,
        title: 'Editor PDF Pro',
        titleBarStyle: 'default', // Standard OS title bar
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    // In development, load the Vite dev server.
    // In production, load the built index.html.
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
// Helper function to safely convert Uint8Array/Object/ArrayBuffer data from IPC into Node Buffer
function ensureBuffer(data) {
    if (!data) {
        return Buffer.alloc(0);
    }
    if (Buffer.isBuffer(data)) {
        return data;
    }
    if (data instanceof ArrayBuffer) {
        return Buffer.from(data);
    }
    if (data instanceof Uint8Array) {
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }
    if (data && typeof data === 'object') {
        if (data.type === 'Buffer' && Array.isArray(data.data)) {
            return Buffer.from(data.data);
        }
        // Object values fallback (serialized array keys)
        const values = Object.values(data);
        return Buffer.from(values);
    }
    return Buffer.from(data);
}
// IPC Handler: Open File Dialog and Read File
ipcMain.handle('dialog:openFile', async () => {
    if (!mainWindow)
        return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Abrir Documento PDF',
        properties: ['openFile'],
        filters: [{ name: 'Archivos PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }
    const filePath = result.filePaths[0];
    const fileBuffer = fs.readFileSync(filePath);
    return {
        name: path.basename(filePath),
        path: filePath,
        data: fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength),
    };
});
// IPC Handler: Direct Save File to existing path
ipcMain.handle('file:saveFile', async (_event, { path: filePath, data }) => {
    try {
        const buffer = ensureBuffer(data);
        fs.writeFileSync(filePath, buffer);
        return { success: true };
    }
    catch (error) {
        console.error('Error al guardar archivo:', error);
        return { success: false, error: error.message };
    }
});
// IPC Handler: Save As Dialog
ipcMain.handle('dialog:saveAs', async (_event, { data, defaultName }) => {
    if (!mainWindow)
        return null;
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Guardar PDF Como',
        defaultPath: defaultName || 'documento_editado.pdf',
        filters: [{ name: 'Archivos PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) {
        return { success: false, error: 'Guardado cancelado' };
    }
    try {
        const buffer = ensureBuffer(data);
        fs.writeFileSync(result.filePath, buffer);
        return {
            success: true,
            path: result.filePath,
            name: path.basename(result.filePath)
        };
    }
    catch (error) {
        console.error('Error al guardar como:', error);
        return { success: false, error: error.message };
    }
});
// IPC Handler: Select Multiple PDF Files to Merge
ipcMain.handle('dialog:selectFilesToMerge', async () => {
    if (!mainWindow)
        return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Seleccionar Archivos PDF para Combinar',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Archivos PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }
    const files = result.filePaths.map((filePath) => {
        const fileBuffer = fs.readFileSync(filePath);
        return {
            name: path.basename(filePath),
            path: filePath,
            data: fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength),
        };
    });
    return files;
});
// IPC Handler: Open Image File Dialog
ipcMain.handle('dialog:openImage', async () => {
    if (!mainWindow)
        return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Seleccionar Imagen',
        properties: ['openFile'],
        filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }],
    });
    if (result.canceled || result.filePaths.length === 0)
        return null;
    const filePath = result.filePaths[0];
    const fileBuffer = fs.readFileSync(filePath);
    return {
        name: path.basename(filePath),
        path: filePath,
        data: fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength),
    };
});
// IPC Handler: Encrypt PDF with password
ipcMain.handle('pdf:encrypt', async (_event, { data, userPassword, ownerPassword }) => {
    try {
        const qpdf = require('node-qpdf2');
        const os = require('os');
        const pathModule = require('path');
        const fsModule = require('fs');
        const tmpDir = os.tmpdir();
        const inputPath = pathModule.join(tmpDir, `pdf_encrypt_input_${Date.now()}.pdf`);
        const outputPath = pathModule.join(tmpDir, `pdf_encrypt_output_${Date.now()}.pdf`);
        fsModule.writeFileSync(inputPath, ensureBuffer(data));
        const options = {
            keyLength: 256,
            password: userPassword || ownerPassword || '',
            restrictions: {
                ...(ownerPassword ? { ownerPassword } : {}),
            }
        };
        try {
            await qpdf.encrypt(inputPath, outputPath, options);
            const encryptedBytes = fsModule.readFileSync(outputPath);
            // Cleanup temp files
            try {
                fsModule.unlinkSync(inputPath);
            }
            catch { }
            try {
                fsModule.unlinkSync(outputPath);
            }
            catch { }
            return { success: true, data: new Uint8Array(encryptedBytes) };
        }
        catch (qpdfError) {
            // Cleanup temp files on error
            try {
                fsModule.unlinkSync(inputPath);
            }
            catch { }
            try {
                fsModule.unlinkSync(outputPath);
            }
            catch { }
            throw qpdfError;
        }
    }
    catch (error) {
        console.error('Error al cifrar PDF:', error);
        return { success: false, error: error.message };
    }
});
// IPC Handler: Print File Trigger
ipcMain.handle('file:print', async (_event, { path: filePath }) => {
    if (!mainWindow)
        return { success: false, error: 'No hay ventana activa' };
    try {
        const { shell } = require('electron');
        await shell.openPath(filePath);
        return { success: true };
    }
    catch (error) {
        console.error('Error al imprimir:', error);
        return { success: false, error: error.message };
    }
});
