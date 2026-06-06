// Karakeep Quick Archive — list-picker overlay (content script).
// Injected on demand by the background page when the user presses the
// "archive to list" keyboard shortcut. Renders a shadow-DOM modal centred over
// the page (page dimmed 50%) that lets the user pick a Karakeep list — option 1
// is Favourites, options 2–9 are the first eight manual lists, all selectable by
// number key or click. Picking archives the current tab + files it into that
// list, then the background closes the tab. Mirrors the iOS content-script list
// button, restyled as a centred modal with numeric hotkeys.

(() => {
  const HOST_ID = "karakeep-quick-archive-list-picker-host";

  // Pressing the shortcut again while the picker is open toggles it closed.
  if (window.__karakeepListPicker) {
    window.__karakeepListPicker.close();
    return;
  }
  // Fallback: a prior overlay's host lingers but its globals were lost — clear it.
  const stale = document.getElementById(HOST_ID);
  if (stale) {
    stale.remove();
    return;
  }

  const MESSAGE_TYPES = {
    getLists: "getLists",
    archiveCurrentTabToList: "archiveCurrentTabToList"
  };

  // Three-lines-with-dots list glyph, matching the popup / iOS toolbar.
  const SVG_LIST = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="9" y1="6" x2="19" y2="6"/><line x1="9" y1="12" x2="19" y2="12"/><line x1="9" y1="18" x2="19" y2="18"/><circle cx="5" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1.3" fill="currentColor" stroke="none"/></svg>`;

  function sendMessage(message) {
    try {
      return Promise.resolve(browser.runtime.sendMessage(message));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText =
    "all: initial; position: fixed; inset: 0; z-index: 2147483647;";
  (document.body || document.documentElement).appendChild(host);

  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = template();

  const backdrop = root.querySelector('[data-role="backdrop"]');
  const card = root.querySelector('[data-role="card"]');
  const body = root.querySelector('[data-role="body"]');

  /** @type {{kind: 'favourite' | 'list', list: any}[]} */
  let options = [];
  let closed = false;
  let selecting = false;

  function close() {
    if (closed) return;
    closed = true;
    window.removeEventListener("keydown", onKeydown, true);
    host.remove();
    if (window.__karakeepListPicker === controller) {
      delete window.__karakeepListPicker;
    }
  }

  function onKeydown(event) {
    // Self-heal if our host was torn down by another injection.
    if (closed || !host.isConnected) {
      window.removeEventListener("keydown", onKeydown, true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    // Don't hijack browser/page chords (Ctrl/Alt/Cmd + digit).
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key >= "1" && event.key <= "9") {
      const index = Number(event.key) - 1;
      if (index < options.length) {
        event.preventDefault();
        event.stopPropagation();
        select(options[index]);
      }
    }
  }

  function select(option) {
    if (!option || selecting || closed) return;
    selecting = true;
    window.removeEventListener("keydown", onKeydown, true);

    const message =
      option.kind === "favourite"
        ? { type: MESSAGE_TYPES.archiveCurrentTabToList, favourite: true }
        : {
            type: MESSAGE_TYPES.archiveCurrentTabToList,
            listId: option.list.id,
            listName: option.list.name || null
          };
    const destination =
      option.kind === "favourite" ? "Favourites" : option.list.name || "list";

    // Fire-and-forget — the background archives, then closes this tab (which
    // tears down the overlay with the page).
    sendMessage(message).catch(() => {});
    body.replaceChildren(note(`Saving to ${destination}…`));
    // Fallback teardown in case the tab can't be closed (e.g. last tab).
    window.setTimeout(close, 1500);
  }

  // state: { loading } | { error } | { lists }
  function render(state) {
    options = [{ kind: "favourite", list: null }];
    if (Array.isArray(state.lists)) {
      for (const list of state.lists) {
        options.push({ kind: "list", list });
      }
    }

    const rows = options.map((option, index) => buildRow(option, index));
    if (state.loading) {
      rows.push(note("Loading lists…"));
    } else if (state.error) {
      rows.push(note(state.error));
    } else if (!state.lists || state.lists.length === 0) {
      rows.push(note("No lists yet"));
    }
    body.replaceChildren(...rows);
  }

  function buildRow(option, index) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "row";

    const badge = document.createElement("span");
    badge.className = index < 9 ? "badge" : "badge badge-empty";
    badge.textContent = index < 9 ? String(index + 1) : "";

    const icon = document.createElement("span");
    icon.className = "icon";

    const label = document.createElement("span");
    label.className = "label";

    if (option.kind === "favourite") {
      icon.classList.add("star");
      icon.textContent = "★";
      label.textContent = "Favourites";
    } else {
      const emoji =
        option.list.icon && String(option.list.icon).trim()
          ? String(option.list.icon).trim()
          : "";
      if (emoji) {
        icon.textContent = emoji;
      } else {
        icon.innerHTML = SVG_LIST;
      }
      label.textContent = option.list.name || "Untitled";
    }

    row.append(badge, icon, label);
    row.addEventListener("click", () => select(option));
    return row;
  }

  function note(text) {
    const el = document.createElement("div");
    el.className = "note";
    el.textContent = text;
    return el;
  }

  function template() {
    return `
      <style>
        :host { all: initial; }
        .backdrop {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .card {
          width: min(360px, calc(100vw - 32px));
          max-height: min(70vh, 560px);
          display: flex;
          flex-direction: column;
          background: rgba(28, 28, 30, 0.98);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          overflow: hidden;
          padding: 14px;
        }
        .card:focus { outline: none; }
        .title { font-size: 15px; font-weight: 600; padding: 2px 4px 10px; }
        .body {
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .row {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          text-align: left;
          font: inherit;
          font-size: 14px;
          color: inherit;
          background: transparent;
          border: 0;
          border-radius: 10px;
          padding: 10px;
          cursor: pointer;
        }
        .row:hover { background: rgba(255, 255, 255, 0.10); }
        .badge {
          flex: 0 0 auto;
          width: 20px;
          height: 20px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.7);
          background: rgba(255, 255, 255, 0.10);
          border-radius: 6px;
        }
        .badge-empty { background: transparent; }
        .icon {
          flex: 0 0 auto;
          width: 18px;
          height: 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
        .icon svg { width: 16px; height: 16px; display: block; }
        .icon.star { color: #ffcc00; font-size: 15px; }
        .label {
          flex: 1 1 auto;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .note { padding: 10px; font-size: 13px; opacity: 0.7; }
        .hint { padding: 10px 4px 2px; font-size: 11px; opacity: 0.5; }
      </style>
      <div class="backdrop" data-role="backdrop">
        <div class="card" data-role="card" role="dialog" aria-modal="true" aria-label="Add to list" tabindex="-1">
          <div class="title">Add to list</div>
          <div class="body" data-role="body"></div>
          <div class="hint">Press 1–9 or click · Esc to cancel</div>
        </div>
      </div>
    `;
  }

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });

  window.addEventListener("keydown", onKeydown, true);

  const controller = { close };
  window.__karakeepListPicker = controller;

  render({ loading: true });
  try {
    card.focus({ preventScroll: true });
  } catch {
    // focus is best-effort; number keys work via the window listener regardless.
  }

  sendMessage({ type: MESSAGE_TYPES.getLists })
    .then((response) => {
      if (closed || selecting) return;
      if (!response || response.ok === false || !Array.isArray(response.lists)) {
        render({ error: (response && response.message) || "Couldn't load lists" });
        return;
      }
      render({ lists: response.lists });
    })
    .catch(() => {
      if (!closed && !selecting) render({ error: "Couldn't load lists" });
    });
})();
