const STORAGE_KEY = "execPanel:v3";
const LEGACY_STORAGE_KEY = "execPanel:v1";
const REMOTE_ENDPOINT = "./api/data";

function nowIso() {
  return new Date().toISOString();
}

function coerceInt(v, fallback) {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeLines(value) {
  if (Array.isArray(value)) {
    return value.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  return value.split(/\r?\n/g).map((s) => s.trim()).filter(Boolean);
}

function normalizeLinks(value) {
  const seen = new Set();
  const out = [];
  for (const s of normalizeLines(value)) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function defaultData() {
  return {
    schemaVersion: 3,
    items: [],
    sessions: [],
    stats: {
      points: 0,
      streak: 0,
    },
    settings: {
      defaultEstimateMin: 25,
      completePoints: 5,
      failPoints: -3,
      streakResetOnFail: true,
    },
    updatedAt: nowIso(),
  };
}

function normalizeItem(raw) {
  const name = String(raw?.name || raw?.title || raw?.sopKey || "").trim();
  const id = String(raw?.id || "").trim() || newId("i");
  return {
    id,
    name,
    goal: String(raw?.goal || "").trim(),
    steps: normalizeLines(raw?.steps),
    links: normalizeLinks(raw?.links),
    defaultEstimateMin: coerceInt(raw?.defaultEstimateMin ?? raw?.estimateMin, 25),
    lastPracticeFocus: String(raw?.lastPracticeFocus || "").trim(),
    createdAt: typeof raw?.createdAt === "string" ? raw.createdAt : nowIso(),
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : nowIso(),
  };
}

function normalizeSession(raw) {
  const result = raw?.result === "fail" ? "fail" : raw?.result === "success" ? "success" : "";
  return {
    id: String(raw?.id || "").trim() || newId("s"),
    itemId: String(raw?.itemId || "").trim(),
    itemName: String(raw?.itemName || raw?.sopKey || "").trim(),
    taskTitle: String(raw?.taskTitle || "").trim(),
    goalSnapshot: String(raw?.goalSnapshot || "").trim(),
    practiceFocus: String(raw?.practiceFocus || "").trim(),
    startedAt: typeof raw?.startedAt === "string" ? raw.startedAt : "",
    endedAt: typeof raw?.endedAt === "string" ? raw.endedAt : "",
    plannedMin: coerceInt(raw?.plannedMin, 0),
    actualSec: coerceInt(raw?.actualSec, 0),
    result,
    goalProgress: raw?.goalProgress === "closer" || raw?.goalProgress === "same" || raw?.goalProgress === "off" ? raw.goalProgress : "",
    failReason: String(raw?.failReason || "").trim(),
    failTrigger: String(raw?.failTrigger || "").trim(),
    reminder: String(raw?.reminder || "").trim(),
  };
}

function migrateLegacy(raw) {
  const base = defaultData();
  if (!raw || typeof raw !== "object") return base;

  const itemByName = new Map();
  const ensureItem = (name) => {
    const key = String(name || "").trim();
    if (!key) return null;
    if (itemByName.has(key)) return itemByName.get(key);
    const item = normalizeItem({
      id: newId("i"),
      name: key,
      goal: "",
      steps: Array.isArray(raw.sops?.[key]) ? raw.sops[key] : [],
      links: Array.isArray(raw.sopLinks?.[key]) ? raw.sopLinks[key] : [],
      createdAt: nowIso(),
      updatedAt: raw.updatedAt || nowIso(),
    });
    itemByName.set(key, item);
    return item;
  };

  for (const t of Array.isArray(raw.tasks) ? raw.tasks : []) {
    const name = String(t?.sopKey || t?.title || "").trim();
    const item = ensureItem(name);
    if (!item) continue;
    if (!item.lastPracticeFocus && typeof t?.lastPracticeFocus === "string") item.lastPracticeFocus = t.lastPracticeFocus.trim();
    item.defaultEstimateMin = coerceInt(t?.estimateMin, item.defaultEstimateMin);
    item.links = normalizeLinks([...(item.links || []), ...(Array.isArray(t?.links) ? t.links : [])]);
  }

  for (const key of Object.keys(raw.sops || {})) ensureItem(key);
  for (const key of Object.keys(raw.sopLinks || {})) ensureItem(key);

  const sessions = (Array.isArray(raw.sessions) ? raw.sessions : [])
    .map((s) => {
      const item = ensureItem(s?.sopKey || "未归类");
      return normalizeSession({
        ...s,
        itemId: item?.id || "",
        itemName: item?.name || s?.sopKey || "未归类",
        taskTitle: String((raw.tasks || []).find((t) => t?.id === s?.taskId)?.title || s?.sopKey || "练习").trim(),
        goalProgress: s?.selfCompare === "better" ? "closer" : s?.selfCompare === "worse" ? "off" : s?.selfCompare === "same" ? "same" : "",
      });
    })
    .filter((s) => s.result);

  return {
    ...base,
    items: Array.from(itemByName.values()).filter((i) => i.name),
    sessions,
    stats: {
      points: coerceInt(raw?.stats?.points, 0),
      streak: coerceInt(raw?.stats?.streak, 0),
    },
    settings: {
      defaultEstimateMin: coerceInt(raw?.settings?.defaultEstimateMin, 25),
      completePoints: coerceInt(raw?.settings?.completePoints, 5),
      failPoints: coerceInt(raw?.settings?.failPoints, -3),
      streakResetOnFail: Boolean(raw?.settings?.streakResetOnFail ?? true),
    },
    updatedAt: raw?.updatedAt || nowIso(),
  };
}

export function sanitizeData(raw) {
  if (!raw || typeof raw !== "object") return defaultData();
  if (raw.schemaVersion !== 3 && (Array.isArray(raw.tasks) || raw.sops)) return migrateLegacy(raw);

  const base = defaultData();
  const items = (Array.isArray(raw.items) ? raw.items : []).map(normalizeItem).filter((i) => i.name);
  const sessions = (Array.isArray(raw.sessions) ? raw.sessions : []).map(normalizeSession).filter((s) => s.result);

  return {
    ...base,
    items,
    sessions,
    stats: {
      points: coerceInt(raw?.stats?.points, 0),
      streak: coerceInt(raw?.stats?.streak, 0),
    },
    settings: {
      defaultEstimateMin: coerceInt(raw?.settings?.defaultEstimateMin, 25),
      completePoints: coerceInt(raw?.settings?.completePoints, 5),
      failPoints: coerceInt(raw?.settings?.failPoints, -3),
      streakResetOnFail: Boolean(raw?.settings?.streakResetOnFail ?? true),
    },
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : nowIso(),
  };
}

export function loadData() {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) return sanitizeData(JSON.parse(current));

    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) return sanitizeData(JSON.parse(legacy));
    return defaultData();
  } catch {
    return defaultData();
  }
}

export function prepareDataForSave(data) {
  return sanitizeData({ ...data, updatedAt: nowIso(), schemaVersion: 3 });
}

export function saveData(data) {
  const out = prepareDataForSave(data);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  return out;
}

export function clearData() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

export async function loadRemoteData() {
  if (location.protocol === "file:") return null;
  try {
    const resp = await fetch(REMOTE_ENDPOINT, { cache: "no-store" });
    if (!resp.ok) return null;
    const raw = await resp.json();
    if (!raw) return null;
    return sanitizeData(raw);
  } catch {
    return null;
  }
}

export async function saveRemoteData(data) {
  if (location.protocol === "file:") return false;
  try {
    const out = prepareDataForSave(data);
    const resp = await fetch(REMOTE_ENDPOINT, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(out),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export function newId(prefix = "id") {
  const rnd = Math.random().toString(16).slice(2);
  return `${prefix}_${Date.now().toString(16)}_${rnd}`;
}
