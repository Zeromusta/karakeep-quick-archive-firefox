import { SESSION_STORAGE_KEYS } from "../shared/constants.js";
import { isEligibleUrl } from "../shared/utils.js";

const snapshotCache = new Map();
let sessionWriteQueue = Promise.resolve();

const snapshotStorageKey = (tabId) =>
  `${SESSION_STORAGE_KEYS.tabSnapshotPrefix}${tabId}`;

const isSnapshotKey = (key) =>
  key.startsWith(SESSION_STORAGE_KEYS.tabSnapshotPrefix);

export async function initializeTabSnapshotCache() {
  const [tabs, existingSession] = await Promise.all([
    browser.tabs.query({}),
    browser.storage.session.get(null)
  ]);

  snapshotCache.clear();

  for (const [key, snapshot] of Object.entries(existingSession ?? {})) {
    if (!isSnapshotKey(key) || !snapshot || !Number.isInteger(snapshot.tabId)) {
      continue;
    }
    snapshotCache.set(snapshot.tabId, snapshot);
  }

  const writes = {};
  for (const tab of tabs) {
    const snapshot = buildSnapshotFromTab(tab);
    if (!snapshot) {
      continue;
    }
    snapshotCache.set(snapshot.tabId, snapshot);
    writes[snapshotStorageKey(snapshot.tabId)] = snapshot;
  }

  if (Object.keys(writes).length > 0) {
    enqueueSessionWrite(() => browser.storage.session.set(writes));
  }
}

export function rememberTab(tab) {
  if (!Number.isInteger(tab?.id)) {
    return null;
  }

  const snapshot = buildSnapshotFromTab(tab);

  if (!snapshot) {
    if (snapshotCache.has(tab.id)) {
      forgetTab(tab.id);
    }
    return null;
  }

  const existing = snapshotCache.get(tab.id);
  if (existing && areSnapshotsEqual(existing, snapshot)) {
    return existing;
  }

  snapshotCache.set(tab.id, snapshot);
  enqueueSessionWrite(() =>
    browser.storage.session.set({
      [snapshotStorageKey(tab.id)]: snapshot
    })
  );
  return snapshot;
}

export function getSnapshot(tabId) {
  return snapshotCache.get(tabId) ?? null;
}

export function forgetTab(tabId) {
  if (!snapshotCache.delete(tabId)) {
    return;
  }
  enqueueSessionWrite(() =>
    browser.storage.session.remove(snapshotStorageKey(tabId))
  );
}

export function getCachedTabIds() {
  return [...snapshotCache.keys()];
}

export function flushSessionWrites() {
  return sessionWriteQueue;
}

function enqueueSessionWrite(operation) {
  sessionWriteQueue = sessionWriteQueue.then(operation, operation).catch(() => {});
}

function buildSnapshotFromTab(tab) {
  if (
    !Number.isInteger(tab?.id) ||
    !Number.isInteger(tab?.windowId) ||
    !isEligibleUrl(tab.url ?? "")
  ) {
    return null;
  }

  return {
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title || tab.url,
    favIconUrl: tab.favIconUrl ?? null
  };
}

function areSnapshotsEqual(left, right) {
  return (
    left.tabId === right.tabId &&
    left.windowId === right.windowId &&
    left.url === right.url &&
    left.title === right.title &&
    left.favIconUrl === right.favIconUrl
  );
}
