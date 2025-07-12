const { app, BrowserWindow, Tray, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { startEmbeddedServer, stopEmbeddedServer } = require('./server-embedded.cjs');

// 保持对窗口对象的全局引用
let mainWindow;
let tray;
let serverPort = 3000;

const isDev = process.argv.includes('--dev');

function findAvailablePort(startPort = 3000) {
  return new Promise((resolve) => {
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
      
      console.log('Starting PairDrop embedded server on port:', serverPort);
      
      // 使用嵌入式服务器
      const resourcePath = isDev ? __dirname : process.resourcesPath;
      await startEmbeddedServer(serverPort, isDev, resourcePath);
      
      console.log('PairDrop embedded server started successfully');
      resolve();
      
    } catch (error) {
      console.error('Error starting embedded server:', error);
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
      webSecurity: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
    icon: isDev 
      ? path.join(__dirname, 'assets/icon.png')
      : path.join(process.resourcesPath, 'app/electron/assets/icon.png'),
    titleBarStyle: 'default',
    show: false,
    title: 'PairDrop'
  });

  // 加载本地服务器
  const serverUrl = `http://localhost:${serverPort}`;
  console.log('Loading URL:', serverUrl);
  
  mainWindow.loadURL(serverUrl);

  // 当窗口准备好显示时显示窗口
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
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

  // 处理页面导航
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://localhost:${serverPort}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

function createTray() {
  const iconPath = isDev 
    ? path.join(__dirname, 'assets/tray-icon.png')
    : path.join(process.resourcesPath, 'app/electron/assets/tray-icon.png');
  
  // 如果图标文件不存在，跳过托盘创建
  if (!fs.existsSync(iconPath)) {
    console.log('Tray icon not found, skipping tray creation');
    return;
  }
  
  try {
    tray = new Tray(iconPath);
    
    // 获取本机IP地址
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();
    const localIPs = [];
    
    Object.keys(networkInterfaces).forEach(interfaceName => {
      const addresses = networkInterfaces[interfaceName];
      addresses.forEach(address => {
        if (address.family === 'IPv4' && !address.internal) {
          localIPs.push(address.address);
        }
      });
    });
    
    // 构建菜单项
    const menuItems = [
      {
        label: 'Show PairDrop',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: `Local: http://localhost:${serverPort}`,
        click: () => {
          shell.openExternal(`http://localhost:${serverPort}`);
        }
      }
    ];
    
    // 添加局域网访问地址
    if (localIPs.length > 0) {
      menuItems.push({ type: 'separator' });
      menuItems.push({
        label: 'LAN Access (for other devices):',
        enabled: false
      });
      
      localIPs.forEach(ip => {
        menuItems.push({
          label: `http://${ip}:${serverPort}`,
          click: () => {
            // 复制到剪贴板
            const { clipboard } = require('electron');
            clipboard.writeText(`http://${ip}:${serverPort}`);
            
            // 可选：显示通知
            const { Notification } = require('electron');
            if (Notification.isSupported()) {
              new Notification({
                title: 'PairDrop',
                body: `URL copied to clipboard: http://${ip}:${serverPort}`
              }).show();
            }
          }
        });
      });
    }
    
    menuItems.push(
      { type: 'separator' },
      {
        label: 'Open in Browser',
        click: () => {
          shell.openExternal(`http://localhost:${serverPort}`);
        }
      },
      { type: 'separator' },
      {
        label: 'Quit PairDrop',
        click: () => {
          app.quit();
        }
      }
    );
    
    const contextMenu = Menu.buildFromTemplate(menuItems);
    tray.setContextMenu(contextMenu);
    tray.setToolTip('PairDrop - Local file sharing');
    
    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
    
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    
  } catch (error) {
    console.error('Failed to create tray:', error);
  }
}

// 当Electron完成初始化时调用
app.whenReady().then(async () => {
  try {
    console.log('App is ready, starting server...');
    await startServer();
    createWindow();
    createTray();
    
    app.on('activate', () => {
      // macOS上点击dock图标时重新创建窗口
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else if (mainWindow) {
        mainWindow.show();
      }
    });
    
  } catch (error) {
    console.error('Failed to start application:', error);
    dialog.showErrorBox('启动错误', '无法启动PairDrop服务器: ' + error.message);
    app.quit();
  }
});

// 当所有窗口都关闭时
app.on('window-all-closed', () => {
  // 在macOS上保持应用运行
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用退出前清理
app.on('before-quit', () => {
  console.log('App is quitting, cleaning up...');
  stopEmbeddedServer();
});

// 防止多个实例
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 运行第二个实例时聚焦到主窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 处理证书错误（开发环境）
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (isDev && url.startsWith(`http://localhost:${serverPort}`)) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

// 安全性设置
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
  
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    
    if (parsedUrl.origin !== `http://localhost:${serverPort}`) {
      event.preventDefault();
    }
  });
});