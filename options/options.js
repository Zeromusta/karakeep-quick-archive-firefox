import { DEFAULT_SETTINGS, MESSAGE_TYPES, STORAGE_KEYS } from "../shared/constants.js";
import { applyDocumentTheme, watchThemeChanges } from "../shared/theme.js";
import { normalizeSettingsInput, toOriginPattern } from "../shared/utils.js";

const STATUS_AUTOHIDE_MS = 4000;
const STATUS_FADE_MS = 400;

const optionsForm = document.querySelector("#options-form");
const baseUrlInput = document.querySelector("#base-url-input");
const apiKeyInput = document.querySelector("#api-key-input");
const timeoutInput = document.querySelector("#timeout-input");
const retentionInput = document.querySelector("#retention-input");
const maxHistoryInput = document.querySelector("#max-history-input");
const showFaviconsInput = document.querySelector("#show-favicons-input");
const iconThemeInput = document.querySelector("#icon-theme-input");
const themeInput = document.querySelector("#theme-input");
const debugLoggingInput = document.querySelector("#debug-logging-input");
const testConnectionButton = document.querySelector("#test-connection-button");
const clearHistoryButton = document.querySelector("#clear-history-button");
const testConnectionStatus = document.querySelector("#test-connection-status");
const clearHistoryStatus = document.querySelector("#clear-history-status");
const saveStatus = document.querySelector("#save-status");

await loadSettings();
watchThemeChanges();

iconThemeInput.addEventListener("change", async () => {
  await persistSettingChange("iconTheme", iconThemeInput.value);
});

themeInput.addEventListener("change", async () => {
  applyDocumentTheme(themeInput.value);
  await persistSettingChange("theme", themeInput.value);
});

retentionInput.addEventListener("change", async () => {
  const merged = await persistSettingChange(
    "historyRetentionHours",
    retentionInput.value
  );
  if (merged) {
    retentionInput.value = String(merged.historyRetentionHours);
  }
});

maxHistoryInput.addEventListener("change", async () => {
  const merged = await persistSettingChange(
    "maxHistoryItems",
    maxHistoryInput.value
  );
  if (merged) {
    maxHistoryInput.value = String(merged.maxHistoryItems);
  }
});

showFaviconsInput.addEventListener("change", async () => {
  await persistSettingChange("showFavicons", showFaviconsInput.checked);
});

debugLoggingInput.addEventListener("change", async () => {
  await persistSettingChange("debugLogging", debugLoggingInput.checked);
});

optionsForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const normalizedSettings = normalizeSettingsInput(readFormValues(), {
      requireCredentials: true,
      strictNumbers: true
    });

    await browser.storage.local.set({
      [STORAGE_KEYS.settings]: normalizedSettings
    });

    showStatus(saveStatus, "Settings saved.");
  } catch (error) {
    showStatus(saveStatus, error.message, { isError: true });
  }
});

testConnectionButton.addEventListener("click", async () => {
  try {
    const normalizedSettings = normalizeSettingsInput(readFormValues(), {
      requireCredentials: true,
      strictNumbers: true
    });

    testConnectionButton.disabled = true;
    showStatus(testConnectionStatus, "Testing connection…", { persistent: true });
    await requestHostPermission(normalizedSettings.karakeepBaseUrl);

    const result = await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.testConnection,
      settings: normalizedSettings
    });

    if (!result || result.ok !== true) {
      throw new Error(result?.message || "Connection test returned an unexpected response");
    }

    showStatus(testConnectionStatus, result.message || "Connection succeeded.");
  } catch (error) {
    showStatus(testConnectionStatus, error.message, { isError: true });
  } finally {
    testConnectionButton.disabled = false;
  }
});

clearHistoryButton.addEventListener("click", async () => {
  if (!window.confirm("Clear all history entries? This can't be undone.")) {
    return;
  }
  clearHistoryButton.disabled = true;
  try {
    await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.clearHistory,
      statusFilter: "all"
    });
    showStatus(clearHistoryStatus, "History cleared.");
  } catch (error) {
    showStatus(clearHistoryStatus, error.message, { isError: true });
  } finally {
    clearHistoryButton.disabled = false;
  }
});

// History/UI/Debug fields persist on `change`. Connection fields still wait
// for Save — they need URL/API-key validation that we don't want to gate on
// keystrokes. Non-strict normalization clamps numeric inputs, and the caller
// can sync the displayed value back from the returned merged settings.
async function persistSettingChange(fieldName, value) {
  try {
    const stored = await browser.storage.local.get(STORAGE_KEYS.settings);
    const existing = stored[STORAGE_KEYS.settings] ?? DEFAULT_SETTINGS;
    const merged = normalizeSettingsInput({
      ...existing,
      [fieldName]: value
    });
    await browser.storage.local.set({ [STORAGE_KEYS.settings]: merged });
    return merged;
  } catch {
    return null;
  }
}

async function loadSettings() {
  const { [STORAGE_KEYS.settings]: storedSettings } = await browser.storage.local.get(
    STORAGE_KEYS.settings
  );
  const settings = normalizeSettingsInput(storedSettings ?? DEFAULT_SETTINGS);

  baseUrlInput.value = settings.karakeepBaseUrl;
  apiKeyInput.value = settings.karakeepApiKey;
  timeoutInput.value = String(settings.requestTimeoutSeconds);
  retentionInput.value = String(settings.historyRetentionHours);
  maxHistoryInput.value = String(settings.maxHistoryItems);
  showFaviconsInput.checked = settings.showFavicons;
  iconThemeInput.value = settings.iconTheme;
  themeInput.value = settings.theme;
  debugLoggingInput.checked = settings.debugLogging;
  applyDocumentTheme(settings.theme);
}

function readFormValues() {
  return {
    karakeepBaseUrl: baseUrlInput.value,
    karakeepApiKey: apiKeyInput.value,
    requestTimeoutSeconds: timeoutInput.value,
    historyRetentionHours: retentionInput.value,
    maxHistoryItems: maxHistoryInput.value,
    showFavicons: showFaviconsInput.checked,
    iconTheme: iconThemeInput.value,
    theme: themeInput.value,
    debugLogging: debugLoggingInput.checked
  };
}

async function requestHostPermission(baseUrl) {
  // Must be the first await in the user-gesture chain: Firefox rejects
  // permissions.request() once we've yielded back to the event loop. A
  // permissions.contains() pre-check would yield and break the gesture, so
  // call request() unconditionally — it resolves to true without prompting
  // when the origin is already granted.
  const granted = await browser.permissions.request({
    origins: [toOriginPattern(baseUrl)]
  });

  if (!granted) {
    throw new Error("Permission to access the Karakeep host was not granted");
  }
}

function showStatus(element, message, options = {}) {
  const { isError = false, persistent = false } = options;

  clearTimeout(element._fadeTimer);
  clearTimeout(element._hideTimer);

  element.textContent = message;
  element.classList.toggle("is-error", isError);
  element.classList.remove("is-fading");
  element.hidden = false;

  if (persistent) {
    return;
  }

  element._fadeTimer = setTimeout(() => {
    element.classList.add("is-fading");
    element._hideTimer = setTimeout(() => {
      element.hidden = true;
      element.classList.remove("is-fading");
    }, STATUS_FADE_MS);
  }, STATUS_AUTOHIDE_MS);
}
