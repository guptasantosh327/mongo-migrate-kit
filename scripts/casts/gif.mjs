/**
 * Turns the terminal casts (docs/public/casts/*.svg) into animated GIFs, and the diagrams
 * (docs/public/diagrams/*.svg) into PNGs, for places that can't show SVG: Medium, Dev.to,
 * LinkedIn, Slack previews.
 *
 * It drives a headless Chrome over the DevTools protocol, steps each animation through time,
 * screenshots every frame, and encodes the GIF. The two encoder packages are not project
 * dependencies, so install them without saving first:
 *
 *   npm i --no-save gifenc@1.0.3 pngjs@7.0.0
 *   node scripts/casts/gif.mjs                 # everything
 *   node scripts/casts/gif.mjs hero lock       # just these casts
 *   node scripts/casts/gif.mjs diagrams        # just the diagram PNGs
 *
 * Output: docs/public/gifs/<cast>.gif and docs/public/diagrams/png/<diagram>.png
 * Set CHROME=/path/to/chrome if Chrome isn't in the default macOS location.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let gifenc;
let PNG;
try {
  gifenc = await import('gifenc');
  ({ PNG } = await import('pngjs'));
} catch {
  console.error('Missing encoder packages. Run: npm i --no-save gifenc@1.0.3 pngjs@7.0.0');
  process.exit(1);
}
const { GIFEncoder, quantize, applyPalette } = gifenc.default ?? gifenc;

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const castDir = join(repo, 'docs/public/casts');
const diagramDir = join(repo, 'docs/public/diagrams');
const gifDir = join(repo, 'docs/public/gifs');
const pngDir = join(diagramDir, 'png');
const CHROME =
  process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + Math.floor(Math.random() * 500);
const STEP_MS = 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start Chrome and return a tiny DevTools client for one page. */
async function openBrowser() {
  const profile = mkdtempSync(join(tmpdir(), 'mmk-gif-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    await sleep(200);
    targets = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      .then((r) => r.json())
      .catch(() => undefined);
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const waiting = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      const n = ++id;
      waiting.set(n, (msg) => (msg.error ? fail(new Error(msg.error.message)) : done(msg.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const close = () => {
    ws.close();
    chrome.kill();
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Chrome may still be flushing its profile; the OS temp folder gets cleaned anyway.
    }
  };
  return { send, close };
}

function size(svg) {
  const m = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  return { w: Math.ceil(Number(m[1])), h: Math.ceil(Number(m[2])) };
}

async function load(page, svg, { w, h }, scale, colorScheme = 'light', background = 'transparent') {
  // The blinking cursor would add a frame every half second for no benefit, so it stays solid.
  const html = `<!doctype html><html><head><style>html,body{margin:0;background:${background}}.cur{animation:none!important}</style></head>
<body>${svg}<script>
window.__anims = () => document.getAnimations();
window.__total = () => Math.max(1, ...__anims().map((a) => a.effect.getTiming().duration).filter((d) => d > 2000));
window.__seek = (t) => { for (const a of __anims()) { a.pause(); a.currentTime = t; } };
</script></body></html>`;
  const file = join(tmpdir(), `mmk-gif-${process.pid}.html`);
  writeFileSync(file, html);
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: scale,
    mobile: false,
  });
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: colorScheme }],
  });
  await page.send('Page.navigate', { url: `file://${file}` });
  await sleep(400);
}

async function shot(page) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  return PNG.sync.read(Buffer.from(data, 'base64'));
}

async function castToGif(page, name) {
  const svg = readFileSync(join(castDir, `${name}.svg`), 'utf8');
  const dims = size(svg);
  // GIFs have no partial transparency, so the rounded window corners sit on white.
  await load(page, svg, dims, 1, 'light', '#ffffff');
  const { result } = await page.send('Runtime.evaluate', { expression: '__total()' });
  const total = result.value;

  const frames = [];
  let last;
  for (let t = 0; t < total; t += STEP_MS) {
    await page.send('Runtime.evaluate', { expression: `__seek(${t})` });
    const png = await shot(page);
    const same = last && Buffer.compare(png.data, last.data) === 0;
    if (same) frames[frames.length - 1].delay += STEP_MS;
    else frames.push({ data: png.data, delay: STEP_MS });
    last = png;
  }

  // One palette for the whole GIF, taken from the busiest frame, keeps colours steady. The last
  // palette slot is kept free: in every frame after the first, pixels that didn't change point at
  // it and are drawn transparent, so only the changed part of the screen is stored.
  const busiest = frames.reduce((a, b) => (countInk(b.data) > countInk(a.data) ? b : a));
  const palette = quantize(busiest.data, 255);
  while (palette.length < 255) palette.push([0, 0, 0]);
  palette.push([0, 0, 0]);
  const CLEAR = 255;
  const gif = GIFEncoder();
  let prev;
  for (const f of frames) {
    const index = applyPalette(f.data, palette);
    if (prev) {
      for (let i = 0, p = 0; i < index.length; i++, p += 4) {
        if (
          f.data[p] === prev[p] &&
          f.data[p + 1] === prev[p + 1] &&
          f.data[p + 2] === prev[p + 2] &&
          f.data[p + 3] === prev[p + 3]
        ) {
          index[i] = CLEAR;
        }
      }
    }
    gif.writeFrame(index, last.width, last.height, {
      palette,
      delay: f.delay,
      transparent: Boolean(prev),
      transparentIndex: CLEAR,
      dispose: 1,
    });
    prev = f.data;
  }
  gif.finish();
  writeFileSync(join(gifDir, `${name}.gif`), gif.bytes());
  return { frames: frames.length, kb: Math.round(gif.bytes().length / 1024) };
}

/** Rough "how much is on screen" measure: pixels that aren't the terminal background. */
function countInk(data) {
  let n = 0;
  for (let i = 0; i < data.length; i += 16) if (data[i] + data[i + 1] + data[i + 2] > 180) n++;
  return n;
}

async function diagramToPng(page, name) {
  // Loaded as an <img>, not inlined: inlined, the diagram would look for the docs site's theme
  // colours (its `html .dg` rule) and find none.
  const path = join(diagramDir, `${name}.svg`);
  const { w, h } = size(readFileSync(path, 'utf8'));
  const file = join(tmpdir(), `mmk-png-${process.pid}.html`);
  writeFileSync(
    file,
    `<!doctype html><html><body style="margin:0;background:transparent"><img src="file://${path}" width="${w}" height="${h}"></body></html>`,
  );
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });
  await page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await page.send('Page.navigate', { url: `file://${file}` });
  await sleep(400);
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(pngDir, `${name}.png`), Buffer.from(data, 'base64'));
}

const only = process.argv.slice(2);
mkdirSync(gifDir, { recursive: true });
mkdirSync(pngDir, { recursive: true });
const page = await openBrowser();
try {
  await page.send('Page.enable');
  for (const file of readdirSync(castDir).filter((f) => f.endsWith('.svg'))) {
    const name = basename(file, '.svg');
    if (only.length > 0 && !only.includes(name)) continue;
    process.stdout.write(`gif ${name}… `);
    const { frames, kb } = await castToGif(page, name);
    process.stdout.write(`${frames} frames, ${kb} KB\n`);
  }
  if (only.length === 0 || only.includes('diagrams')) {
    for (const file of readdirSync(diagramDir).filter((f) => f.endsWith('.svg'))) {
      const name = basename(file, '.svg');
      await diagramToPng(page, name);
      process.stdout.write(`png ${name}\n`);
    }
  }
} finally {
  page.close();
}
