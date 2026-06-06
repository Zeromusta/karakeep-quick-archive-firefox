import test from "node:test";
import assert from "node:assert/strict";

import { createBrowserMock } from "./helpers/browser-mock.js";
import { importFresh } from "./helpers/module.js";

const listServiceModuleUrl = new URL(
  "../background/list-service.js",
  import.meta.url
);

const SETTINGS = {
  karakeepBaseUrl: "https://karakeep.example.com",
  karakeepApiKey: "secret-key",
  requestTimeoutSeconds: 15,
  historyRetentionHours: 168,
  showFavicons: true,
  maxHistoryItems: 500,
  debugLogging: false
};

function mockBrowser() {
  return (globalThis.browser = createBrowserMock({
    initialStorage: { settings: SETTINGS },
    grantedOrigins: ["https://karakeep.example.com/*"]
  }));
}

test("fetchListsWithMembership keeps only manual lists and reports membership", async () => {
  mockBrowser();
  globalThis.fetch = async (url) => {
    if (url.endsWith("/api/v1/lists")) {
      return {
        status: 200,
        async json() {
          return {
            lists: [
              { id: "l1", name: "Reading", type: "manual" },
              { id: "l2", name: "Smart", type: "smart" },
              { id: "l3", name: "Later", type: "manual" }
            ]
          };
        }
      };
    }
    if (url.endsWith("/api/v1/bookmarks/bm-1/lists")) {
      return {
        status: 200,
        async json() {
          return { lists: [{ id: "l3", name: "Later", type: "manual" }] };
        }
      };
    }
    return { status: 404, async json() { return {}; } };
  };

  const { fetchListsWithMembership } = await importFresh(listServiceModuleUrl);
  const result = await fetchListsWithMembership("bm-1");

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.lists.map((list) => list.id),
    ["l1", "l3"]
  );
  assert.deepEqual(result.memberListIds, ["l3"]);
  assert.equal(result.message, null);
});

test("fetchListsWithMembership skips the membership call when no bookmark id is given", async () => {
  mockBrowser();
  const fetchedUrls = [];
  globalThis.fetch = async (url) => {
    fetchedUrls.push(url);
    return {
      status: 200,
      async json() {
        return { lists: [{ id: "l1", name: "Reading", type: "manual" }] };
      }
    };
  };

  const { fetchListsWithMembership } = await importFresh(listServiceModuleUrl);
  const result = await fetchListsWithMembership(null);

  assert.equal(result.ok, true);
  assert.deepEqual(result.memberListIds, []);
  assert.deepEqual(fetchedUrls, ["https://karakeep.example.com/api/v1/lists"]);
});

test("fetchListsWithMembership surfaces client errors as a message", async () => {
  mockBrowser();
  globalThis.fetch = async () => ({ status: 500, async json() { return {}; } });

  const { fetchListsWithMembership } = await importFresh(listServiceModuleUrl);
  const result = await fetchListsWithMembership("bm-1");

  assert.equal(result.ok, false);
  assert.deepEqual(result.lists, []);
  assert.deepEqual(result.memberListIds, []);
  assert.equal(result.message, "Karakeep returned an error");
});

test("setMembership adds with PUT and removes with DELETE", async () => {
  mockBrowser();
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options.method });
    return {
      status: 204,
      async json() {
        throw new Error("204 has no body");
      }
    };
  };

  const { setMembership } = await importFresh(listServiceModuleUrl);

  const added = await setMembership("bm-1", "l1", true);
  assert.deepEqual(added, { ok: true, message: null });
  assert.equal(calls[0].method, "PUT");

  const removed = await setMembership("bm-1", "l1", false);
  assert.deepEqual(removed, { ok: true, message: null });
  assert.equal(calls[1].method, "DELETE");
});

test("setMembership returns an error message when the request fails", async () => {
  mockBrowser();
  globalThis.fetch = async () => ({ status: 401, async json() { return {}; } });

  const { setMembership } = await importFresh(listServiceModuleUrl);
  const result = await setMembership("bm-1", "l1", true);

  assert.equal(result.ok, false);
  assert.equal(result.message, "API key was rejected");
});
