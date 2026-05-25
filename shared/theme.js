import { STORAGE_KEYS, THEMES } from "./constants.js";
import { normalizeSettingsInput } from "./utils.js";

export function applyDocumentTheme(theme) {
  const normalized = Object.values(THEMES).includes(theme) ? theme : THEMES.system;
  document.documentElement.setAttribute("data-theme", normalized);
}

export function watchThemeChanges() {
  if (typeof browser === "undefined" || !browser.storage?.onChanged?.addListener) {
    return;
  }
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEYS.settings]) {
      return;
    }
    const next = normalizeSettingsInput(changes[STORAGE_KEYS.settings].newValue);
    applyDocumentTheme(next.theme);
  });
}
