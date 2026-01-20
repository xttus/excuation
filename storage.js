const STORAGE_KEY = "execPanel:v1";

function nowIso() {
  return new Date().toISOString();
}

function defaultData() {
  return {
    schemaVersion: 2,
    tasks: [],
    // Map: sopKey -> steps[]
    sops: {},
    // Practice sessions history (append-only; keep last N in UI/service layer).
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
    lastTaskOrder: 0,
    updatedAt: nowIso(),
  };
}

function coerceInt(v, fallback) {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeLoadedData(raw) {
  const base = defaultData();
  if (!raw || typeof raw !== "object") return base;

  const out = { ...base, ...raw };
  out.schemaVersion = 2;

  out.stats = {
    points: coerceInt(raw?.stats?.points, base.stats.points),
    streak: coerceInt(raw?.stats?.streak, base.stats.streak),
  };

  out.settings = {
    defaultEstimateMin: coerceInt(raw?.settings?.defaultEstimateMin, base.settings.defaultEstimateMin),
    completePoints: coerceInt(raw?.settings?.completePoints, base.settings.completePoints),
    failPoints: coerceInt(raw?.settings?.failPoints, base.settings.failPoints),
    streakResetOnFail: Boolean(
      raw?.settings?.streakResetOnFail ?? base.settings.streakResetOnFail
    ),
  };

  out.sops = {};
  if (raw?.sops && typeof raw.sops === "object" && !Array.isArray(raw.sops)) {
    for (const [k, v] of Object.entries(raw.sops)) {
      if (!k || typeof k !== "string") continue;
      if (!Array.isArray(v)) continue;
      const steps = v.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean);
      out.sops[k] = steps;
    }
  }

  out.tasks = Array.isArray(raw?.tasks) ? raw.tasks.filter((t) => t && typeof t === "object") : [];
  out.tasks = out.tasks.map((t) => ({
    id: String(t.id || ""),
    title: String(t.title || "").trim(),
    type: t.type === "repeat" || t.type === "light" ? t.type : "deep",
    estimateMin: coerceInt(t.estimateMin, out.settings.defaultEstimateMin),
    importance: t.importance === "urgent" ? "urgent" : "normal",
    // v0 stored `url`; now supports multiple `links`.
    links: Array.isArray(t.links)
      ? t.links.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean)
      : Array.isArray(t.urls)
        ? t.urls.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean)
        : typeof t.url === "string" && t.url.trim()
          ? [t.url.trim()]
          : [],
    definitionOfDone: typeof t.definitionOfDone === "string" ? t.definitionOfDone.trim() : "",
    // Optional "practice focus" shortcut for next time.
    lastPracticeFocus: typeof t.lastPracticeFocus === "string" ? t.lastPracticeFocus.trim() : "",
    // SOP is associated by "事项"/key (user-controlled); fallback can be task title on UI.
    sopKey: typeof t.sopKey === "string" ? t.sopKey.trim() : "",
    notes: Array.isArray(t.notes)
      ? t.notes
          .filter((n) => n && typeof n === "object" && typeof n.text === "string")
          .map((n) => ({
            id: String(n.id || ""),
            text: String(n.text || "").trim(),
            createdAt: typeof n.createdAt === "string" ? n.createdAt : nowIso(),
          }))
          .filter((n) => n.id.length > 0 && n.text.length > 0)
      : [],
    noteDraft: typeof t.noteDraft === "string" ? t.noteDraft : "",
    status: t.status === "done" ? "done" : "todo",
    order: coerceInt(t.order, 0),
    createdAt: typeof t.createdAt === "string" ? t.createdAt : nowIso(),
    updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : nowIso(),
    lastSkippedAt: typeof t.lastSkippedAt === "string" ? t.lastSkippedAt : "",
  }));
  out.tasks = out.tasks.filter((t) => t.title.length > 0 && t.id.length > 0);

  out.sessions = Array.isArray(raw?.sessions)
    ? raw.sessions.filter((s) => s && typeof s === "object")
    : [];
  out.sessions = out.sessions
    .map((s) => ({
      id: String(s.id || ""),
      taskId: String(s.taskId || ""),
      sopKey: typeof s.sopKey === "string" ? s.sopKey.trim() : "",
      taskType: s.taskType === "repeat" || s.taskType === "light" ? s.taskType : "deep",
      startedAt: typeof s.startedAt === "string" ? s.startedAt : "",
      endedAt: typeof s.endedAt === "string" ? s.endedAt : "",
      plannedMin: coerceInt(s.plannedMin, 0),
      actualSec: coerceInt(s.actualSec, 0),
      result: s.result === "fail" ? "fail" : s.result === "success" ? "success" : "",
      practiceFocus: typeof s.practiceFocus === "string" ? s.practiceFocus.trim() : "",
      failReason: typeof s.failReason === "string" ? s.failReason : "",
      failTrigger: typeof s.failTrigger === "string" ? s.failTrigger : "",
      selfCompare: typeof s.selfCompare === "string" ? s.selfCompare : "",
    }))
    .filter((s) => s.id.length > 0 && s.taskId.length > 0 && (s.result === "success" || s.result === "fail"));

  out.lastTaskOrder = coerceInt(raw?.lastTaskOrder, base.lastTaskOrder);
  out.updatedAt = typeof raw?.updatedAt === "string" ? raw.updatedAt : nowIso();

  return out;
}

export function loadData() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return defaultData();
    const raw = JSON.parse(s);
    return sanitizeLoadedData(raw);
  } catch {
    return defaultData();
  }
}

export function saveData(data) {
  const out = { ...data, updatedAt: nowIso(), schemaVersion: 2 };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
}

export function clearData() {
  localStorage.removeItem(STORAGE_KEY);
}

export function newId(prefix = "t") {
  const rnd = Math.random().toString(16).slice(2);
  return `${prefix}_${Date.now().toString(16)}_${rnd}`;
}
