export const SCHEMA_VERSION = 4;

export function nowIso() {
  return new Date().toISOString();
}

export function newId(prefix = "id") {
  const rnd = Math.random().toString(16).slice(2);
  return `${prefix}_${Date.now().toString(16)}_${rnd}`;
}

function coerceInt(v, fallback) {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function stringValue(v) {
  return String(v || "").trim();
}

function linesFrom(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  return value.split(/\r?\n/g);
}

function uniqueBy(arr, getKey) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function inferStepType(text) {
  const s = stringValue(text);
  if (s.startsWith("@")) return "check";
  if (s.startsWith("!")) return "warning";
  if (s.startsWith("->") || s.startsWith("↑")) return "improvement";
  return "action";
}

export function defaultData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    items: [],
    practices: [],
    inbox: [],
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

export function normalizeSteps(value) {
  const steps = linesFrom(value)
    .map((step, index) => {
      if (typeof step === "string") {
        const text = stringValue(step);
        if (!text) return null;
        return {
          id: newId("step"),
          text,
          type: inferStepType(text),
          order: index,
          createdAt: nowIso(),
          archivedAt: "",
        };
      }

      const text = stringValue(step?.text);
      if (!text) return null;
      return {
        id: stringValue(step?.id) || newId("step"),
        text,
        type: ["action", "check", "warning", "improvement"].includes(step?.type) ? step.type : inferStepType(text),
        order: coerceInt(step?.order, index),
        createdAt: typeof step?.createdAt === "string" ? step.createdAt : nowIso(),
        archivedAt: typeof step?.archivedAt === "string" ? step.archivedAt : "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .map((step, index) => ({ ...step, order: index }));

  return uniqueBy(steps, (s) => s.id);
}

export function normalizeLinks(value) {
  const links = linesFrom(value)
    .map((link, index) => {
      if (typeof link === "string") {
        const url = stringValue(link);
        if (!url) return null;
        return {
          id: newId("link"),
          url,
          title: "",
          order: index,
          createdAt: nowIso(),
          lastUsedAt: "",
          archivedAt: "",
        };
      }

      const url = stringValue(link?.url || link?.href);
      if (!url) return null;
      return {
        id: stringValue(link?.id) || newId("link"),
        url,
        title: stringValue(link?.title),
        order: coerceInt(link?.order, index),
        createdAt: typeof link?.createdAt === "string" ? link.createdAt : nowIso(),
        lastUsedAt: typeof link?.lastUsedAt === "string" ? link.lastUsedAt : "",
        archivedAt: typeof link?.archivedAt === "string" ? link.archivedAt : "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .map((link, index) => ({ ...link, order: index }));

  return uniqueBy(links, (l) => l.url);
}

export function normalizeItem(raw) {
  const name = stringValue(raw?.name || raw?.title || raw?.sopKey);
  return {
    id: stringValue(raw?.id) || newId("item"),
    name,
    goal: stringValue(raw?.goal),
    nextPracticeFocus: stringValue(raw?.nextPracticeFocus || raw?.lastPracticeFocus),
    steps: normalizeSteps(raw?.steps),
    links: normalizeLinks(raw?.links),
    defaultEstimateMin: coerceInt(raw?.defaultEstimateMin ?? raw?.estimateMin, 25),
    createdAt: typeof raw?.createdAt === "string" ? raw.createdAt : nowIso(),
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : nowIso(),
    archivedAt: typeof raw?.archivedAt === "string" ? raw.archivedAt : "",
  };
}

export function normalizePractice(raw) {
  const result = raw?.result === "fail" ? "fail" : raw?.result === "success" ? "success" : "";
  const checkedStepIds = Array.isArray(raw?.checkedStepIds) ? raw.checkedStepIds.map(stringValue).filter(Boolean) : [];
  const openedLinkIds = Array.isArray(raw?.openedLinkIds) ? raw.openedLinkIds.map(stringValue).filter(Boolean) : [];
  const addedLinkIds = Array.isArray(raw?.addedLinkIds) ? raw.addedLinkIds.map(stringValue).filter(Boolean) : [];
  const stepsTotal = coerceInt(raw?.stepsTotal, checkedStepIds.length);

  return {
    id: stringValue(raw?.id) || newId("practice"),
    itemId: stringValue(raw?.itemId),
    itemNameSnapshot: stringValue(raw?.itemNameSnapshot || raw?.itemName || raw?.sopKey),
    taskTitle: stringValue(raw?.taskTitle),
    goalSnapshot: stringValue(raw?.goalSnapshot),
    focus: stringValue(raw?.focus || raw?.practiceFocus),
    plannedMin: coerceInt(raw?.plannedMin, 0),
    actualSec: coerceInt(raw?.actualSec, 0),
    result,
    startedAt: typeof raw?.startedAt === "string" ? raw.startedAt : "",
    endedAt: typeof raw?.endedAt === "string" ? raw.endedAt : "",
    progressRating: ["closer", "same", "off"].includes(raw?.progressRating || raw?.goalProgress)
      ? raw.progressRating || raw.goalProgress
      : "",
    qualityScore: coerceInt(raw?.qualityScore, 0),
    difficultyScore: coerceInt(raw?.difficultyScore, 0),
    focusScore: coerceInt(raw?.focusScore, 0),
    energyScore: coerceInt(raw?.energyScore, 0),
    failReason: stringValue(raw?.failReason),
    failTrigger: stringValue(raw?.failTrigger),
    note: stringValue(raw?.note),
    reminder: stringValue(raw?.reminder),
    addedReminderToSteps: Boolean(raw?.addedReminderToSteps),
    stepsTotal,
    stepsChecked: coerceInt(raw?.stepsChecked, checkedStepIds.length),
    checkedStepIds,
    linksTotal: coerceInt(raw?.linksTotal, openedLinkIds.length),
    linksOpenedCount: coerceInt(raw?.linksOpenedCount, openedLinkIds.length),
    linksAddedCount: coerceInt(raw?.linksAddedCount, addedLinkIds.length),
    openedLinkIds,
    addedLinkIds,
    createdAt: typeof raw?.createdAt === "string" ? raw.createdAt : typeof raw?.endedAt === "string" ? raw.endedAt : nowIso(),
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : typeof raw?.endedAt === "string" ? raw.endedAt : nowIso(),
  };
}

export function normalizeInboxTask(raw) {
  return {
    id: stringValue(raw?.id) || newId("inbox"),
    title: stringValue(raw?.title),
    note: stringValue(raw?.note),
    status: raw?.status === "done" ? "done" : "todo",
    promotedToItemId: stringValue(raw?.promotedToItemId),
    createdAt: typeof raw?.createdAt === "string" ? raw.createdAt : nowIso(),
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : nowIso(),
  };
}

function migrateLegacyToV4(raw) {
  const itemByName = new Map();
  const ensureItem = (name) => {
    const key = stringValue(name || "未归类");
    if (itemByName.has(key)) return itemByName.get(key);
    const item = normalizeItem({
      id: newId("item"),
      name: key,
      steps: raw?.sops?.[key] || [],
      links: raw?.sopLinks?.[key] || [],
      createdAt: nowIso(),
      updatedAt: raw?.updatedAt || nowIso(),
    });
    itemByName.set(key, item);
    return item;
  };

  for (const t of Array.isArray(raw?.tasks) ? raw.tasks : []) {
    const item = ensureItem(t?.sopKey || t?.title);
    if (!item.nextPracticeFocus) item.nextPracticeFocus = stringValue(t?.lastPracticeFocus);
    item.defaultEstimateMin = coerceInt(t?.estimateMin, item.defaultEstimateMin);
    item.links = normalizeLinks([...(item.links || []), ...(Array.isArray(t?.links) ? t.links : [])]);
  }
  for (const key of Object.keys(raw?.sops || {})) ensureItem(key);
  for (const key of Object.keys(raw?.sopLinks || {})) ensureItem(key);

  const practices = (Array.isArray(raw?.sessions) ? raw.sessions : []).map((s) => {
    const item = ensureItem(s?.sopKey || "未归类");
    const task = (raw?.tasks || []).find((t) => t?.id === s?.taskId);
    return normalizePractice({
      ...s,
      itemId: item.id,
      itemNameSnapshot: item.name,
      taskTitle: task?.title || s?.sopKey || "练习",
      focus: s?.practiceFocus,
      progressRating: s?.selfCompare === "better" ? "closer" : s?.selfCompare === "worse" ? "off" : s?.selfCompare === "same" ? "same" : "",
      stepsTotal: item.steps.length,
      linksTotal: item.links.length,
    });
  });

  return sanitizeData({
    ...defaultData(),
    items: Array.from(itemByName.values()).filter((i) => i.name),
    practices: practices.filter((p) => p.result),
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
  });
}

export function sanitizeData(raw) {
  if (!raw || typeof raw !== "object") return defaultData();
  if (Array.isArray(raw.tasks) || raw.sops) return migrateLegacyToV4(raw);

  const base = defaultData();
  const items = (Array.isArray(raw.items) ? raw.items : []).map(normalizeItem).filter((i) => i.name);
  const practicesSource = Array.isArray(raw.practices) ? raw.practices : Array.isArray(raw.sessions) ? raw.sessions : [];
  const practices = practicesSource.map(normalizePractice).filter((p) => p.result);
  const inbox = (Array.isArray(raw.inbox) ? raw.inbox : []).map(normalizeInboxTask).filter((t) => t.title);

  return {
    ...base,
    items,
    practices,
    inbox,
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
    schemaVersion: SCHEMA_VERSION,
  };
}

export function prepareDataForSave(data) {
  return sanitizeData({ ...data, updatedAt: nowIso(), schemaVersion: SCHEMA_VERSION });
}
