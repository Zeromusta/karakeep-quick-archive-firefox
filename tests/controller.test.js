import test from "node:test";
import assert from "node:assert/strict";

import {
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
