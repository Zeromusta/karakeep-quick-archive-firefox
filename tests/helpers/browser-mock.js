export function createBrowserMock(options = {}) {
  const localState = structuredClone(options.initialStorage ?? {});
  const sessionState = structuredClone(options.initialSessionStorage ?? {});
  const grantedOrigins = new Set(options.grantedOrigins ?? []);
  const permissionRequestResults = Array.isArray(options.permissionRequestResults)
    ? [...options.permissionRequestResults]
    : [];
  const alarms = new Map();
  const tabs = new Map(
    (options.tabs ?? []).map((tab) => [tab.id, structuredClone(tab)])
  );
  const currentWindowId = options.currentWindowId ?? 1;
  const nextTabId = {
    value:
      options.nextTabId ??
      (tabs.size > 0 ? Math.max(...tabs.keys()) + 1 : 1)
  };

  const onChanged = createEvent();
  const browser = {
    __mock: {
      alarms,
      grantedOrigins,
      localState,
      sessionState,
      removedTabIds: [],
      createdTabs: [],
      permissionsContainsCalls: [],
      permissionsRequestCalls: [],
      async emitStorageChange(changes) {
        await onChanged.emit(changes, "local");
      }
    },
    storage: {
      onChanged,
      local: createStorageArea(localState, "local", onChanged),
      session: createStorageArea(sessionState, "session", onChanged)
    },
    permissions: {
      async contains(details) {
        browser.__mock.permissionsContainsCalls.push(details);
        return details.origins.every((origin) => grantedOrigins.has(origin));
      },
      async request(details) {
        browser.__mock.permissionsRequestCalls.push(details);
        const result =
          permissionRequestResults.length > 0
            ? Boolean(permissionRequestResults.shift())
            : true;

        if (result) {
          for (const origin of details.origins) {
            grantedOrigins.add(origin);
          }
        }

        return result;
      }
    },
    alarms: {
      onAlarm: createEvent(),
      async create(name, info) {
        alarms.set(name, cloneValue(info));
      }
    },
    runtime: {
      onInstalled: createEvent(),
      onStartup: createEvent(),
      onMessage: createEvent(),
      async openOptionsPage() {
        browser.__mock.openOptionsPageCalls =
          (browser.__mock.openOptionsPageCalls ?? 0) + 1;
      },
      async sendMessage(message) {
        const results = await browser.runtime.onMessage.emit(message, {
          id: "test-sender"
        });

        for (let index = results.length - 1; index >= 0; index -= 1) {
          if (results[index] !== undefined) {
            return results[index];
          }
        }

        return undefined;
      }
    },
    commands: {
      onCommand: createEvent()
    },
    tabs: {
      onCreated: createEvent(),
      onUpdated: createEvent(),
      onActivated: createEvent(),
      onRemoved: createEvent(),
      async query(queryInfo = {}) {
        return [...tabs.values()]
          .filter((tab) => {
            if (queryInfo.active === true && !tab.active) {
              return false;
            }

            if (queryInfo.currentWindow === true && tab.windowId !== currentWindowId) {
              return false;
            }

            return true;
          })
          .map((tab) => cloneValue(tab));
      },
      async get(tabId) {
        if (!tabs.has(tabId)) {
          throw new Error(`Tab ${tabId} was not found`);
        }

        return cloneValue(tabs.get(tabId));
      },
      async remove(tabId) {
        const tab = tabs.get(tabId);
        if (!tab) {
          throw new Error(`Tab ${tabId} was not found`);
        }

        tabs.delete(tabId);
        browser.__mock.removedTabIds.push(tabId);
        await browser.tabs.onRemoved.emit(tabId, {
          windowId: tab.windowId,
          isWindowClosing: false
        });
      },
      async create(createProperties) {
        const newTab = {
          id: nextTabId.value,
          windowId: currentWindowId,
          active: false,
          title: createProperties.url,
          url: createProperties.url,
          favIconUrl: null,
          ...createProperties
        };

        nextTabId.value += 1;
        tabs.set(newTab.id, cloneValue(newTab));
        browser.__mock.createdTabs.push(cloneValue(newTab));
        await browser.tabs.onCreated.emit(cloneValue(newTab));
        return cloneValue(newTab);
      }
    }
  };

  return browser;
}

function createStorageArea(state, areaName, onChanged) {
  return {
    async get(keys) {
      return getStorageValues(state, keys);
    },
    async set(values) {
      const changes = {};

      for (const [key, value] of Object.entries(values)) {
        const oldValue = cloneValue(state[key]);
        const newValue = cloneValue(value);
        if (areValuesEqual(oldValue, newValue)) {
          continue;
        }

        state[key] = newValue;
        changes[key] = { oldValue, newValue };
      }

      if (Object.keys(changes).length > 0) {
        await onChanged.emit(changes, areaName);
      }
    },
    async remove(keys) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const changes = {};

      for (const key of keyList) {
        if (!(key in state)) {
          continue;
        }

        changes[key] = {
          oldValue: cloneValue(state[key]),
          newValue: undefined
        };
        delete state[key];
      }

      if (Object.keys(changes).length > 0) {
        await onChanged.emit(changes, areaName);
      }
    },
    async clear() {
      const changes = {};

      for (const [key, value] of Object.entries(state)) {
        changes[key] = {
          oldValue: cloneValue(value),
          newValue: undefined
        };
      }

      for (const key of Object.keys(state)) {
        delete state[key];
      }

      if (Object.keys(changes).length > 0) {
        await onChanged.emit(changes, areaName);
      }
    }
  };
}

function createEvent() {
  const listeners = new Set();

  return {
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
    hasListener(listener) {
      return listeners.has(listener);
    },
    async emit(...args) {
      const results = [];

      for (const listener of [...listeners]) {
        results.push(await listener(...args));
      }

      return results;
    },
    dispatch(...args) {
      return [...listeners].map((listener) => listener(...args));
    }
  };
}

function getStorageValues(state, keys) {
  if (keys === undefined || keys === null) {
    return cloneValue(state);
  }

  if (typeof keys === "string") {
    return {
      [keys]: cloneValue(state[keys])
    };
  }

  if (Array.isArray(keys)) {
    return keys.reduce((result, key) => {
      if (key in state) {
        result[key] = cloneValue(state[key]);
      }
      return result;
    }, {});
  }

  return Object.entries(keys).reduce((result, [key, fallbackValue]) => {
    result[key] = key in state ? cloneValue(state[key]) : cloneValue(fallbackValue);
    return result;
  }, {});
}

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function areValuesEqual(leftValue, rightValue) {
  return JSON.stringify(leftValue) === JSON.stringify(rightValue);
}
