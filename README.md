# Karakeep Quick Archive

A Firefox extension that archives the current tab to a self-hosted
[Karakeep](https://karakeep.app/) instance with a single keystroke, then
closes the tab. Designed to make "archive this tab" feel as cheap as
"close this tab".

## Features

- **One-shortcut archive**: press `Ctrl+Cmd+W` (macOS) or `Ctrl+Alt+W`
  (Windows/Linux) to send the current tab to Karakeep and close it
  immediately — no waiting on the network.
- **Archive into a list**: press `Ctrl+Cmd+E` (macOS) or `Ctrl+Alt+E`
  (Windows/Linux) to open a list picker over the current page (the page
  dims behind it). Pick **Favourites** or any manual Karakeep list by
  pressing `1`–`9` or clicking; the tab is archived into that list and
  closed. `Esc` or a click outside cancels.
- **Compact popup** with three sections that hide themselves when empty:
  - **Processing** — archive requests still in flight.
  - **Manual Review** — failed archive, favourite-toggle, or list-add
    attempts, with Retry / Mark closed / Dismiss controls.
  - **History** — recently closed, archived, and skipped tabs, filterable
    by All / Closed / Archived / Skipped.
- **Two-click promotions**: clicking the `Closed` badge on a history row
  flips it to `Archive?`; a second click sends the archive request.
  Clicking the history count flips it to `Clear?`; a second click clears
  the entries matching the active filter. Clicking elsewhere reverts.
- **Open in Karakeep**: archived and skipped history rows link directly
  to their bookmark in the Karakeep web UI.
- **Favourite & list controls**: each archived/skipped history row has a
  star button that toggles the bookmark's favourited state, and a list
  button that opens an inline picker to add or remove the bookmark from
  any manual Karakeep list (current membership is pre-checked). Favourite
  state syncs across every history row that references the same bookmark.

## Screenshot

![Screenshot](screenshot.png)

## Install

https://github.com/Zeromusta/karakeep-quick-archive-firefox/releases

## Configure

1. Click the Karakeep toolbar icon → **Settings**.
2. Enter your **Karakeep Base URL** (e.g. `https://karakeep.example.com`)
   and **API Key**. Generate an API key from your Karakeep account
   settings.
3. Click **Test connection**. Firefox will prompt for permission to
   access your Karakeep host the first time — grant it. A successful
   ping reports "Connection succeeded."
4. Click **Save settings**.

Other settings:

- **Request timeout (seconds)** — how long to wait on a Karakeep request
  before giving up. Default 15.
- **History retention (hours)** — how long resolved entries (Closed /
  Archived / Skipped) stay in the popup before being pruned. Default 50.
- **Max history items to render** — caps how many entries the popup
  shows even if more are retained. Default 500.
- **Show favicon in UI** — toggle favicons in row rendering.
- **Debug logging** — surface internal logs in the background page
  console (visible via `about:debugging` → Inspect on Karakeep Quick
  Archive).
- **Clear all history** — danger button at the bottom of the settings
  page wipes every history entry. Requires confirmation.

## Develop

```bash
npm test       # run the Node-based test suite (no install required)
```

Tests use Node's built-in `node:test` runner and live under `tests/`.
A `tests/helpers/browser-mock.js` stub provides the `browser.*` APIs
that the background and shared modules expect. No browser is launched.

Manual testing in a real Firefox happens via the temporary-load flow
above. Re-clicking **Reload** in `about:debugging` picks up file
changes without restarting Firefox.

## Architecture

```
manifest.json              # MV3 manifest; declares permissions, action,
                           # commands (Ctrl+Alt+W archive, Ctrl+Alt+E
                           # archive-to-list), icons.
background/
  controller.js            # Listener registration, message routing,
                           # archive commands, idempotent init.
  archive-queue.js         # In-flight job tracking; resumes on startup.
                           # Runs the optional post-archive list/favourite
                           # step and queues retries on failure.
  history-store.js         # Single source of truth for storage.local;
                           # serializes all writes behind a promise lock.
  karakeep-client.js       # POST /api/v1/bookmarks (archive), PATCH
                           # /api/v1/bookmarks/{id} (favourite), GET
                           # /api/v1/lists, and list membership PUT/DELETE.
  list-service.js          # Fetch lists + membership; add/remove a
                           # bookmark from a list (used by popup + overlay).
  tab-snapshot-cache.js    # In-memory map of currently open tabs,
                           # rehydrated from storage.session on wake.
  cleanup.js               # Alarm-driven history pruning.
content/
  list-picker.js           # On-demand shadow-DOM overlay for the
                           # archive-to-list shortcut (numeric hotkeys).
popup/                     # Toolbar popup UI.
options/                   # Settings page.
shared/                    # Constants, utilities, JSDoc type defs.
tests/                     # Node-based tests + mock helpers.
icons/                     # PNG icons (light + dark theme variants).
```

## Releasing

Packaging, AMO signing, and the tag-driven GitHub Actions workflow
that publishes signed `.xpi`s plus an auto-update feed are documented
in [RELEASING.md](RELEASING.md).

## Credits

- Star, list, and check icons from [Font Awesome Free 6](https://fontawesome.com/),
  licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Built around the [Karakeep](https://karakeep.app/) self-hosted
  bookmarking API.
- My mate [Claude](https://claude.ai) who never groans when I ask him to change the padding.
