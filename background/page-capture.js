import { CAPTURE_TIMEOUT_MS, MAX_CAPTURE_BYTES, RESOURCE_TIMEOUT_MS, blobToDataUrl, imageDataUrlToBlob, readLimitedResponse, withTimeout } from "../shared/capture.js";

const sessions = new Map();

// Only an injected script in a tab currently being captured can use this bridge.
// Karakeep credentials never enter content scripts or resource requests.
export async function handleCaptureResource(message, sender) {
  const session = sessions.get(message.captureId);
  if (!session || sender?.tab?.id !== session.tabId || sender.frameId !== 0 || sender.url !== session.url) {
    return { error: "No active capture" };
  }
  try {
    const url = new URL(message.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    if (session.bytes >= MAX_CAPTURE_BYTES) throw new Error();
    const blob = await readLimitedResponse(await fetch(url.href, {
      credentials: "include", cache: "force-cache", signal: AbortSignal.timeout(RESOURCE_TIMEOUT_MS)
    }));
    session.bytes += blob.size;
    if (session.bytes > MAX_CAPTURE_BYTES) throw new Error();
    return { dataUrl: await blobToDataUrl(blob) };
  } catch {
    return { error: "Resource unavailable; check page capture permissions" };
  }
}

export async function capturePage(tab) {
  const captureId = crypto.randomUUID();
  const result = { url: tab.url, capturedAt: Date.now(), mode: "url", issues: [], html: null, screenshot: null, banner: null };
  sessions.set(captureId, { tabId: tab.id, url: tab.url, bytes: 0 });
  let prepared;
  try {
    await withTimeout(browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/page-capture.bundle.js"] }), 5000, "Page capture unavailable");
    prepared = await invoke(tab.id, "prepare", [captureId], 5000);
    if (prepared?.url !== tab.url) throw new Error("Page changed before capture");
    if (prepared.challenge) throw new Error("Page contains a browser security check");
    result.title = prepared.title;

    // captureVisibleTab works with activeTab. Check identity on both sides so
    // switching tabs during capture never saves another page's screenshot.
    try {
      const before = await browser.tabs.query({ active: true, windowId: tab.windowId });
      if (before[0]?.id !== tab.id || before[0]?.url !== tab.url) throw new Error();
      const screenshot = await withTimeout(browser.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 85 }), 5000, "Screenshot timed out");
      const after = await browser.tabs.query({ active: true, windowId: tab.windowId });
      if (after[0]?.id !== tab.id || after[0]?.url !== tab.url) throw new Error();
      result.screenshot = imageDataUrlToBlob(screenshot);
    } catch (error) { result.issues.push(`Screenshot unavailable${error?.message ? `: ${error.message}` : ""}`); }

    const [page, banner] = await Promise.allSettled([
      invoke(tab.id, "capture", [captureId], CAPTURE_TIMEOUT_MS),
      invoke(tab.id, "banner", [captureId, prepared.bannerUrls], 12_000)
    ]);
    if (page.status === "fulfilled" && page.value?.url === tab.url && page.value.html) {
      const html = new Blob([page.value.html], { type: "text/html" });
      if (html.size <= MAX_CAPTURE_BYTES) {
        result.html = html;
        result.mode = "full";
        if (page.value.failedResources) result.issues.push("Some page resources could not be captured");
      } else result.issues.push("Page snapshot exceeded 32 MB");
    } else result.issues.push("Full page capture failed or timed out");

    if (!result.html && prepared.fallbackHtml) {
      result.html = new Blob([prepared.fallbackHtml], { type: "text/html" });
      result.mode = "text";
    }
    if (banner.status === "fulfilled" && banner.value) {
      try { result.banner = await withTimeout(normaliseBanner(imageDataUrlToBlob(banner.value)), 5000, "Banner conversion timed out"); }
      catch { result.banner = result.screenshot; result.issues.push("Page image could not be converted; using screenshot as banner"); }
    } else {
      // Pages without a representative image still get a useful card preview.
      result.banner = result.screenshot;
      if (prepared.bannerUrls.length) result.issues.push(`Page image unavailable; using screenshot as banner${banner.reason?.message ? ` (${banner.reason.message})` : ""}`);
    }
    const currentTab = await browser.tabs.get(tab.id);
    if (currentTab.url !== tab.url) throw new Error("Page changed during capture");
  } catch (error) {
    result.mode = "url";
    result.html = result.screenshot = result.banner = null;
    result.issues.push(error?.message || "Page capture unavailable");
  } finally {
    sessions.delete(captureId);
    if (prepared) void invoke(tab.id, "end", [captureId], 1000).catch(() => {});
  }
  return result;
}

async function invoke(tabId, method, args, timeout) {
  const results = await withTimeout(browser.scripting.executeScript({
    target: { tabId },
    func: async (name, values) => globalThis.__karakeepCapture[name](...values),
    args: [method, args]
  }), timeout, `${method} timed out`);
  if (results[0]?.error) throw new Error(results[0].error.message || "Page capture failed");
  return results[0]?.result;
}

// Rasterize unsupported formats in the extension page, away from the website's
// CSP. Karakeep 0.33 accepts JPEG/PNG/GIF/WebP assets, but not SVG or AVIF.
async function normaliseBanner(blob) {
  if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(blob.type)) return blob;
  const img = new Image();
  img.src = await blobToDataUrl(blob);
  await img.decode();
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return imageDataUrlToBlob(canvas.toDataURL("image/png"));
}
