// Real Firefox, a fresh profile, and a local mock Karakeep. Never uses the
// installed extension, personal browser profile, or live Karakeep credentials.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, cp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { download } from "geckodriver";

const root = resolve(".");
const temporary = await mkdtemp(join(tmpdir(), "karakeep-firefox-smoke-"));
const uuid = "cf1e9537-53c1-4667-9648-139510c5b893";
const calls = [];
let report;
const reported = new Promise((resolve) => { report = resolve; });
let resourceDelay = 0;
let delayedRequests = 0;
const pageRequests = new Map();
let bookmarkNumber = 0;
const bookmarks = new Map();
function createBookmark() {
  const id = `bm-${++bookmarkNumber}`;
  bookmarks.set(id, { id, content: { crawlStatus: "pending" }, assets: [{ id: `crawler-banner-${id}`, assetType: "bannerImage" }] });
  return id;
}
let driver;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><rect width="500" height="300" fill="#f5a623"/><text x="30" y="150" font-size="40">Product banner</text></svg>';
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/arm-delay") { resourceDelay = 3000; res.end("ok"); return; }
    if (url.pathname === "/disarm-delay") { resourceDelay = 0; res.end("ok"); return; }
    if (url.pathname === "/test-result") {
      let body = ""; for await (const chunk of req) body += chunk;
      report(JSON.parse(body)); res.end("ok"); return;
    }
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      assert.equal(req.headers.authorization, "Bearer smoke-key");
      const call = { path: url.pathname, method: req.method };
      calls.push(call);
      res.setHeader("Content-Type", "application/json");
      if (url.pathname.endsWith("/singlefile")) {
        const form = await new Request("http://localhost", { method: "POST", headers: { "content-type": req.headers["content-type"] }, body }).formData();
        call.html = await form.get("file").text();
        call.url = form.get("url");
        if (call.url.endsWith("/rejected")) { res.writeHead(413); res.end("{}"); return; }
        res.writeHead(201); res.end(JSON.stringify({ id: createBookmark() })); return;
      }
      if (url.pathname === "/api/v1/assets") {
        const form = await new Request("http://localhost", { method: "POST", headers: { "content-type": req.headers["content-type"] }, body }).formData();
        call.file = { type: form.get("file").type, size: form.get("file").size };
        assert.ok(["image/png", "image/jpeg", "image/gif", "image/webp"].includes(call.file.type));
        if (call.file.type === "image/jpeg") await writeFile(join(temporary, "screenshot.jpg"), Buffer.from(await form.get("file").arrayBuffer()));
        res.writeHead(201); res.end(JSON.stringify({ assetId: `asset-${calls.length}` })); return;
      }
      if (body.length) call.json = JSON.parse(body);
      if (url.pathname === "/api/v1/bookmarks" && req.method === "POST") {
        res.writeHead(201); res.end(JSON.stringify({ id: createBookmark() })); return;
      }
      const parts = url.pathname.split("/");
      const bookmark = bookmarks.get(parts[4]);
      if (bookmark && req.method === "GET") {
        res.end(JSON.stringify(bookmark));
        bookmark.content.crawlStatus = "success";
        return;
      }
      if (bookmark && parts[5] === "assets") {
        if (req.method === "PUT") {
          const old = bookmark.assets.find((asset) => asset.id === parts[6]);
          assert.ok(old, "replacement must name an existing image");
          call.imageType = old.assetType;
          old.id = call.json.assetId;
          res.writeHead(204); res.end(); return;
        }
        call.imageType = call.json.assetType;
        bookmark.assets.push(call.json);
      }
      res.end("{}"); return;
    }
    // No Karakeep API key may leak to the captured site's resource requests.
    assert.equal(req.headers.authorization, undefined);
    res.setHeader("Cache-Control", "no-store");
    if (resourceDelay && ["/banner.svg", "/style.css"].includes(url.pathname)) {
      delayedRequests++; await new Promise((resolve) => setTimeout(resolve, resourceDelay));
    }
    if (url.pathname === "/banner.svg") { res.setHeader("Content-Type", "image/svg+xml"); res.end(svg); return; }
    if (url.pathname === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end("body{font:20px sans-serif;background:#f1f5f9;color:#102030;padding:30px}article{max-width:700px}img{width:500px}"); return; }
    if (url.pathname === "/hydrate.js") { res.setHeader("Content-Type", "text/javascript"); res.end('document.querySelector("#details").textContent="Hydrated product details, captured from the live page.";document.querySelector("#live-value").value="Edited form value";document.querySelector("#shadow").attachShadow({mode:"open"}).textContent="Live shadow details";const ctx=document.querySelector("canvas").getContext("2d");ctx.fillStyle="green";ctx.fillRect(0,0,30,30);'); return; }
    pageRequests.set(url.pathname, (pageRequests.get(url.pathname) || 0) + 1);
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src * data:; style-src *; script-src 'self'");
    res.end(`<!doctype html><html><head><title>Capture proof</title><meta property="og:image" content="http://localhost:${server.address().port}/banner.svg"><meta name="description" content="Product capture test"><link rel="stylesheet" href="http://localhost:${server.address().port}/style.css"></head><body><article><h1>Capture proof</h1><p>Fixture ${url.pathname}</p><img src="http://localhost:${server.address().port}/banner.svg"><p id="details">Loading product…</p><input id="live-value" value="Initial value"><div id="shadow"></div><canvas width="30" height="30"></canvas><p>${"These product details should be preserved in the archive. ".repeat(15)}</p></article><script src="/hydrate.js"></script></body></html>`);
  } catch (error) { console.error(error); res.writeHead(500); res.end(String(error)); }
});

try {
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const extension = join(temporary, "extension");
  await cp(root, extension, { recursive: true, filter: (src) => !/\/(node_modules|\.git|web-ext-artifacts|tests)(\/|$)/.test(src) });
  const manifest = JSON.parse(await readFile(join(extension, "manifest.json")));
  // Test-only host grants avoid interacting with browser permission UI; the
  // released extension keeps these optional and offers them in Settings.
  manifest.host_permissions = ["<all_urls>"];
  manifest.background.scripts.push("harness-bootstrap.js");
  await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(extension, "harness.html"), '<!doctype html><title>Isolated extension test</title><script src="harness.js"></script>');
  await writeFile(join(extension, "harness-bootstrap.js"), 'browser.tabs.create({url:browser.runtime.getURL("harness.html")});');
  await writeFile(join(extension, "harness.js"), `(${browserHarness.toString()})(${JSON.stringify(base)});`);
  const binary = process.env.FIREFOX_BINARY || (process.platform === "darwin" ? "/Applications/Firefox.app/Contents/MacOS/firefox" : "firefox");
  const options = new firefox.Options().setBinary(binary).addArguments("-headless")
    .setPreference("extensions.webextensions.uuids", JSON.stringify({ [manifest.browser_specific_settings.gecko.id]: uuid }))
    .setPreference("browser.shell.checkDefaultBrowser", false);
  const service = new firefox.ServiceBuilder(await download("0.37.1"));
  driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).setFirefoxService(service).build();
  await driver.installAddon(extension, true);
  const result = await Promise.race([reported, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("Browser harness timed out")), 120_000);
    void reported.then(() => clearTimeout(timer));
  })]);
  if (result.error) throw new Error(result.error);
  const { saved, fallback } = result;
  assert.equal(saved.captureMode, "full");
  assert.ok(delayedRequests > 0, "the test must actually delay captured resources");
  assert.ok(saved.closeMs < 2000, `Tab took ${saved.closeMs}ms to close despite offloaded resources`);
  console.log(`PASS: tab closed in ${Math.round(saved.closeMs)}ms while resource downloads each waited 3000ms`);
  assert.deepEqual(saved.captureIssues || [], []);
  const archive = calls.find((call) => call.path.endsWith("singlefile"));
  assert.match(archive.html, /Hydrated product details/);
  assert.match(archive.html, /Edited form value/);
  assert.match(archive.html, /Live shadow details/);
  assert.match(archive.html, /data:image\/png/);
  assert.equal(pageRequests.get("/product"), 1, "assembly must not reload the original page");
  assert.match(archive.html, /Fixture \/product/);
  assert.match(calls.find((call) => call.url?.endsWith("/rejected"))?.html, /Fixture \/rejected/);
  assert.match(archive.html, /data:image\/svg\+xml/);
  assert.doesNotMatch(archive.html, /karakeep-quick-archive-list-picker-host/);
  assert.deepEqual(calls.filter((call) => call.path.includes("/bm-1/") && call.imageType).map((call) => call.imageType), ["screenshot", "bannerImage"]);
  assert.ok(calls.some((call) => call.file?.type === "image/jpeg" && call.file.size > 1000));
  assert.ok(calls.some((call) => call.json?.favourited === true));
  assert.ok(calls.some((call) => call.method === "PUT" && call.imageType === "bannerImage"));
  console.log("PASS: live DOM, cross-origin CSS/image, screenshot, banner, favourite, close and durable queue in real Firefox");

  assert.equal(fallback.captureMode, "url");
  assert.match(fallback.captureIssues.join(), /413/);
  assert.ok(calls.some((call) => call.json?.tags?.[0]?.tagName === "capture-incomplete"));
  console.log("PASS: rejected snapshot falls back to URL, keeps images, tags for review and closes the tab");
  console.log(`Screenshot for visual inspection: ${join(temporary, "screenshot.jpg")}`);
} finally {
  if (driver) await driver.quit();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  // Preserve screenshot only for visual QA; no captured personal data is used.
  await rm(join(temporary, "extension"), { recursive: true, force: true });
}

async function browserHarness(base) {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    await pause(500);
    await browser.storage.local.set({ settings: { karakeepBaseUrl: base, karakeepApiKey: "smoke-key" }, processingItems: [], manualReviewItems: [], historyItems: [] });
    let firstClosed;
    const firstTabClosed = new Promise((resolve) => { firstClosed = resolve; });
    async function savePage(path) {
      const tab = await browser.tabs.create({ url: `${base}/${path}`, active: true });
      const readyDeadline = Date.now() + 10_000;
      while ((await browser.tabs.get(tab.id)).status !== "complete") {
        if (Date.now() > readyDeadline) throw new Error("Fixture did not load");
        await pause(50);
      }
      await pause(100);
      if (path === "product") await fetch(`${base}/arm-delay`);
      let closeMs;
      const started = performance.now();
      const onRemoved = (id) => { if (id === tab.id) { closeMs = performance.now() - started; if (path === "product") firstClosed(); } };
      browser.tabs.onRemoved.addListener(onRemoved);
      await browser.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
        void browser.runtime.sendMessage({ type: "archiveCurrentTabToList", favourite: true });
      } });
      const deadline = Date.now() + 50_000;
      while (Date.now() < deadline) {
        const state = await browser.storage.local.get(["processingItems", "manualReviewItems", "historyItems"]);
        if (state.manualReviewItems?.length) throw new Error(JSON.stringify(state.manualReviewItems));
        const item = state.historyItems?.find((item) => item.url === `${base}/${path}` && item.captureMode);
        if (item) {
          if ((await browser.tabs.query({})).some((t) => t.id === tab.id)) throw new Error("Archived tab did not close");
          browser.tabs.onRemoved.removeListener(onRemoved);
          await fetch(`${base}/disarm-delay`);
          return { ...item, closeMs };
        }
        await pause(250);
      }
      throw new Error("Capture did not complete: " + JSON.stringify(await browser.storage.local.get()));
    }
    const saving = savePage("product");
    // Capture another page while the first archive is still downloading.
    await Promise.race([firstTabClosed, saving]);
    const [saved, fallback] = await Promise.all([saving, savePage("rejected")]);
    await fetch(`${base}/test-result`, { method: "POST", body: JSON.stringify({ saved, fallback }) });
  } catch (error) {
    await fetch(`${base}/test-result`, { method: "POST", body: JSON.stringify({ error: String(error) + "\n" + error.stack }) });
  }
}
