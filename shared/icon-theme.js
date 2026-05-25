import { ICON_PATHS, ICON_THEMES } from "./constants.js";

let currentMode = ICON_THEMES.system;
let currentPaused = false;
let themeListenerAttached = false;

export async function applyIconTheme(iconTheme, monitoringPaused = false) {
  if (typeof browser === "undefined" || !browser.action?.setIcon) {
    return;
  }
  currentMode = iconTheme;
  currentPaused = Boolean(monitoringPaused);

  let pathMap;
  if (iconTheme === ICON_THEMES.light) {
    pathMap = ICON_PATHS.light;
  } else if (iconTheme === ICON_THEMES.dark) {
    pathMap = ICON_PATHS.dark;
  } else {
    const useDark = await currentToolbarIsDark();
    pathMap = useDark ? ICON_PATHS.dark : ICON_PATHS.light;
  }

  if (currentPaused) {
    const imageData = await buildPausedImageData(pathMap);
    if (imageData) {
      await setActionImageData(imageData);
      await setActionTitle("Karakeep Quick Archive — Monitoring paused");
      return;
    }
    // OffscreenCanvas not available — fall back to the plain icon.
  }

  await setActionIcon(pathMap);
  await setActionTitle("Karakeep Quick Archive");
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

async function buildPausedImageData(pathMap) {
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
      const composed = await composePausedImageData(iconPath, Number(size));
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

async function composePausedImageData(iconPath, size) {
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
    drawPauseBadge(ctx, size);
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
