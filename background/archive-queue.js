import { logDebug } from "../shared/utils.js";
import { putCapture, deleteCapture } from "./capture-store.js";
import { archiveWithCapture } from "./capture-upload.js";
import {
  applyBookmarkFavouriteToHistory,
  archiveClosedHistoryItem,
  completeProcessingItem,
  createProcessingItem,
  failProcessingItem,
  getHistoryItem,
  getProcessingItems,
  getSettings,
  recordFavouriteToggleFailure,
  recordListAddFailure,
  retryManualReviewItem
} from "./history-store.js";
import {
  addBookmarkToList,
  setBookmarkFavourite
} from "./karakeep-client.js";

const activeJobs = new Map();

export async function enqueueArchiveFromSnapshot(snapshot, extras = {}, capture = null, { deferProcessing = false } = {}) {
  let captureId;
  if (capture) {
    captureId = crypto.randomUUID();
    try { await putCapture(captureId, capture); }
    catch {
      captureId = null;
      extras = { ...extras, captureIssues: ["Could not store local capture; saved URL only"] };
    }
  }
  const item = await createProcessingItem(snapshot, { ...extras, captureId });
  if (!deferProcessing) startProcessingJob(item);
  return item;
}

export async function retryFailedArchive(itemId) {
  const item = await retryManualReviewItem(itemId);
  if (!item) {
    return null;
  }

  startProcessingJob(item);
  return item;
}

export async function archiveFromClosedHistory(itemId) {
  const item = await archiveClosedHistoryItem(itemId);
  if (!item) {
    return null;
  }

  startProcessingJob(item);
  return item;
}

export function waitForProcessing(itemId) {
  return activeJobs.get(itemId) ?? Promise.resolve();
}

export async function resumeProcessingQueue() {
  const processingItems = await getProcessingItems();
  await Promise.all(processingItems.map((item) => startProcessingJob(item)));
}

export function startProcessingJob(item) {
  if (activeJobs.has(item.id)) {
    return activeJobs.get(item.id);
  }

  const job = (async () => {
    try {
      const result = await archiveWithCapture(item);
      await completeProcessingItem(item.id, result.status, result.bookmarkId, result);
      // The archive itself is done; the optional list/favourite step runs after
      // and never fails the archive — it spawns its own manual-review entry.
      await applyPostArchiveAction(item, result.bookmarkId);
      if (item.captureId) await deleteCapture(item.captureId).catch(() => {});
    } catch (error) {
      const settings = await getSettings();
      logDebug(
        settings.debugLogging,
        "Archive failed",
        item.url,
        toErrorMessage(error)
      );
      await failProcessingItem(item.id, toErrorMessage(error));
    }
  })();

  const trackedJob = job.finally(() => {
    activeJobs.delete(item.id);
  });

  activeJobs.set(item.id, trackedJob);
  return trackedJob;
}

// After a successful archive, apply the overlay's chosen list / favourite. A
// failure here doesn't undo the archive — it lands a dedicated manual-review
// entry so the user can retry just that step.
async function applyPostArchiveAction(item, bookmarkId) {
  if (!bookmarkId) {
    return;
  }

  if (item.favourite) {
    try {
      await setBookmarkFavourite(bookmarkId, true);
      await applyBookmarkFavouriteToHistory(bookmarkId, true);
    } catch (error) {
      const historyItem = await getHistoryItem(item.id);
      if (historyItem) {
        await recordFavouriteToggleFailure({
          historyItem,
          desiredFavouritedState: true,
          lastError: toErrorMessage(error)
        });
      }
    }
    return;
  }

  if (item.listId) {
    try {
      await addBookmarkToList(bookmarkId, item.listId);
    } catch (error) {
      await recordListAddFailure({
        item,
        bookmarkId,
        listId: item.listId,
        listName: item.listName ?? null,
        lastError: toErrorMessage(error)
      });
    }
  }
}

function toErrorMessage(error) {
  return error instanceof Error && error.message
    ? error.message
    : "Karakeep returned an error";
}
