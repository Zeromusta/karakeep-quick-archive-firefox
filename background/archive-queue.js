import { logDebug } from "../shared/utils.js";
import {
  archiveClosedHistoryItem,
  completeProcessingItem,
  createProcessingItem,
  failProcessingItem,
  getProcessingItems,
  getSettings,
  retryManualReviewItem
} from "./history-store.js";
import { archiveBookmark } from "./karakeep-client.js";

const activeJobs = new Map();

export async function enqueueArchiveFromSnapshot(snapshot) {
  const item = await createProcessingItem(snapshot);
  startProcessingJob(item);
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

function startProcessingJob(item) {
  if (activeJobs.has(item.id)) {
    return activeJobs.get(item.id);
  }

  const job = (async () => {
    try {
      const result = await archiveBookmark(item);
      await completeProcessingItem(item.id, result.status, result.bookmarkId);
    } catch (error) {
      const settings = await getSettings();
      const errorMessage =
        error instanceof Error && error.message
          ? error.message
          : "Karakeep returned an error";

      logDebug(settings.debugLogging, "Archive failed", item.url, errorMessage);
      await failProcessingItem(item.id, errorMessage);
    }
  })();

  const trackedJob = job.finally(() => {
    activeJobs.delete(item.id);
  });

  activeJobs.set(item.id, trackedJob);
  return trackedJob;
}
