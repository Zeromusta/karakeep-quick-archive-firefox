// Large blobs live outside storage.local so opening the popup doesn't read or
// rewrite megabytes of page content. Commit the transaction before closing a tab.
const DB_NAME = "karakeep-page-captures";

async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("captures");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(mode, operation) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("captures", mode);
      const request = operation(tx.objectStore("captures"));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error || request.error || new Error("Could not store page capture"));
    });
  } finally { db.close(); }
}

// Store bytes, not Firefox's file-backed Blob handles: those can become
// unreadable after the writing connection closes. Convert before opening a tx.
export async function putCapture(id, capture) {
  const record = { ...capture };
  for (const key of ["html", "screenshot", "banner"]) {
    if (record[key] instanceof Blob) record[key] = { bytes: await record[key].arrayBuffer(), type: record[key].type };
  }
  return transaction("readwrite", (store) => store.put(record, id));
}

export async function getCapture(id) {
  const record = await transaction("readonly", (store) => store.get(id));
  if (record) for (const key of ["html", "screenshot", "banner"]) {
    if (record[key]?.bytes instanceof ArrayBuffer) record[key] = new Blob([record[key].bytes], { type: record[key].type });
  }
  return record;
}
export const deleteCapture = (id) => transaction("readwrite", (store) => store.delete(id));

export async function pruneCaptureFiles() {
  const { processingItems = [], manualReviewItems = [] } = await browser.storage.local.get(["processingItems", "manualReviewItems"]);
  const live = new Set([...processingItems, ...manualReviewItems].map((item) => item.captureId).filter(Boolean));
  const ids = await transaction("readonly", (store) => store.getAllKeys());
  for (const id of ids) {
    if (!live.has(id)) {
      const capture = await getCapture(id);
      // Grace period covers the handoff between storing a blob and queuing it.
      if (capture?.capturedAt < Date.now() - 60 * 60 * 1000) await deleteCapture(id);
    }
  }
}
