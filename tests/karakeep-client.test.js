import test from "node:test";
import assert from "node:assert/strict";

import { createBrowserMock } from "./helpers/browser-mock.js";
import { importFresh } from "./helpers/module.js";

const clientModuleUrl = new URL("../background/karakeep-client.js", import.meta.url);

test("archiveBookmark sends the smallest link payload and maps 201/200 responses", async () => {
  const fetchCalls = [];

  const browser = (globalThis.browser = createBrowserMock({
    initialStorage: {
      settings: {
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
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      status: fetchCalls.length === 1 ? 201 : 200,
      async json() {
        return { id: `bookmark-${fetchCalls.length}` };
      }
    };
  };

  const { archiveBookmark } = await importFresh(clientModuleUrl);
  const archivedResult = await archiveBookmark({ url: "https://example.com/article" });
  const skippedResult = await archiveBookmark({ url: "https://example.com/article" });

  assert.equal(archivedResult.status, "archived");
  assert.equal(skippedResult.status, "skipped");
  assert.equal(fetchCalls[0].url, "https://karakeep.example.com/api/v1/bookmarks");
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), {
    type: "link",
    url: "https://example.com/article"
  });
  assert.equal(fetchCalls[0].options.headers.Authorization, "Bearer secret-key");
});

test("testConnection uses existing host permission without requesting a new one", async () => {
  const browser = (globalThis.browser = createBrowserMock({
    grantedOrigins: ["https://karakeep.example.com/*"]
  }));
  const fetchCalls = [];
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      status: 200,
      async json() {
        return { data: [] };
      }
    };
  };

  const { testConnection } = await importFresh(clientModuleUrl);
  const result = await testConnection({
    karakeepBaseUrl: "https://karakeep.example.com/",
    karakeepApiKey: "secret-key",
    requestTimeoutSeconds: 15,
    historyRetentionHours: 168,
    showFavicons: true,
    maxHistoryItems: 500,
    debugLogging: false
  });

  assert.deepEqual(result, { ok: true, message: "Connection succeeded." });
  assert.equal(browser.__mock.permissionsRequestCalls.length, 0);
  assert.equal(fetchCalls[0].options.headers.Authorization, "Bearer secret-key");
});

test("archiveBookmark surfaces permission and API key failures with user-facing messages", async () => {
  globalThis.browser = createBrowserMock({
    initialStorage: {
      settings: {
        karakeepBaseUrl: "https://karakeep.example.com",
        karakeepApiKey: "secret-key",
        requestTimeoutSeconds: 15,
        historyRetentionHours: 168,
        showFavicons: true,
        maxHistoryItems: 500,
        debugLogging: false
      }
    }
  });
  globalThis.fetch = async () => {
    throw new Error("fetch should not run");
  };

  const { archiveBookmark } = await importFresh(clientModuleUrl);
  await assert.rejects(
    () => archiveBookmark({ url: "https://example.com" }),
    /Permission to access the Karakeep host was not granted/
  );

  globalThis.browser = createBrowserMock({
    initialStorage: {
      settings: {
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
  });
  globalThis.fetch = async () => ({
    status: 401,
    async json() {
      return { message: "Unauthorized" };
    }
  });

  const refreshedClient = await importFresh(clientModuleUrl);
  await assert.rejects(
    () => refreshedClient.archiveBookmark({ url: "https://example.com" }),
    /API key was rejected/
  );
});

test("archiveBookmark maps abort errors to timeout messaging", async () => {
  globalThis.browser = createBrowserMock({
    initialStorage: {
      settings: {
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
  });
  globalThis.fetch = async () => {
    throw new DOMException("Aborted", "AbortError");
  };

  const { archiveBookmark } = await importFresh(clientModuleUrl);
  await assert.rejects(
    () => archiveBookmark({ url: "https://example.com" }),
    /Timed out contacting Karakeep/
  );
});
