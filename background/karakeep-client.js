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
        url: item.url
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
