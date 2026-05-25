/**
 * @typedef {"closed" | "archived" | "skipped"} HistoryStatus
 *
 * @typedef {Object} ProcessingItem
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string | null | undefined} favIconUrl
 * @property {number} requestedAt
 * @property {number} sourceWindowId
 * @property {"processing"} state
 * @property {number} attemptCount
 *
 * @typedef {Object} ManualReviewItem
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string | null | undefined} favIconUrl
 * @property {number} requestedAt
 * @property {number} failedAt
 * @property {number} sourceWindowId
 * @property {"failed"} state
 * @property {number} attemptCount
 * @property {string} lastError
 *
 * @typedef {Object} HistoryItem
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string | null | undefined} favIconUrl
 * @property {number} sourceWindowId
 * @property {number} actionAt
 * @property {HistoryStatus} status
 * @property {number} expiresAt
 *
 * @typedef {Object} Settings
 * @property {string} karakeepBaseUrl
 * @property {string} karakeepApiKey
 * @property {number} requestTimeoutSeconds
 * @property {number} historyRetentionHours
 * @property {boolean} showFavicons
 * @property {number} maxHistoryItems
 * @property {boolean} debugLogging
 * @property {boolean} monitoringPaused
 */

export {};
