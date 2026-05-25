import {
  DEFAULT_SETTINGS,
  ELIGIBLE_PROTOCOLS,
  HISTORY_STATUS,
  ICON_THEMES,
  THEMES
} from "./constants.js";

export function generateId() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function isEligibleUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    return ELIGIBLE_PROTOCOLS.has(parsedUrl.protocol);
  } catch {
    return false;
  }
}

export function normalizeBaseUrl(rawValue) {
  const trimmedValue = String(rawValue ?? "").trim();
  if (!trimmedValue) {
    throw new Error("Karakeep Base URL is required");
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(trimmedValue);
  } catch {
    throw new Error("Karakeep Base URL must be a valid URL");
  }

  if (!ELIGIBLE_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error("Karakeep Base URL must use http or https");
  }

  const normalizedPath = parsedUrl.pathname.replace(/\/+$/, "");
  parsedUrl.pathname = normalizedPath || "";
  parsedUrl.search = "";
  parsedUrl.hash = "";

  return parsedUrl.toString().replace(/\/+$/, "");
}

export function normalizeSettingsInput(rawSettings = {}, options = {}) {
  const { requireCredentials = false, strictNumbers = false } = options;
  const mergedSettings = {
    ...DEFAULT_SETTINGS,
    ...(rawSettings ?? {})
  };

  const normalizedBaseUrl = String(mergedSettings.karakeepBaseUrl ?? "").trim();
  const normalizedApiKey = String(mergedSettings.karakeepApiKey ?? "").trim();

  // Backward compat: prior versions stored historyRetentionDays.
  // Honor it as a one-time migration source if the new field isn't set.
  let retentionHoursInput = mergedSettings.historyRetentionHours;
  if (
    (retentionHoursInput === undefined || retentionHoursInput === null) &&
    mergedSettings.historyRetentionDays !== undefined &&
    mergedSettings.historyRetentionDays !== null
  ) {
    const days = Number(mergedSettings.historyRetentionDays);
    if (Number.isFinite(days) && days > 0) {
      retentionHoursInput = days * 24;
    }
  }

  return {
    karakeepBaseUrl: normalizedBaseUrl
      ? normalizeBaseUrl(normalizedBaseUrl)
      : validateRequiredValue(
          "",
          "Karakeep Base URL",
          requireCredentials
        ),
    karakeepApiKey: normalizedApiKey || validateRequiredValue("", "Karakeep API Key", requireCredentials),
    requestTimeoutSeconds: parsePositiveInteger(
      mergedSettings.requestTimeoutSeconds,
      "Request timeout",
      DEFAULT_SETTINGS.requestTimeoutSeconds,
      { strict: strictNumbers, min: 1, max: 120 }
    ),
    historyRetentionHours: parsePositiveInteger(
      retentionHoursInput,
      "History retention",
      DEFAULT_SETTINGS.historyRetentionHours,
      { strict: strictNumbers, min: 1, max: 8760 }
    ),
    showFavicons: Boolean(mergedSettings.showFavicons),
    maxHistoryItems: parsePositiveInteger(
      mergedSettings.maxHistoryItems,
      "Max history items",
      DEFAULT_SETTINGS.maxHistoryItems,
      { strict: strictNumbers, min: 1, max: 5000 }
    ),
    iconTheme: normalizeIconTheme(mergedSettings.iconTheme),
    theme: normalizeTheme(mergedSettings.theme),
    debugLogging: Boolean(mergedSettings.debugLogging),
    monitoringPaused: Boolean(mergedSettings.monitoringPaused)
  };
}

function normalizeIconTheme(value) {
  return Object.values(ICON_THEMES).includes(value)
    ? value
    : DEFAULT_SETTINGS.iconTheme;
}

function normalizeTheme(value) {
  return Object.values(THEMES).includes(value)
    ? value
    : DEFAULT_SETTINGS.theme;
}

export function toOriginPattern(baseUrl) {
  return `${new URL(baseUrl).origin}/*`;
}

export function getExpiryTimestamp(actionAt, historyRetentionHours) {
  const retentionMs = historyRetentionHours * 60 * 60 * 1000;
  return actionAt + retentionMs;
}

export function formatTimestamp(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

export function getStatusLabel(status) {
  switch (status) {
    case HISTORY_STATUS.archived:
      return "Archived";
    case HISTORY_STATUS.skipped:
      return "Skipped";
    case HISTORY_STATUS.closed:
    default:
      return "Closed";
  }
}

export function logDebug(enabled, ...args) {
  if (enabled) {
    console.debug("[karakeep-quick-archive]", ...args);
  }
}

function parsePositiveInteger(value, label, fallback, options = {}) {
  const { strict = false, min = 1, max = Number.MAX_SAFE_INTEGER } = options;
  const parsedValue = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isInteger(parsedValue)) {
    if (strict) {
      throw new Error(`${label} must be a whole number`);
    }

    return fallback;
  }

  if (parsedValue < min || parsedValue > max) {
    if (strict) {
      throw new Error(`${label} must be between ${min} and ${max}`);
    }

    return Math.min(Math.max(parsedValue, min), max);
  }

  return parsedValue;
}

function validateRequiredValue(value, label, required) {
  if (required) {
    throw new Error(`${label} is required`);
  }

  return value;
}
