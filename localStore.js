import { defaultData, prepareDataForSave, sanitizeData } from "./dataModel.js";

export const STORAGE_KEY = "execPanel:v4";
export const LEGACY_KEYS = ["execPanel:v3", "execPanel:v1"];

export function hasLocalData() {
  try {
    if (localStorage.getItem(STORAGE_KEY)) return true;
    return LEGACY_KEYS.some((key) => Boolean(localStorage.getItem(key)));
  } catch {
    return false;
  }
}

export function loadLocalData() {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) return sanitizeData(JSON.parse(current));

    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key);
      if (legacy) return sanitizeData(JSON.parse(legacy));
    }
    return defaultData();
  } catch {
    return defaultData();
  }
}

export function saveLocalData(data) {
  const out = prepareDataForSave(data);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  return out;
}

export function clearLocalData() {
  localStorage.removeItem(STORAGE_KEY);
  for (const key of LEGACY_KEYS) localStorage.removeItem(key);
}
