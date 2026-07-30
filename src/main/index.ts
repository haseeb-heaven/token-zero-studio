import { app, BrowserWindow, nativeTheme } from 'electron';
import * as path from 'node:path';
import { resolveTheme } from '../core/theme';
import { currentConfig, registerIpc, Shutdown } from './ipc';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const config = currentConfig();
  const dark = resolveTheme(config?.theme ?? 'system', nativeTheme.shouldUseDarkColors) === 'dark';
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: dark ? '#0b0f17' : '#f2f4f9',
    title: 'TokenZero - Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  registerIpc(() => mainWindow);
  nativeTheme.themeSource = currentConfig()?.theme ?? 'system';
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  Shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  Shutdown();
});
