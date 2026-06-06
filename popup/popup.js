import {
  HISTORY_STATUS,
  KARAKEEP_BOOKMARK_PREVIEW_PATH,
  MANUAL_REVIEW_ACTIONS,
  MESSAGE_TYPES,
  POPUP_RENDER_DEBOUNCE_MS,
  POPUP_STATUS_DURATION_MS,
  STORAGE_KEYS,
  TOOLTIP_DELAY_MS
} from "../shared/constants.js";
import { applyDocumentTheme } from "../shared/theme.js";

// Icons from Font Awesome Free 6 (CC BY 4.0). https://fontawesome.com
const STAR_OUTLINE_SVG = `<svg viewBox="0 0 576 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="currentColor" d="M287.9 0c9.2 0 17.6 5.2 21.6 13.5l68.6 141.3 153.2 22.6c9 1.3 16.5 7.6 19.3 16.3s.5 18.1-5.9 24.5L433.6 328.4l26.2 155.6c1.5 9-2.2 18.1-9.6 23.5s-17.3 6-25.3 1.7l-137-73.2L151 509.1c-8.1 4.3-17.9 3.7-25.3-1.7s-11.2-14.5-9.7-23.5l26.2-155.6L31.1 218.2c-6.5-6.4-8.7-15.9-5.9-24.5s10.3-15 19.3-16.3l153.2-22.6L266.3 13.5C270.4 5.2 278.7 0 287.9 0zm0 79L235.4 187.2c-3.5 7.1-10.2 12.1-18.1 13.3L99 217.9 184.9 303c5.5 5.5 8.1 13.3 6.8 21L171.4 443.7l105.2-56.2c7.1-3.8 15.6-3.8 22.6 0l105.2 56.2L384.2 324.1c-1.3-7.7 1.2-15.5 6.8-21l85.9-85.1L358.6 200.5c-7.8-1.2-14.6-6.1-18.1-13.3L287.9 79z"/></svg>`;
const STAR_SOLID_SVG = `<svg viewBox="0 0 576 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="currentColor" d="M316.9 18C311.6 7 300.4 0 288.1 0s-23.4 7-28.8 18L195 150.3 51.4 171.5c-12 1.8-22 10.2-25.7 21.7s-.7 24.2 7.9 32.7L137.8 329 113.2 474.7c-2 12 3 24.2 12.9 31.3s23 8 33.8 2.3l128.3-68.5 128.3 68.5c10.8 5.7 23.9 4.9 33.8-2.3s14.9-19.3 12.9-31.3L438.5 329 542.7 225.9c8.6-8.5 11.7-21.2 7.9-32.7s-13.7-19.9-25.7-21.7L381.2 150.3 316.9 18z"/></svg>`;
const COG_SVG = `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="currentColor" d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z"/></svg>`;
import {
  formatTimestamp,
  getStatusLabel,
  getExpiryTimestamp,
  normalizeSettingsInput
} from "../shared/utils.js";

const pendingArchivePrompts = new Set();
let currentHistoryFilter = "all";
let pendingHistoryClear = false;

// Detect whether the platform shows a scrollbar that takes layout space
// (Mac in Firefox, persistent setups) versus an overlay scrollbar that
// floats over content (Windows 11+, modern setups). scrollbar-gutter
// only meaningfully reserves space in the former case.
(() => {
  const test = document.createElement("div");
  test.style.cssText =
    "width:100px;height:100px;overflow-y:scroll;position:absolute;top:-9999px;visibility:hidden;";
  document.body.appendChild(test);
  const persistent = test.offsetWidth > test.clientWidth;
  test.remove();
  if (persistent) {
    document.documentElement.classList.add("persistent-scrollbar");
  }
})();

const popupStatusElement = document.querySelector("#popup-status");
const processingListElement = document.querySelector("#processing-list");
const manualReviewListElement = document.querySelector("#manual-review-list");
const historyListElement = document.querySelector("#history-list");
const processingCountElement = document.querySelector("#processing-count");
const manualReviewCountElement = document.querySelector("#manual-review-count");
const historyCountElement = document.querySelector("#history-count");
const openOptionsButton = document.querySelector("#open-options-button");
const monitoringToggleButton = document.querySelector("#monitoring-toggle");

openOptionsButton.innerHTML = COG_SVG;

openOptionsButton.addEventListener("click", async () => {
  await browser.runtime.openOptionsPage();
});

monitoringToggleButton.addEventListener("click", async () => {
  monitoringToggleButton.disabled = true;
  try {
    const stored = await browser.storage.local.get(STORAGE_KEYS.settings);
    const existing = stored[STORAGE_KEYS.settings] ?? {};
    const next = normalizeSettingsInput({
      ...existing,
      monitoringPaused: !existing.monitoringPaused
    });
    await browser.storage.local.set({ [STORAGE_KEYS.settings]: next });
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    monitoringToggleButton.disabled = false;
  }
});

let renderTimer = null;
browser.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    void renderPopup();
  }, POPUP_RENDER_DEBOUNCE_MS);
});

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  // Any click that isn't on one of the two-step prompts (Closed → Archive?,
  // count → Clear?) cancels them and reverts the UI to its resting state.
  const promptElement = event.target.closest(
    "[data-action='prompt-archive'], [data-action='confirm-archive'], #history-count"
  );
  if (
    !promptElement &&
    (pendingArchivePrompts.size > 0 || pendingHistoryClear)
  ) {
    pendingArchivePrompts.clear();
    pendingHistoryClear = false;
    void renderPopup();
  }

  const retryButton = event.target.closest("[data-action='retry']");
  if (retryButton) {
    event.preventDefault();
    void handleRetry(retryButton.dataset.itemId);
    return;
  }

  const closeButton = event.target.closest("[data-action='mark-closed']");
  if (closeButton) {
    event.preventDefault();
    void handleMarkClosed(closeButton.dataset.itemId);
    return;
  }

  const linkElement = event.target.closest("[data-action='open-url']");
  if (linkElement) {
    event.preventDefault();
    void openUrl(linkElement.dataset.url);
    return;
  }

  const promptArchiveBadge = event.target.closest("[data-action='prompt-archive']");
  if (promptArchiveBadge) {
    event.preventDefault();
    pendingArchivePrompts.add(promptArchiveBadge.dataset.itemId);
    void renderPopup();
    return;
  }

  const confirmArchiveBadge = event.target.closest("[data-action='confirm-archive']");
  if (confirmArchiveBadge) {
    event.preventDefault();
    void handleConfirmArchive(confirmArchiveBadge.dataset.itemId);
    return;
  }

  const openInKarakeepBadge = event.target.closest("[data-action='open-in-karakeep']");
  if (openInKarakeepBadge) {
    event.preventDefault();
    void handleOpenInKarakeep(openInKarakeepBadge.dataset.bookmarkId);
    return;
  }

  const favouriteButton = event.target.closest("[data-action='toggle-favourite']");
  if (favouriteButton) {
    event.preventDefault();
    void handleToggleFavourite(favouriteButton);
    return;
  }

  const dismissButton = event.target.closest("[data-action='dismiss-manual-review']");
  if (dismissButton) {
    event.preventDefault();
    void handleDismissManualReview(dismissButton.dataset.itemId);
    return;
  }

  const filterPill = event.target.closest("[data-history-filter]");
  if (filterPill) {
    event.preventDefault();
    if (currentHistoryFilter !== filterPill.dataset.historyFilter) {
      pendingHistoryClear = false;
    }
    currentHistoryFilter = filterPill.dataset.historyFilter;
    void renderPopup();
    return;
  }

  const historyCount = event.target.closest("#history-count");
  if (historyCount) {
    event.preventDefault();
    if (!pendingHistoryClear) {
      pendingHistoryClear = true;
      void renderPopup();
    } else {
      pendingHistoryClear = false;
      void handleClearHistory(currentHistoryFilter);
    }
  }
});

let activeTooltipTrigger = null;
let tooltipTimer = null;
let tooltipElement = null;

document.addEventListener("mouseover", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }
  const trigger = event.target.closest("[data-tooltip]");
  if (trigger === activeTooltipTrigger) {
    return;
  }

  activeTooltipTrigger = trigger;
  window.clearTimeout(tooltipTimer);
  hideTooltip();

  if (!trigger) {
    return;
  }

  const text = trigger.dataset.tooltip;
  if (!text) {
    return;
  }

  // For elements styled with text truncation (nowrap + overflow:hidden),
  // only surface the tooltip if the text is actually clipped. Other
  // tooltips (status badges with instructional text) always show.
  if (hasTruncationStyling(trigger) && !isTextTruncated(trigger)) {
    return;
  }

  tooltipTimer = window.setTimeout(() => {
    if (activeTooltipTrigger === trigger) {
      showTooltip(text, trigger);
    }
  }, TOOLTIP_DELAY_MS);
});

function hasTruncationStyling(element) {
  const style = window.getComputedStyle(element);
  return style.whiteSpace === "nowrap" && style.overflow === "hidden";
}

function isTextTruncated(element) {
  return element.scrollWidth > element.clientWidth;
}

document.addEventListener("mouseout", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }
  const trigger = event.target.closest("[data-tooltip]");
  if (!trigger || trigger !== activeTooltipTrigger) {
    return;
  }
  const nextTarget = event.relatedTarget;
  if (nextTarget instanceof Node && trigger.contains(nextTarget)) {
    return;
  }
  activeTooltipTrigger = null;
  window.clearTimeout(tooltipTimer);
  hideTooltip();
});

await renderPopup();

async function renderPopup() {
  const state = await browser.storage.local.get(Object.values(STORAGE_KEYS));
  const settings = normalizeSettingsInput(state[STORAGE_KEYS.settings]);
  applyDocumentTheme(settings.theme);
  const isConfigured = Boolean(
    settings.karakeepBaseUrl && settings.karakeepApiKey
  );
  renderMonitoringToggle(settings.monitoringPaused, isConfigured);
  const now = Date.now();
  const processingItems = Array.isArray(state[STORAGE_KEYS.processingItems])
    ? [...state[STORAGE_KEYS.processingItems]].sort(
        (leftItem, rightItem) => rightItem.requestedAt - leftItem.requestedAt
      )
    : [];
  const manualReviewItems = Array.isArray(state[STORAGE_KEYS.manualReviewItems])
    ? [...state[STORAGE_KEYS.manualReviewItems]].sort(
        (leftItem, rightItem) => rightItem.failedAt - leftItem.failedAt
      )
    : [];
  const historyItems = Array.isArray(state[STORAGE_KEYS.historyItems])
    ? state[STORAGE_KEYS.historyItems]
        .map((item) => ({
          ...item,
          expiresAt: getExpiryTimestamp(item.actionAt, settings.historyRetentionHours)
        }))
        .filter((item) => item.expiresAt > now)
        .sort((leftItem, rightItem) => rightItem.actionAt - leftItem.actionAt)
        .slice(0, settings.maxHistoryItems)
    : [];

  const filteredHistoryItems =
    currentHistoryFilter === "all"
      ? historyItems
      : historyItems.filter((item) => item.status === currentHistoryFilter);

  processingCountElement.textContent = String(processingItems.length);
  manualReviewCountElement.textContent = String(manualReviewItems.length);
  if (pendingHistoryClear && filteredHistoryItems.length > 0) {
    historyCountElement.textContent = "Clear?";
    historyCountElement.classList.add("clear-prompt");
  } else {
    if (pendingHistoryClear) {
      // Nothing to clear at the current filter; bail out of the prompt.
      pendingHistoryClear = false;
    }
    historyCountElement.textContent = String(filteredHistoryItems.length);
    historyCountElement.classList.remove("clear-prompt");
  }

  renderProcessing(processingItems, settings.showFavicons);
  renderManualReview(manualReviewItems, settings.showFavicons);
  renderHistory(filteredHistoryItems, settings.showFavicons);

  setSectionVisibility(processingListElement, processingItems.length > 0);
  setSectionVisibility(manualReviewListElement, manualReviewItems.length > 0);
  updateFilterPills();

  // Element identities change on re-render; clear any stale tooltip state.
  activeTooltipTrigger = null;
  window.clearTimeout(tooltipTimer);
  hideTooltip();

  updateOverflowState();
}

function renderMonitoringToggle(isPaused, isConfigured) {
  monitoringToggleButton.textContent = isPaused
    ? "Paused"
    : isConfigured
      ? "Monitoring"
      : "Not Configured";
  monitoringToggleButton.classList.toggle("is-paused", Boolean(isPaused));
  monitoringToggleButton.classList.toggle(
    "is-unconfigured",
    !isPaused && !isConfigured
  );
  monitoringToggleButton.setAttribute("aria-pressed", isPaused ? "true" : "false");
  let tooltip;
  if (isPaused) {
    tooltip = "Tab closures aren't being logged. Click to resume.";
  } else if (!isConfigured) {
    tooltip =
      "Karakeep isn't set up yet. Tab closures are still being logged. Click to pause.";
  } else {
    tooltip = "Tab closures are being logged. Click to pause.";
  }
  monitoringToggleButton.dataset.tooltip = tooltip;
  monitoringToggleButton.setAttribute("aria-label", tooltip);
}

function setSectionVisibility(listElement, isVisible) {
  const section = listElement.closest(".section");
  if (section) {
    section.classList.toggle("section-empty", !isVisible);
  }
}

function updateFilterPills() {
  document.querySelectorAll("[data-history-filter]").forEach((pill) => {
    pill.classList.toggle(
      "active",
      pill.dataset.historyFilter === currentHistoryFilter
    );
  });
}

function updateOverflowState() {
  // Toggle a class so CSS can switch between a plain 15px right padding
  // (no overflow) and a scrollbar-gutter layout (with overflow). This
  // gives a consistent ~15px right margin on macOS overlay scrollbars,
  // macOS persistent scrollbars, and Windows alike — independent of
  // each platform's idiosyncratic gutter sizing.
  requestAnimationFrame(() => {
    const root = document.documentElement;
    const hasOverflow = root.scrollHeight > root.clientHeight;
    root.classList.toggle("has-overflow", hasOverflow);
  });
}

function renderProcessing(items, showFavicons) {
  if (items.length === 0) {
    processingListElement.innerHTML =
      '<div class="empty-state">No items are being archived.</div>';
    return;
  }

  processingListElement.innerHTML = items
    .map(
      (item) => `
        <article class="item-row">
          <div class="row-main">
            ${renderFavicon(item.favIconUrl, item.title, showFavicons)}
            <div class="row-body">
              <div class="title" data-tooltip="${escapeAttribute(item.title)}">${escapeHtml(item.title)}</div>
              ${renderUrlLink(item.url)}
              <div class="row-meta">
                <span>${formatTimestamp(item.requestedAt)}</span>
                <span class="spinner" aria-hidden="true"></span>
                <span>Archiving...</span>
              </div>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderManualReview(items, showFavicons) {
  if (items.length === 0) {
    manualReviewListElement.innerHTML =
      '<div class="empty-state">Nothing needs manual review.</div>';
    return;
  }

  manualReviewListElement.innerHTML = items
    .map(
      (item) => `
        <article class="item-row">
          <div class="row-main">
            ${renderFavicon(item.favIconUrl, item.title, showFavicons)}
            <div class="row-body">
              <div class="title" data-tooltip="${escapeAttribute(item.title)}">${escapeHtml(item.title)}</div>
              ${renderUrlLink(item.url)}
              <div class="row-meta">
                <span>${formatTimestamp(item.failedAt)}</span>
                <span class="error-text">${escapeHtml(item.lastError)}</span>
              </div>
              ${renderManualReviewActions(item)}
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderManualReviewActions(item) {
  if (item.failedAction === MANUAL_REVIEW_ACTIONS.favouriteToggle) {
    return `
      <div class="row-actions">
        <button type="button" data-action="retry" data-item-id="${item.id}">
          Retry favourite
        </button>
        <button type="button" data-action="dismiss-manual-review" data-item-id="${item.id}">
          Dismiss
        </button>
      </div>
    `;
  }
  return `
    <div class="row-actions">
      <button type="button" data-action="retry" data-item-id="${item.id}">
        Retry archive
      </button>
      <button type="button" data-action="mark-closed" data-item-id="${item.id}">
        Mark closed
      </button>
    </div>
  `;
}

function renderHistory(items, showFavicons) {
  if (items.length === 0) {
    const message =
      currentHistoryFilter === "all"
        ? "No resolved tab actions yet."
        : `No ${getStatusLabel(currentHistoryFilter).toLowerCase()} items in history.`;
    historyListElement.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
    return;
  }

  historyListElement.innerHTML = items
    .map(
      (item) => `
        <article class="item-row">
          <div class="row-main">
            ${renderFavicon(item.favIconUrl, item.title, showFavicons)}
            <div class="row-body">
              <div class="title" data-tooltip="${escapeAttribute(item.title)}">${escapeHtml(item.title)}</div>
              ${renderUrlLink(item.url)}
              <div class="row-meta">
                ${renderHistoryBadge(item)}
                <span>${formatTimestamp(item.actionAt)}</span>
                ${renderFavouriteButton(item)}
              </div>
            </div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderFavouriteButton(item) {
  if (
    !(
      item.status === HISTORY_STATUS.archived ||
      item.status === HISTORY_STATUS.skipped
    ) ||
    !item.bookmarkId
  ) {
    return "";
  }
  const isFavourited = Boolean(item.favourited);
  const nextState = isFavourited ? "false" : "true";
  const label = isFavourited ? "Remove from favourites" : "Add to favourites";
  return `
    <button
      type="button"
      class="favourite-button${isFavourited ? " is-favourited" : ""}"
      data-action="toggle-favourite"
      data-item-id="${escapeAttribute(item.id)}"
      data-bookmark-id="${escapeAttribute(item.bookmarkId)}"
      data-favourited="${isFavourited ? "true" : "false"}"
      data-desired-state="${nextState}"
      aria-pressed="${isFavourited ? "true" : "false"}"
      aria-label="${label}"
      data-tooltip="${label}"
    >${isFavourited ? STAR_SOLID_SVG : STAR_OUTLINE_SVG}</button>
  `;
}

function renderHistoryBadge(item) {
  if (
    (item.status === HISTORY_STATUS.archived ||
      item.status === HISTORY_STATUS.skipped) &&
    item.bookmarkId
  ) {
    return `<span class="status-badge ${item.status}" data-action="open-in-karakeep" data-bookmark-id="${escapeAttribute(item.bookmarkId)}" data-tooltip="Open in Karakeep">${getStatusLabel(item.status)}</span>`;
  }
  if (item.status === HISTORY_STATUS.closed && pendingArchivePrompts.has(item.id)) {
    return `<span class="status-badge archive-prompt" data-action="confirm-archive" data-item-id="${item.id}" data-tooltip="Send archive request to Karakeep">Archive?</span>`;
  }
  if (item.status === HISTORY_STATUS.closed) {
    return `<span class="status-badge closed" data-action="prompt-archive" data-item-id="${item.id}" data-tooltip="Archive this closed entry">Closed</span>`;
  }
  return `<span class="status-badge ${item.status}">${getStatusLabel(item.status)}</span>`;
}

async function handleRetry(itemId) {
  try {
    await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.retryManualReview,
      itemId
    });
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function handleMarkClosed(itemId) {
  try {
    await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.markManualReviewClosed,
      itemId
    });
    showStatus("Item marked as closed.");
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function handleConfirmArchive(itemId) {
  pendingArchivePrompts.delete(itemId);
  try {
    const result = await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.archiveClosedHistoryItem,
      itemId
    });
    if (result && result.ok === false && result.message) {
      showStatus(result.message, true);
    }
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function handleToggleFavourite(button) {
  const itemId = button.dataset.itemId;
  const bookmarkId = button.dataset.bookmarkId;
  const desiredFavouritedState = button.dataset.desiredState === "true";
  button.disabled = true;
  try {
    const result = await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.toggleBookmarkFavourite,
      itemId,
      bookmarkId,
      desiredFavouritedState
    });
    if (result && result.ok === false && result.message) {
      showStatus(result.message, true);
    }
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function handleDismissManualReview(itemId) {
  try {
    await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.dismissManualReview,
      itemId
    });
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function handleClearHistory(statusFilter) {
  try {
    await browser.runtime.sendMessage({
      type: MESSAGE_TYPES.clearHistory,
      statusFilter
    });
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function handleOpenInKarakeep(bookmarkId) {
  if (!bookmarkId) {
    return;
  }
  const { [STORAGE_KEYS.settings]: rawSettings } = await browser.storage.local.get(
    STORAGE_KEYS.settings
  );
  const settings = normalizeSettingsInput(rawSettings);
  if (!settings.karakeepBaseUrl) {
    showStatus("Karakeep base URL is not configured.", true);
    return;
  }
  const url = `${settings.karakeepBaseUrl}${KARAKEEP_BOOKMARK_PREVIEW_PATH.replace(
    "{id}",
    encodeURIComponent(bookmarkId)
  )}`;
  await browser.tabs.create({ url, active: true });
}

async function openUrl(url) {
  if (!url) {
    return;
  }

  await browser.tabs.create({
    url,
    active: true
  });
}

function renderFavicon(favIconUrl, _title, showFavicons) {
  if (!showFavicons || !isSafeFaviconUrl(favIconUrl)) {
    return '<div class="favicon hidden" aria-hidden="true"></div>';
  }

  return `<img class="favicon" src="${escapeAttribute(favIconUrl)}" alt="" referrerpolicy="no-referrer" />`;
}

function isSafeFaviconUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:" ||
      parsed.protocol === "data:"
    );
  } catch {
    return false;
  }
}

function renderUrlLink(url) {
  const displayUrl = getDisplayUrl(url);
  return `
    <a
      class="url-link"
      href="${escapeAttribute(url)}"
      data-action="open-url"
      data-url="${escapeAttribute(url)}"
      data-tooltip="${escapeAttribute(displayUrl)}"
    >
      ${escapeHtml(displayUrl)}
    </a>
  `;
}

function showStatus(message, isError = false) {
  popupStatusElement.hidden = false;
  popupStatusElement.classList.toggle("error", isError);
  popupStatusElement.textContent = message;

  window.clearTimeout(showStatus.timeoutId);
  showStatus.timeoutId = window.setTimeout(() => {
    popupStatusElement.hidden = true;
  }, POPUP_STATUS_DURATION_MS);
}

function showTooltip(text, trigger) {
  if (!tooltipElement) {
    tooltipElement = document.createElement("div");
    tooltipElement.className = "tooltip";
    document.body.appendChild(tooltipElement);
  }
  tooltipElement.textContent = text;
  positionTooltip(trigger);
}

function hideTooltip() {
  if (tooltipElement) {
    tooltipElement.remove();
    tooltipElement = null;
  }
}

function positionTooltip(trigger) {
  if (!tooltipElement) {
    return;
  }
  const triggerRect = trigger.getBoundingClientRect();
  const tooltipRect = tooltipElement.getBoundingClientRect();
  const margin = 4;

  let left = triggerRect.left;
  let top = triggerRect.bottom + margin;

  if (left + tooltipRect.width > window.innerWidth - margin) {
    left = window.innerWidth - tooltipRect.width - margin;
  }
  if (left < margin) {
    left = margin;
  }
  if (top + tooltipRect.height > window.innerHeight - margin) {
    top = triggerRect.top - tooltipRect.height - margin;
  }
  if (top < margin) {
    top = margin;
  }

  tooltipElement.style.left = `${left}px`;
  tooltipElement.style.top = `${top}px`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function getDisplayUrl(url) {
  const rawUrl = String(url ?? "");
  try {
    new URL(rawUrl);
  } catch {
    return rawUrl || "Open link";
  }
  return rawUrl.replace(/^https?:\/\/(www\.)?/, "");
}
