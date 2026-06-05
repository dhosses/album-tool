const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let firstRun = false;

const userDataDir = app.getPath('userData');
const envDest = path.join(userDataDir, '.env');
const envSrc = path.join(__dirname, '.env.example');

function ensureEnv() {
  if (!fs.existsSync(envDest)) {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(envDest, fs.readFileSync(envSrc, 'utf8'));
    firstRun = true;
  }
}

function readPort() {
  try {
    const content = fs.readFileSync(envDest, 'utf8');
    const m = content.match(/^PORT=(\d+)/m);
    if (m) return parseInt(m[1]);
  } catch (_) {}
  return 3000;
}

function waitForServer(port, callback) {
  let attempts = 0;
  function attempt() {
    attempts++;
    const req = http.get(`http://localhost:${port}/`, (res) => {
      res.destroy();
      callback(null);
    });
    req.on('error', () => {
      if (attempts >= 50) {
        callback(new Error('Server did not start in time'));
      } else {
        setTimeout(attempt, 100);
      }
    });
    req.end();
  }
  attempt();
}

function buildMenu(envPath) {
  const template = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Open Config File (.env)',
          click: () => shell.openPath(envPath),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Album Tool',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  ensureEnv();

  process.env.ENV_FILE = envDest;
  const port = readPort();

  require('./server.js');

  Menu.setApplicationMenu(buildMenu(envDest));

  waitForServer(port, (err) => {
    if (err) {
      const { dialog } = require('electron');
      dialog.showErrorBox('Album Tool', 'The server failed to start. Please restart the app.');
      app.quit();
      return;
    }
    createWindow(port);
    if (firstRun) {
      shell.openPath(envDest);
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) {
    const port = readPort();
    createWindow(port);
  }
});
