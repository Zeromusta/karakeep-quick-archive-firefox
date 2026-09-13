// Each job gets a fresh extension iframe: SingleFile's module state and resource
// cache cannot cross between concurrent captures. Captured HTML stays in inert
// DOMParser documents; it is never navigated to or inserted in a live document.
import { getPageData } from "single-file-core/single-file.js";
import { captureOptions } from "../shared/capture-options.js";
import { MAX_CAPTURE_BYTES, RESOURCE_TIMEOUT_MS, blobToDataUrl, imageDataUrlToBlob, readLimitedResponse } from "../shared/capture.js";

globalThis.assemble = async (capture) => {
  const issues = [];
  const cache = new Map();
  let totalBytes = 0;
  let failedResources = 0;
  async function resource(url) {
    const key = String(url);
    if (cache.has(key)) return cache.get(key);
    const pending = (async () => {
      const parsed = new URL(key);
      if (!["http:", "https:", "data:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Resource unavailable");
      if (totalBytes >= MAX_CAPTURE_BYTES) throw new Error("Resource budget exceeded");
      const response = await fetch(key, { credentials: "include", cache: "force-cache", signal: AbortSignal.timeout(RESOURCE_TIMEOUT_MS) });
      const blob = await readLimitedResponse(response);
      totalBytes += blob.size;
      if (totalBytes > MAX_CAPTURE_BYTES) throw new Error("Resource budget exceeded");
      return blob;
    })().catch((error) => { failedResources++; throw error; });
    cache.set(key, pending);
    return pending;
  }
  const fetchResource = async (url) => {
    const blob = await resource(url);
    return { status: 200, url: String(url), headers: new Headers({ "content-type": blob.type }), arrayBuffer: () => blob.arrayBuffer() };
  };
  let html = null;
  let mode = capture.mode;
  if (capture.snapshot) {
    try {
      const snapshot = capture.snapshot;
      // Absolute base also preserves resources on pages using <base href>.
      const doc = new DOMParser().parseFromString(snapshot.content, "text/html");
      let base = doc.querySelector("base");
      if (!base) { base = doc.createElement("base"); doc.head.prepend(base); }
      base.href = snapshot.baseURI || snapshot.url;
      const page = await getPageData({
        ...captureOptions, ...snapshot.state,
        content: "<!doctype html>" + doc.documentElement.outerHTML,
        url: snapshot.baseURI || snapshot.url
      }, { fetch: fetchResource }, null, null);
      if (!page.content || new Blob([page.content]).size > MAX_CAPTURE_BYTES) throw new Error("Page snapshot exceeded 32 MB");
      html = page.content;
      mode = "full";
    } catch (error) {
      issues.push(`Full page assembly failed: ${error.message}`);
      html = capture.fallbackHtml;
      mode = html ? "text" : "url";
    }
  }
  let banner = null;
  for (const url of capture.bannerUrls || []) {
    try {
      const blob = await resource(url);
      if (!blob.type.startsWith("image/")) continue;
      banner = await normaliseBanner(blob);
      break;
    } catch { /* Try the next image; otherwise use the saved screenshot. */ }
  }
  if (failedResources) issues.push("Some page resources could not be captured");
  if (!banner && capture.bannerUrls?.length) issues.push("Page image unavailable; using screenshot as banner");
  return { html, mode, banner, issues };
};

async function normaliseBanner(blob) {
  const dataUrl = await blobToDataUrl(blob);
  if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(blob.type)) return dataUrl;
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  const result = canvas.toDataURL("image/png");
  imageDataUrlToBlob(result); // Validate upload size.
  return result;
}
