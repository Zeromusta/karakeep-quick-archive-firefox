import {
  DEFAULT_SETTINGS,
  DEFAULT_STORAGE_STATE,
  HISTORY_STATUS,
  ITEM_STATES,
  MANUAL_REVIEW_ACTIONS,
  STORAGE_KEYS
} from "../shared/constants.js";
import {
  generateId,
  getExpiryTimestamp,
  normalizeSettingsInput
} from "../shared/utils.js";

let storageLock = Promise.resolve();

export async function ensureStorageDefaults() {
  const currentState = await browser.storage.local.get(Object.values(STORAGE_KEYS));
  const updates = {};

  for (const [stateKey, defaultValue] of Object.entries(DEFAULT_STORAGE_STATE)) {
    if (!(stateKey in currentState)) {
      updates[stateKey] = defaultValue;
    }
  }

  const normalizedSettings = normalizeSettingsInput(
    currentState[STORAGE_KEYS.settings] ?? DEFAULT_SETTINGS
  );

  if (
    JSON.stringify(normalizedSettings) !==
    JSON.stringify(currentState[STORAGE_KEYS.settings] ?? DEFAULT_SETTINGS)
  ) {
    updates[STORAGE_KEYS.settings] = normalizedSettings;
  }

  if (Object.keys(updates).length > 0) {
    await browser.storage.local.set(updates);
  }
}

export async function getSettings() {
  const { [STORAGE_KEYS.settings]: rawSettings } = await browser.storage.local.get(
    STORAGE_KEYS.settings
  );

  return normalizeSettingsInput(rawSettings);
}

export async function saveSettings(settings) {
  await browser.storage.local.set({
    [STORAGE_KEYS.settings]: settings
  });
}

export async function getProcessingItems() {
  const state = await readState();
  return state.processingItems;
}

export async function createProcessingItem(snapshot, extras = {}) {
  const item = {
    id: generateId(),
    url: snapshot.url,
    title: snapshot.title,
    favIconUrl: snapshot.favIconUrl ?? null,
    requestedAt: Date.now(),
    sourceWindowId: snapshot.windowId,
    state: ITEM_STATES.processing,
    attemptCount: 1,
    // Drive an optional post-archive step (overlay "archive to list" / favourite).
    ...(extras.listId ? { listId: extras.listId } : {}),
    ...(extras.listName ? { listName: extras.listName } : {}),
    ...(extras.favourite ? { favourite: true } : {})
  };

  await updateState((state) => {
    state.processingItems = sortDescendingBy(
      [item, ...state.processingItems],
      "requestedAt"
    );
  });

  return item;
}

export async function completeProcessingItem(itemId, status, bookmarkId = null) {
  await updateState((state) => {
    const processingItem = state.processingItems.find((item) => item.id === itemId);
    if (!processingItem) {
      return;
    }

    state.processingItems = state.processingItems.filter((item) => item.id !== itemId);
    state.historyItems = addHistoryItem(
      state,
      { ...processingItem, bookmarkId },
      status,
      Date.now()
    );
  });
}

export async function failProcessingItem(itemId, lastError) {
  await updateState((state) => {
    const processingItem = state.processingItems.find((item) => item.id === itemId);
    if (!processingItem) {
      return;
    }

    state.processingItems = state.processingItems.filter((item) => item.id !== itemId);
    state.manualReviewItems = sortDescendingBy(
      [
        {
          ...processingItem,
          failedAt: Date.now(),
          state: ITEM_STATES.failed,
          lastError
        },
        ...state.manualReviewItems.filter((item) => item.id !== itemId)
      ],
      "failedAt"
    );
  });
}

export async function retryManualReviewItem(itemId) {
  let nextItem = null;

  await updateState((state) => {
    const manualItem = state.manualReviewItems.find((item) => item.id === itemId);
    if (!manualItem) {
      return;
    }

    nextItem = {
      id: manualItem.id,
      url: manualItem.url,
      title: manualItem.title,
      favIconUrl: manualItem.favIconUrl ?? null,
      requestedAt: Date.now(),
      sourceWindowId: manualItem.sourceWindowId,
      state: ITEM_STATES.processing,
      attemptCount: manualItem.attemptCount + 1
    };

    state.manualReviewItems = state.manualReviewItems.filter((item) => item.id !== itemId);
    state.processingItems = sortDescendingBy(
      [nextItem, ...state.processingItems.filter((item) => item.id !== itemId)],
      "requestedAt"
    );
  });

  return nextItem;
}

export async function archiveClosedHistoryItem(itemId) {
  let nextItem = null;

  await updateState((state) => {
    const historyItem = state.historyItems.find(
      (item) => item.id === itemId && item.status === HISTORY_STATUS.closed
    );
    if (!historyItem) {
      return;
    }

    nextItem = {
      id: historyItem.id,
      url: historyItem.url,
      title: historyItem.title,
      favIconUrl: historyItem.favIconUrl ?? null,
      requestedAt: Date.now(),
      sourceWindowId: historyItem.sourceWindowId,
      state: ITEM_STATES.processing,
      attemptCount: 1
    };

    state.historyItems = state.historyItems.filter((item) => item.id !== itemId);
    state.processingItems = sortDescendingBy(
      [nextItem, ...state.processingItems.filter((item) => item.id !== itemId)],
      "requestedAt"
    );
  });

  return nextItem;
}

export async function markManualReviewItemClosed(itemId) {
  await updateState((state) => {
    const manualItem = state.manualReviewItems.find((item) => item.id === itemId);
    if (!manualItem) {
      return;
    }

    state.manualReviewItems = state.manualReviewItems.filter((item) => item.id !== itemId);
    state.historyItems = addHistoryItem(
      state,
      {
        id: manualItem.id,
        url: manualItem.url,
        title: manualItem.title,
        favIconUrl: manualItem.favIconUrl ?? null,
        sourceWindowId: manualItem.sourceWindowId
      },
      HISTORY_STATUS.closed,
      Date.now()
    );
  });
}

export async function recordClosedHistory(snapshot) {
  await updateState((state) => {
    state.historyItems = addHistoryItem(
      state,
      {
        id: generateId(),
        url: snapshot.url,
        title: snapshot.title,
        favIconUrl: snapshot.favIconUrl ?? null,
        sourceWindowId: snapshot.windowId
      },
      HISTORY_STATUS.closed,
      Date.now()
    );
  });
}

export async function applyBookmarkFavouriteToHistory(bookmarkId, favourited) {
  if (!bookmarkId) {
    return 0;
  }
  let matchCount = 0;
  await updateState((state) => {
    state.historyItems = state.historyItems.map((item) => {
      if (item.bookmarkId !== bookmarkId) {
        return item;
      }
      matchCount += 1;
      return { ...item, favourited: Boolean(favourited) };
    });
  });
  return matchCount;
}

export async function getManualReviewItem(itemId) {
  const state = await readState();
  return state.manualReviewItems.find((item) => item.id === itemId) ?? null;
}

export async function getHistoryItem(itemId) {
  const state = await readState();
  return state.historyItems.find((item) => item.id === itemId) ?? null;
}

export async function dismissManualReviewItem(itemId) {
  await updateState((state) => {
    state.manualReviewItems = state.manualReviewItems.filter(
      (item) => item.id !== itemId
    );
  });
}

export async function recordFavouriteToggleFailure({
  historyItem,
  desiredFavouritedState,
  lastError
}) {
  const failureItem = {
    id: generateId(),
    historyItemId: historyItem.id,
    bookmarkId: historyItem.bookmarkId,
    desiredFavouritedState: Boolean(desiredFavouritedState),
    url: historyItem.url,
    title: historyItem.title,
    favIconUrl: historyItem.favIconUrl ?? null,
    sourceWindowId: historyItem.sourceWindowId,
    requestedAt: Date.now(),
    failedAt: Date.now(),
    state: ITEM_STATES.failed,
    failedAction: MANUAL_REVIEW_ACTIONS.favouriteToggle,
    attemptCount: 1,
    lastError
  };
  await updateState((state) => {
    state.manualReviewItems = sortDescendingBy(
      [failureItem, ...state.manualReviewItems],
      "failedAt"
    );
  });
  return failureItem;
}

// The archive itself succeeded but filing the bookmark into the chosen list
// failed. Record a manual-review entry so the user can retry just the list add.
export async function recordListAddFailure({
  item,
  bookmarkId,
  listId,
  listName,
  lastError
}) {
  const failureItem = {
    id: generateId(),
    bookmarkId,
    listId,
    listName: listName ?? null,
    url: item.url,
    title: item.title,
    favIconUrl: item.favIconUrl ?? null,
    sourceWindowId: item.sourceWindowId,
    requestedAt: Date.now(),
    failedAt: Date.now(),
    state: ITEM_STATES.failed,
    failedAction: MANUAL_REVIEW_ACTIONS.listAdd,
    attemptCount: 1,
    lastError
  };
  await updateState((state) => {
    state.manualReviewItems = sortDescendingBy(
      [failureItem, ...state.manualReviewItems],
      "failedAt"
    );
  });
  return failureItem;
}

// Action-agnostic: bumps the failure timestamp / attempt count on a manual-review
// entry after a retry fails (used by both favourite-toggle and list-add retries).
export async function recordManualReviewRetryFailure(itemId, lastError) {
  await updateState((state) => {
    state.manualReviewItems = state.manualReviewItems.map((item) => {
      if (item.id !== itemId) {
        return item;
      }
      return {
        ...item,
        failedAt: Date.now(),
        attemptCount: (item.attemptCount ?? 1) + 1,
        lastError
      };
    });
    state.manualReviewItems = sortDescendingBy(
      state.manualReviewItems,
      "failedAt"
    );
  });
}

export async function clearHistoryItems(statusFilter = "all") {
  await updateState((state) => {
    if (statusFilter === "all") {
      state.historyItems = [];
      return;
    }
    state.historyItems = state.historyItems.filter(
      (item) => item.status !== statusFilter
    );
  });
}

export async function pruneHistory() {
  await updateState((state) => {
    state.historyItems = normalizeHistoryItems(
      state.historyItems,
      state.settings.historyRetentionHours
    );
  });
}

async function updateState(mutator) {
  return withStorageLock(async () => {
    const state = await readState();
    await mutator(state);
    await browser.storage.local.set(serializeState(state));
    return state;
  });
}

async function readState() {
  const rawState = await browser.storage.local.get(Object.values(STORAGE_KEYS));
  const settings = normalizeSettingsInput(rawState[STORAGE_KEYS.settings] ?? DEFAULT_SETTINGS);

  return {
    settings,
    processingItems: Array.isArray(rawState[STORAGE_KEYS.processingItems])
      ? sortDescendingBy(rawState[STORAGE_KEYS.processingItems], "requestedAt")
      : [],
    manualReviewItems: Array.isArray(rawState[STORAGE_KEYS.manualReviewItems])
      ? sortDescendingBy(rawState[STORAGE_KEYS.manualReviewItems], "failedAt")
      : [],
    historyItems: Array.isArray(rawState[STORAGE_KEYS.historyItems])
      ? normalizeHistoryItems(rawState[STORAGE_KEYS.historyItems], settings.historyRetentionHours)
      : []
  };
}

function serializeState(state) {
  return {
    [STORAGE_KEYS.settings]: state.settings,
    [STORAGE_KEYS.processingItems]: state.processingItems,
    [STORAGE_KEYS.manualReviewItems]: state.manualReviewItems,
    [STORAGE_KEYS.historyItems]: state.historyItems
  };
}

function normalizeHistoryItems(historyItems, historyRetentionHours) {
  const now = Date.now();

  return sortDescendingBy(
    historyItems
      .map((item) => ({
        ...item,
        expiresAt: getExpiryTimestamp(item.actionAt, historyRetentionHours)
      }))
      .filter((item) => item.expiresAt > now),
    "actionAt"
  );
}

function addHistoryItem(state, sourceItem, status, actionAt) {
  const historyItem = {
    id: sourceItem.id,
    url: sourceItem.url,
    title: sourceItem.title,
    favIconUrl: sourceItem.favIconUrl ?? null,
    sourceWindowId: sourceItem.sourceWindowId,
    bookmarkId: sourceItem.bookmarkId ?? null,
    actionAt,
    status,
    expiresAt: getExpiryTimestamp(actionAt, state.settings.historyRetentionHours)
  };

  return normalizeHistoryItems(
    [historyItem, ...state.historyItems.filter((item) => item.id !== historyItem.id)],
    state.settings.historyRetentionHours
  );
}

function sortDescendingBy(items, key) {
  return [...items].sort((leftItem, rightItem) => {
    const leftValue = Number(leftItem?.[key] ?? 0);
    const rightValue = Number(rightItem?.[key] ?? 0);
    return rightValue - leftValue;
  });
}

function withStorageLock(task) {
  const nextTask = storageLock.then(task, task);
  storageLock = nextTask.catch((error) => {
    console.error("[karakeep-quick-archive] Storage mutation failed", error);
  });
  return nextTask;
}
