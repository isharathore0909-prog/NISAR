const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const os = require("os");
const isDev = process.env.NODE_ENV === "development";

if (isDev) {
  process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#0a0b1e",
    webPreferences: {
      nodeIntegration: false, // Better security
      contextIsolation: true, // Better security
      preload: path.join(__dirname, "preload.js"),
    },
    show: false,
  });

  // In development, load from Vite dev server
  // In production, load the built index.html
  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools();
    
    // If the server isn't ready, retry after 1 second
    win.webContents.on("did-fail-load", () => {
      console.log("Failed to load, retrying in 1s...");
      setTimeout(() => {
        win.loadURL("http://localhost:5173");
      }, 1000);
    });
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  win.once("ready-to-show", () => {
    win.show();
  });
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("dialog:openDirectory", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (canceled) {
      return null;
    } else {
      return filePaths[0];
    }
  });

  // Fetch real system stats
  ipcMain.handle("system:getStats", async () => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsage = ((usedMem / totalMem) * 100).toFixed(1);
    
    // CPU info
    const cpus = os.cpus();
    const cpuModel = cpus[0].model.split("@")[0].trim();
    const cpuCount = cpus.length;
    
    // Simple CPU Load (Load average isn't great on Windows, so we use a dummy for now or calculate)
    // On Windows loadavg is always [0, 0, 0]. 
    // For now we'll return the core count and model.
    
    return {
      ram: {
        total: (totalMem / (1024 ** 3)).toFixed(1) + "GB",
        used: (usedMem / (1024 ** 3)).toFixed(1) + "GB",
        usage: memUsage + "%"
      },
      cpu: {
        model: cpuModel,
        cores: cpuCount,
        usage: "Calculating..." // We'll handle usage in the UI or leave as is
      },
      platform: os.platform(),
      version: app.getVersion()
    };
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
