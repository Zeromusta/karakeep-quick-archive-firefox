import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserMock } from "./helpers/browser-mock.js";
import { importFresh, flushMicrotasks, createDeferred } from "./helpers/module.js";

async function setup(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const browser = globalThis.browser = createBrowserMock();
  const icons = [];
  let title = "", badge = "";
  browser.action = {
    async setIcon(icon) { icons.push(icon); },
    async setTitle(value) { title = value.title; },
    async setBadgeText(value) { badge = value.text; },
    async setBadgeBackgroundColor() {}
  };
  t.mock.method(globalThis, "fetch", async () => new Response("icon"));
  globalThis.createImageBitmap = async () => ({ close() {} });
  t.after(() => { delete globalThis.createImageBitmap; delete globalThis.OffscreenCanvas; });
  globalThis.OffscreenCanvas = class {
    getContext() {
      const operations = [];
      return new Proxy({ getImageData: () => ({ operations }) }, {
        get(target, name) { return target[name] ?? ((...args) => operations.push([name, ...args])); }
      });
    }
  };
  const icon = await importFresh(new URL("../shared/icon-theme.js", import.meta.url));
  await icon.applyIconTheme("light");
  const tick = async (ms) => { t.mock.timers.tick(ms); await flushMicrotasks(); };
  return { icon, icons, browser, tick, title: () => title, badge: () => badge };
}

test("spins while processing, ticks for two seconds, then checks current work", async (t) => {
  const { icon, icons, tick, title } = await setup(t);
  const first = icon.beginArchiveProcessing();
  const second = icon.beginArchiveProcessing();
  await tick(0);
  assert.match(title(), /Archiving/);
  const frame = icons.at(-1);
  await tick(100);
  assert.notDeepEqual(icons.at(-1), frame, "spinner pixels must change");
  first(true);
  await tick(0);
  assert.match(title(), /Archived/);
  await tick(1999);
  assert.match(title(), /Archived/);
  await tick(1);
  assert.match(title(), /Archiving/);
  second(true);
  await tick(0);
  assert.match(title(), /Archived/);
  await tick(2000);
  assert.equal(title(), "Karakeep Quick Archive");
});

test("completions during a tick neither queue nor extend it", async (t) => {
  const { icon, tick, title } = await setup(t);
  const first = icon.beginArchiveProcessing();
  const second = icon.beginArchiveProcessing();
  first(true);
  await tick(1500);
  second(true);
  const third = icon.beginArchiveProcessing();
  await tick(500);
  assert.match(title(), /Archiving/);
  third(false);
  await tick(0);
  assert.equal(title(), "Karakeep Quick Archive", "failure must not flash success");
});

test("warning takes priority, survives success and theme changes, and clears to live work", async (t) => {
  const { icon, browser, tick, title } = await setup(t);
  const first = icon.beginArchiveProcessing();
  await icon.showArchiveWarning();
  first(true);
  await icon.applyIconTheme("dark", true);
  await tick(3000);
  assert.match(title(), /fell back/);
  assert.equal(browser.__mock.localState.archiveWarning, true);
  const second = icon.beginArchiveProcessing();
  await icon.clearArchiveWarning();
  await tick(0);
  assert.match(title(), /Archiving/);
  assert.equal(browser.__mock.localState.archiveWarning, undefined);
  second(false);
  await tick(0);
  assert.match(title(), /Monitoring paused/);
});

test("stored warning restores without replaying old completions", async (t) => {
  const { icon, browser, title } = await setup(t);
  await browser.storage.local.set({ archiveWarning: true });
  await icon.restoreArchiveWarning();
  assert.match(title(), /fell back/);
  await icon.clearArchiveWarning();
});

test("warning remains visible with feedback disabled and without canvas", async (t) => {
  const { icon, title, badge, tick } = await setup(t);
  globalThis.OffscreenCanvas = undefined;
  await icon.applyIconTheme("light", false, false);
  const finish = icon.beginArchiveProcessing();
  await tick(0);
  assert.equal(title(), "Karakeep Quick Archive");
  await icon.showArchiveWarning();
  await tick(0);
  assert.equal(badge(), "!");
  finish(true);
  await icon.clearArchiveWarning();
  await tick(0);
  assert.equal(badge(), "");
});

test("late image loading cannot repaint a cleared warning", async (t) => {
  const { icon, icons, tick, title } = await setup(t);
  const image = createDeferred();
  globalThis.createImageBitmap = () => image.promise;
  await icon.showArchiveWarning();
  await icon.clearArchiveWarning();
  await tick(0);
  image.resolve({ close() {} });
  await tick(0);
  assert.equal(title(), "Karakeep Quick Archive");
  assert.ok(icons.at(-1).path);
});
