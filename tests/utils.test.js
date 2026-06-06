import test from "node:test";
import assert from "node:assert/strict";

import {
  getStatusLabel,
  isEligibleUrl,
  normalizeBaseUrl,
  normalizeSettingsInput
} from "../shared/utils.js";

test("normalizeBaseUrl trims trailing slash and strips search/hash", () => {
  assert.equal(
    normalizeBaseUrl(" https://karakeep.example.com/path/?debug=1#hash "),
    "https://karakeep.example.com/path"
  );
});

test("normalizeBaseUrl rejects non-http protocols", () => {
  assert.throws(
    () => normalizeBaseUrl("ftp://karakeep.example.com"),
    /must use http or https/
  );
});

test("normalizeSettingsInput validates required fields and integer options", () => {
  assert.deepEqual(
    normalizeSettingsInput(
      {
        karakeepBaseUrl: "https://karakeep.example.com/",
        karakeepApiKey: "  secret-key  ",
        requestTimeoutSeconds: "20",
        historyRetentionHours: "9",
        maxHistoryItems: "250",
        showFavicons: false,
        iconTheme: "dark",
        theme: "dark",
        debugLogging: true
      },
      { requireCredentials: true, strictNumbers: true }
    ),
    {
      karakeepBaseUrl: "https://karakeep.example.com",
      karakeepApiKey: "secret-key",
      requestTimeoutSeconds: 20,
      historyRetentionHours: 9,
      showFavicons: false,
      maxHistoryItems: 250,
      iconTheme: "dark",
      theme: "dark",
      debugLogging: true,
      monitoringPaused: false,
      archiveFeedbackIcon: true,
      archiveFeedbackNotification: false
    }
  );
});

test("normalizeSettingsInput round-trips archive feedback toggles", () => {
  const normalized = normalizeSettingsInput({
    archiveFeedbackIcon: false,
    archiveFeedbackNotification: true
  });
  assert.equal(normalized.archiveFeedbackIcon, false);
  assert.equal(normalized.archiveFeedbackNotification, true);

  const defaults = normalizeSettingsInput({});
  assert.equal(defaults.archiveFeedbackIcon, true);
  assert.equal(defaults.archiveFeedbackNotification, false);
});

test("normalizeSettingsInput defaults theme to system when missing or invalid", () => {
  const normalizedWithoutTheme = normalizeSettingsInput({});
  assert.equal(normalizedWithoutTheme.theme, "system");

  const normalizedWithJunkTheme = normalizeSettingsInput({ theme: "rainbow" });
  assert.equal(normalizedWithJunkTheme.theme, "system");

  const normalizedWithLight = normalizeSettingsInput({ theme: "light" });
  assert.equal(normalizedWithLight.theme, "light");
});

test("normalizeSettingsInput defaults iconTheme to system when missing or invalid", () => {
  const normalizedWithoutIconTheme = normalizeSettingsInput({});
  assert.equal(normalizedWithoutIconTheme.iconTheme, "system");

  const normalizedWithJunkIconTheme = normalizeSettingsInput({ iconTheme: "rainbow" });
  assert.equal(normalizedWithJunkIconTheme.iconTheme, "system");

  const normalizedWithLight = normalizeSettingsInput({ iconTheme: "light" });
  assert.equal(normalizedWithLight.iconTheme, "light");
});

test("isEligibleUrl accepts only http and https URLs", () => {
  assert.equal(isEligibleUrl("https://example.com"), true);
  assert.equal(isEligibleUrl("http://example.com"), true);
  assert.equal(isEligibleUrl("about:blank"), false);
  assert.equal(isEligibleUrl("moz-extension://123/popup.html"), false);
});

test("getStatusLabel maps status values to UI labels", () => {
  assert.equal(getStatusLabel("archived"), "Archived");
  assert.equal(getStatusLabel("skipped"), "Skipped");
  assert.equal(getStatusLabel("closed"), "Closed");
});
