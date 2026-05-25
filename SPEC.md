# Firefox extension spec: close normally, archive instantly to Karakeep

## 1. Summary

Build a Firefox extension that supports two fast actions for the current tab:

- **Close** using normal browser behaviour, such as `Ctrl+W`
- **Archive** using an extension shortcut, which captures the current tab details, adds the item to a processing queue, and then immediately closes the tab without waiting for Karakeep to respond

The extension also keeps a compact UI with:

- **Processing**
- **Manual Review**
- **History**

There is **no Pending section** in v1.

---

## 2. Product goals

### Primary goal
Make “archive this tab” as quick and frictionless as “close this tab”.

### UX goals
- archive shortcut should feel almost instant
- normal close should remain untouched
- compact UI
- small-ish fonts
- low whitespace
- simple settings
- useful history and failure recovery

### Technical goals
- Firefox-first
- simple v1
- queue-based async archive processing
- no blocking dialogs
- no tab restore tricks
- no pre-check dedupe API call

---

## 3. Non-goals for v1

Do not build these in v1:

- pre-close interception or confirmation dialogs
- Pending queue
- restore closed tabs automatically
- full-page capture / SingleFile
- Chrome support
- private-window support
- tags/lists/notes sent to Karakeep
- sync across devices
- advanced dedupe logic before sending to Karakeep

---

## 4. Core workflow

### 4.1 Normal close
When the user closes a tab normally, for example with `Ctrl+W` or the tab close button:

- Firefox closes the tab normally
- the extension observes the close afterward
- the extension records the event in **History** with status **Closed**

### 4.2 Archive shortcut
When the user triggers the archive shortcut on the current tab:

1. capture the current tab metadata
   - URL
   - title
   - favicon if available
   - timestamp
2. create a **Processing** item immediately
3. start the Karakeep request asynchronously
4. close the tab immediately using the extension
5. do not wait for Karakeep before closing the tab

### Important behaviour
The archive action must feel like a close action, not a modal workflow.

The user should be able to archive repeatedly without stopping to watch the queue.

### 4.3 Whole-window close
If a tab is closed because the entire browser window is closing:

- do not record it in history
- do not treat it as an archive failure
- ignore it

---

## 5. Status model

These are the statuses shown in the UI and stored in history.

### Closed
The tab was closed normally by the user and was not archived.

### Archived
An archive request was sent and Karakeep created a new bookmark successfully.

### Skipped
An archive request was sent and Karakeep returned the existing bookmark because the URL already exists.

### Failed
The archive request did not succeed and the item is moved to **Manual Review**.

Examples:
- connection error
- timeout
- invalid API key
- permission failure
- invalid response
- 4xx or 5xx from Karakeep

---

## 6. High-level UX

### 6.1 User mental model
- `Ctrl+W` = close tab
- `Ctrl+Alt+W` = archive tab and close it

The user does not need to think about queues while browsing.

The extension UI is there for:
- checking progress
- retrying failures
- reviewing history

### 6.2 UI sections
The compact UI contains only these sections:

1. **Processing**
2. **Manual Review**
3. **History**

There is no Pending section.

### 6.3 Compact layout rules
- use small text, around 12–13px
- tight row spacing
- low padding
- favicon if available
- title on first line
- URL on second line
- compact buttons
- subtle status badges
- no oversized cards or lots of whitespace

---

## 7. Keyboard shortcuts

### 7.1 Native close
Do not override or interfere with native close.

Normal browser shortcuts such as `Ctrl+W` should continue working as usual.

### 7.2 Archive shortcut
Create an extension command for archive.

Requested default:
- **Windows/Linux:** `Ctrl+Alt+W`
- **macOS:** `Command+Alt+W`

### 7.3 Optional second shortcut
Optional but useful for v1:

- `Alt+Shift+K` or similar to open the extension UI

This is not required if the toolbar button is enough.

---

## 8. UI entry point

### 8.1 Main entry
Use the extension toolbar button to open the compact UI.

The toolbar UI should show:
- Processing
- Manual Review
- History

### 8.2 No auto-open
Do **not** automatically open the UI on every close or archive.

Reason:
- user wants speed
- user does not want interruption
- archive should feel like close

### 8.3 Optional badge
Nice to include in v1 if easy:
- badge count for failed manual-review items
- or count for active processing items

Not a blocker.

---

## 9. Section behaviour

### 9.1 Processing
Shows items currently being archived.

Each row shows:
- favicon if available
- title
- URL
- time archive was requested
- spinner
- status text such as `Archiving...`

No row actions needed in v1.

If a request succeeds:
- remove row from Processing
- append to History as **Archived** or **Skipped**

If a request fails:
- remove row from Processing
- move to Manual Review as **Failed**

### 9.2 Manual Review
Shows archive attempts that failed.

Each row shows:
- favicon if available
- title
- URL
- failed timestamp
- concise error message
- `Retry archive` button
- `Mark closed` button

### Retry archive
- moves item back to Processing
- sends the same archive request again

### Mark closed
- removes item from Manual Review
- adds it to History as **Closed**

This wording is better than “Discard” because the tab is already closed at this point.

### 9.3 History
Shows resolved items only.

History includes:
- items closed normally
- items archived successfully
- items skipped because the URL already existed
- items manually resolved as Closed from Manual Review

Each row shows:
- favicon if available
- title
- URL
- status badge: `Closed`, `Archived`, or `Skipped`
- timestamp
- click action to reopen in a background tab

---

## 10. History rules

### 10.1 Retention period
History retention is configurable.

### Default
- **7 days**

### Settings
- retention value stored as a number of days
- user-editable in extension settings

### 10.2 No local dedupe
Do **not** dedupe history locally.

If a user closes three Google tabs and archives two Google tabs, history may show five entries.

That is acceptable and desired.

### 10.3 Archive result mapping
When archive is sent to Karakeep:

- `201` → History status = **Archived**
- `200` → History status = **Skipped**

### 10.4 Cleanup
Use:
- a scheduled cleanup with `alarms`
- and a prune-on-start pass

---

## 11. Settings / configuration

Provide a simple Options page.

### 11.1 Required fields
- **Karakeep Base URL**
- **Karakeep API Key**

### 11.2 Optional fields
- **Request timeout (seconds)**  
  default: `15`
- **History retention (days)**  
  default: `7`
- **Show favicon in UI**  
  default: `true`
- **Max history items to render in UI**  
  default: `500` or similar
- **Debug logging**  
  default: `false`

### 11.3 Save rules
On save:
- trim whitespace
- normalize Karakeep URL by removing trailing slash
- require `http` or `https`
- mask API key by default in the UI
- store values in `storage.local`

### 11.4 Host permission request
Because the Karakeep host is user-defined, use Manifest V3 `optional_host_permissions` and request the configured host at runtime.

### 11.5 Test connection button
Include a `Test connection` button.

On click:
1. request host permission for the Karakeep origin if needed
2. make a lightweight authenticated request
3. show success or error

For v1, a simple authenticated endpoint check is enough.

---

## 12. Permissions

Use these extension permissions:

- `tabs`
- `storage`
- `alarms`

Use `optional_host_permissions` for the configured Karakeep origin.

Reasoning:
- `tabs` is needed for access to tab URL, title, and favicon
- `storage` is needed for settings, queues, and history
- `alarms` is needed for retention cleanup
- runtime host permission is needed for user-configured Karakeep access

---

## 13. Data capture model

### 13.1 Live tab snapshot cache
Maintain an in-memory plus persisted cache of open-tab metadata keyed by tab id.

Snapshot fields:
- tab id
- window id
- URL
- title
- favicon URL
- active state
- last seen timestamp

Reason:
`tabs.onRemoved` tells you that a tab was closed, but not the full tab payload, so the extension should cache the useful details before closure.

### 13.2 Snapshot update events
Update the snapshot cache from:
- `tabs.onCreated`
- `tabs.onUpdated`
- `tabs.onActivated`
- startup query of currently open tabs

### 13.3 Eligible URLs
Only process `http:` and `https:` URLs in v1.

Ignore:
- `about:`
- `moz-extension:`
- `file:`
- other privileged/internal URLs

---

## 14. Archive processing model

### 14.1 On archive shortcut
When the archive command fires for the active tab:

1. read current tab metadata
2. validate eligible URL
3. create a Processing item
4. persist it immediately
5. kick off async Karakeep request
6. close the tab immediately with `tabs.remove(tabId)`

### 14.2 Request details
Send:

```http
POST {baseUrl}/api/v1/bookmarks
Authorization: Bearer <api-key>
```

### 14.3 Request body
For v1, send the smallest valid body needed to create a link bookmark.

The key behavioural requirement is that the request creates a link bookmark for the tab URL.

### 14.4 Result handling
Map outcomes like this:

- `201` → remove from Processing, add to History as **Archived**
- `200` → remove from Processing, add to History as **Skipped**
- any failure → remove from Processing, add to Manual Review as **Failed**

### 14.5 No pre-check
Do **not** call Karakeep’s `check-url` endpoint before archiving in v1.

Reason:
- extra network round trip
- slower archive action
- unnecessary because `POST /bookmarks` already tells us whether the URL was new or already existed

---

## 15. Handling normal closes vs archive closes

### 15.1 No dedupe requirement
Do not try to collapse multiple similar URLs into one history item.

Every user action can generate its own history entry.

### 15.2 Avoid false “Closed” entry for archive shortcut
When the extension archives the current tab and then closes it programmatically, do **not** also add a separate `Closed` history item for that same action.

Implementation detail:
- mark archive-initiated closes in a short-lived in-memory map keyed by tab id
- when `tabs.onRemoved` fires for that tab id, skip creating the ordinary `Closed` history record

This is not dedupe across URLs. It is only avoiding double-counting a single archive action.

---

## 16. Manual review error messages

Keep them short and readable.

Suggested messages:
- `Could not reach Karakeep`
- `Timed out contacting Karakeep`
- `API key was rejected`
- `Permission to access the Karakeep host was not granted`
- `Karakeep returned an invalid response`
- `Karakeep returned an error`

Do not show raw stack traces in the main UI.

---

## 17. Suggested data model

```ts
type HistoryStatus = "closed" | "archived" | "skipped";

type ProcessingItem = {
  id: string;
  url: string;
  title: string;
  favIconUrl?: string | null;
  requestedAt: number;
  sourceWindowId: number;
  state: "processing";
  attemptCount: number;
};

type ManualReviewItem = {
  id: string;
  url: string;
  title: string;
  favIconUrl?: string | null;
  requestedAt: number;
  failedAt: number;
  sourceWindowId: number;
  state: "failed";
  attemptCount: number;
  lastError: string;
};

type HistoryItem = {
  id: string;
  url: string;
  title: string;
  favIconUrl?: string | null;
  sourceWindowId: number;
  actionAt: number;
  status: HistoryStatus;
  expiresAt: number;
};

type Settings = {
  karakeepBaseUrl: string;
  karakeepApiKey: string;
  requestTimeoutSeconds: number;
  historyRetentionDays: number;
  showFavicons: boolean;
  debugLogging: boolean;
};
```

---

## 18. Suggested file structure

```text
/manifest.json
/background/
  controller.js
  archive-queue.js
  history-store.js
  tab-snapshot-cache.js
  karakeep-client.js
  cleanup.js
/options/
  options.html
  options.css
  options.js
/popup/
  popup.html
  popup.css
  popup.js
/shared/
  constants.js
  utils.js
  types.js
/icons/
  icon-16.png
  icon-32.png
  icon-48.png
  icon-128.png
```

---

## 19. Acceptance criteria

The extension is complete when all of these work:

### Setup
- user can enter Karakeep URL and API key
- extension can request runtime host permission for that origin
- connection test shows success or failure

### Normal close
- closing a normal tab adds a `Closed` entry to History
- closing a whole window does not add entries

### Archive shortcut
- pressing archive shortcut on the current tab immediately adds a Processing item
- the tab closes immediately
- the UI does not block while waiting
- on `201`, item lands in History as `Archived`
- on `200`, item lands in History as `Skipped`
- on failure, item lands in Manual Review

### Manual review
- retry archive works
- mark closed works

### History
- history shows `Closed`, `Archived`, and `Skipped`
- clicking a history item opens it in a background tab
- history is retained for the configured number of days
- expired history is pruned on schedule and on startup

### Visual
- compact
- small-ish text
- little whitespace
- favicon shown when available

---

## 20. Build notes for Codex

Codex should assume:

- Firefox-first
- Manifest V3
- no pre-close interception
- no Pending queue
- no auto-opening popup on every action
- no pre-check call to Karakeep
- archive requests are async fire-and-close
- `200` from Karakeep maps to `Skipped`
- `201` maps to `Archived`
- normal close maps to `Closed`
- failed archive attempts live in Manual Review until resolved
