import { app, BrowserWindow, Tray, Menu, shell, dialog, ipcMain } from 'electron';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path, { dirname } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 保持对窗口对象的全局引用，如果不这样做，窗口将
// 在JavaScript对象被垃圾回收时自动关闭。
let mainWindow;
let tray;
let serverProcess;
let serverPort = 3000;

const isDev = process.argv.includes('--dev');

function findAvailablePort(startPort = 3000) {
  return new Promise(async (resolve) => {
    const net = await import('net');
    const server = net.createServer();
    
    server.listen(startPort, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    
    server.on('error', () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

function startServer() {
  return new Promise(async (resolve, reject) => {
    try {
      // 查找可用端口
      serverPort = await findAvailablePort(3000);
      
      // 确定服务器文件路径
      const serverPath = isDev 
        ? path.join(__dirname, '../server/index.js')
        : path.join(process.resourcesPath, 'app/server/index.js');
      
      console.log('Starting PairDrop server on port:', serverPort);
      console.log('Server path:', serverPath);
      
      // 启动服务器
      serverProcess = spawn('node', [serverPath], {
        env: { 
          ...process.env, 
          PORT: serverPort,
          DEBUG_MODE: isDev ? 'true' : 'false'
        },
        stdio: isDev ? 'inherit' : 'pipe'
      });
      
      serverProcess.on('error', (error) => {
        console.error('Failed to start server:', error);
        reject(error);
      });
      
      // 等待服务器启动
      setTimeout(() => {
        console.log('PairDrop server started successfully');
        resolve();
      }, 3000);
      
    } catch (error) {
      console.error('Error starting server:', error);
      reject(error);
    }
  });
}

function createWindow() {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    icon: isDev 
      ? path.join(__dirname, 'assets/icon.png')
      : path.join(process.resourcesPath, 'app/electron/assets/icon.png'),
    titleBarStyle: 'default',
    show: false
  });

  // 加载本地服务器
  const serverUrl = `http://localhost:${serverPort}`;
  console.log('Loading URL:', serverUrl);
  
  mainWindow.loadURL(serverUrl);

  // 当窗口准备好显示时显示窗口
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 当窗口关闭时发出的事件
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 处理外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 开发模式下打开开发者工具
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

function createTray() {
  const iconPath = isDev 
    ? path.join(__dirname, 'assets/tray-icon.png')
    : path.join(process.resourcesPath, 'app/electron/assets/tray-icon.png');
  
  // 如果图标文件不存在，使用默认图标
  const trayIconPath = fs.existsSync(iconPath) ? iconPath : null;
  
  if (trayIconPath) {
    tray = new Tray(trayIconPath);
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show PairDrop',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
          }
        }
      },
      {
        label: `Server: http://localhost:${serverPort}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Open in Browser',
        click: () => {
          shell.openExternal(`http://localhost:${serverPort}`);
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit();
        }
      }
    ]);
    
    tray.setContextMenu(contextMenu);
    tray.setToolTip('PairDrop - Local file sharing');
    
    tray.on('click', () => {
      if (mainWindow) {
        mainWindow.show();
      }
    });
  }
}

// 这个方法当Electron完成初始化并准备创建浏览器窗口时被调用
// 某些API只能在该事件发生后使用
app.whenReady().then(async () => {
  try {
    console.log('App is ready, starting server...');
    await startServer();
    createWindow();
    createTray();
    
    app.on('activate', () => {
      // 在macOS上，当单击dock图标并且没有其他窗口打开时，
      // 通常在应用程序中重新创建一个窗口。
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
    
  } catch (error) {
    console.error('Failed to start application:', error);
    dialog.showErrorBox('启动错误', '无法启动PairDrop服务器: ' + error.message);
    app.quit();
  }
});

// 当所有窗口都关闭时退出应用
app.on('window-all-closed', () => {
  // 在macOS上，通常应用程序及其菜单栏保持活动状态，
  // 直到用户明确使用Cmd + Q退出
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用退出前清理服务器进程
app.on('before-quit', () => {
  console.log('App is quitting, cleaning up...');
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
});

// 防止多个实例
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 当运行第二个实例时，聚焦到主窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// 安全性：防止新窗口
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});