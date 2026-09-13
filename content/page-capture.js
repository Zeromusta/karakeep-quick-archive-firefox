// Bundled locally with SingleFile; runs only in Firefox's isolated content world.
import { getPageData } from "single-file-core/single-file.js";
import { blobToDataUrl, readLimitedResponse, MAX_CAPTURE_BYTES, RESOURCE_TIMEOUT_MS } from "../shared/capture.js";

if (!globalThis.__karakeepCapture) {
  let session;

  async function resourceFetch(url, current = session) {
    if (!current || current !== session) throw new Error("Capture session ended");
    const key = String(url);
    if (current.cache.has(key)) return responseFromBlob(await current.cache.get(key), key);
    const pending = (async () => {
      if (current.bytes >= MAX_CAPTURE_BYTES) throw new Error("Capture resource budget exceeded");
      try {
        const response = await fetch(key, {
          credentials: "include", cache: "force-cache",
          signal: AbortSignal.timeout(RESOURCE_TIMEOUT_MS)
        });
        return await readLimitedResponse(response);
      } catch {
        const result = await browser.runtime.sendMessage({
          type: "captureResource", captureId: current.id, url: key
        });
        if (!result?.dataUrl) throw new Error("Resource unavailable");
        // Decoding with fetch(data:) is blocked by some pages' CSP in MV3.
        const comma = result.dataUrl.indexOf(",");
        const bytes = Uint8Array.from(atob(result.dataUrl.slice(comma + 1)), (char) => char.charCodeAt(0));
        return new Blob([bytes], { type: result.dataUrl.slice(5, comma).split(";")[0] });
      }
    })().then((blob) => {
      current.bytes += blob.size;
      if (current.bytes > MAX_CAPTURE_BYTES) throw new Error("Capture resource budget exceeded");
      return blob;
    });
    current.cache.set(key, pending);
    try {
      return responseFromBlob(await pending, key);
    } catch (error) {
      current.failedResources++;
      throw error;
    }
  }

  function responseFromBlob(blob, url) {
    return { status: 200, url, headers: new Headers({ "content-type": blob.type }), arrayBuffer: () => blob.arrayBuffer(), blob: () => blob };
  }

  function prepare(id) {
    if (session) throw new Error("A capture is already running");
    // Our own overlay must never appear in screenshots or archived HTML.
    document.getElementById("karakeep-quick-archive-list-picker-host")?.remove();
    session = { id, cache: new Map(), failedResources: 0, bytes: 0 };
    const url = location.href;
    const title = document.title || url;
    const description = document.querySelector('meta[name="description"], meta[property="og:description"]')?.content || "";
    const text = (document.body?.innerText || "").slice(0, 500_000);
    const candidates = [
      ...document.querySelectorAll('meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"], meta[property="twitter:image"]')
    ].map((meta) => meta.content);
    const images = [...document.images].filter((img) => img.naturalWidth >= 150 && img.naturalHeight >= 100);
    images.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);
    candidates.push(...images.slice(0, 5).map((img) => img.currentSrc || img.src));
    const bannerUrls = [...new Set(candidates.filter(Boolean).map((src) => {
      try { return new URL(src, document.baseURI).href; } catch { return null; }
    }).filter(Boolean))].slice(0, 5);
    const fallbackHtml = text.trim()
      ? `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"></head><body><h1>${escape(title)}</h1><pre>${escape(text)}</pre></body></html>`
      : null;
    const challenge = /browser has failed some security checks|verify you are human|checking your browser|just a moment/i.test(`${title}\n${text.slice(0, 3000)}`);
    return { url, title, bannerUrls, fallbackHtml, challenge };
  }

  async function capture(id) {
    if (session?.id !== id) throw new Error("Invalid capture session");
    const current = session;
    const page = await getPageData({
      removeHiddenElements: true, removeUnusedStyles: true, removeUnusedFonts: true,
      compressHTML: true, blockScripts: true, blockVideos: true, blockAudios: true,
      removeFrames: true, removeAlternativeFonts: true, removeAlternativeMedias: true,
      removeAlternativeImages: true, groupDuplicateImages: true,
      maxResourceSizeEnabled: true, maxResourceSize: 8, networkTimeout: RESOURCE_TIMEOUT_MS,
      loadDeferredImages: false, saveOriginalURLs: true
    }, { fetch: (url) => resourceFetch(url, current) }, document, window);
    return { url: location.href, html: page.content, failedResources: current.failedResources };
  }

  async function banner(id, urls) {
    if (session?.id !== id) throw new Error("Invalid capture session");
    const current = session;
    let lastError;
    for (const url of urls) {
      try {
        const response = await resourceFetch(url, current);
        const blob = response.blob();
        if (blob.type.startsWith("image/")) return await blobToDataUrl(blob);
        lastError = new Error(`Unsupported banner content type: ${blob.type}`);
      } catch (error) { lastError = error; }
    }
    if (lastError) throw lastError;
    return null;
  }

  function escape(value) {
    return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  globalThis.__karakeepCapture = { prepare, capture, banner, end: (id) => {
    if (session?.id === id) session = null;
  } };
}
