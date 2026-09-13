import { imageDataUrlToBlob, withTimeout } from "../shared/capture.js";

export async function assembleCapture(capture) {
  if (!capture.snapshot && !capture.bannerUrls) return; // Already assembled / older queue item.
  let frame;
  try {
    frame = document.createElement("iframe");
    frame.hidden = true;
    const loaded = new Promise((resolve, reject) => {
      frame.onload = resolve;
      frame.onerror = () => reject(new Error("Could not load archive processor"));
    });
    frame.src = browser.runtime.getURL("background/capture-processor.html");
    document.body.append(frame);
    await withTimeout(loaded, 5000, "Archive processor did not load");
    const result = await withTimeout(frame.contentWindow.assemble(capture), 45_000, "Archive assembly timed out");
    if (result.html) capture.html = new Blob([result.html], { type: "text/html" });
    capture.mode = result.mode;
    capture.banner = result.banner ? imageDataUrlToBlob(result.banner) : capture.screenshot;
    capture.issues.push(...result.issues);
  } catch (error) {
    capture.issues.push(error.message || "Archive assembly failed");
    if (capture.snapshot) {
      capture.html = capture.fallbackHtml ? new Blob([capture.fallbackHtml], { type: "text/html" }) : null;
      capture.mode = capture.html ? "text" : "url";
    }
    capture.banner = capture.screenshot;
  } finally {
    frame?.remove(); // Also destroys timed-out resource fetches / processor state.
    delete capture.snapshot;
    delete capture.bannerUrls;
    delete capture.fallbackHtml;
  }
}
