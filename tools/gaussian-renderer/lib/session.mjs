// Starts a local static server and a headless Chromium with software WebGPU,
// loads the harness page and exposes helpers to render and save images.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };

export function writePng(file, width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]));
}

/**
 * @param {{ mounts?: Record<string, string>, port?: number }} options
 *   mounts maps URL prefixes (e.g. "/data/ts16") to directories.
 */
export async function openSession({ mounts = {}, port = 8765 } = {}) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file;
    for (const [prefix, dir] of Object.entries(mounts)) {
      if (url.startsWith(prefix + "/")) file = path.join(dir, url.slice(prefix.length + 1));
    }
    if (!file) file = path.join(root, url === "/" ? "index.html" : url.slice(1));
    file = path.normalize(file);
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
        "Content-Length": st.size,
      });
      fs.createReadStream(file).pipe(res);
    });
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  // Default: software WebGPU (SwiftShader), which runs anywhere but is slow.
  // On a machine with a GPU set GV_BROWSER_ARGS, for example
  //   GV_BROWSER_ARGS="--enable-unsafe-webgpu --enable-features=Vulkan --ignore-gpu-blocklist" GV_HEADLESS=0
  const args = process.env.GV_BROWSER_ARGS
    ? process.env.GV_BROWSER_ARGS.split(/\s+/).filter(Boolean)
    : ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];
  const browser = await chromium.launch({ args, headless: process.env.GV_HEADLESS !== "0" });
  const page = await browser.newPage();
  const logs = [];
  page.on("console", (m) => { const t = `[page ${m.type()}] ${m.text()}`; logs.push(t); if (m.type() === "error" || m.type() === "warning") console.log(t); });
  page.on("pageerror", (e) => console.log("[page exception]", e.message));
  await page.goto(`http://localhost:${port}/`);
  const adapter = await page.evaluate(() => globalThis.gv.init());
  const software = /swiftshader|llvmpipe|software/i.test(`${adapter.vendor} ${adapter.architecture} ${adapter.description}`);
  console.log(`WebGPU adapter: ${JSON.stringify(adapter)}${software ? "  <-- SOFTWARE rasteriser: timings are not GPU timings" : ""}`);

  return {
    page, logs, adapter,
    call: (method, ...args) => page.evaluate(([m, a]) => globalThis.gv[m](...a), [method, args]),
    /** Renders and writes a PNG; returns { ms, width, height, file }. */
    async render(config, file) {
      const t0 = Date.now();
      const r = await page.evaluate((c) => globalThis.gv.render(c), config);
      const rgba = Buffer.from(r.pixels, "base64");
      if (file) writePng(file, r.width, r.height, rgba);
      return { ms: r.ms, wallMs: Date.now() - t0, width: r.width, height: r.height, file, extra: r.extra };
    },
    async close() { await browser.close(); await new Promise((r) => server.close(r)); },
  };
}
