// Headless Chrome on the GPU, pointed at the reel renderer page (reel.html) served by Vite.
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { ROOT } from './paths.mjs';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);

export function chromePath() {
  const found = CANDIDATES.find(p => existsSync(p));
  if (!found) throw new Error('No Chrome or Edge found: set CHROME_PATH to a Chrome executable.');
  return found;
}

// GPU flags. On Windows: ANGLE on Vulkan, on the real GPU. ANGLE's Direct3D 11 backend draws the scene,
// but the bloom chain (src/post.js) comes out black on the Intel iGPU this was built on, in headless and
// headful Chrome alike (the app's "low" quality, without bloom, is fine there). REEL_ANGLE=d3d11 tries it anyway.
const ANGLE = process.env.REEL_ANGLE ?? (process.platform === 'win32' ? 'vulkan' : null);
const GPU_ARGS = [...(ANGLE ? [`--use-angle=${ANGLE}`] : []), '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

export async function openRenderer({ w, h, log = console.log, headless = true }) {
  const server = await createServer({
    root: ROOT, configFile: `${ROOT}/vite.config.js`, logLevel: 'error',
    server: { port: 0, strictPort: false, host: '127.0.0.1', watch: { ignored: ['**/out/**', '**/data/videos/**', '**/node_modules/**'] }, hmr: false },
  });
  await server.listen();
  const url = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await puppeteer.launch({
    executablePath: chromePath(), headless,
    args: [...GPU_ARGS, `--window-size=${w},${h}`, '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb'],
    defaultViewport: { width: w, height: h, deviceScaleFactor: 1 },
    protocolTimeout: 600000,
  });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warn') log(`[page ${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => log(`[page error] ${e.message}`));
  await page.goto(`${url}/reel.html?w=${w}&h=${h}`, { waitUntil: 'load', timeout: 120000 });
  const info = await page.evaluate(async () => { const r = await window.reel.ready; window.R = r; return { gpu: r.gpu, w: r.W, h: r.H }; });
  log(`renderer ${info.w}×${info.h} on ${info.gpu}`);
  if (/swiftshader|software|llvmpipe/i.test(info.gpu)) log('WARNING: WebGL is running in software; the render will be slow and may differ.');
  return {
    page, info, url,
    async close() { await browser.close(); await server.close(); },
  };
}
