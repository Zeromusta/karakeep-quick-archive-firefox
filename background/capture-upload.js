import { CAPTURE_TAG } from "../shared/capture.js";
import { getCapture, putCapture } from "./capture-store.js";
import { addCaptureReviewTag, archiveBookmark, attachCaptureImage, uploadCaptureImage, uploadPageArchive, waitForImageProcessing } from "./karakeep-client.js";

export async function archiveWithCapture(item) {
  const stored = item.captureId ? await getCapture(item.captureId) : null;
  const capture = stored || {
    mode: "url", issues: item.captureIssues || ["Page was already closed; saved URL only"],
    capturedAt: Date.now()
  };
  if (item.captureId && !stored) capture.issues = ["Stored capture unavailable; saved URL only"];
  const checkpoint = async () => {
    if (item.captureId) await putCapture(item.captureId, capture);
  };

  if (!capture.result) {
    if (capture.html) {
      try { capture.result = await uploadPageArchive(item.url, capture.html); }
      catch (error) {
        capture.issues.push(`Snapshot upload failed: ${error.message}`);
        capture.mode = "url";
      }
    }
    if (!capture.result) capture.result = await archiveBookmark(item);
    if (!capture.result.bookmarkId) throw new Error("Karakeep returned no bookmark ID");
    await checkpoint();
  }

  if ((capture.screenshot && !capture.screenshotAttached) || (capture.banner && !capture.bannerAttached)) {
    const status = await waitForImageProcessing(capture.result.bookmarkId);
    if (status === "failure") capture.issues.push("Karakeep could not finish processing the page");
  }

  // Checkpoint uploads separately from attachment so retries reuse the asset ID.
  for (const [key, assetType] of [["screenshot", "screenshot"], ["banner", "bannerImage"]]) {
    if (!capture[key] || capture[`${key}Attached`]) continue;
    try {
      if (!capture[`${key}AssetId`]) {
        const extension = capture[key].type.split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") || "png";
        capture[`${key}AssetId`] = await uploadCaptureImage(capture[key], `${key}.${extension}`);
        await checkpoint();
      }
      await attachCaptureImage(capture.result.bookmarkId, capture[`${key}AssetId`], assetType);
      capture[`${key}Attached`] = true;
      await checkpoint();
    } catch (error) {
      capture.issues.push(`${key === "banner" ? "Banner" : "Screenshot"} upload failed: ${error.message}`);
      await checkpoint();
    }
  }
  capture.issues = [...new Set(capture.issues)];
  if (capture.issues.length && !capture.tagged) {
    await addCaptureReviewTag(capture.result.bookmarkId, CAPTURE_TAG);
    capture.tagged = true;
    await checkpoint();
  }
  return { ...capture.result, captureMode: capture.mode, captureIssues: capture.issues };
}
