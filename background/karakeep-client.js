import { getSettings } from "./history-store.js";
import {
  logDebug,
  normalizeSettingsInput,
  toOriginPattern
} from "../shared/utils.js";

export async function archiveBookmark(item) {
  const settings = await getSettings();
  validateReadySettings(settings);
  await assertHostPermission(settings.karakeepBaseUrl);

  logDebug(settings.debugLogging, "Archiving bookmark", item.url);

  const response = await fetchWithTimeout(
    `${settings.karakeepBaseUrl}/api/v1/bookmarks`,
    {
      method: "POST",
      headers: buildHeaders(settings.karakeepApiKey),
      body: JSON.stringify({
        type: "link",
        url: item.url,
        ...(item.title ? { title: item.title } : {})
      })
    },
    settings.requestTimeoutSeconds
  );

  if (response.status === 200 || response.status === 201) {
    const payload = await ensureJsonObject(response);
    return {
      status: response.status === 201 ? "archived" : "skipped",
      bookmarkId: typeof payload?.id === "string" ? payload.id : null
    };
  }

  throw mapKarakeepError(response.status);
}

export async function uploadPageArchive(url, html) {
  const body = new FormData();
  body.append("url", url);
  body.append("file", html, "page.html");
  const { response, payload } = await captureRequest(
    "/api/v1/bookmarks/singlefile?ifexists=overwrite-recrawl", "POST", body
  );
  if (typeof payload?.id !== "string") throw new Error("Archive upload returned no bookmark ID");
  return { status: response.status === 201 ? "archived" : "skipped", bookmarkId: payload.id };
}

export async function uploadCaptureImage(blob, name) {
  const body = new FormData();
  body.append("file", blob, name);
  const { payload } = await captureRequest("/api/v1/assets", "POST", body);
  if (typeof payload?.assetId !== "string") throw new Error("Image upload returned no asset ID");
  return payload.assetId;
}

export async function attachCaptureImage(bookmarkId, assetId, assetType) {
  const path = `/api/v1/bookmarks/${encodeURIComponent(bookmarkId)}`;
  const { payload } = await captureRequest(path, "GET");
  const matching = (payload.assets || []).filter((asset) => asset.assetType === assetType);
  if (matching.some((asset) => asset.id === assetId)) return; // Retried after an uncertain response.
  const previous = matching.at(-1);
  if (previous) {
    await captureRequest(`${path}/assets/${encodeURIComponent(previous.id)}`, "PUT", { assetId });
  } else {
    await captureRequest(`${path}/assets`, "POST", { id: assetId, assetType });
  }
}

export async function waitForImageProcessing(bookmarkId, { timeoutMs = 60_000, pollMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const { payload } = await captureRequest(`/api/v1/bookmarks/${encodeURIComponent(bookmarkId)}`, "GET");
    if (payload.content?.crawlStatus !== "pending") return payload.content?.crawlStatus;
    // The crawler writes its own image assets. Finish ours after that write so
    // an error-page image cannot replace the browser capture. Retain the local
    // payload for Retry if the worker is unavailable or its queue is backed up.
    if (Date.now() >= deadline) throw new Error("Karakeep is still processing the page; retry to finish uploading images");
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export async function addCaptureReviewTag(bookmarkId, tag) {
  await captureRequest(`/api/v1/bookmarks/${encodeURIComponent(bookmarkId)}/tags`, "POST", { tags: [{ tagName: tag }] });
}

async function captureRequest(path, method, body) {
  const settings = await getSettings();
  validateReadySettings(settings);
  await assertHostPermission(settings.karakeepBaseUrl);
  const multipart = body instanceof FormData;
  const headers = buildHeaders(settings.karakeepApiKey);
  if (multipart) delete headers["Content-Type"];
  const response = await fetchWithTimeout(`${settings.karakeepBaseUrl}${path}`, {
    method, headers, body: multipart ? body : JSON.stringify(body)
  }, Math.max(settings.requestTimeoutSeconds, 90));
  if (![200, 201, 204].includes(response.status)) {
    throw new Error(`Capture request failed (HTTP ${response.status})`);
  }
  const payload = response.status === 204 ? null : await ensureJsonObject(response);
  return { response, payload };
}

export async function setBookmarkFavourite(bookmarkId, favourited) {
  const settings = await getSettings();
  validateReadySettings(settings);
  await assertHostPermission(settings.karakeepBaseUrl);

  logDebug(
    settings.debugLogging,
    "Setting bookmark favourite",
    bookmarkId,
    favourited
  );

  const response = await fetchWithTimeout(
    `${settings.karakeepBaseUrl}/api/v1/bookmarks/${encodeURIComponent(bookmarkId)}`,
    {
      method: "PATCH",
      headers: buildHeaders(settings.karakeepApiKey),
      body: JSON.stringify({ favourited: Boolean(favourited) })
    },
    settings.requestTimeoutSeconds
  );

  if (response.status === 200) {
    await ensureJsonObject(response);
    return { ok: true };
  }

  throw mapKarakeepError(response.status);
}

export async function testConnection(rawSettings) {
  const settings = normalizeSettingsInput(rawSettings, {
    requireCredentials: true,
    strictNumbers: true
  });

  await assertHostPermission(settings.karakeepBaseUrl);

  const response = await fetchWithTimeout(
    `${settings.karakeepBaseUrl}/api/v1/bookmarks?limit=1`,
    {
      method: "GET",
      headers: buildHeaders(settings.karakeepApiKey)
    },
    settings.requestTimeoutSeconds
  );

  if (response.status === 200) {
    await ensureJsonPayload(response);
    return {
      ok: true,
      message: "Connection succeeded."
    };
  }

  throw mapKarakeepError(response.status);
}

// All lists for the authenticated user (manual + smart). Not paginated.
// Callers filter to type === "manual"; smart lists can't accept manual adds.
export async function getLists() {
  const settings = await getSettings();
  validateReadySettings(settings);
  await assertHostPermission(settings.karakeepBaseUrl);

  logDebug(settings.debugLogging, "Fetching lists");

  const response = await fetchWithTimeout(
    `${settings.karakeepBaseUrl}/api/v1/lists`,
    {
      method: "GET",
      headers: buildHeaders(settings.karakeepApiKey)
    },
    settings.requestTimeoutSeconds
  );

  if (response.status === 200) {
    return await ensureJsonList(response);
  }

  throw mapKarakeepError(response.status);
}

// The lists a given bookmark already belongs to — drives the membership
// pre-check in the popup list picker.
export async function getBookmarkLists(bookmarkId) {
  const settings = await getSettings();
  validateReadySettings(settings);
  await assertHostPermission(settings.karakeepBaseUrl);

  logDebug(settings.debugLogging, "Fetching bookmark lists", bookmarkId);

  const response = await fetchWithTimeout(
    `${settings.karakeepBaseUrl}/api/v1/bookmarks/${encodeURIComponent(bookmarkId)}/lists`,
    {
      method: "GET",
      headers: buildHeaders(settings.karakeepApiKey)
    },
    settings.requestTimeoutSeconds
  );

  if (response.status === 200) {
    return await ensureJsonList(response);
  }

  throw mapKarakeepError(response.status);
}

export async function addBookmarkToList(bookmarkId, listId) {
  return mutateListMembership(bookmarkId, listId, "PUT");
}

export async function removeBookmarkFromList(bookmarkId, listId) {
  return mutateListMembership(bookmarkId, listId, "DELETE");
}

async function mutateListMembership(bookmarkId, listId, method) {
  const settings = await getSettings();
  validateReadySettings(settings);
  await assertHostPermission(settings.karakeepBaseUrl);

  logDebug(
    settings.debugLogging,
    "Mutating list membership",
    method,
    listId,
    bookmarkId
  );

  const response = await fetchWithTimeout(
    `${settings.karakeepBaseUrl}/api/v1/lists/${encodeURIComponent(listId)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
    {
      method,
      headers: buildHeaders(settings.karakeepApiKey)
    },
    settings.requestTimeoutSeconds
  );

  // Karakeep replies 204 No Content; accept 200/201 defensively.
  if (
    response.status === 200 ||
    response.status === 201 ||
    response.status === 204
  ) {
    return { ok: true };
  }

  throw mapKarakeepError(response.status);
}

function validateReadySettings(settings) {
  normalizeSettingsInput(settings, {
    requireCredentials: true,
    strictNumbers: true
  });
}

async function assertHostPermission(baseUrl) {
  const originPattern = toOriginPattern(baseUrl);
  const hasPermission = await browser.permissions.contains({
    origins: [originPattern]
  });

  if (hasPermission) {
    return;
  }

  throw new Error("Permission to access the Karakeep host was not granted");
}

function buildHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
}

async function fetchWithTimeout(url, options, timeoutSeconds) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeoutSeconds * 1000);

  try {
    return await fetch(url, {
      ...options,
      signal: abortController.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Timed out contacting Karakeep");
    }

    if (error instanceof Error && error.message) {
      if (
        error.message === "Permission to access the Karakeep host was not granted" ||
        error.message.startsWith("Karakeep ")
      ) {
        throw error;
      }
    }

    throw new Error("Could not reach Karakeep");
  } finally {
    clearTimeout(timeoutId);
  }
}

async function ensureJsonObject(response) {
  const payload = await ensureJsonPayload(response);
  if (!payload || typeof payload !== "object") {
    throw new Error("Karakeep returned an invalid response");
  }
  return payload;
}

async function ensureJsonPayload(response) {
  try {
    return await response.json();
  } catch {
    throw new Error("Karakeep returned an invalid response");
  }
}

async function ensureJsonList(response) {
  const payload = await ensureJsonObject(response);
  if (!Array.isArray(payload.lists)) {
    throw new Error("Karakeep returned an invalid response");
  }
  return payload.lists;
}

function mapKarakeepError(statusCode) {
  if (statusCode === 401 || statusCode === 403) {
    return new Error("API key was rejected");
  }

  if (statusCode >= 400 && statusCode < 600) {
    return new Error("Karakeep returned an error");
  }

  return new Error("Karakeep returned an invalid response");
}
