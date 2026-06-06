import {
  ARCHIVE_FLASH_DURATION_MS,
  COMMAND_NAMES,
  MANUAL_REVIEW_ACTIONS,
  MESSAGE_TYPES,
  STORAGE_KEYS
} from "../shared/constants.js";
import {
  applyIconTheme,
  flashArchivedIcon,
  watchSystemThemeChanges
} from "../shared/icon-theme.js";
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
  recordManualReviewRetryFailure
} from "./history-store.js";
import {
  addBookmarkToList,
  setBookmarkFavourite,
  testConnection
} from "./karakeep-client.js";
import { fetchListsWithMembership, setMembership } from "./list-service.js";
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
    await initializeExtension();

    if (command === COMMAND_NAMES.archiveCurrentTab) {
      await archiveActiveTab();
    } else if (command === COMMAND_NAMES.archiveCurrentTabToList) {
      await presentListPickerOnActiveTab();
    }
  });

  browser.runtime.onMessage.addListener(async (message, sender) => {
    await initializeExtension();

    switch (message?.type) {
      case MESSAGE_TYPES.testConnection:
        return await testConnection(message.settings);
      case MESSAGE_TYPES.getLists:
        return await handleGetLists();
      case MESSAGE_TYPES.archiveCurrentTabToList:
        return await handleArchiveCurrentTabToList(message, sender);
      case MESSAGE_TYPES.fetchListsWithMembership:
        return await fetchListsWithMembership(message.bookmarkId);
      case MESSAGE_TYPES.setListMembership:
        return await setMembership(
          message.bookmarkId,
          message.listId,
          message.member
        );
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

  // The item is now persisted ("captured"), so confirm to the user before the
  // tab closes — regardless of whether the archive later succeeds or fails.
  // Fire-and-forget so the close stays instant.
  void showArchiveCaptureFeedback(snapshot);

  try {
    await browser.tabs.remove(activeTab.id);
  } catch (error) {
    const settings = await getSettings();
    logDebug(settings.debugLogging, "Failed to close archived tab", activeTab.id, error);
    archiveInitiatedCloses.delete(activeTab.id);
  }

  await waitForProcessing(item.id);
}

// Keyboard-shortcut entry point: inject the list-picker overlay into the active
// tab. The command grants activeTab, so scripting.executeScript can reach the
// page without a broad host grant. The overlay drives the rest via messages.
async function presentListPickerOnActiveTab() {
  const [activeTab] = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!Number.isInteger(activeTab?.id) || !isEligibleUrl(activeTab.url ?? "")) {
    return;
  }

  try {
    await browser.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ["content/list-picker.js"]
    });
  } catch (error) {
    const settings = await getSettings();
    logDebug(
      settings.debugLogging,
      "Failed to inject list picker",
      activeTab.id,
      error
    );
  }
}

async function handleGetLists() {
  const result = await fetchListsWithMembership(null);
  return { ok: result.ok, lists: result.lists, message: result.message };
}

// Overlay pick handler: archive the sender's tab and file it into the chosen
// list / favourite, then close the tab. Mirrors archiveActiveTab but keyed off
// sender.tab (the message comes from the content script in the active tab).
async function handleArchiveCurrentTabToList(message, sender) {
  const tab = sender?.tab;
  if (!Number.isInteger(tab?.id) || !isEligibleUrl(tab.url ?? "")) {
    return { ok: false };
  }

  const snapshot = (await rememberTab(tab)) ?? (await getSnapshot(tab.id));
  if (!snapshot) {
    return { ok: false };
  }

  const extras = message.favourite
    ? { favourite: true }
    : { listId: message.listId, listName: message.listName };

  const item = await enqueueArchiveFromSnapshot(snapshot, extras);
  archiveInitiatedCloses.add(tab.id);

  void showArchiveCaptureFeedback(snapshot);

  try {
    await browser.tabs.remove(tab.id);
  } catch (error) {
    const settings = await getSettings();
    logDebug(settings.debugLogging, "Failed to close archived tab", tab.id, error);
    archiveInitiatedCloses.delete(tab.id);
  }

  await waitForProcessing(item.id);
  return { ok: true };
}

async function showArchiveCaptureFeedback(snapshot) {
  const settings = await getSettings();
  if (settings.archiveFeedbackIcon) {
    void flashArchivedIcon();
  }
  if (settings.archiveFeedbackNotification) {
    void notifyArchived(snapshot.title || snapshot.url || "Tab");
  }
}

async function notifyArchived(title) {
  if (!browser.notifications?.create) {
    return;
  }
  try {
    const notificationId = await browser.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon-light-128.png"),
      title: "Karakeep Quick Archive",
      message: `${title} archived.`
    });
    // Best-effort "lingers ~2s" — clear it after the same window as the icon
    // tick. Platforms that auto-dismiss sooner simply no-op here.
    if (browser.notifications.clear) {
      setTimeout(() => {
        void browser.notifications.clear(notificationId);
      }, ARCHIVE_FLASH_DURATION_MS);
    }
  } catch {
    // Notifications are cosmetic; never let them break the archive flow.
  }
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

  if (manualItem.failedAction === MANUAL_REVIEW_ACTIONS.listAdd) {
    return await retryListAddFromManualReview(manualItem);
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
    await recordManualReviewRetryFailure(manualItem.id, message);
    return { ok: false, message };
  }
}

// Re-files an archived bookmark into its list after the original add failed.
// Mirrors ListService.retryAddFromManualReview in the iOS app.
async function retryListAddFromManualReview(manualItem) {
  if (!manualItem.bookmarkId || !manualItem.listId) {
    return { ok: false, message: "Item was not found." };
  }
  try {
    await addBookmarkToList(manualItem.bookmarkId, manualItem.listId);
    await dismissManualReviewItem(manualItem.id);
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Karakeep returned an error";
    await recordManualReviewRetryFailure(manualItem.id, message);
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
