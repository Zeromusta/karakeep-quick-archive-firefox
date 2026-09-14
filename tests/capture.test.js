import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { capturePage } from "../background/page-capture.js";
import { getCapture, putCapture, deleteCapture, pruneCaptureFiles } from "../background/capture-store.js";
import { attachCaptureImage, waitForImageProcessing } from "../background/karakeep-client.js";
import { archiveWithCapture } from "../background/capture-upload.js";
import { createProcessingItem, failProcessingItem, retryManualReviewItem } from "../background/history-store.js";
import { createBrowserMock } from "./helpers/browser-mock.js";
import { assembleCapture } from "../background/capture-assembly.js";
import { imageDataUrlToBlob, readLimitedResponse } from "../shared/capture.js";

const tab = { id: 1, windowId: 1, active: true, url: "https://shop.example/product", title: "Product" };
const image = "data:image/png;base64,aGVsbG8=";
const settings = { karakeepBaseUrl: "https://karakeep.example", karakeepApiKey: "test-key" };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

function setupCapture(overrides = {}) {
  const browser = globalThis.browser = createBrowserMock({ tabs: [tab] });
  browser.tabs.captureVisibleTab = async () => image;
  browser.scripting = { executeScript: async ({ files, args }) => {
    if (files) return [];
    const [method] = args;
    if (overrides[method]) return [{ result: await overrides[method](...args[1]) }];
    if (method === "prepare") return [{ result: { url: tab.url, title: tab.title, bannerUrls: ["https://cdn.example/product.png"], fallbackHtml: "<p>Product details</p>" } }];
    if (method === "freeze") return [{ result: { url: tab.url, baseURI: tab.url, content: "<html>Product details</html>", state: { canvases: [] } } }];
    return [{ result: undefined }];
  } };
  return browser;
}

test("captures live state and screenshot without downloading any resources", async () => {
  const browser = setupCapture();
  globalThis.fetch = () => { throw new Error("capture must not fetch"); };
  const result = await capturePage(tab);
  assert.equal(result.mode, "pending");
  assert.deepEqual(result.issues, []);
  assert.match(result.snapshot.content, /Product details/);
  assert.equal(result.screenshot.type, "image/png");
  assert.deepEqual(result.bannerUrls, ["https://cdn.example/product.png"]);
  assert.deepEqual(browser.__mock.removedTabIds, []);
});

test("injection failure falls back to URL with a review reason", async () => {
  const browser = setupCapture();
  browser.scripting.executeScript = async () => { throw new Error("Missing host permission"); };
  const result = await capturePage(tab);
  assert.equal(result.mode, "url");
  assert.equal(result.html, null);
  assert.match(result.issues.join(), /permission/);
});

test("live snapshot failure retains readable text and screenshot", async () => {
  setupCapture({ freeze: () => { throw new Error("Snapshot failed"); } });
  const result = await capturePage(tab);
  assert.equal(result.mode, "text");
  assert.match(await result.html.text(), /Product details/);
  assert.ok(result.screenshot);
  assert.ok(result.issues.length);
});

test("oversized snapshots fall back to readable text", async () => {
  setupCapture({ freeze: () => ({ url: tab.url, content: "x".repeat(32 * 1024 * 1024 + 1) }) });
  const result = await capturePage(tab);
  assert.equal(result.mode, "text");
  assert.match(result.issues.join(), /32 MB/);
});

test("challenge pages do not become successful local archives", async () => {
  setupCapture({ prepare: () => ({ url: tab.url, challenge: true }) });
  const result = await capturePage(tab);
  assert.equal(result.mode, "url");
  assert.match(result.issues.join(), /security check/);
});

test("switching tabs during screenshot drops the screenshot", async () => {
  const browser = setupCapture();
  browser.tabs.captureVisibleTab = async () => {
    browser.tabs.query = async () => [{ ...tab, id: 2 }];
    return image;
  };
  const result = await capturePage(tab);
  assert.equal(result.mode, "pending");
  assert.equal(result.screenshot, null);
  assert.match(result.issues.join(), /Screenshot/);
});

test("navigation discards mismatched captured data", async () => {
  const browser = setupCapture();
  browser.tabs.get = async () => ({ ...tab, url: "https://example.com/other" });
  const result = await capturePage(tab);
  assert.equal(result.mode, "url");
  assert.equal(result.html, null);
  assert.equal(result.screenshot, null);
});

test("resource and data URL size/type limits are enforced", async () => {
  assert.throws(() => imageDataUrlToBlob("data:text/html;base64,WA=="));
  await assert.rejects(readLimitedResponse(new Response("12345"), 4), /too large/);
});

function setupUpload() {
  globalThis.browser = createBrowserMock({ initialStorage: { settings }, grantedOrigins: ["https://karakeep.example/*"] });
}

test("durable capture uploads multipart HTML and both typed image attachments", async () => {
  setupUpload();
  const captureId = crypto.randomUUID();
  await putCapture(captureId, { capturedAt: Date.now(), mode: "full", issues: [], html: new Blob(["<p>Product</p>"], { type: "text/html" }), screenshot: imageDataUrlToBlob(image), banner: imageDataUrlToBlob(image) });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("singlefile")) {
      assert.equal(options.body.get("url"), tab.url);
      assert.equal(await options.body.get("file").text(), "<p>Product</p>");
      assert.equal(options.headers["Content-Type"], undefined);
      assert.equal(options.headers.Authorization, "Bearer test-key");
      return response({ id: "bm" }, 201);
    }
    if (url.endsWith("/api/v1/assets")) return response({ assetId: `asset-${calls.length}` }, 201);
    return response({});
  };
  const result = await archiveWithCapture({ ...tab, captureId });
  assert.equal(result.captureMode, "full");
  assert.deepEqual(result.captureIssues, []);
  assert.deepEqual(calls.filter((call) => call.url.endsWith("/bookmarks/bm/assets")).map((call) => JSON.parse(call.options.body).assetType), ["screenshot", "bannerImage"]);
  assert.equal(calls.some((call) => call.url.endsWith("/tags")), false);
  assert.equal((await getCapture(captureId)).bannerAttached, true);
  await deleteCapture(captureId);
});

test("failed archive upload saves the URL and review tag", async () => {
  setupUpload();
  const captureId = crypto.randomUUID();
  await putCapture(captureId, { mode: "full", issues: [], html: new Blob(["page"]) });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("singlefile")) return response({}, 413);
    if (url.endsWith("/tags")) return response({});
    return response({ id: "bm" }, 201);
  };
  const result = await archiveWithCapture({ ...tab, captureId });
  assert.equal(result.captureMode, "url");
  assert.equal(browser.__mock.localState.archiveWarning, true);
  assert.match(result.captureIssues.join(), /413/);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { tags: [{ tagName: "capture-incomplete" }] });
  await deleteCapture(captureId);
});

test("tag failure retains bookmark ID and retries without uploading snapshot again", async () => {
  setupUpload();
  const captureId = crypto.randomUUID();
  await putCapture(captureId, { mode: "text", issues: ["Partial capture"], html: new Blob(["page"]) });
  let uploads = 0, taggingAttempts = 0;
  globalThis.fetch = async (url) => {
    if (url.includes("singlefile")) { uploads++; return response({ id: "bm" }, 201); }
    if (url.endsWith("/tags")) return response({}, ++taggingAttempts === 1 ? 503 : 200);
    throw new Error("Unexpected request");
  };
  await assert.rejects(archiveWithCapture({ ...tab, captureId }), /503/);
  assert.equal((await getCapture(captureId)).result.bookmarkId, "bm");
  await archiveWithCapture({ ...tab, captureId });
  assert.equal(uploads, 1);
  assert.equal(taggingAttempts, 2);
  await deleteCapture(captureId);
});

test("screenshot attachment failure keeps the snapshot and adds the review tag", async () => {
  setupUpload();
  const captureId = crypto.randomUUID();
  await putCapture(captureId, { mode: "full", issues: [], html: new Blob(["page"]), screenshot: imageDataUrlToBlob(image) });
  let tagged = false;
  globalThis.fetch = async (url, options) => {
    if (options.method === "GET") return response({ content: { crawlStatus: "success" }, assets: [] });
    if (url.includes("singlefile")) return response({ id: "bm" }, 201);
    if (url.endsWith("/api/v1/assets")) return response({ assetId: "image" }, 201);
    if (url.endsWith("/tags")) { tagged = true; return response({}); }
    return response({}, 500);
  };
  const result = await archiveWithCapture({ ...tab, captureId });
  assert.equal(result.captureMode, "full");
  assert.ok(tagged);
  assert.match(result.captureIssues.join(), /Screenshot/);
  await deleteCapture(captureId);
});

test("closed-history saves get the review tag without accessing the old page", async () => {
  setupUpload();
  let tagged = false;
  globalThis.fetch = async (url) => {
    if (url.endsWith("/tags")) { tagged = true; return response({}); }
    assert.equal(url, "https://karakeep.example/api/v1/bookmarks");
    return response({ id: "bm" }, 201);
  };
  const result = await archiveWithCapture(tab);
  assert.equal(result.captureMode, "url");
  assert.equal(browser.__mock.localState.archiveWarning, undefined);
  assert.ok(tagged);
});

test("manual retry preserves capture and destination; cleanup retains pending captures", async () => {
  setupUpload();
  const captureId = crypto.randomUUID(), orphan = crypto.randomUUID();
  const capture = { capturedAt: Date.now() - 7200_000, html: new Blob(["page"]), issues: [] };
  await putCapture(captureId, capture);
  await putCapture(orphan, capture);
  const item = await createProcessingItem(tab, { captureId, listId: "reading", listName: "Reading" });
  await failProcessingItem(item.id, "Offline");
  await pruneCaptureFiles();
  assert.equal(await getCapture(orphan), undefined);
  assert.equal(await (await getCapture(captureId)).html.text(), "page");
  const retry = await retryManualReviewItem(item.id);
  assert.equal(retry.captureId, captureId);
  assert.equal(retry.listId, "reading");
  await deleteCapture(captureId);
});


test("image upsert replaces an existing screenshot instead of leaving the error image first", async () => {
  setupUpload();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "GET") return response({ assets: [{ id: "old-shot", assetType: "screenshot" }] });
    return new Response(null, { status: 204 });
  };
  await attachCaptureImage("bm", "new-shot", "screenshot");
  assert.equal(calls[1].url, "https://karakeep.example/api/v1/bookmarks/bm/assets/old-shot");
  assert.equal(calls[1].options.method, "PUT");
  assert.deepEqual(JSON.parse(calls[1].options.body), { assetId: "new-shot" });
});

test("image retry is idempotent when the previous attachment response was lost", async () => {
  setupUpload();
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.method, "GET");
    return response({ assets: [{ id: "shot", assetType: "screenshot" }] });
  };
  await attachCaptureImage("bm", "shot", "screenshot");
});

test("images wait for crawler writes and report a stalled worker for retry", async () => {
  setupUpload();
  let requests = 0;
  globalThis.fetch = async () => response({ content: { crawlStatus: ++requests === 1 ? "pending" : "success" } });
  assert.equal(await waitForImageProcessing("bm", { pollMs: 1 }), "success");
  assert.equal(requests, 2);
  globalThis.fetch = async () => response({ content: { crawlStatus: "pending" } });
  await assert.rejects(waitForImageProcessing("bm", { timeoutMs: 0 }), /retry/);
});

test("unavailable worker preserves the captured page and saved bookmark ID for retry", async () => {
  setupUpload();
  const captureId = crypto.randomUUID();
  await putCapture(captureId, { mode: "full", issues: [], html: new Blob(["page"]), screenshot: imageDataUrlToBlob(image) });
  let uploads = 0;
  globalThis.fetch = async (url) => {
    if (url.includes("singlefile")) { uploads++; return response({ id: "bm" }, 201); }
    return response({}, 503);
  };
  await assert.rejects(archiveWithCapture({ ...tab, captureId }), /503/);
  const stored = await getCapture(captureId);
  assert.equal(stored.result.bookmarkId, "bm");
  assert.equal(await stored.html.text(), "page");
  assert.equal(uploads, 1);
  await deleteCapture(captureId);
});


test("frozen DOM state survives storage before background processing", async () => {
  setupCapture();
  const capture = await capturePage(tab);
  const id = crypto.randomUUID();
  await putCapture(id, capture);
  assert.deepEqual((await getCapture(id)).snapshot, capture.snapshot);
  await deleteCapture(id);
});

function setupAssembly(assemble) {
  let removed = false;
  const frame = { contentWindow: { assemble }, remove() { removed = true; } };
  globalThis.document = { createElement: () => frame, body: { append: () => queueMicrotask(() => frame.onload()) } };
  globalThis.browser = { runtime: { getURL: (path) => `moz-extension://test/${path}` } };
  return () => removed;
}

test("background assembly replaces frozen state with uploadable HTML and images", async () => {
  const wasRemoved = setupAssembly(async () => ({ html: "<p>Archived content</p>", mode: "full", banner: image, issues: ["Some page resources could not be captured"] }));
  const capture = { snapshot: { content: "page" }, fallbackHtml: "text", bannerUrls: [], issues: [] };
  await assembleCapture(capture);
  assert.equal(capture.mode, "full");
  assert.equal(await capture.html.text(), "<p>Archived content</p>");
  assert.ok(capture.banner);
  assert.match(capture.issues.join(), /resources/);
  assert.equal(capture.snapshot, undefined);
  assert.ok(wasRemoved());
});

test("failed background assembly retains text and screenshot, and tears down the processor", async () => {
  const wasRemoved = setupAssembly(async () => { throw new Error("Processor failed"); });
  const screenshot = imageDataUrlToBlob(image);
  const capture = { snapshot: { content: "page" }, fallbackHtml: "Readable text", screenshot, issues: [] };
  await assembleCapture(capture);
  assert.equal(capture.mode, "text");
  assert.equal(await capture.html.text(), "Readable text");
  assert.equal(capture.banner, screenshot);
  assert.match(capture.issues.join(), /Processor failed/);
  assert.ok(wasRemoved());
});

test("deferred queue persists a frozen capture without starting resource downloads or upload", async () => {
  setupUpload();
  globalThis.fetch = () => { throw new Error("Work started before tab closure"); };
  const { enqueueArchiveFromSnapshot } = await import("../background/archive-queue.js");
  const snapshot = { url: tab.url, content: "<p>Frozen page</p>", state: {} };
  const item = await enqueueArchiveFromSnapshot(tab, {}, { mode: "pending", snapshot, issues: [] }, { deferProcessing: true });
  assert.deepEqual((await getCapture(item.captureId)).snapshot, snapshot);
  const state = await browser.storage.local.get("processingItems");
  assert.equal(state.processingItems[0].captureId, item.captureId);
  await deleteCapture(item.captureId);
});
