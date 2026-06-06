import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SETTINGS,
  HISTORY_STATUS,
  MANUAL_REVIEW_ACTIONS,
  STORAGE_KEYS
} from "../shared/constants.js";
import { createBrowserMock } from "./helpers/browser-mock.js";
import { importFresh } from "./helpers/module.js";

const historyStoreModuleUrl = new URL("../background/history-store.js", import.meta.url);

test("history-store moves processing items into history on successful completion", async () => {
  const browser = (globalThis.browser = createBrowserMock());

  const historyStore = await importFresh(historyStoreModuleUrl);
  await historyStore.ensureStorageDefaults();

  const processingItem = await historyStore.createProcessingItem({
    tabId: 1,
    windowId: 2,
    url: "https://example.com/article",
    title: "Example Article",
    favIconUrl: "https://example.com/favicon.ico"
  });

  await historyStore.completeProcessingItem(processingItem.id, HISTORY_STATUS.archived);

  const storedState = await browser.storage.local.get([
    STORAGE_KEYS.processingItems,
    STORAGE_KEYS.historyItems
  ]);

  assert.deepEqual(storedState.processingItems, []);
  assert.equal(storedState.historyItems.length, 1);
  assert.equal(storedState.historyItems[0].status, HISTORY_STATUS.archived);
});

test("history-store supports failed archive retry and manual close resolution", async () => {
  const browser = (globalThis.browser = createBrowserMock({
    initialStorage: {
      [STORAGE_KEYS.settings]: DEFAULT_SETTINGS
    }
  }));

  const historyStore = await importFresh(historyStoreModuleUrl);
  await historyStore.ensureStorageDefaults();

  const processingItem = await historyStore.createProcessingItem({
    tabId: 8,
    windowId: 3,
    url: "https://example.com/failure",
    title: "Failure Case",
    favIconUrl: null
  });

  await historyStore.failProcessingItem(processingItem.id, "Could not reach Karakeep");

  let storedState = await browser.storage.local.get([
    STORAGE_KEYS.manualReviewItems,
    STORAGE_KEYS.processingItems
  ]);
  assert.equal(storedState.processingItems.length, 0);
  assert.equal(storedState.manualReviewItems.length, 1);
  assert.equal(storedState.manualReviewItems[0].lastError, "Could not reach Karakeep");

  const retriedItem = await historyStore.retryManualReviewItem(processingItem.id);
  assert.equal(retriedItem.attemptCount, 2);

  storedState = await browser.storage.local.get([
    STORAGE_KEYS.manualReviewItems,
    STORAGE_KEYS.processingItems
  ]);
  assert.equal(storedState.manualReviewItems.length, 0);
  assert.equal(storedState.processingItems.length, 1);

  await historyStore.failProcessingItem(processingItem.id, "API key was rejected");
  await historyStore.markManualReviewItemClosed(processingItem.id);

  storedState = await browser.storage.local.get([
    STORAGE_KEYS.manualReviewItems,
    STORAGE_KEYS.historyItems
  ]);
  assert.equal(storedState.manualReviewItems.length, 0);
  assert.equal(storedState.historyItems.length, 1);
  assert.equal(storedState.historyItems[0].status, HISTORY_STATUS.closed);
});

test("pruneHistory removes expired entries using the configured retention period", async () => {
  const now = Date.now();

  const browser = (globalThis.browser = createBrowserMock({
    initialStorage: {
      [STORAGE_KEYS.settings]: {
        ...DEFAULT_SETTINGS,
        historyRetentionHours: 24
      },
      [STORAGE_KEYS.historyItems]: [
        {
          id: "expired",
          url: "https://example.com/old",
          title: "Old Entry",
          favIconUrl: null,
          sourceWindowId: 1,
          actionAt: now - 3 * 24 * 60 * 60 * 1000,
          status: HISTORY_STATUS.closed,
          expiresAt: now - 2 * 24 * 60 * 60 * 1000
        },
        {
          id: "fresh",
          url: "https://example.com/new",
          title: "Fresh Entry",
          favIconUrl: null,
          sourceWindowId: 1,
          actionAt: now,
          status: HISTORY_STATUS.archived,
          expiresAt: now + 24 * 60 * 60 * 1000
        }
      ]
    }
  }));

  const historyStore = await importFresh(historyStoreModuleUrl);
  await historyStore.pruneHistory();

  const { [STORAGE_KEYS.historyItems]: historyItems } = await browser.storage.local.get(
    STORAGE_KEYS.historyItems
  );

  assert.equal(historyItems.length, 1);
  assert.equal(historyItems[0].id, "fresh");
});

test("createProcessingItem threads list/favourite extras onto the item", async () => {
  globalThis.browser = createBrowserMock();
  const historyStore = await importFresh(historyStoreModuleUrl);
  await historyStore.ensureStorageDefaults();

  const listed = await historyStore.createProcessingItem(
    { url: "https://example.com/a", title: "A", favIconUrl: null, windowId: 1 },
    { listId: "list-1", listName: "Reading" }
  );
  assert.equal(listed.listId, "list-1");
  assert.equal(listed.listName, "Reading");
  assert.equal(listed.favourite, undefined);

  const favourited = await historyStore.createProcessingItem(
    { url: "https://example.com/b", title: "B", favIconUrl: null, windowId: 1 },
    { favourite: true }
  );
  assert.equal(favourited.favourite, true);
  assert.equal(favourited.listId, undefined);
});

test("recordListAddFailure queues a retryable list-add manual review entry", async () => {
  const browser = (globalThis.browser = createBrowserMock({
    initialStorage: { [STORAGE_KEYS.settings]: DEFAULT_SETTINGS }
  }));
  const historyStore = await importFresh(historyStoreModuleUrl);
  await historyStore.ensureStorageDefaults();

  await historyStore.recordListAddFailure({
    item: {
      url: "https://example.com/a",
      title: "Article A",
      favIconUrl: null,
      sourceWindowId: 1
    },
    bookmarkId: "bm-1",
    listId: "list-1",
    listName: "Reading",
    lastError: "Could not reach Karakeep"
  });

  const { [STORAGE_KEYS.manualReviewItems]: items } = await browser.storage.local.get(
    STORAGE_KEYS.manualReviewItems
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].failedAction, MANUAL_REVIEW_ACTIONS.listAdd);
  assert.equal(items[0].bookmarkId, "bm-1");
  assert.equal(items[0].listId, "list-1");
  assert.equal(items[0].listName, "Reading");
  assert.equal(items[0].attemptCount, 1);
  assert.equal(items[0].lastError, "Could not reach Karakeep");
});

test("recordManualReviewRetryFailure bumps the attempt count and last error", async () => {
  const browser = (globalThis.browser = createBrowserMock({
    initialStorage: {
      [STORAGE_KEYS.settings]: DEFAULT_SETTINGS,
      [STORAGE_KEYS.manualReviewItems]: [
        {
          id: "m1",
          failedAction: MANUAL_REVIEW_ACTIONS.listAdd,
          attemptCount: 1,
          failedAt: Date.now() - 1000,
          lastError: "first"
        }
      ]
    }
  }));
  const historyStore = await importFresh(historyStoreModuleUrl);

  await historyStore.recordManualReviewRetryFailure("m1", "second");

  const { [STORAGE_KEYS.manualReviewItems]: items } = await browser.storage.local.get(
    STORAGE_KEYS.manualReviewItems
  );
  assert.equal(items[0].attemptCount, 2);
  assert.equal(items[0].lastError, "second");
});
