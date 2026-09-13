import { MAX_CAPTURE_BYTES, imageDataUrlToBlob, withTimeout } from "../shared/capture.js";

export async function capturePage(tab) {
  const captureId = crypto.randomUUID();
  const result = { url: tab.url, capturedAt: Date.now(), mode: "url", issues: [], html: null, screenshot: null, banner: null };
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

    result.bannerUrls = prepared.bannerUrls;
    result.fallbackHtml = prepared.fallbackHtml;
    try {
      const snapshot = await invoke(tab.id, "freeze", [captureId], 5000);
      if (snapshot?.url !== tab.url || !snapshot.content) throw new Error("Page changed during capture");
      if (new Blob([JSON.stringify(snapshot)]).size > MAX_CAPTURE_BYTES) throw new Error("Page snapshot exceeded 32 MB");
      result.snapshot = snapshot;
      result.mode = "pending";
    } catch (error) {
      result.issues.push(error.message || "Live page capture failed");
      if (prepared.fallbackHtml) {
        result.html = new Blob([prepared.fallbackHtml], { type: "text/html" });
        result.mode = "text";
      }
    }
    const currentTab = await browser.tabs.get(tab.id);
    if (currentTab.url !== tab.url) throw new Error("Page changed during capture");
  } catch (error) {
    result.mode = "url";
    result.html = result.screenshot = result.banner = result.snapshot = null;
    delete result.bannerUrls;
    delete result.fallbackHtml;
    result.issues.push(error?.message || "Page capture unavailable");
  } finally {
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
