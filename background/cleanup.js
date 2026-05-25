import {
  ALARM_NAMES,
  CLEANUP_PERIOD_MINUTES
} from "../shared/constants.js";
import { pruneHistory } from "./history-store.js";

export async function initializeCleanup() {
  await browser.alarms.create(ALARM_NAMES.pruneHistory, {
    periodInMinutes: CLEANUP_PERIOD_MINUTES
  });
}

export function registerCleanupHandler() {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAMES.pruneHistory) {
      void pruneHistory();
    }
  });
}
