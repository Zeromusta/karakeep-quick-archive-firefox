import {
  COMMAND_NAMES,
  MANUAL_REVIEW_ACTIONS,
  MESSAGE_TYPES,
  STORAGE_KEYS
} from "../shared/constants.js";
import { applyIconTheme, watchSystemThemeChanges } from "../shared/icon-theme.js";
import { isEligibleUrl, logDebug, normalizeSettingsInput } from "../shared/utils.js";
import {
  archiveFromClosedHistory,
  enqueueArchiveFromSnapshot,
  resumeProcessingQueue,
  retryFailedArchive,
  waitForProcessing
} from "./archive-queue.js";
import { initializeCleanup, registerCleanupHandler } from "./cleanup.js";
import {
  applyBookmarkFavouriteToHistory,
  clearHistoryItems,
  dismissManualReviewItem,
  ensureStorageDefaults,
  getHistoryItem,
  getManualReviewItem,
  getSettings,
  markManualReviewItemClosed,
  pruneHistory,
  recordClosedHistory,
  recordFavouriteToggleFailure,
  recordFavouriteToggleRetryFailure
} from "./history-store.js";
import { setBookmarkFavourite, testConnection } from "./karakeep-client.js";
import {
  forgetTab,
  getSnapshot,
  initializeTabSnapshotCache,
  rememberTab
} from "./tab-snapshot-cache.js";

const archiveInitiatedCloses = new Set();
let initializePromise = null;
let isInitialized = false;

registerListeners();
void runStartupTasks();

function registerListeners() {
  registerCleanupHandler();

  browser.runtime.onInstalled.addListener(() => {
    void runStartupTasks();
  });

  browser.runtime.onStartup.addListener(() => {
    void runStartupTasks();
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEYS.settings]) {
      return;
    }
    const nextSettings = normalizeSettingsInput(
      changes[STORAGE_KEYS.settings].newValue ?? {}
    );
    void applyIconTheme(nextSettings.iconTheme, nextSettings.monitoringPaused);
  });

  browser.tabs.onCreated.addListener(async (tab) => {
    await initializeExtension();
    rememberTab(tab);
  });

  browser.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
    if (
      !("url" in changeInfo) &&
      !("title" in changeInfo) &&
      !("favIconUrl" in changeInfo) &&
      changeInfo.status !== "complete"
    ) {
      return;
    }
    await initializeExtension();
    rememberTab(tab);
  });

  browser.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    await initializeExtension();
    await handleTabRemoved(tabId, removeInfo);
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== COMMAND_NAMES.archiveCurrentTab) {
      return;
    }

    await initializeExtension();
    await archiveActiveTab();
  });

  browser.runtime.onMessage.addListener(async (message) => {
    await initializeExtension();

    switch (message?.type) {
      case MESSAGE_TYPES.testConnection:
        return await testConnection(message.settings);
      case MESSAGE_TYPES.retryManualReview:
        return await handleRetryManualReview(message.itemId);
      case MESSAGE_TYPES.markManualReviewClosed:
        await markManualReviewItemClosed(message.itemId);
        return { ok: true };
      case MESSAGE_TYPES.openHistoryItem:
        await openHistoryItem(message.url);
        return { ok: true };
      case MESSAGE_TYPES.archiveClosedHistoryItem:
        return await handleArchiveClosedHistoryItem(message.itemId);
      case MESSAGE_TYPES.clearHistory:
        await clearHistoryItems(message.statusFilter ?? "all");
        return { ok: true };
      case MESSAGE_TYPES.toggleBookmarkFavourite:
        return await handleToggleBookmarkFavourite(message);
      case MESSAGE_TYPES.dismissManualReview:
        await dismissManualReviewItem(message.itemId);
        return { ok: true };
      default:
        return undefined;
    }
  });
}

async function initializeExtension() {
  if (isInitialized) {
    return;
  }
  if (!initializePromise) {
    initializePromise = (async () => {
      await ensureStorageDefaults();
      await initializeTabSnapshotCache();
      await initializeCleanup();
      await pruneHistory();
      const settings = await getSettings();
      await applyIconTheme(settings.iconTheme, settings.monitoringPaused);
      watchSystemThemeChanges();
      isInitialized = true;
    })().finally(() => {
      initializePromise = null;
    });
  }

  return initializePromise;
}

async function runStartupTasks() {
  await initializeExtension();
  await resumeProcessingQueue();
}

async function archiveActiveTab() {
  const [activeTab] = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!Number.isInteger(activeTab?.id) || !isEligibleUrl(activeTab.url ?? "")) {
    return;
  }

  const snapshot = (await rememberTab(activeTab)) ?? (await getSnapshot(activeTab.id));
  if (!snapshot) {
    return;
  }

  const item = await enqueueArchiveFromSnapshot(snapshot);
  archiveInitiatedCloses.add(activeTab.id);

  try {
    await browser.tabs.remove(activeTab.id);
  } catch (error) {
    const settings = await getSettings();
    logDebug(settings.debugLogging, "Failed to close archived tab", activeTab.id, error);
    archiveInitiatedCloses.delete(activeTab.id);
  }

  await waitForProcessing(item.id);
}

async function handleTabRemoved(tabId, removeInfo) {
  const snapshot = await getSnapshot(tabId);
  await forgetTab(tabId);

  if (removeInfo.isWindowClosing) {
    archiveInitiatedCloses.delete(tabId);
    return;
  }

  if (archiveInitiatedCloses.delete(tabId)) {
    return;
  }

  if (!snapshot || !isEligibleUrl(snapshot.url)) {
    return;
  }

  const settings = await getSettings();
  if (settings.monitoringPaused) {
    return;
  }

  await recordClosedHistory(snapshot);
}

async function handleRetryManualReview(itemId) {
  const manualItem = await getManualReviewItem(itemId);
  if (!manualItem) {
    return { ok: false, message: "Item was not found." };
  }

  if (manualItem.failedAction === MANUAL_REVIEW_ACTIONS.favouriteToggle) {
    return await retryFavouriteToggleFromManualReview(manualItem);
  }

  const processingItem = await retryFailedArchive(itemId);
  if (!processingItem) {
    return { ok: false, message: "Item was not found." };
  }

  await waitForProcessing(processingItem.id);
  return { ok: true };
}

async function retryFavouriteToggleFromManualReview(manualItem) {
  try {
    await setBookmarkFavourite(
      manualItem.bookmarkId,
      manualItem.desiredFavouritedState
    );
    await applyBookmarkFavouriteToHistory(
      manualItem.bookmarkId,
      manualItem.desiredFavouritedState
    );
    await dismissManualReviewItem(manualItem.id);
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Karakeep returned an error";
    await recordFavouriteToggleRetryFailure(manualItem.id, message);
    return { ok: false, message };
  }
}

async function handleToggleBookmarkFavourite(message) {
  const { itemId, bookmarkId, desiredFavouritedState } = message;
  if (!bookmarkId) {
    return { ok: false, message: "Bookmark id is missing." };
  }
  const historyItem = itemId ? await getHistoryItem(itemId) : null;
  try {
    await setBookmarkFavourite(bookmarkId, desiredFavouritedState);
    // The same bookmark id can appear on multiple history rows (e.g.
    // first archive lands as Archived, subsequent attempts on the same
    // URL land as Skipped). Update them all so the star state stays in
    // sync across rows.
    await applyBookmarkFavouriteToHistory(bookmarkId, desiredFavouritedState);
    return { ok: true };
  } catch (error) {
    const settings = await getSettings();
    const errorMessage =
      error instanceof Error && error.message
        ? error.message
        : "Karakeep returned an error";
    logDebug(
      settings.debugLogging,
      "Favourite toggle failed",
      bookmarkId,
      errorMessage
    );
    if (historyItem) {
      await recordFavouriteToggleFailure({
        historyItem,
        desiredFavouritedState,
        lastError: errorMessage
      });
    }
    return { ok: false, message: errorMessage };
  }
}

async function handleArchiveClosedHistoryItem(itemId) {
  const processingItem = await archiveFromClosedHistory(itemId);
  if (!processingItem) {
    return {
      ok: false,
      message: "History item was not found."
    };
  }

  await waitForProcessing(processingItem.id);
  return { ok: true };
}

async function openHistoryItem(url) {
  if (!isEligibleUrl(url)) {
    return;
  }

  await browser.tabs.create({
    url,
    active: false
  });
}
