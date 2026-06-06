export const STORAGE_KEYS = Object.freeze({
  settings: "settings",
  processingItems: "processingItems",
  manualReviewItems: "manualReviewItems",
  historyItems: "historyItems"
});

export const SESSION_STORAGE_KEYS = Object.freeze({
  tabSnapshotPrefix: "tabSnapshot:"
});

export const HISTORY_STATUS = Object.freeze({
  closed: "closed",
  archived: "archived",
  skipped: "skipped"
});

export const ITEM_STATES = Object.freeze({
  processing: "processing",
  failed: "failed"
});

export const ICON_THEMES = Object.freeze({
  system: "system",
  light: "light",
  dark: "dark"
});

export const THEMES = Object.freeze({
  system: "system",
  light: "light",
  dark: "dark"
});

export const ICON_PATHS = Object.freeze({
  light: Object.freeze({
    16: "icons/icon-light-16.png",
    32: "icons/icon-light-32.png"
  }),
  dark: Object.freeze({
    16: "icons/icon-dark-16.png",
    32: "icons/icon-dark-32.png"
  })
});

export const DEFAULT_SETTINGS = Object.freeze({
  karakeepBaseUrl: "",
  karakeepApiKey: "",
  requestTimeoutSeconds: 15,
  historyRetentionHours: 50,
  showFavicons: true,
  maxHistoryItems: 500,
  iconTheme: ICON_THEMES.system,
  theme: THEMES.system,
  debugLogging: false,
  monitoringPaused: false,
  archiveFeedbackIcon: true,
  archiveFeedbackNotification: false
});

export const DEFAULT_STORAGE_STATE = Object.freeze({
  [STORAGE_KEYS.settings]: DEFAULT_SETTINGS,
  [STORAGE_KEYS.processingItems]: [],
  [STORAGE_KEYS.manualReviewItems]: [],
  [STORAGE_KEYS.historyItems]: []
});

export const ALARM_NAMES = Object.freeze({
  pruneHistory: "prune-history"
});

export const CLEANUP_PERIOD_MINUTES = 360;

export const POPUP_STATUS_DURATION_MS = 3000;
export const POPUP_RENDER_DEBOUNCE_MS = 100;
export const TOOLTIP_DELAY_MS = 200;

// How long the green "archived" tick lingers on the toolbar icon.
export const ARCHIVE_FLASH_DURATION_MS = 2000;

// Karakeep web UI path to view a single bookmark by ID. Substitute {id}.
export const KARAKEEP_BOOKMARK_PREVIEW_PATH = "/dashboard/preview/{id}";

export const MESSAGE_TYPES = Object.freeze({
  testConnection: "testConnection",
  retryManualReview: "retryManualReview",
  markManualReviewClosed: "markManualReviewClosed",
  openHistoryItem: "openHistoryItem",
  archiveClosedHistoryItem: "archiveClosedHistoryItem",
  clearHistory: "clearHistory",
  toggleBookmarkFavourite: "toggleBookmarkFavourite",
  dismissManualReview: "dismissManualReview",
  getLists: "getLists",
  archiveCurrentTabToList: "archiveCurrentTabToList",
  fetchListsWithMembership: "fetchListsWithMembership",
  setListMembership: "setListMembership"
});

export const MANUAL_REVIEW_ACTIONS = Object.freeze({
  archive: "archive",
  favouriteToggle: "favourite-toggle",
  listAdd: "list-add"
});

export const COMMAND_NAMES = Object.freeze({
  archiveCurrentTab: "archive-current-tab",
  archiveCurrentTabToList: "archive-current-tab-to-list"
});

export const ELIGIBLE_PROTOCOLS = new Set(["http:", "https:"]);
