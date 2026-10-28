import crypto from "node:crypto";
import path from "node:path";
import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from "electron";
import { appRoot } from "../core/paths.js";
import { startServer } from "../server/http.js";

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

async function createWindow(url: string) {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    title: "Fivebar",
    backgroundColor: "#F6F5F1",
    icon: path.join(appRoot(), "assets", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Links to other sites open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
  await win.loadURL(url);
}

app.whenReady().then(async () => {
  const token = crypto.randomBytes(24).toString("hex");
  const server = await startServer({ port: 0, token });
  await createWindow(server.url);

  tray = new Tray(nativeImage.createFromPath(path.join(appRoot(), "assets", "tray.png")));
  tray.setToolTip("Fivebar");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Fivebar", click: () => { win?.show(); win?.focus(); } },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; server.close(); app.quit(); } },
  ]));
  tray.on("click", () => { win?.show(); win?.focus(); });

  // Smoke test for CI and the build log: save what the window shows, then quit.
  if (process.env.FIVEBAR_SMOKE_SHOT) {
    await new Promise((r) => setTimeout(r, 2500));
    const img = await win!.webContents.capturePage();
    (await import("node:fs")).writeFileSync(process.env.FIVEBAR_SMOKE_SHOT, img.toPNG());
    quitting = true;
    server.close();
    app.quit();
  }
});

app.on("window-all-closed", () => {
  // Fivebar keeps running in the tray. Quit from the tray menu.
});
