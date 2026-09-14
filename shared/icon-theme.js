import {
  ARCHIVE_FLASH_DURATION_MS,
  ICON_PATHS,
  ICON_THEMES,
  STORAGE_KEYS
} from "./constants.js";

let currentMode = ICON_THEMES.system;
let currentPaused = false;
let themeListenerAttached = false;
let feedbackEnabled = true;
let processingCount = 0;
let warningActive = false;
let flashTimer = null;
let animationTimer = null;
let frame = 0;
let paintVersion = 0;
const imageCache = new Map();

export async function applyIconTheme(iconTheme, monitoringPaused = false, archiveFeedbackIcon = feedbackEnabled) {
  currentMode = iconTheme;
  currentPaused = Boolean(monitoringPaused);
  feedbackEnabled = Boolean(archiveFeedbackIcon);
  await refreshIcon();
}

// Count live work, not completion notifications. Finishes during an existing
// tick are coalesced; its deadline never moves and nothing is queued.
export function beginArchiveProcessing() {
  processingCount += 1;
  void refreshIcon();
  let finished = false;
  return (succeeded = false) => {
    if (finished) return;
    finished = true;
    processingCount -= 1;
    if (succeeded) flashArchivedIcon();
    else void refreshIcon();
  };
}

export function flashArchivedIcon() {
  if (!warningActive && feedbackEnabled && flashTimer === null) {
    flashTimer = setTimeout(() => {
      flashTimer = null;
      void refreshIcon();
    }, ARCHIVE_FLASH_DURATION_MS);
  }
  void refreshIcon();
}

export async function restoreArchiveWarning() {
  const stored = await browser.storage.local.get(STORAGE_KEYS.archiveWarning);
  warningActive = Boolean(stored[STORAGE_KEYS.archiveWarning]);
  await refreshIcon();
}

export async function showArchiveWarning() {
  warningActive = true;
  clearTimeout(flashTimer);
  flashTimer = null;
  void refreshIcon();
  try {
    await browser.storage.local.set({ [STORAGE_KEYS.archiveWarning]: true });
  } catch { /* Badge feedback must never fail an archive. */ }
}

export async function clearArchiveWarning() {
  warningActive = false;
  void refreshIcon();
  await browser.storage.local.remove(STORAGE_KEYS.archiveWarning);
}

export async function refreshIcon() {
  const version = ++paintVersion;
  if (typeof browser === "undefined" || !browser.action?.setIcon) return;
  const state = warningActive ? "warning"
    : feedbackEnabled && flashTimer !== null ? "archived"
    : feedbackEnabled && processingCount > 0 ? "processing"
    : currentPaused ? "paused" : "idle";
  const animated = state === "processing" || state === "archived";
  if (animated && animationTimer === null) {
    animationTimer = setInterval(() => {
      frame = (frame + 1) % 12;
      void refreshIcon();
    }, 100);
  } else if (!animated && animationTimer !== null) {
    clearInterval(animationTimer);
    animationTimer = null;
  }
  const pathMap = await resolvePathMap(currentMode);
  const currentFrame = frame;
  const drawBadge = {
    warning: drawWarningBadge,
    archived: drawCheckBadge,
    processing: (ctx, size) => drawSpinnerBadge(ctx, size, currentFrame),
    paused: drawPauseBadge
  }[state];
  let imageData = null;
  if (drawBadge) {
    const key = JSON.stringify([pathMap, state, state === "processing" ? currentFrame : 0]);
    if (!imageCache.has(key)) imageCache.set(key, buildBadgedImageData(pathMap, drawBadge));
    imageData = await imageCache.get(key);
    if (!imageData) imageCache.delete(key);
  }
  // Theme changes and new archive events can overtake asynchronous image work.
  if (version !== paintVersion) return;
  if (imageData) await setActionImageData(imageData);
  else await setActionIcon(pathMap);
  if (version !== paintVersion) return;
  try {
    // Native text is a fallback when canvas compositing is unavailable.
    if (browser.action.setBadgeText) {
      if (state === "warning" && !imageData) {
        await browser.action.setBadgeBackgroundColor?.({ color: "#f59e0b" });
      }
      await browser.action.setBadgeText({ text: !imageData && state === "warning" ? "!" : "" });
    }
  } catch { /* Cosmetic. */ }
  if (version !== paintVersion) return;
  const suffix = {
    warning: " — Page archive fell back; click to review",
    archived: " — Archived",
    processing: " — Archiving…",
    paused: " — Monitoring paused",
    idle: ""
  }[state];
  await setActionTitle(`Karakeep Quick Archive${suffix}`);
}

async function resolvePathMap(iconTheme) {
  if (iconTheme === ICON_THEMES.light) {
    return ICON_PATHS.light;
  }
  if (iconTheme === ICON_THEMES.dark) {
    return ICON_PATHS.dark;
  }
  const useDark = await currentToolbarIsDark();
  return useDark ? ICON_PATHS.dark : ICON_PATHS.light;
}

export function watchSystemThemeChanges() {
  if (themeListenerAttached) return;
  if (typeof browser === "undefined" || !browser.theme?.onUpdated?.addListener) {
    return;
  }
  browser.theme.onUpdated.addListener(() => {
    if (currentMode === ICON_THEMES.system) {
      void applyIconTheme(currentMode, currentPaused);
    }
  });
  themeListenerAttached = true;
}

async function setActionIcon(pathMap) {
  try {
    await browser.action.setIcon({ path: { ...pathMap } });
  } catch {
    // Setting the toolbar icon is cosmetic; never let it break startup or save.
  }
}

async function setActionImageData(imageData) {
  try {
    await browser.action.setIcon({ imageData });
  } catch {
    // Cosmetic; ignore.
  }
}

async function setActionTitle(title) {
  if (!browser.action?.setTitle) {
    return;
  }
  try {
    await browser.action.setTitle({ title });
  } catch {
    // Cosmetic.
  }
}

async function buildBadgedImageData(pathMap, drawBadge) {
  if (
    typeof OffscreenCanvas !== "function" ||
    typeof createImageBitmap !== "function" ||
    typeof fetch !== "function" ||
    !browser.runtime?.getURL
  ) {
    return null;
  }
  const entries = await Promise.all(
    Object.entries(pathMap).map(async ([size, iconPath]) => {
      const composed = await composeBadgedImageData(
        iconPath,
        Number(size),
        drawBadge
      );
      return composed ? [size, composed] : null;
    })
  );
  const result = {};
  for (const entry of entries) {
    if (entry) {
      result[entry[0]] = entry[1];
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

async function composeBadgedImageData(iconPath, size, drawBadge) {
  try {
    const url = browser.runtime.getURL(iconPath);
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, size, size);
    bitmap.close();
    drawBadge(ctx, size);
    return ctx.getImageData(0, 0, size, size);
  } catch {
    return null;
  }
}

function drawPauseBadge(ctx, size) {
  // Bottom-right red circle with a thin white ring for legibility on any
  // background, plus two white pause bars. The centre sits closer to the
  // corner than the radius would suggest — letting ~30% of the badge bleed
  // off the right/bottom edges anchors it visually to the corner.
  const badgeRadius = size * 0.42;
  const ringWidth = Math.max(1, size * 0.08);
  const cornerInset = badgeRadius * 0.7;
  const cx = size - cornerInset;
  const cy = size - cornerInset;

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, badgeRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#dc2626";
  ctx.beginPath();
  ctx.arc(cx, cy, badgeRadius - ringWidth, 0, Math.PI * 2);
  ctx.fill();

  const innerRadius = badgeRadius - ringWidth;
  const barHeight = innerRadius * 1.05;
  const barWidth = Math.max(1, innerRadius * 0.28);
  const barGap = Math.max(1, innerRadius * 0.18);
  const barsTop = cy - barHeight / 2;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(cx - barGap - barWidth, barsTop, barWidth, barHeight);
  ctx.fillRect(cx + barGap, barsTop, barWidth, barHeight);
}

function drawSpinnerBadge(ctx, size, frame) {
  const cx = size * 0.706;
  const cy = cx;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = Math.max(1.5, size * 0.12);
  ctx.lineCap = "round";
  const angle = frame * Math.PI / 6;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.26, angle, angle + Math.PI * 1.4);
  ctx.stroke();
}

function drawWarningBadge(ctx, size) {
  const cx = size * 0.706;
  const cy = cx;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#111827";
  ctx.fillRect(cx - size * 0.055, cy - size * 0.23, size * 0.11, size * 0.28);
  ctx.fillRect(cx - size * 0.055, cy + size * 0.13, size * 0.11, size * 0.11);
}

function drawCheckBadge(ctx, size) {
  // Same bottom-right placement and ring treatment as drawPauseBadge, but a
  // green disc with a white check mark — the "archive captured" confirmation.
  const badgeRadius = size * 0.42;
  const ringWidth = Math.max(1, size * 0.08);
  const cornerInset = badgeRadius * 0.7;
  const cx = size - cornerInset;
  const cy = size - cornerInset;

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, badgeRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#16a34a";
  ctx.beginPath();
  ctx.arc(cx, cy, badgeRadius - ringWidth, 0, Math.PI * 2);
  ctx.fill();

  const innerRadius = badgeRadius - ringWidth;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1, innerRadius * 0.3);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - innerRadius * 0.5, cy + innerRadius * 0.02);
  ctx.lineTo(cx - innerRadius * 0.12, cy + innerRadius * 0.42);
  ctx.lineTo(cx + innerRadius * 0.55, cy - innerRadius * 0.4);
  ctx.stroke();
}

async function currentToolbarIsDark() {
  if (browser.theme?.getCurrent) {
    try {
      const theme = await browser.theme.getCurrent();
      const toolbarColor = theme?.colors?.toolbar ?? theme?.colors?.frame;
      if (toolbarColor) {
        return isDarkColor(toolbarColor);
      }
    } catch {
      // fall through to OS detection
    }
  }
  if (typeof globalThis.matchMedia === "function") {
    try {
      return globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      // ignore
    }
  }
  return false;
}

function isDarkColor(colorString) {
  const rgb = parseColor(colorString);
  if (!rgb) return false;
  // ITU-R BT.709 relative luminance, 0–1
  const luma = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luma < 0.5;
}

function parseColor(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();

  const shortHex = trimmed.match(/^#([\da-f])([\da-f])([\da-f])[\da-f]?$/i);
  if (shortHex) {
    return {
      r: parseInt(shortHex[1] + shortHex[1], 16),
      g: parseInt(shortHex[2] + shortHex[2], 16),
      b: parseInt(shortHex[3] + shortHex[3], 16)
    };
  }

  const longHex = trimmed.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})(?:[\da-f]{2})?$/i);
  if (longHex) {
    return {
      r: parseInt(longHex[1], 16),
      g: parseInt(longHex[2], 16),
      b: parseInt(longHex[3], 16)
    };
  }

  const rgbMatch = trimmed.match(
    /^rgba?\s*\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i
  );
  if (rgbMatch) {
    return {
      r: Math.round(Number(rgbMatch[1])),
      g: Math.round(Number(rgbMatch[2])),
      b: Math.round(Number(rgbMatch[3]))
    };
  }

  return null;
}
