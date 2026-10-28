// Captures build-log screenshots of the running UI.
// npx electron scripts/capture.mjs <plan.json> <outDir>
// A plan is a list of steps: { go: "#/p/x" } navigates, { js: "..." } runs in the page,
// { wait: ms } pauses, { shot: "name" } saves <outDir>/<name>.png.
import { app, BrowserWindow, nativeTheme } from "electron";
import fs from "node:fs";
import path from "node:path";

const [planFile, outDir] = process.argv.slice(-2);
const base = process.env.FIVEBAR_URL ?? "http://127.0.0.1:4870/";
app.commandLine.appendSwitch("force-device-scale-factor", process.env.SCALE ?? "2");
nativeTheme.themeSource = process.env.THEME ?? "light";

app.whenReady().then(async () => {
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ width: 1440, height: 900, show: false, useContentSize: true, enableLargerThanScreen: true, webPreferences: { backgroundThrottling: false } });
  win.setContentSize(1440, 900);
  await win.loadURL(base);
  await win.webContents.insertCSS("::-webkit-scrollbar { display: none; }");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1200);
  for (const step of plan) {
    if (step.go !== undefined) { await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(step.go)}`); await sleep(step.settle ?? 900); }
    if (step.js) await win.webContents.executeJavaScript(`(async () => { ${step.js} })()`);
    if (step.wait) await sleep(step.wait);
    if (step.shot) {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, `${step.shot}.png`), img.toPNG());
      console.log(`saved ${step.shot}.png ${img.getSize().width}x${img.getSize().height}`);
    }
  }
  app.quit();
});
