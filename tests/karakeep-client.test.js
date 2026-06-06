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

const LIST_CLIENT_SETTINGS = {
  karakeepBaseUrl: "https://karakeep.example.com",
  karakeepApiKey: "secret-key",
  requestTimeoutSeconds: 15,
  historyRetentionHours: 168,
  showFavicons: true,
  maxHistoryItems: 500,
  debugLogging: false
};

test("getLists requests every list and returns the raw array", async () => {
  const browser = (globalThis.browser = createBrowserMock({
    initialStorage: { settings: LIST_CLIENT_SETTINGS },
    grantedOrigins: ["https://karakeep.example.com/*"]
  }));
  const fetchCalls = [];
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      status: 200,
      async json() {
        return {
          lists: [
            { id: "l1", name: "Reading", type: "manual" },
            { id: "l2", name: "Auto", type: "smart" }
          ]
        };
      }
    };
  };

  const { getLists } = await importFresh(clientModuleUrl);
  const lists = await getLists();

  assert.equal(fetchCalls[0].url, "https://karakeep.example.com/api/v1/lists");
  assert.equal(fetchCalls[0].options.method, "GET");
  assert.equal(fetchCalls[0].options.headers.Authorization, "Bearer secret-key");
  assert.deepEqual(
    lists.map((list) => list.id),
    ["l1", "l2"]
  );
});

test("getLists rejects a payload that is missing the lists array", async () => {
  globalThis.browser = createBrowserMock({
    initialStorage: { settings: LIST_CLIENT_SETTINGS },
    grantedOrigins: ["https://karakeep.example.com/*"]
  });
  globalThis.fetch = async () => ({
    status: 200,
    async json() {
      return { data: [] };
    }
  });

  const { getLists } = await importFresh(clientModuleUrl);
  await assert.rejects(() => getLists(), /Karakeep returned an invalid response/);
});

test("getBookmarkLists fetches the bookmark's lists", async () => {
  const browser = (globalThis.browser = createBrowserMock({
    initialStorage: { settings: LIST_CLIENT_SETTINGS },
    grantedOrigins: ["https://karakeep.example.com/*"]
  }));
  const fetchCalls = [];
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      status: 200,
      async json() {
        return { lists: [{ id: "l1", name: "Reading", type: "manual" }] };
      }
    };
  };

  const { getBookmarkLists } = await importFresh(clientModuleUrl);
  const lists = await getBookmarkLists("bm-1");

  assert.equal(
    fetchCalls[0].url,
    "https://karakeep.example.com/api/v1/bookmarks/bm-1/lists"
  );
  assert.equal(lists.length, 1);
  assert.equal(lists[0].id, "l1");
});

test("addBookmarkToList PUTs to the membership endpoint, encodes ids, and accepts 204", async () => {
  const browser = (globalThis.browser = createBrowserMock({
    initialStorage: { settings: LIST_CLIENT_SETTINGS },
    grantedOrigins: ["https://karakeep.example.com/*"]
  }));
  const fetchCalls = [];
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      status: 204,
      async json() {
        throw new Error("204 has no body");
      }
    };
  };

  const { addBookmarkToList } = await importFresh(clientModuleUrl);
  const result = await addBookmarkToList("bm 1", "list/2");

  assert.deepEqual(result, { ok: true });
  assert.equal(fetchCalls[0].options.method, "PUT");
  assert.equal(
    fetchCalls[0].url,
    "https://karakeep.example.com/api/v1/lists/list%2F2/bookmarks/bm%201"
  );
});

test("removeBookmarkFromList DELETEs the membership endpoint", async () => {
  const browser = (globalThis.browser = createBrowserMock({
    initialStorage: { settings: LIST_CLIENT_SETTINGS },
    grantedOrigins: ["https://karakeep.example.com/*"]
  }));
  const fetchCalls = [];
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options });
    return {
      status: 204,
      async json() {
        throw new Error("204 has no body");
      }
    };
  };

  const { removeBookmarkFromList } = await importFresh(clientModuleUrl);
  await removeBookmarkFromList("bm-1", "l2");

  assert.equal(fetchCalls[0].options.method, "DELETE");
  assert.equal(
    fetchCalls[0].url,
    "https://karakeep.example.com/api/v1/lists/l2/bookmarks/bm-1"
  );
});

test("addBookmarkToList maps a 401 to the API key error", async () => {
  globalThis.browser = createBrowserMock({
    initialStorage: { settings: LIST_CLIENT_SETTINGS },
    grantedOrigins: ["https://karakeep.example.com/*"]
  });
  globalThis.fetch = async () => ({
    status: 401,
    async json() {
      return {};
    }
  });

  const { addBookmarkToList } = await importFresh(clientModuleUrl);
  await assert.rejects(
    () => addBookmarkToList("bm-1", "l1"),
    /API key was rejected/
  );
});
