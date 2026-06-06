import test from "node:test";
import assert from "node:assert/strict";

import {
  MANUAL_REVIEW_ACTIONS,
  MESSAGE_TYPES,
  SESSION_STORAGE_KEYS,
  STORAGE_KEYS
} from "../shared/constants.js";
import { getCachedTabIds } from "../background/tab-snapshot-cache.js";
import { createBrowserMock } from "./helpers/browser-mock.js";
import {
  createDeferred,
  flushMicrotasks,
  importFresh,
  waitFor
} from "./helpers/module.js";

const controllerModuleUrl = new URL("../background/controller.js", import.meta.url);

test("controller records normal closes and ignores whole-window closes", async () => {
  const browser = (globalThis.browser = createBrowserMock({
    tabs: [
      {
        id: 1,
        windowId: 1,
        active: true,
        url: "https://example.com/article",
        title: "Example Article",
        favIconUrl: "https://example.com/favicon.ico"
      },
      {
        id: 2,
        windowId: 2,
        active: false,
        url: "https://example.com/window-close",
        title: "Window Close",
        favIconUrl: null
      }
    ],
    grantedOrigins: ["https://karakeep.example.com/*"]
  }));
  globalThis.fetch = async () => ({
    status: 200,
    async json() {
      return { data: [] };
    }
  });

  await importFresh(controllerModuleUrl);
  await waitFor(() => getCachedTabIds().length === 2);

  await browser.tabs.onRemoved.emit(1, { windowId: 1, isWindowClosing: false });
  await browser.tabs.onRemoved.emit(2, { windowId: 2, isWindowClosing: true });

  const historyItems = await waitFor(async () => {
    const { [STORAGE_KEYS.historyItems]: nextHistoryItems } = await browser.storage.local.get(
      STORAGE_KEYS.historyItems
    );
    return nextHistoryItems?.length === 1 ? nextHistoryItems : null;
  });

  assert.equal(historyItems.length, 1);
  assert.equal(historyItems[0].status, "closed");
  assert.equal(historyItems[0].url, "https://example.com/article");
});

test("archive command creates processing immediately, closes the tab, and resolves to archived history", async () => {
  const deferredResponse = createDeferred();

  const browser = (globalThis.browser = createBrowserMock({
    tabs: [
      {
        id: 5,
        windowId: 1,
        active: true,
        url: "https://example.com/archive-me",
        title: "Archive Me",
        favIconUrl: "https://example.com/favicon.ico"
      }
    ],
    initialStorage: {
      [STORAGE_KEYS.settings]: {
        karakeepBaseUrl: "https://karakeep.example.com",
        karakeepApiKey: "secret-key",
        requestTimeoutSeconds: 15,
        historyRetentionHours: 168,
        showFavicons: true,
        maxHistoryItems: 500,
        debugLogging: false
      }
    },
    grantedOrigins: ["https://karakeep.example.com/*"]
  }));
  globalThis.fetch = async () => deferredResponse.promise;

  await importFresh(controllerModuleUrl);
  await waitFor(() => getCachedTabIds().length === 1);

  const commandPromise = browser.commands.onCommand.emit("archive-current-tab");
  const processingItems = await waitFor(async () => {
    const { [STORAGE_KEYS.processingItems]: nextProcessingItems } =
      await browser.storage.local.get(STORAGE_KEYS.processingItems);
    return nextProcessingItems?.length === 1 ? nextProcessingItems : null;
  });

  let storedState = await browser.storage.local.get([STORAGE_KEYS.historyItems]);
  assert.equal(processingItems.length, 1);
  assert.equal((storedState.historyItems ?? []).length, 0);
  assert.deepEqual(browser.__mock.removedTabIds, [5]);

  deferredResponse.resolve({
    status: 201,
    async json() {
      return { id: "bookmark-1" };
    }
  });

  await commandPromise;
  const archivedHistory = await waitFor(async () => {
    const nextState = await browser.storage.local.get([
      STORAGE_KEYS.processingItems,
      STORAGE_KEYS.historyItems
    ]);
    return nextState.processingItems?.length === 0 && nextState.historyItems?.length === 1
      ? nextState.historyItems
      : null;
  });

  storedState = await browser.storage.local.get([STORAGE_KEYS.processingItems]);
  assert.equal(storedState.processingItems.length, 0);
  assert.equal(archivedHistory.length, 1);
  assert.equal(archivedHistory[0].status, "archived");
});

test("archive command fires a desktop notification when that feedback is enabled", async () => {
  const browser = (globalThis.browser = createBrowserMock({
    tabs: [
      {
        id: 7,
        windowId: 1,
        active: true,
        url: "https://example.com/notify-me",
        title: "Notify Me",
        favIconUrl: null
      }
    ],
    initialStorage: {
      [STORAGE_KEYS.settings]: {
        karakeepBaseUrl: "https://karakeep.example.com",
        karakeepApiKey: "secret-key",
        requestTimeoutSeconds: 15,
        historyRetentionHours: 168,
        showFavicons: true,
        maxHistoryItems: 500,
        debugLogging: false,
        archiveFeedbackNotification: true
      }
    },
    grantedOrigins: ["https://karakeep.example.com/*"]
  }));
  globalThis.fetch = async () => ({
    status: 201,
    async json() {
      return { id: "bookmark-notify" };
    }
  });

  await importFresh(controllerModuleUrl);
  await waitFor(() => getCachedTabIds().length === 1);

  await browser.commands.onCommand.emit("archive-current-tab");

  const notifications = await waitFor(() =>
    browser.__mock.notifications.length === 1
      ? browser.__mock.notifications
      : null
  );

  assert.equal(notifications.length, 1);
  assert.match(notifications[0].message, /Notify Me archived\./);
  assert.deepEqual(browser.__mock.removedTabIds, [7]);
});

test("controller routes runtime retry and mark-closed actions through background state changes", async () => {
  const retryBrowser = (globalThis.browser = createBrowserMock({
    tabs: [],
    initialStorage: {
      [STORAGE_KEYS.settings]: {
        karakeepBaseUrl: "https://karakeep.example.com",
        karakeepApiKey: "secret-key",
        requestTimeoutSeconds: 15,
        historyRetentionHours: 168,
        showFavicons: true,
        maxHistoryItems: 500,
        debugLogging: false
      },
      [STORAGE_KEYS.manualReviewItems]: [
        {
          id: "failed-item",
          url: "https://example.com/failed",
          title: "Failed Item",
          favIconUrl: null,
          requestedAt: Date.now() - 1000,
          failedAt: Date.now(),
          sourceWindowId: 1,
          state: "failed",
          attemptCount: 1,
          lastError: "Could not reach Karakeep"
        }
      ]
    },
    grantedOrigins: ["https://karakeep.example.com/*"]
  }));
  globalThis.fetch = async () => ({
    status: 200,
    async json() {
      return { id: "existing-bookmark" };
    }
  });

  await importFresh(controllerModuleUrl);
  await flushMicrotasks();

  const retryResult = await retryBrowser.runtime.sendMessage({
    type: MESSAGE_TYPES.retryManualReview,
    itemId: "failed-item"
  });
  assert.deepEqual(retryResult, { ok: true });

  let storedState = await retryBrowser.storage.local.get([
    STORAGE_KEYS.manualReviewItems,
    STORAGE_KEYS.historyItems
  ]);
  assert.equal(storedState.manualReviewItems.length, 0);
  assert.equal(storedState.historyItems.length, 1);
  assert.equal(storedState.historyItems[0].status, "skipped");

  const markClosedBrowser = (globalThis.browser = createBrowserMock({
    initialStorage: {
      [STORAGE_KEYS.manualReviewItems]: [
        {
          id: "mark-closed-item",
          url: "https://example.com/manual-close",
          title: "Manual Close",
          favIconUrl: null,
          requestedAt: Date.now() - 1000,
          failedAt: Date.now(),
          sourceWindowId: 1,
          state: "failed",
          attemptCount: 1,
          lastError: "API key was rejected"
        }
      ]
    }
  }));
  globalThis.fetch = async () => ({
    status: 200,
    async json() {
      return { data: [] };
    }
  });

  await importFresh(controllerModuleUrl);
  await flushMicrotasks();

  await markClosedBrowser.runtime.sendMessage({
    type: MESSAGE_TYPES.markManualReviewClosed,
    itemId: "mark-closed-item"
  });

  storedState = await markClosedBrowser.storage.local.get([
    STORAGE_KEYS.manualReviewItems,
    STORAGE_KEYS.historyItems
  ]);
  assert.equal(storedState.manualReviewItems.length, 0);
  assert.equal(storedState.historyItems.length, 1);
  assert.equal(storedState.historyItems[0].status, "closed");
});

test("controller promotes a Closed history entry to Archived when the user confirms an archive", async () => {
  const browser = (globalThis.browser = createBrowserMock({
    tabs: [],
    initialStorage: {
      [STORAGE_KEYS.settings]: {
        karakeepBaseUrl: "https://karakeep.example.com",
        karakeepApiKey: "secret-key",
        requestTimeoutSeconds: 15,
        historyRetentionHours: 168,
        showFavicons: true,
        maxHistoryItems: 500,
        debugLogging: false
      },
      [STORAGE_KEYS.historyItems]: [
        {
          id: "closed-entry",
          url: "https://example.com/previously-closed",
          title: "Previously Closed",
          favIconUrl: null,
          sourceWindowId: 1,
          actionAt: Date.now() - 1000,
          status: "closed",
          expiresAt: Date.now() + 86_400_000
        }
      ]
    },
    grantedOrigins: ["https://karakeep.example.com/*"]
  }));
  globalThis.fetch = async () => ({
    status: 201,
    async json() {
      return { id: "bookmark-1" };
    }
  });

  await importFresh(controllerModuleUrl);
  await flushMicrotasks();

  const result = await browser.runtime.sendMessage({
    type: MESSAGE_TYPES.archiveClosedHistoryItem,
    itemId: "closed-entry"
  });
  assert.deepEqual(result, { ok: true });

  const historyItems = await waitFor(async () => {
    const { [STORAGE_KEYS.historyItems]: nextHistoryItems } = await browser.storage.local.get(
      STORAGE_KEYS.historyItems
    );
    return nextHistoryItems?.length === 1 && nextHistoryItems[0].status === "archived"
      ? nextHistoryItems
      : null;
  });

  const { [STORAGE_KEYS.processingItems]: processingItems } = await browser.storage.local.get(
    STORAGE_KEYS.processingItems
  );
  assert.equal(processingItems.length, 0);
  assert.equal(historyItems[0].url, "https://example.com/previously-closed");
});

test("controller skips Closed history when monitoring is paused", async () => {
  const browser = (globalThis.browser = createBrowserMock({
    tabs: [
      {
        id: 9,
        windowId: 1,
        active: true,
        url: "https://example.com/secret",
        title: "Secret Tab",
        favIconUrl: null
      }
    ],
    initialStorage: {
      [STORAGE_KEYS.settings]: {
        karakeepBaseUrl: "https://karakeep.example.com",
        karakeepApiKey: "secret-key",
        requestTimeoutSeconds: 15,
        historyRetentionHours: 168,
        showFavicons: true,
        maxHistoryItems: 500,
        debugLogging: false,
        monitoringPaused: true
      }
    },
    grantedOrigins: ["https://karakeep.example.com/*"]
  }));
  globalThis.fetch = async () => ({
    status: 200,
    async json() {
      return { data: [] };
    }
  });

  await importFresh(controllerModuleUrl);
  await waitFor(() => getCachedTabIds().length === 1);

  await browser.tabs.onRemoved.emit(9, { windowId: 1, isWindowClosing: false });
  await flushMicrotasks();

  const { [STORAGE_KEYS.historyItems]: historyItems } = await browser.storage.local.get(
    STORAGE_KEYS.historyItems
  );
  assert.deepEqual(historyItems ?? [], []);
});

test("controller records Closed history for a tab that was closed before the cache rehydrated from session storage", async () => {
  const browser = (globalThis.browser = createBrowserMock({
    tabs: [],
    initialSessionStorage: {
      [`${SESSION_STORAGE_KEYS.tabSnapshotPrefix}42`]: {
        tabId: 42,
        windowId: 1,
        url: "https://example.com/closed-during-suspension",
        title: "Closed During Suspension",
        favIconUrl: "https://example.com/favicon.ico"
      }
    }
  }));
  globalThis.fetch = async () => ({
    status: 200,
    async json() {
      return { data: [] };
    }
  });

  await importFresh(controllerModuleUrl);

  await browser.tabs.onRemoved.emit(42, { windowId: 1, isWindowClosing: false });

  const historyItems = await waitFor(async () => {
    const { [STORAGE_KEYS.historyItems]: nextHistoryItems } = await browser.storage.local.get(
      STORAGE_KEYS.historyItems
    );
    return nextHistoryItems?.length === 1 ? nextHistoryItems : null;
  });

  assert.equal(historyItems.length, 1);
  assert.equal(historyItems[0].status, "closed");
  assert.equal(historyItems[0].url, "https://example.com/closed-during-suspension");
});

const LIST_SETTINGS = {
  karakeepBaseUrl: "https://karakeep.example.com",
  karakeepApiKey: "secret-key",
  requestTimeoutSeconds: 15,
  historyRetentionHours: 168,
  showFavicons: true,
  maxHistoryItems: 500,
  debugLogging: false
};

test("getLists message returns only manual lists", async () => {
  const browser = (globalThis.browser = createBrowserMock({
    tabs: [],
    initialStorage: { [STORAGE_KEYS.settings]: LIST_SETTINGS },
    grantedOrigins: ["https://karakeep.example.com/*"]
  }));
  globalThis.fetch = async (url) => {
    if (url.endsWith("/api/v1/lists")) {
      return {
        status: 200,
        async json() {
          return {
            lists: [
              { id: "l1", name: "Reading", type: "manual" },
              { id: "l2", name: "Smart", type: "smart" }
            ]
          };
        }
      };
    }
    return { status: 404, async json() { return {}; } };
  };

  await importFresh(controllerModuleUrl);
  await flushMicrotasks();

  const response = await browser.runtime.sendMessage({ type: MESSAGE_TYPES.getLists });
  assert.equal(response.ok, true);
  assert.deepEqual(
    response.lists.map((list) => list.id),
    ["l1"]
  );
});

test("archiveCurrentTabToList archives the sender tab, files it into the list, and closes it", async () => {
  const tab = {
    id: 11,
    windowId: 1,
    active: true,
    url: "https://example.com/save",
    title: "Save Me",
    favIconUrl: null
  };
  const browser = (globalThis.browser = createBrowserMock({
    tabs: [tab],
    initialStorage: { [STORAGE_KEYS.settings]: LIST_SETTINGS },
    grantedOrigins: ["https://karakeep.example.com/*"]
  }));
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options.method });
    if (url.endsWith("/api/v1/bookmarks") && options.method === "POST") {
      return { status: 201, async json() { return { id: "bm-1" }; } };
    }
    if (url.includes("/api/v1/lists/") && options.method === "PUT") {
      return { status: 204, async json() { throw new Error("204 has no body"); } };
    }
    return { status: 500, async json() { return {}; } };
  };

  await importFresh(controllerModuleUrl);
  await waitFor(() => getCachedTabIds().length === 1);

  const [result] = await browser.runtime.onMessage.emit(
    { type: MESSAGE_TYPES.archiveCurrentTabToList, listId: "list-1", listName: "Reading" },
    { id: "content-script", tab }
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(browser.__mock.removedTabIds, [11]);

  const state = await browser.storage.local.get([
    STORAGE_KEYS.historyItems,
    STORAGE_KEYS.manualReviewItems
  ]);
  assert.equal(state.historyItems.length, 1);
  assert.equal(state.historyItems[0].status, "archived");
  assert.equal(state.historyItems[0].bookmarkId, "bm-1");
  assert.deepEqual(state.manualReviewItems, []);
  assert.ok(
    calls.some(
      (call) =>
        call.method === "PUT" &&
        call.url.endsWith("/api/v1/lists/list-1/bookmarks/bm-1")
    )
  );
});

test("archiveCurrentTabToList records a list-add manual review entry when filing fails", async () => {
  const tab = {
    id: 12,
    windowId: 1,
    active: true,
    url: "https://example.com/save2",
    title: "Save Me 2",
    favIconUrl: null
  };
  const browser = (globalThis.browser = createBrowserMock({
    tabs: [tab],
    initialStorage: { [STORAGE_KEYS.settings]: LIST_SETTINGS },
    grantedOrigins: ["https://karakeep.example.com/*"]
  }));
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/api/v1/bookmarks") && options.method === "POST") {
      return { status: 201, async json() { return { id: "bm-2" }; } };
    }
    if (url.includes("/api/v1/lists/") && options.method === "PUT") {
      return { status: 500, async json() { return {}; } };
    }
    return { status: 404, async json() { return {}; } };
  };

  await importFresh(controllerModuleUrl);
  await waitFor(() => getCachedTabIds().length === 1);

  await browser.runtime.onMessage.emit(
    { type: MESSAGE_TYPES.archiveCurrentTabToList, listId: "list-9", listName: "Later" },
    { id: "content-script", tab }
  );

  const state = await browser.storage.local.get([
    STORAGE_KEYS.historyItems,
    STORAGE_KEYS.manualReviewItems
  ]);
  // The archive itself succeeded...
  assert.equal(state.historyItems.length, 1);
  assert.equal(state.historyItems[0].status, "archived");
  assert.equal(state.historyItems[0].bookmarkId, "bm-2");
  // ...but the list add failed and is queued for retry.
  assert.equal(state.manualReviewItems.length, 1);
  assert.equal(state.manualReviewItems[0].failedAction, MANUAL_REVIEW_ACTIONS.listAdd);
  assert.equal(state.manualReviewItems[0].bookmarkId, "bm-2");
  assert.equal(state.manualReviewItems[0].listId, "list-9");
});

test("retryManualReview re-files a failed list-add and clears the entry", async () => {
  const browser = (globalThis.browser = createBrowserMock({
    tabs: [],
    initialStorage: {
      [STORAGE_KEYS.settings]: LIST_SETTINGS,
      [STORAGE_KEYS.manualReviewItems]: [
        {
          id: "la-1",
          failedAction: MANUAL_REVIEW_ACTIONS.listAdd,
          bookmarkId: "bm-3",
          listId: "list-3",
          listName: "Reading",
          url: "https://example.com/x",
          title: "X",
          favIconUrl: null,
          sourceWindowId: 1,
          requestedAt: Date.now() - 1000,
          failedAt: Date.now(),
          state: "failed",
          attemptCount: 1,
          lastError: "Could not reach Karakeep"
        }
      ]
    },
    grantedOrigins: ["https://karakeep.example.com/*"]
  }));
  let putCalled = false;
  globalThis.fetch = async (url, options) => {
    if (url.includes("/api/v1/lists/") && options.method === "PUT") {
      putCalled = true;
      return { status: 204, async json() { throw new Error("204 has no body"); } };
    }
    return { status: 404, async json() { return {}; } };
  };

  await importFresh(controllerModuleUrl);
  await flushMicrotasks();

  const result = await browser.runtime.sendMessage({
    type: MESSAGE_TYPES.retryManualReview,
    itemId: "la-1"
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(putCalled, true);

  const { [STORAGE_KEYS.manualReviewItems]: items } = await browser.storage.local.get(
    STORAGE_KEYS.manualReviewItems
  );
  assert.deepEqual(items, []);
});
