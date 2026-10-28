// Renders assets/icon.png (512 px app icon) and assets/tray.png (32 px, three bars) from SVG.
// npx electron scripts/render-icons.mjs
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const TRAY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">
  <defs><clipPath id="s"><path d="M40 30 H140 V82 C140 114 118 136 90 152 C62 136 40 114 40 82 Z"/></clipPath></defs>
  <g clip-path="url(#s)"><rect x="30" y="30" width="120" height="22" fill="#f6f5f1"/><rect x="30" y="66" width="120" height="22" fill="#f6f5f1"/><rect x="30" y="102" width="120" height="50" fill="#FF4F1A"/></g>
</svg>`;

let win;
async function render(svg, size, out) {
  const out_ = size;
  size = Math.max(size, 256);
  const html = `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`;
  const tmp = path.join(os.tmpdir(), `fivebar-icon-${out_}.html`);
  fs.writeFileSync(tmp, html);
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  fs.writeFileSync(out, img.resize({ width: out_, height: out_, quality: "best" }).toPNG());
  console.log(`saved ${path.relative(root, out)}`);
}

app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, useContentSize: true, enableLargerThanScreen: true, webPreferences: { offscreen: true } });
  const icon = fs.readFileSync(path.join(root, "assets", "icon.svg"), "utf8").replace(/ width="180" height="180"/, "");
  await render(icon, 512, path.join(root, "assets", "icon.png"));
  await render(TRAY, 32, path.join(root, "assets", "tray.png"));
  app.quit();
});
