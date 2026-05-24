import { clearData, loadData, newId, saveData } from "./storage.js";

const appEl = document.getElementById("app");
const statsEl = document.getElementById("stats");
const toastEl = document.getElementById("toast");
const modalRoot = document.getElementById("modalRoot");

const state = {
  data: loadData(),
  view: "home", // home | tasks | focus | settings | sops | history
  session: null, // { taskId, startedAt, endsAt, openLinks, useSop, definitionOfDone, estimateMin, sopKey, practiceFocus }
};

let focusTicker = null;

const FAIL_REASONS = [
  { code: "difficulty_misjudge", label: "难度判断失误" },
  { code: "interrupted", label: "专注被打断" },
  { code: "sop_bad", label: "SOP 不合理" },
  { code: "goal_unclear", label: "目标不清晰" },
  { code: "bad_state", label: "就是状态不好" },
];

const SELF_COMPARE_OPTIONS = [
  { code: "better", label: "明显更好" },
  { code: "same", label: "差不多" },
  { code: "worse", label: "更差" },
];

const FAIL_REASON_LABELS = Object.fromEntries(FAIL_REASONS.map((r) => [r.code, r.label]));
const SELF_COMPARE_LABELS = Object.fromEntries(SELF_COMPARE_OPTIONS.map((o) => [o.code, o.label]));

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === false || v === null || v === undefined) continue;
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("toast--show");
  window.clearTimeout(toast._t);
  toast._t = window.setTimeout(() => toastEl.classList.remove("toast--show"), 1600);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制到剪贴板");
    return true;
  } catch {
    // Fallback: best-effort
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) toast("已复制到剪贴板");
      else toast("复制失败：请手动复制");
      return ok;
    } catch {
      toast("复制失败：请手动复制");
      return false;
    }
  }
}

function persist() {
  saveData(state.data);
  renderStats();
}

function renderStats() {
  const { points, streak } = state.data.stats;
  statsEl.replaceChildren(
    h("div", { class: "pill" }, "points ", h("code", { text: String(points) })),
    h("div", { class: "pill" }, "streak ", h("code", { text: String(streak) }))
  );
}

function setView(view) {
  state.view = view;
  document.documentElement.classList.toggle("focusMode", view === "focus");
  render();
}

function sortTodos(tasks) {
  return tasks
    .filter((t) => t.status === "todo")
    .sort((a, b) => {
      const impA = a.importance === "urgent" ? 1 : 0;
      const impB = b.importance === "urgent" ? 1 : 0;
      if (impA !== impB) return impB - impA;
      return a.order - b.order;
    });
}

function getSopKey(task) {
  // Default: use user-defined "事项" (sopKey). If empty, fall back to title.
  return (task?.sopKey || task?.title || "").trim();
}

function getLinks(task) {
  return Array.isArray(task?.links) ? task.links : [];
}

function normalizeLinks(list) {
  const seen = new Set();
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function toOpenableUrl(raw) {
  const s0 = String(raw || "").trim();
  if (!s0) return null;

  // If it already has a scheme, keep it as-is (http:, https:, mailto:, etc.)
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s0);
  const isLikelyLocal =
    /^(localhost)([:/]|$)/i.test(s0) ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(s0);
  const candidate = hasScheme ? s0 : `${isLikelyLocal ? "http" : "https"}://${s0.replace(/^\/\//, "")}`;

  try {
    return new URL(candidate).toString();
  } catch {
    // Fall back: if it looked like a URL but was malformed, refuse to open (avoid about:blank).
    return null;
  }
}

function sanitizeOpenableLinks(list) {
  const valid = [];
  const invalid = [];
  for (const v of normalizeLinks(list)) {
    const u = toOpenableUrl(v);
    if (u) valid.push(u);
    else invalid.push(v);
  }
  return { valid: normalizeLinks(valid), invalid };
}

function openUrls(list, title) {
  const { valid, invalid } = sanitizeOpenableLinks(list);
  if (invalid.length) toast(`有 ${invalid.length} 个链接格式不对，已跳过`);
  if (!valid.length) return false;

  if (valid.length === 1) {
    return Boolean(window.open(valid[0], "_blank", "noopener,noreferrer") || toast("弹窗被拦截：请允许弹窗"));
  }

  // Try open a single hub window; even if blocked, we still show in-app list.
  openLinkHub(valid, title) || toast("弹窗被拦截：已在页面内提供链接列表");
  openLinksUI(valid, "打开链接（列表）");
  return true;
}

// Stable (Edge-friendly) link opening:
// - Never auto-open new tabs/windows (popup blockers are unpredictable).
// - Show an in-app list; each link is opened by an explicit user click (<a target=_blank>).
function openLinksUIStable(links, title) {
  const { valid, invalid } = sanitizeOpenableLinks(links);
  if (invalid.length) toast(`有 ${invalid.length} 个链接格式不对，已跳过`);
  if (!valid.length) {
    toast("没有可打开的链接");
    return;
  }

  const body = h(
    "div",
    { class: "col" },
    h("div", { class: "muted" }, "Edge 可能会拦截弹窗；更稳的方式是：在这里逐个点击打开链接。"),
    h(
      "div",
      { class: "buttons" },
      h("button", { class: "btn btn--primary", onclick: () => copyToClipboard(valid.join("\n")) }, "复制全部链接"),
      h(
        "button",
        { class: "btn", onclick: () => openLinkHub(valid, title) || toast("已被浏览器拦截：请在 Edge 允许此站点的弹窗") },
        "尝试新标签面板"
      )
    ),
    h("div", { class: "divider" }),
    h(
      "div",
      { class: "list" },
      ...valid.map((u) =>
        h(
          "div",
          { class: "card" },
          h("div", { class: "muted" }, u),
          h(
            "div",
            { class: "buttons" },
            h("a", { class: "btn btn--primary", href: u, target: "_blank", rel: "noopener noreferrer" }, "打开"),
            h("button", { class: "btn", onclick: () => copyToClipboard(u) }, "复制")
          )
        )
      )
    )
  );

  openModal({ title: title || "链接", body });
}

function openUrlsStable(list, title) {
  const { valid, invalid } = sanitizeOpenableLinks(list);
  if (invalid.length) toast(`有 ${invalid.length} 个链接格式不对，已跳过`);
  if (!valid.length) {
    toast("没有可打开的链接");
    return false;
  }
  openLinksUIStable(valid, title || "打开链接");
  return true;
}

function getSopLinks(sopKey) {
  const key = String(sopKey || "").trim();
  if (!key) return [];
  return normalizeLinks(state.data?.sopLinks?.[key]);
}

function shouldAutoOpenSopLinks(sopKey) {
  const key = String(sopKey || "").trim();
  if (!key) return false;
  return Boolean(state.data?.sopAutoOpenLinks?.[key]);
}

function getEffectiveLinks(task, sopKey) {
  return normalizeLinks([...getLinks(task), ...getSopLinks(sopKey)]);
}

function getRecommendedTask() {
  const todos = sortTodos(state.data.tasks);
  return todos.length ? todos[0] : null;
}

function maxOrder() {
  return state.data.tasks.reduce((m, t) => Math.max(m, t.order || 0), 0);
}

function upsertTask(task) {
  const idx = state.data.tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) state.data.tasks[idx] = task;
  else state.data.tasks.push(task);
  persist();
}

function deleteTask(taskId) {
  state.data.tasks = state.data.tasks.filter((t) => t.id !== taskId);
  persist();
}

function cloneTaskForNextPractice(sourceTask) {
  if (!sourceTask) return null;
  const next = {
    ...sourceTask,
    id: newId("t"),
    status: "todo",
    order: maxOrder() + 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastSkippedAt: "",
    notes: [],
    noteDraft: "",
  };
  upsertTask(next);
  toast("已创建下一次练习");
  return next;
}

function findTaskById(taskId) {
  return (state.data.tasks || []).find((t) => t.id === taskId) || null;
}

function getSessionTaskTitle(session) {
  return findTaskById(session?.taskId)?.title || "已删除任务";
}

function formatSessionDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function formatDurationSec(sec) {
  const n = Math.max(0, Number.parseInt(String(sec || 0), 10));
  const m = Math.floor(n / 60);
  const s = n % 60;
  if (m <= 0) return `${s} 秒`;
  if (s === 0) return `${m} 分钟`;
  return `${m} 分 ${s} 秒`;
}

function openModal({ title, body, footer, onClose, dismissible = true }) {
  modalRoot.setAttribute("aria-hidden", "false");
  modalRoot.replaceChildren(
    h(
      "div",
      {
        class: "modal",
        role: "dialog",
        "aria-modal": "true",
        onkeydown: (e) => {
          if (dismissible && e.key === "Escape") closeModal();
        },
      },
      h(
        "div",
        { class: "modalHeader" },
        h("div", { class: "modalTitle", text: title || "" }),
        dismissible
          ? h("button", { class: "btn btn--ghost", onclick: () => closeModal() }, "关闭")
          : null
      ),
      h("div", { class: "divider" }),
      body,
      footer ? h("div", { class: "divider" }) : null,
      footer || null
    )
  );

  function closeModal() {
    modalRoot.setAttribute("aria-hidden", "true");
    modalRoot.replaceChildren();
    if (typeof onClose === "function") onClose();
  }

  if (dismissible) {
    modalRoot.onclick = (e) => {
      if (e.target === modalRoot) closeModal();
    };
  } else {
    modalRoot.onclick = null;
  }

  return { close: closeModal };
}

function capArrayTail(arr, maxLen) {
  const a = Array.isArray(arr) ? arr : [];
  if (a.length <= maxLen) return a;
  return a.slice(a.length - maxLen);
}

function appendPracticeSession(session) {
  if (!session || typeof session !== "object") return;
  state.data.sessions = capArrayTail([...(state.data.sessions || []), session], 200);
  persist();
}

function updatePracticeSession(sessionId, patch) {
  const id = String(sessionId || "");
  if (!id) return;
  const idx = (state.data.sessions || []).findIndex((s) => s && s.id === id);
  if (idx < 0) return;
  state.data.sessions[idx] = { ...state.data.sessions[idx], ...(patch || {}) };
  persist();
}

function openFailReasonModal({ title, onSubmit }) {
  let selected = "";
  const list = h(
    "div",
    { class: "col" },
    ...FAIL_REASONS.map((r) =>
      h(
        "label",
        { class: "check" },
        h("input", {
          type: "radio",
          name: "failReason",
          value: r.code,
          onchange: (e) => {
            selected = e.target.value;
            confirmBtn.disabled = !selected;
          },
        }),
        h("div", {}, h("div", { class: "taskTitle", text: r.label }))
      )
    )
  );

  const confirmBtn = h(
    "button",
    {
      class: "btn btn--primary",
      disabled: "disabled",
      onclick: () => {
        if (!selected) return;
        ctrl.close();
        onSubmit?.(selected);
      },
    },
    "确认"
  );
  const footer = h("div", { class: "buttons" }, confirmBtn);
  const ctrl = openModal({
    title: title || "这次没完成，主要原因是？（必选）",
    body: list,
    footer,
    dismissible: false,
  });
}

function openSuccessSettleModal({ sessionId, sopKey, taskTitle, sourceTask }) {
  let selectedCompare = "";
  let compareApplied = false;
  const canCreateNext = sourceTask?.type === "repeat" || sourceTask?.type === "light";

  const compareBlock = h(
    "div",
    { class: "col" },
    h(
      "div",
      { class: "muted" },
      String(sopKey || "").trim()
        ? `和上一次同事项（${String(sopKey || "").trim()}）相比，这次感觉如何？（可跳过）`
        : "和上一次同类任务相比，这次感觉如何？（可跳过）"
    ),
    ...SELF_COMPARE_OPTIONS.map((o) =>
      h(
        "label",
        { class: "check" },
        h("input", {
          type: "radio",
          name: "selfCompare",
          value: o.code,
          onchange: (e) => {
            selectedCompare = e.target.value;
          },
        }),
        h("div", {}, h("div", { class: "taskTitle", text: o.label }))
      )
    )
  );

  const suggestedKey = String(sopKey || taskTitle || "").trim();
  const keyInput = h("input", {
    value: suggestedKey,
    placeholder: "例如：发布公众号 / 报销 / 剪辑视频（同事项用同一项）",
  });
  const existing = Array.isArray(state.data.sops[suggestedKey]) ? state.data.sops[suggestedKey] : [];
  const textarea = h("textarea", {
    placeholder: "每行一个步骤；可用前缀：!注意 / @检查 / ↑提升点（可不写）",
    text: existing.join("\n"),
  });

  const body = h(
    "div",
    { class: "col" },
    compareBlock,
    h("div", { class: "divider" }),
    h("div", { class: "muted" }, "要把本次步骤沉淀为 SOP 吗？（可跳过）"),
    h("div", {}, h("label", { text: "事项（SOP 名称）" }), keyInput),
    textarea
  );

  function applyCompareIfAny() {
    if (!selectedCompare || compareApplied) return;
    compareApplied = true;
    updatePracticeSession(sessionId, { selfCompare: selectedCompare });
  }

  function saveSop({ createNext = false } = {}) {
    const key = keyInput.value.trim();
    if (!key) {
      toast("事项不能为空");
      keyInput.focus();
      return false;
    }
    const steps = textarea.value
      .split(/\r?\n/g)
      .map((s) => s.trim())
      .filter(Boolean);
    state.data.sops[key] = steps;
    persist();
    applyCompareIfAny();
    if (createNext) cloneTaskForNextPractice(sourceTask);
    ctrl.close();
    toast(steps.length ? "SOP 已保存" : "SOP 已清空");
    return true;
  }

  const footer = h(
    "div",
    { class: "buttons" },
    h(
      "button",
      {
        class: "btn btn--primary",
        onclick: () => {
          saveSop();
        },
      },
      "保存 SOP 并结束"
    ),
    canCreateNext
      ? h(
          "button",
          {
            class: "btn btn--primary",
            onclick: () => {
              saveSop({ createNext: true });
            },
          },
          "保存 SOP，再练一次"
        )
      : null,
    canCreateNext
      ? h(
          "button",
          {
            class: "btn",
            onclick: () => {
              applyCompareIfAny();
              cloneTaskForNextPractice(sourceTask);
              ctrl.close();
            },
          },
          "不保存 SOP，再练一次"
        )
      : null,
    h(
      "button",
      {
        class: "btn",
        onclick: () => {
          applyCompareIfAny();
          ctrl.close();
        },
      },
      "不保存，结束"
    )
  );

  const ctrl = openModal({ title: "完成结算", body, footer, onClose: applyCompareIfAny });
}

function openLinkHub(links, title) {
  // Only 1 popup: show a link list page so user can open many links with explicit clicks.
  // This avoids browsers blocking multiple window.open() calls.
  const { valid, invalid } = sanitizeOpenableLinks(links);
  if (!valid.length) return false;

  // NOTE: do NOT use "noopener,noreferrer" here, otherwise some browsers
  // will prevent scripting access to the newly opened about:blank window,
  // leaving users stuck on a blank about:blank tab.
  let w = null;
  try {
    w = window.open("", "_blank");
    if (!w) return false;

    const safeTitle = String(title || "链接面板").replace(/[<>]/g, "");
    const items = valid
      .map((u) => {
        const escaped = u.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `<li><a href="${escaped}" target="_blank" rel="noopener noreferrer">${escaped}</a></li>`;
      })
      .join("");
    const invalidItems = invalid.length
      ? invalid
          .map((u) => String(u).trim())
          .filter(Boolean)
          .map((u) => {
            const escaped = u.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            return `<li><span class="muted">⚠ 无法识别链接：${escaped}</span></li>`;
          })
          .join("")
      : "";

    w.document.open();
    w.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;margin:16px;line-height:1.45}
  .muted{color:#667085;font-size:12px}
  ul{padding-left:18px}
  li{margin:8px 0}
  a{word-break:break-all}
  .bar{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
  button{padding:8px 10px;border-radius:10px;border:1px solid rgba(0,0,0,.15);background:#f6f7fb;cursor:pointer}
</style></head>
<body>
  <h2 style="margin:0 0 6px 0">${safeTitle}</h2>
  <div class="muted">提示：浏览器通常会拦截“一次点击打开很多弹窗”。建议在这里逐个点开，或对 localhost 允许弹窗。</div>
  <div class="bar">
    <button id="openAll">尝试打开全部（可能被拦截）</button>
  </div>
  <ul id="list">${items}${invalidItems}</ul>
  <script>
    const links = Array.from(document.querySelectorAll('#list a')).map(a=>a.href);
    document.getElementById('openAll').onclick = () => {
      let blocked = 0;
      for (const u of links) {
        const w = window.open(u, '_blank', 'noopener,noreferrer');
        if (!w) blocked++;
      }
      if (blocked) alert('可能被拦截：' + blocked + ' 个未打开。可逐个点击链接打开。');
    };
  </script>
</body></html>`);
    w.document.close();
    return true;
  } catch (e) {
    try {
      if (w && typeof w.close === "function") w.close();
    } catch {}
    console.error("[openLinkHub] failed", e);
    return false;
  }
}

function openLinksUI(links, title) {
  const { valid, invalid } = sanitizeOpenableLinks(links);
  if (invalid.length) toast(`有 ${invalid.length} 个链接格式不对，已跳过`);
  if (!valid.length) {
    toast("没有可打开的链接");
    return;
  }

  const body = h(
    "div",
    { class: "col" },
    h("div", { class: "muted" }, "浏览器通常会拦截“一次点击打开很多弹窗”。建议逐个点开，或对 localhost 允许弹窗。"),
    h(
      "div",
      { class: "buttons" },
      h(
        "button",
        { class: "btn btn--primary", onclick: () => openLinkHub(valid, title) || toast("弹窗被拦截：请允许弹窗") },
        "打开链接面板（推荐）"
      ),
      h(
        "button",
        { class: "btn", onclick: () => copyToClipboard(valid.join("\n")) },
        "复制全部链接"
      )
    ),
    h("div", { class: "divider" }),
    h(
      "div",
      { class: "list" },
      ...valid.map((u) =>
        h(
          "div",
          { class: "card" },
          h("div", { class: "muted" }, u),
          h(
            "div",
            { class: "buttons" },
            h(
              "button",
              { class: "btn btn--primary", onclick: () => window.open(u, "_blank", "noopener,noreferrer") || toast("弹窗被拦截") },
              "打开"
            ),
            h("button", { class: "btn", onclick: () => copyToClipboard(u) }, "复制")
          )
        )
      )
    )
  );
  openModal({ title: title || "链接", body });
}

function openTaskEditor({ task, mode }) {
  const isNew = mode === "new";
  const initial = task || {
    id: newId("t"),
    title: "",
    type: "deep",
    estimateMin: state.data.settings.defaultEstimateMin,
    importance: "normal",
    links: [],
    definitionOfDone: "",
    sopKey: "",
    notes: [],
    noteDraft: "",
    status: "todo",
    order: maxOrder() + 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastSkippedAt: "",
  };

  const titleInput = h("input", { value: initial.title, placeholder: "例如：写完第 1 段引言" });
  const typeSelect = h(
    "select",
    {},
    h("option", { value: "deep", text: "deep（🧠 深度）" }),
    h("option", { value: "repeat", text: "repeat（🔁 重复）" }),
    h("option", { value: "light", text: "light（🪶 轻任务）" })
  );
  typeSelect.value = initial.type;

  const estimateInput = h("input", { type: "number", min: "1", value: String(initial.estimateMin) });
  const importanceSelect = h(
    "select",
    {},
    h("option", { value: "normal", text: "normal（普通）" }),
    h("option", { value: "urgent", text: "urgent（🔴 必须推进）" })
  );
  importanceSelect.value = initial.importance;

  const sopKeyInput = h("input", {
    value: initial.sopKey,
    placeholder: "例如：发布公众号 / 报销 / 剪辑视频（同类任务用同一个事项名）",
  });
  const linksInput = h("textarea", {
    text: getLinks(initial).join("\n"),
    placeholder: "可选：链接列表（每行一个）",
  });
  const dodInput = h("textarea", {
    placeholder: "可选：一句话写清楚“什么算完成”",
    text: initial.definitionOfDone,
  });

  const notesPreview =
    !isNew && Array.isArray(initial.notes) && initial.notes.length
      ? h(
          "div",
          { class: "col" },
          h("div", { class: "divider" }),
          h("div", { class: "h1", text: `笔记（${initial.notes.length}）` }),
          h(
            "div",
            { class: "list" },
            ...initial.notes
              .slice(-10)
              .reverse()
              .map((n) =>
                h(
                  "div",
                  { class: "card" },
                  h("div", { class: "muted" }, new Date(n.createdAt).toLocaleString()),
                  h("div", {}, n.text)
                )
              )
          )
        )
      : null;

  const body = h(
    "div",
    { class: "col" },
    h("div", {}, h("label", { text: "任务名（必填）" }), titleInput),
    h(
      "div",
      { class: "formRow" },
      h("div", {}, h("label", { text: "类型" }), typeSelect),
      h("div", {}, h("label", { text: "预计用时（分钟）" }), estimateInput)
    ),
    h(
      "div",
      { class: "formRow" },
      h("div", {}, h("label", { text: "重要性" }), importanceSelect),
      h("div", {}, h("label", { text: "事项 / SOP 归属（推荐）" }), sopKeyInput)
    ),
    h("div", {}, h("label", { text: "链接列表（可选，支持多个）" }), linksInput),
    h("div", {}, h("label", { text: "完成标准（可选）" }), dodInput),
    notesPreview,
    h("div", { class: "muted" }, "提示：越小越具体，越容易开始。")
  );

  const footer = h(
    "div",
    { class: "buttons" },
    h(
      "button",
      {
        class: "btn btn--primary",
        onclick: () => {
          const title = titleInput.value.trim();
          if (!title) {
            toast("任务名不能为空");
            titleInput.focus();
            return;
          }
          const next = {
            ...initial,
            title,
            type: typeSelect.value,
            estimateMin: Math.max(1, Number.parseInt(estimateInput.value || "1", 10)),
            importance: importanceSelect.value,
            sopKey: sopKeyInput.value.trim(),
            links: linksInput.value
              .split(/\r?\n/g)
              .map((s) => s.trim())
              .filter(Boolean),
            definitionOfDone: dodInput.value.trim(),
            updatedAt: new Date().toISOString(),
          };
          upsertTask(next);
          ctrl.close();
          toast(isNew ? "已添加任务" : "已保存");
          render();
        },
      },
      isNew ? "添加" : "保存"
    ),
    h("button", { class: "btn", onclick: () => ctrl.close() }, "取消")
  );

  const ctrl = openModal({ title: isNew ? "快速添加任务" : "编辑任务", body, footer });
  titleInput.focus();
}

function openStartConfirm(task) {
  const estimateInput = h("input", { type: "number", min: "1", value: String(task.estimateMin) });
  const dodInput = h("textarea", {
    text: task.definitionOfDone,
    placeholder: "可选：一句话写清楚“什么算完成”",
  });

  const sopKeyInput = h("input", {
    value: task.sopKey || "",
    placeholder: "可选：填写后，同类任务可复用同一 SOP",
  });

  let openLinksTouched = false;
  const openLinksInput = h("input", { type: "checkbox" });
  openLinksInput.addEventListener("change", () => {
    openLinksTouched = true;
  });
  const linkMetaEl = h("div", { class: "muted" });

  const rememberAutoOpenInput = h("input", { type: "checkbox" });
  const autoOpenMetaEl = h("div", { class: "muted" });

  const useSopInput = h("input", { type: "checkbox" });
  const sopCountEl = h("div", { class: "muted" });

  const practiceFocusInput = h("input", {
    value: task.lastPracticeFocus || "",
    maxlength: "60",
    placeholder: "一句话：这次刻意练什么？例如：结尾更有力量",
  });

  const body = h(
    "div",
    { class: "col" },
    h("div", { class: "h1", text: task.title }),
    h(
      "div",
      { class: "meta" },
      task.importance === "urgent" ? h("span", { class: "tag tag--urgent", text: "🔴 urgent" }) : null,
      h("span", { class: "tag tag--type", text: `type: ${task.type}` })
    ),
    h("div", {}, h("label", { text: "预计用时（分钟）" }), estimateInput),
    h("div", {}, h("label", { text: "完成标准（可选）" }), dodInput)
  );

  // Build toggles manually to keep label click behavior correct
  const sopKeyRow = h(
    "div",
    { class: "check" },
    h("div", {}, h("div", { class: "taskTitle", text: "事项（用于 SOP 沉淀与复用）" }), h("div", { class: "muted" }, "建议：同一类任务用同一个事项名")),
    h("div", { style: "min-width: 260px; width: 45%;" }, sopKeyInput)
  );
  const openLinksRow = h(
    "div",
    { class: "check" },
    openLinksInput,
    h(
      "div",
      {},
      h("div", { class: "taskTitle", text: "进入执行态时自动打开链接" }),
      linkMetaEl
    )
  );
  const rememberAutoOpenRow = h(
    "div",
    { class: "check" },
    rememberAutoOpenInput,
    h(
      "div",
      {},
      h("div", { class: "taskTitle", text: "该事项下次默认自动打开链接（记住）" }),
      autoOpenMetaEl
    )
  );
  const useSopRow = h(
    "div",
    { class: "check" },
    useSopInput,
    h(
      "div",
      {},
      h("div", { class: "taskTitle", text: "加载该事项 SOP" }),
      sopCountEl
    )
  );

  body.appendChild(h("div", { class: "divider" }));
  body.insertBefore(
    h("div", {}, h("label", { text: "练习目标（Practice Focus，可选）" }), practiceFocusInput),
    body.lastChild
  );
  body.appendChild(sopKeyRow);
  body.appendChild(openLinksRow);
  body.appendChild(rememberAutoOpenRow);
  body.appendChild(useSopRow);

  function syncSopMeta() {
    const key = (sopKeyInput.value || task.title).trim();

    const taskLinks = getLinks(task);
    const sopLinks = getSopLinks(key);
    const effectiveLinks = normalizeLinks([...taskLinks, ...sopLinks]);
    const hasEffectiveLinks = effectiveLinks.length > 0;

    openLinksInput.disabled = !hasEffectiveLinks;
    if (!hasEffectiveLinks) openLinksInput.checked = false;

    const srcParts = [];
    if (taskLinks.length) srcParts.push(`任务 ${taskLinks.length}`);
    if (sopLinks.length) srcParts.push(`SOP 共享 ${sopLinks.length}`);
    linkMetaEl.textContent = hasEffectiveLinks
      ? `可打开 ${effectiveLinks.length} 个（${srcParts.join(" + ") || "无"}）`
      : "暂无可打开链接";

    rememberAutoOpenInput.disabled = !key;
    if (key) {
      const isAutoOpen = shouldAutoOpenSopLinks(key);
      rememberAutoOpenInput.checked = isAutoOpen;
      autoOpenMetaEl.textContent = isAutoOpen ? "已启用：该事项以后默认勾选“自动打开链接”" : "未启用：该事项不会默认勾选";
      if (!openLinksTouched) openLinksInput.checked = hasEffectiveLinks && (isAutoOpen || taskLinks.length > 0);
    } else {
      rememberAutoOpenInput.checked = false;
      autoOpenMetaEl.textContent = "仅对事项生效";
      if (!openLinksTouched) openLinksInput.checked = hasEffectiveLinks && taskLinks.length > 0;
    }

    const steps = Array.isArray(state.data.sops[key]) ? state.data.sops[key] : [];
    if (steps.length) {
      useSopInput.disabled = false;
      sopCountEl.textContent = `${steps.length} 条步骤（事项：${key}）`;
      // Default to checked when SOP exists, to reduce friction.
      if (useSopInput.checked !== true) useSopInput.checked = true;
    } else {
      useSopInput.checked = false;
      useSopInput.disabled = true;
      sopCountEl.textContent = "该事项还没有 SOP";
    }
  }
  sopKeyInput.addEventListener("input", syncSopMeta);
  syncSopMeta();

  rememberAutoOpenInput.addEventListener("change", () => {
    const key = (sopKeyInput.value || task.title).trim();
    if (!key) return;
    if (!state.data.sopAutoOpenLinks || typeof state.data.sopAutoOpenLinks !== "object") state.data.sopAutoOpenLinks = {};
    state.data.sopAutoOpenLinks[key] = Boolean(rememberAutoOpenInput.checked);
    persist();
    syncSopMeta();
  });

  const footer = h(
    "div",
    { class: "buttons" },
    h(
      "button",
      {
        class: "btn btn--primary",
        onclick: () => {
          const estimateMin = Math.max(1, Number.parseInt(estimateInput.value || "1", 10));
          const definitionOfDone = dodInput.value.trim();
          const sopKey = (sopKeyInput.value || task.title).trim();
          startSession(task.id, {
            estimateMin,
            definitionOfDone,
            sopKey,
            practiceFocus: practiceFocusInput.value.trim().slice(0, 60),
            openLinks: Boolean(openLinksInput.checked && getEffectiveLinks(task, sopKey).length),
            rememberAutoOpenLinks: Boolean(rememberAutoOpenInput.checked),
            useSop: Boolean(useSopInput.checked && !useSopInput.disabled),
          });
          ctrl.close();
        },
      },
      "直接开始"
    ),
    h("button", { class: "btn", onclick: () => ctrl.close() }, "返回")
  );

  const ctrl = openModal({ title: "开始前确认", body, footer });
}

function quickStartTask(task) {
  if (!task) return;
  const sopKey = getSopKey(task);
  const steps = Array.isArray(state.data.sops[sopKey]) ? state.data.sops[sopKey] : [];
  startSession(task.id, {
    estimateMin: Math.max(1, Number.parseInt(String(task.estimateMin || state.data.settings.defaultEstimateMin || 25), 10)),
    definitionOfDone: task.definitionOfDone || "",
    sopKey,
    practiceFocus: task.lastPracticeFocus || "",
    openLinks: false,
    rememberAutoOpenLinks: shouldAutoOpenSopLinks(sopKey),
    useSop: steps.length > 0,
  });
}

function startSession(taskId, opts) {
  const task = state.data.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "todo") return;

  const sopKey = String(opts?.sopKey || "").trim();

  // Accumulate task-level links into SOP-level reusable links (so same sopKey tasks can reuse them).
  if (sopKey && getLinks(task).length) {
    if (!state.data.sopLinks || typeof state.data.sopLinks !== "object") state.data.sopLinks = {};
    const merged = normalizeLinks([...getSopLinks(sopKey), ...getLinks(task)]);
    if (merged.length) state.data.sopLinks[sopKey] = merged;
  }

  if (sopKey && typeof opts?.rememberAutoOpenLinks === "boolean") {
    if (!state.data.sopAutoOpenLinks || typeof state.data.sopAutoOpenLinks !== "object") state.data.sopAutoOpenLinks = {};
    state.data.sopAutoOpenLinks[sopKey] = Boolean(opts.rememberAutoOpenLinks);
  }

  const links = getEffectiveLinks(task, sopKey);
  if (opts.openLinks && links.length) {
    openUrlsStable(links, `Links: ${task.title}`);
  }

  const startedAt = Date.now();
  const endsAt = startedAt + opts.estimateMin * 60_000;
  state.session = {
    taskId,
    startedAt,
    endsAt,
    openLinks: opts.openLinks,
    useSop: opts.useSop,
    definitionOfDone: opts.definitionOfDone,
    estimateMin: opts.estimateMin,
    sopKey: sopKey,
    practiceFocus: typeof opts.practiceFocus === "string" ? opts.practiceFocus.trim().slice(0, 60) : "",
  };

  // Sync task fields so next time it’s easier to start.
  upsertTask({
    ...task,
    estimateMin: opts.estimateMin,
    definitionOfDone: opts.definitionOfDone,
    sopKey: sopKey,
    lastPracticeFocus:
      typeof opts.practiceFocus === "string" && opts.practiceFocus.trim()
        ? opts.practiceFocus.trim().slice(0, 60)
        : task.lastPracticeFocus || "",
    updatedAt: new Date().toISOString(),
  });

  setView("focus");
}

function settleSuccess(taskId) {
  const task = state.data.tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.status = "done";
  task.updatedAt = new Date().toISOString();

  state.data.stats.points += state.data.settings.completePoints;
  state.data.stats.streak += 1;
  persist();
  toast(`完成 +${state.data.settings.completePoints}`);

}

function settleFail(taskId, reason) {
  const task = state.data.tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.updatedAt = new Date().toISOString();

  state.data.stats.points += state.data.settings.failPoints;
  if (state.data.settings.streakResetOnFail) state.data.stats.streak = 0;
  persist();
  toast(reason || `失败 ${state.data.settings.failPoints}`);
}

function maybePromptSaveSop(task) {
  const suggestedKey = getSopKey({ ...task, sopKey: task.sopKey || task.title });
  const keyInput = h("input", {
    value: suggestedKey,
    placeholder: "例如：发布公众号 / 报销 / 剪辑视频（同类任务用同一个事项名）",
  });
  const existing = Array.isArray(state.data.sops[suggestedKey]) ? state.data.sops[suggestedKey] : [];
  const textarea = h("textarea", {
    placeholder: "每行一个步骤（例如：打开素材库\\n粗剪\\n加字幕\\n导出）",
    text: existing.join("\n"),
  });

  const body = h(
    "div",
    { class: "col" },
    h("div", { class: "muted" }, "要把本次步骤沉淀为 SOP 吗？（可跳过）"),
    h("div", {}, h("label", { text: "事项（SOP 名称）" }), keyInput),
    textarea
  );

  const footer = h(
    "div",
    { class: "buttons" },
    h(
      "button",
      {
        class: "btn btn--primary",
        onclick: () => {
          const key = keyInput.value.trim();
          if (!key) {
            toast("事项不能为空");
            keyInput.focus();
            return;
          }
          const steps = textarea.value
            .split(/\r?\n/g)
            .map((s) => s.trim())
            .filter(Boolean);
          state.data.sops[key] = steps;
          persist();
          ctrl.close();
          toast(steps.length ? "SOP 已保存" : "SOP 已清空");
        },
      },
      "保存 SOP"
    ),
    h("button", { class: "btn", onclick: () => ctrl.close() }, "跳过")
  );

  const ctrl = openModal({ title: "沉淀 SOP", body, footer });
}

function stopFocusTicker() {
  if (focusTicker) {
    window.clearInterval(focusTicker);
    focusTicker = null;
  }
}

function renderHome() {
  const rec = getRecommendedTask();

  const quickAddBtn = h("button", { class: "btn", onclick: () => openTaskEditor({ mode: "new" }) }, "+ 添加任务");
  const toPoolBtn = h("button", { class: "btn", onclick: () => setView("tasks") }, "任务池");
  const toHistoryBtn = h("button", { class: "btn", onclick: () => setView("history") }, "练习记录");
  const toSettingsBtn = h("button", { class: "btn", onclick: () => setView("settings") }, "设置");

  const actions = h("div", { class: "homeNav" }, quickAddBtn, toPoolBtn, toHistoryBtn, toSettingsBtn);

  if (!rec) {
    return h(
      "div",
      { class: "homeShell" },
      h(
        "section",
        { class: "emptyState" },
        h("div", { class: "eyebrow", text: "Execution Panel" }),
        h("div", { class: "displayTitle", text: "先放进一个可以马上开始的练习" }),
        h("div", { class: "lead", text: "不需要计划完整项目，只写下一步动作就够了。" }),
        h("div", { class: "primaryRow" }, h("button", { class: "btn btn--primary btn--xl", onclick: () => openTaskEditor({ mode: "new" }) }, "+ 添加第一个任务"))
      ),
      actions
    );
  }

  const sopKey = getSopKey(rec);
  const effectiveLinks = getEffectiveLinks(rec, sopKey);
  const sopSteps = Array.isArray(state.data.sops[sopKey]) ? state.data.sops[sopKey] : [];
  const meta = h(
    "div",
    { class: "meta" },
    rec.importance === "urgent" ? h("span", { class: "tag tag--urgent", text: "🔴 urgent" }) : null,
    h("span", { class: "tag tag--type", text: rec.type }),
    h("span", { class: "tag", text: `${rec.estimateMin} min` }),
    effectiveLinks.length ? h("span", { class: "tag", text: `链接 ${effectiveLinks.length}` }) : null,
    sopSteps.length ? h("span", { class: "tag", text: `SOP ${sopSteps.length}` }) : null,
    sopKey ? h("span", { class: "tag", text: sopKey }) : null,
    (rec.notes?.length || 0) > 0 ? h("span", { class: "tag", text: `📝 ${rec.notes.length}` }) : null
  );

  const startBtn = h("button", { class: "btn btn--primary btn--xl", onclick: () => quickStartTask(rec) }, "立即开始");
  const prepBtn = h("button", { class: "btn btn--xl", onclick: () => openStartConfirm(rec) }, "准备 / 链接 / SOP");
  const skipBtn = h(
    "button",
    {
      class: "btn",
      onclick: () => {
        const t = { ...rec, order: maxOrder() + 1, lastSkippedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        upsertTask(t);
        toast("已跳过（放到队尾）");
        render();
      },
    },
    "换一个"
  );

  return h(
    "div",
    { class: "homeShell" },
    h(
      "section",
      { class: "practiceHero" },
      h("div", { class: "eyebrow", text: "现在只做这一件事" }),
      h("div", { class: "displayTitle", text: rec.title }),
      meta,
      rec.lastPracticeFocus ? h("div", { class: "focusLine" }, h("span", { text: "练习重点" }), h("strong", { text: rec.lastPracticeFocus })) : null,
      rec.definitionOfDone ? h("div", { class: "doneLine" }, h("span", { text: "完成标准" }), h("strong", { text: rec.definitionOfDone })) : null,
      h("div", { class: "primaryRow" }, startBtn, prepBtn, skipBtn)
    ),
    actions
  );
}

function renderTaskPool() {
  const todos = sortTodos(state.data.tasks);
  const dones = state.data.tasks.filter((t) => t.status === "done").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const list = h("div", { class: "list" });
  for (const t of todos) {
    const meta = h(
      "div",
      { class: "meta" },
      t.importance === "urgent" ? h("span", { class: "tag tag--urgent", text: "🔴 urgent" }) : null,
      h("span", { class: "tag tag--type", text: `type: ${t.type}` }),
      h("span", { class: "tag", text: `${t.estimateMin} min` }),
      getLinks(t).length ? h("span", { class: "tag", text: `🔗 ${getLinks(t).length}` }) : null,
      getSopKey(t) ? h("span", { class: "tag", text: `事项：${getSopKey(t)}` }) : null,
      (t.notes?.length || 0) > 0 ? h("span", { class: "tag", text: `📝 ${t.notes.length}` }) : null
    );

    const actions = h(
      "div",
      { class: "taskActions" },
      h("button", { class: "btn btn--primary", onclick: () => openStartConfirm(t) }, "开始"),
      h("button", { class: "btn", onclick: () => openTaskEditor({ task: t, mode: "edit" }) }, "编辑"),
      h(
        "button",
        {
          class: "btn btn--danger",
          onclick: () => {
            const ok = window.confirm(`确定删除任务？\\n\\n${t.title}`);
            if (!ok) return;
            deleteTask(t.id);
            toast("已删除");
            render();
          },
        },
        "删除"
      )
    );

    list.appendChild(
      h("div", { class: "card" }, h("div", { class: "taskTitle", text: t.title }), meta, t.definitionOfDone ? h("div", { class: "muted" }, `完成标准：${t.definitionOfDone}`) : null, h("div", { class: "divider" }), actions)
    );
  }

  const doneList = h("div", { class: "list" });
  for (const t of dones.slice(0, 30)) {
    doneList.appendChild(
      h(
        "div",
        { class: "card" },
        h("div", { class: "taskTitle", text: t.title }),
        h("div", { class: "meta" }, h("span", { class: "tag", text: "done" }), h("span", { class: "tag", text: `${t.type}` }))
      )
    );
  }

  return h(
    "div",
    { class: "col" },
    h(
      "div",
      { class: "card" },
      h("div", { class: "row" }, h("div", { class: "h1", text: "任务池" }), h("div", { class: "buttons" }, h("button", { class: "btn btn--primary", onclick: () => openTaskEditor({ mode: "new" }) }, "+ 添加"), h("button", { class: "btn", onclick: () => setView("home") }, "返回"))),
      h("div", { class: "divider" }),
      todos.length ? list : h("div", { class: "muted" }, "暂无未完成任务。")
    ),
    dones.length
      ? h(
          "div",
          { class: "card" },
          h("div", { class: "h1", text: "已完成（最近 30 条）" }),
          h("div", { class: "divider" }),
          doneList
        )
      : null
  );
}

function renderPracticeHistory() {
  const sessions = [...(state.data.sessions || [])].sort((a, b) => String(b.endedAt || "").localeCompare(String(a.endedAt || "")));
  const summaryByKey = new Map();

  for (const s of sessions) {
    const key = String(s.sopKey || "未归类").trim() || "未归类";
    const cur = summaryByKey.get(key) || {
      key,
      total: 0,
      success: 0,
      fail: 0,
      lastPracticeFocus: "",
      lastEndedAt: "",
      failReasons: {},
      compare: { better: 0, same: 0, worse: 0 },
    };
    cur.total += 1;
    if (s.result === "success") cur.success += 1;
    if (s.result === "fail") {
      cur.fail += 1;
      if (s.failReason) cur.failReasons[s.failReason] = (cur.failReasons[s.failReason] || 0) + 1;
    }
    if (s.selfCompare && cur.compare[s.selfCompare] !== undefined) cur.compare[s.selfCompare] += 1;
    if (!cur.lastEndedAt || String(s.endedAt || "").localeCompare(cur.lastEndedAt) > 0) {
      cur.lastEndedAt = s.endedAt || "";
      cur.lastPracticeFocus = s.practiceFocus || "";
    }
    summaryByKey.set(key, cur);
  }

  const summaryCards = Array.from(summaryByKey.values())
    .sort((a, b) => String(b.lastEndedAt || "").localeCompare(String(a.lastEndedAt || "")))
    .map((item) => {
      const topFail = Object.entries(item.failReasons).sort((a, b) => b[1] - a[1])[0];
      const compareText = [
        item.compare.better ? `更好 ${item.compare.better}` : "",
        item.compare.same ? `持平 ${item.compare.same}` : "",
        item.compare.worse ? `更差 ${item.compare.worse}` : "",
      ]
        .filter(Boolean)
        .join(" / ");

      return h(
        "div",
        { class: "card" },
        h("div", { class: "row" }, h("div", { class: "h1", text: item.key }), h("div", { class: "meta" }, h("span", { class: "tag", text: `${item.total} 次` }), h("span", { class: "tag", text: `成功 ${item.success}` }), h("span", { class: "tag", text: `失败 ${item.fail}` }))),
        item.lastPracticeFocus ? h("div", { class: "muted" }, `最近练习重点：${item.lastPracticeFocus}`) : null,
        topFail ? h("div", { class: "muted" }, `主要失败原因：${FAIL_REASON_LABELS[topFail[0]] || topFail[0]}（${topFail[1]} 次）`) : null,
        compareText ? h("div", { class: "muted" }, `自我对比：${compareText}`) : null,
        item.lastEndedAt ? h("div", { class: "muted" }, `最近一次：${formatSessionDate(item.lastEndedAt)}`) : null
      );
    });

  const recentCards = sessions.slice(0, 50).map((s) => {
    const resultText = s.result === "success" ? "完成" : "失败";
    const detail =
      s.result === "fail"
        ? `原因：${FAIL_REASON_LABELS[s.failReason] || s.failReason || "未记录"}`
        : s.selfCompare
          ? `对比：${SELF_COMPARE_LABELS[s.selfCompare] || s.selfCompare}`
          : "未做对比";

    return h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "row" },
        h("div", { class: "col" }, h("div", { class: "taskTitle", text: getSessionTaskTitle(s) }), h("div", { class: "muted" }, formatSessionDate(s.endedAt))),
        h("div", { class: "meta" }, h("span", { class: "tag", text: resultText }), h("span", { class: "tag", text: formatDurationSec(s.actualSec) }))
      ),
      h("div", { class: "meta" }, s.sopKey ? h("span", { class: "tag", text: `事项：${s.sopKey}` }) : null, h("span", { class: "tag", text: `计划 ${s.plannedMin || 0} 分钟` }), s.failTrigger ? h("span", { class: "tag", text: s.failTrigger === "timeout" ? "超时" : "放弃" }) : null),
      s.practiceFocus ? h("div", { class: "muted" }, `练习重点：${s.practiceFocus}`) : null,
      h("div", { class: "muted" }, detail)
    );
  });

  return h(
    "div",
    { class: "col" },
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "row" },
        h("div", { class: "h1", text: "练习记录" }),
        h("div", { class: "buttons" }, h("button", { class: "btn", onclick: () => setView("home") }, "返回"))
      ),
      h("div", { class: "divider" }),
      h("div", { class: "muted" }, "这里展示最近的练习尝试，以及按事项汇总的成功、失败和复盘线索。")
    ),
    h(
      "div",
      { class: "card" },
      h("div", { class: "h1", text: "事项复盘" }),
      h("div", { class: "divider" }),
      summaryCards.length ? h("div", { class: "list" }, summaryCards) : h("div", { class: "muted" }, "还没有练习记录。完成或失败一次任务后，这里会出现复盘线索。")
    ),
    h(
      "div",
      { class: "card" },
      h("div", { class: "h1", text: "最近 50 次" }),
      h("div", { class: "divider" }),
      recentCards.length ? h("div", { class: "list" }, recentCards) : h("div", { class: "muted" }, "暂无记录。")
    )
  );
}

function renderSettings() {
  const s = state.data.settings;
  const defaultEstimateMin = h("input", { type: "number", min: "1", value: String(s.defaultEstimateMin) });
  const completePoints = h("input", { type: "number", value: String(s.completePoints) });
  const failPoints = h("input", { type: "number", value: String(s.failPoints) });
  const streakReset = h("input", { type: "checkbox", checked: s.streakResetOnFail ? "checked" : null });

  const saveBtn = h(
    "button",
    {
      class: "btn btn--primary",
      onclick: () => {
        state.data.settings.defaultEstimateMin = Math.max(1, Number.parseInt(defaultEstimateMin.value || "1", 10));
        state.data.settings.completePoints = Number.parseInt(completePoints.value || "0", 10);
        state.data.settings.failPoints = Number.parseInt(failPoints.value || "0", 10);
        state.data.settings.streakResetOnFail = Boolean(streakReset.checked);
        persist();
        toast("设置已保存");
      },
    },
    "保存设置"
  );

  const resetBtn = h(
    "button",
    {
      class: "btn btn--danger",
      onclick: () => {
        const ok = window.confirm("确定清空所有数据？此操作不可撤销。");
        if (!ok) return;
        clearData();
        state.data = loadData();
        state.session = null;
        persist();
        toast("已清空");
        setView("home");
      },
    },
    "清空数据"
  );

  return h(
    "div",
    { class: "col" },
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "row" },
        h("div", { class: "h1", text: "设置" }),
        h(
          "div",
          { class: "buttons" },
          h("button", { class: "btn", onclick: () => setView("sops") }, "SOP 库"),
          h("button", { class: "btn", onclick: () => setView("history") }, "练习记录"),
          h("button", { class: "btn", onclick: () => setView("home") }, "返回")
        )
      ),
      h("div", { class: "divider" }),
      h("div", { class: "formRow" }, h("div", {}, h("label", { text: "默认预计用时（分钟）" }), defaultEstimateMin), h("div", {}, h("label", { text: "完成奖励 points" }), completePoints)),
      h("div", { class: "formRow" }, h("div", {}, h("label", { text: "失败惩罚 points（负数）" }), failPoints), h("div", {}, h("label", { text: "失败清零 streak" }), h("div", { class: "check" }, streakReset, h("div", { class: "muted" }, "开启：失败 streak=0；关闭：失败不影响 streak")))),
      h("div", { class: "divider" }),
      h("div", { class: "buttons" }, saveBtn, resetBtn)
    )
  );
}

// Legacy SOP list page (kept for reference; replaced by SOP-key Hub below).
function renderSopsLegacy() {
  const entries = Object.entries(state.data.sops || {}).sort((a, b) => a[0].localeCompare(b[0], "zh-Hans-CN"));

  function openSopEditor({ key, steps, mode }) {
    const isNew = mode === "new";
    const keyInput = h("input", { value: key || "", placeholder: "例如：发布公众号 / 报销 / 剪辑视频" });
    const textarea = h("textarea", {
      placeholder: "每行一个步骤",
      text: Array.isArray(steps) ? steps.join("\n") : "",
    });

    const body = h(
      "div",
      { class: "col" },
      h("div", {}, h("label", { text: "事项（SOP 名称）" }), keyInput),
      h("div", {}, h("label", { text: "步骤" }), textarea)
    );

    const footer = h(
      "div",
      { class: "buttons" },
      h(
        "button",
        {
          class: "btn btn--primary",
          onclick: () => {
            const nextKey = keyInput.value.trim();
            if (!nextKey) {
              toast("事项不能为空");
              keyInput.focus();
              return;
            }
            const nextSteps = textarea.value
              .split(/\r?\n/g)
              .map((s) => s.trim())
              .filter(Boolean);
            const oldKey = (key || "").trim();
            if (oldKey && oldKey !== nextKey) delete state.data.sops[oldKey];
            state.data.sops[nextKey] = nextSteps;
            persist();
            ctrl.close();
            toast(isNew ? "已创建 SOP" : "已保存 SOP");
            render();
          },
        },
        isNew ? "创建" : "保存"
      ),
      h("button", { class: "btn", onclick: () => ctrl.close() }, "取消")
    );

    const ctrl = openModal({ title: isNew ? "新建 SOP" : "编辑 SOP", body, footer });
    keyInput.focus();
  }

  const list = h(
    "div",
    { class: "list" },
    ...entries.map(([k, steps]) => {
      const count = Array.isArray(steps) ? steps.length : 0;
      return h(
        "div",
        { class: "card" },
        h("div", { class: "row" }, h("div", { class: "h1", text: k }), h("div", { class: "meta" }, h("span", { class: "tag", text: `${count} steps` }))),
        count ? h("div", { class: "muted" }, (steps || []).slice(0, 3).join(" · ") + (count > 3 ? " ..." : "")) : h("div", { class: "muted" }, "（空）"),
        h(
          "div",
          { class: "divider" },
        ),
        h(
          "div",
          { class: "buttons" },
          h("button", { class: "btn btn--primary", onclick: () => openSopEditor({ key: k, steps, mode: "edit" }) }, "编辑"),
          h("button", { class: "btn", onclick: () => copyToClipboard((steps || []).join("\n")) }, "复制步骤"),
          h(
            "button",
            {
              class: "btn btn--danger",
              onclick: () => {
                const ok = window.confirm(`确定删除 SOP？\\n\\n${k}`);
                if (!ok) return;
                delete state.data.sops[k];
                persist();
                toast("已删除 SOP");
                render();
              },
            },
            "删除"
          )
        )
      );
    })
  );

  return h(
    "div",
    { class: "col" },
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "row" },
        h("div", { class: "h1", text: "SOP 库" }),
        h(
          "div",
          { class: "buttons" },
          h("button", { class: "btn btn--primary", onclick: () => openSopEditor({ key: "", steps: [], mode: "new" }) }, "+ 新建 SOP"),
          h("button", { class: "btn", onclick: () => setView("settings") }, "返回")
        )
      ),
      h("div", { class: "divider" }),
      entries.length ? list : h("div", { class: "muted" }, "还没有 SOP。建议完成一次任务后沉淀，或在这里手动新建。")
    )
  );
}

// SOP-key Hub: manage SOP steps + shared links + auto-open by "事项(sopKey)"
// Note: This overrides the legacy `renderSops()` defined earlier in this file.
function renderSops() {
  function openLinksQuick(list, title) {
    openUrlsStable(list, title);
  }

  function ensureMaps() {
    if (!state.data.sops || typeof state.data.sops !== "object") state.data.sops = {};
    if (!state.data.sopLinks || typeof state.data.sopLinks !== "object") state.data.sopLinks = {};
    if (!state.data.sopAutoOpenLinks || typeof state.data.sopAutoOpenLinks !== "object") state.data.sopAutoOpenLinks = {};
  }

  function collectAllSopKeys() {
    const out = new Set();
    for (const k of Object.keys(state.data.sops || {})) out.add(String(k || "").trim());
    for (const k of Object.keys(state.data.sopLinks || {})) out.add(String(k || "").trim());
    for (const k of Object.keys(state.data.sopAutoOpenLinks || {})) out.add(String(k || "").trim());
    for (const t of state.data.tasks || []) {
      const k = String(t?.sopKey || "").trim();
      if (k) out.add(k);
    }
    return Array.from(out).filter(Boolean).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }

  function renameSopKeyEverywhere(oldKey, nextKey) {
    const from = String(oldKey || "").trim();
    const to = String(nextKey || "").trim();
    if (!from || !to || from === to) return;

    if (state.data.sops?.[from] !== undefined) {
      state.data.sops[to] = state.data.sops[from];
      delete state.data.sops[from];
    }
    if (state.data.sopLinks?.[from] !== undefined) {
      state.data.sopLinks[to] = normalizeLinks(state.data.sopLinks[from]);
      delete state.data.sopLinks[from];
    }
    if (state.data.sopAutoOpenLinks?.[from] !== undefined) {
      state.data.sopAutoOpenLinks[to] = Boolean(state.data.sopAutoOpenLinks[from]);
      delete state.data.sopAutoOpenLinks[from];
    }

    // Keep tasks consistent (best-effort)
    for (const t of state.data.tasks || []) {
      if (String(t?.sopKey || "").trim() === from) {
        t.sopKey = to;
        t.updatedAt = new Date().toISOString();
      }
    }
  }

  function deleteSopKeyAssets(key) {
    const k = String(key || "").trim();
    if (!k) return;
    if (state.data.sops) delete state.data.sops[k];
    if (state.data.sopLinks) delete state.data.sopLinks[k];
    if (state.data.sopAutoOpenLinks) delete state.data.sopAutoOpenLinks[k];
  }

  function openSopKeyEditor({ key, mode }) {
    ensureMaps();
    const isNew = mode === "new";
    const oldKey = String(key || "").trim();
    const existingSteps = Array.isArray(state.data.sops?.[oldKey]) ? state.data.sops[oldKey] : [];
    const existingLinks = getSopLinks(oldKey);
    const existingAutoOpen = shouldAutoOpenSopLinks(oldKey);

    const keyInput = h("input", { value: oldKey, placeholder: "例如：报销 / 发布公众号 / 剪辑视频" });
    const autoOpenInput = h("input", { type: "checkbox", checked: existingAutoOpen ? "checked" : null });

    const stepsTextarea = h("textarea", {
      text: (existingSteps || []).join("\n"),
      placeholder: "SOP：每行一个步骤；可用前缀：! 注意 / @检查点 / -> 提升点（可不写）",
    });
    const linksTextarea = h("textarea", {
      text: (existingLinks || []).join("\n"),
      placeholder: "共享链接：每行一个；同事项任务可复用；开始前可选择是否自动打开",
    });

    const body = h(
      "div",
      { class: "col" },
      h("div", {}, h("label", { text: "事项（sopKey）" }), keyInput),
      h(
        "div",
        { class: "check" },
        autoOpenInput,
        h(
          "div",
          {},
          h("div", { class: "taskTitle", text: "默认自动打开共享链接" }),
          h("div", { class: "muted" }, "开启后：同事项任务开始前会默认勾选“自动打开链接”")
        )
      ),
      h("div", { class: "divider" }),
      h("div", {}, h("label", { text: "SOP 步骤" }), stepsTextarea),
      h("div", { class: "divider" }),
      h("div", {}, h("label", { text: "共享链接（同事项复用）" }), linksTextarea),
      h(
        "div",
        { class: "buttons" },
        h(
          "button",
          {
            class: "btn",
            onclick: () => openLinksQuick(linksTextarea.value.split(/\r?\n/g), `链接面板：${keyInput.value.trim() || oldKey || "事项"}`),
          },
          "打开链接"
        ),
        h(
          "button",
          {
            class: "btn",
            onclick: () => copyToClipboard(normalizeLinks(linksTextarea.value.split(/\r?\n/g)).join("\n")),
          },
          "复制链接"
        )
      )
    );

    const footer = h(
      "div",
      { class: "buttons" },
      h(
        "button",
        {
          class: "btn btn--primary",
          onclick: () => {
            const nextKey = keyInput.value.trim();
            if (!nextKey) {
              toast("事项不能为空");
              keyInput.focus();
              return;
            }

            ensureMaps();
            renameSopKeyEverywhere(oldKey, nextKey);

            const nextSteps = stepsTextarea.value
              .split(/\r?\n/g)
              .map((s) => s.trim())
              .filter(Boolean);
            const nextLinks = normalizeLinks(linksTextarea.value.split(/\r?\n/g));
            const nextAutoOpen = Boolean(autoOpenInput.checked);

            // Allow empty SOP steps; item may exist only for shared links.
            state.data.sops[nextKey] = nextSteps;

            if (nextLinks.length) state.data.sopLinks[nextKey] = nextLinks;
            else delete state.data.sopLinks[nextKey];

            if (nextAutoOpen) state.data.sopAutoOpenLinks[nextKey] = true;
            else delete state.data.sopAutoOpenLinks[nextKey];

            persist();
            ctrl.close();
            toast(isNew ? "已创建事项" : "已保存事项");
            render();
          },
        },
        isNew ? "创建" : "保存"
      ),
      h("button", { class: "btn", onclick: () => ctrl.close() }, "取消")
    );

    const ctrl = openModal({ title: isNew ? "新建事项" : "管理事项", body, footer });
    keyInput.focus();
  }

  const searchInput = h("input", { placeholder: "搜索事项（sopKey）..." });
  const listEl = h("div", { class: "list" });

  function rebuildList() {
    const q = String(searchInput.value || "").trim().toLowerCase();
    const keys = collectAllSopKeys().filter((k) => (q ? k.toLowerCase().includes(q) : true));

    listEl.replaceChildren(
      ...keys.map((k) => {
        const steps = Array.isArray(state.data.sops?.[k]) ? state.data.sops[k] : [];
        const links = getSopLinks(k);
        const autoOpen = shouldAutoOpenSopLinks(k);

        const meta = h(
          "div",
          { class: "meta" },
          h("span", { class: "tag", text: `${steps.length} steps` }),
          h("span", { class: "tag", text: `🔗 ${links.length}` }),
          autoOpen ? h("span", { class: "tag", text: "默认自动打开" }) : null
        );

        const previewParts = [];
        if (steps.length) previewParts.push((steps || []).slice(0, 2).join(" · ") + (steps.length > 2 ? " ..." : ""));
        if (links.length) previewParts.push(`链接示例：${links[0]}`);

        return h(
          "div",
          { class: "card" },
          h("div", { class: "row" }, h("div", { class: "h1", text: k }), meta),
          previewParts.length ? h("div", { class: "muted" }, previewParts.join(" / ")) : h("div", { class: "muted" }, "暂无 SOP 与共享链接"),
          h("div", { class: "divider" }),
          h(
            "div",
            { class: "buttons" },
            h("button", { class: "btn btn--primary", onclick: () => openSopKeyEditor({ key: k, mode: "edit" }) }, "管理"),
            links.length ? h("button", { class: "btn", onclick: () => openLinksQuick(links, `链接面板：${k}`) }, "打开链接") : null,
            h(
              "button",
              {
                class: "btn btn--danger",
                onclick: () => {
                  const ok = window.confirm(`确定删除该事项的资产（SOP / 共享链接 / 默认自动打开）？\n\n${k}`);
                  if (!ok) return;
                  deleteSopKeyAssets(k);
                  persist();
                  toast("已删除事项资产");
                  rebuildList();
                },
              },
              "删除"
            )
          )
        );
      })
    );
  }

  searchInput.addEventListener("input", rebuildList);
  rebuildList();

  return h(
    "div",
    { class: "col" },
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "row" },
        h("div", { class: "h1", text: "事项库（sopKey）" }),
        h(
          "div",
          { class: "buttons" },
          h("button", { class: "btn btn--primary", onclick: () => openSopKeyEditor({ key: "", mode: "new" }) }, "+ 新建事项"),
          h("button", { class: "btn", onclick: () => setView("settings") }, "返回")
        )
      ),
      h("div", { class: "divider" }),
      h("div", {}, h("label", { text: "搜索" }), searchInput),
      h("div", { class: "divider" }),
      listEl,
      h("div", { class: "divider" }),
      h("div", { class: "muted" }, "说明：事项资产包含 SOP 步骤、共享链接、默认自动打开开关；同事项任务可复用共享链接。")
    )
  );
}

function formatMs(ms) {
  const clamped = Math.max(0, ms);
  const totalSec = Math.floor(clamped / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function renderFocus() {
  const sess = state.session;
  if (!sess) {
    setView("home");
    return h("div", {}, "");
  }
  const task = state.data.tasks.find((t) => t.id === sess.taskId);
  if (!task) {
    setView("home");
    return h("div", {}, "");
  }

  const timerEl = h("div", { class: "timer", text: "00:00" });
  const dod = sess.definitionOfDone?.trim()
    ? sess.definitionOfDone.trim()
    : "完成标准：做到你愿意提交 / 发布 / 交付。";

  const sopKey = (sess.sopKey || getSopKey(task) || task.title).trim();
  const links = getEffectiveLinks(task, sopKey);
  const sopSteps = sess.useSop ? state.data.sops[sopKey] || [] : [];
  const checklist = h("div", { class: "checklist" });
  if (sopSteps.length) {
    for (const step of sopSteps) {
      const cb = h("input", { type: "checkbox" });
      checklist.appendChild(
        h("label", { class: "check" }, cb, h("div", {}, h("div", { class: "taskTitle", text: step })))
      );
    }
  }

  // Notes / ideas during execution (saved to the task)
  let draftSaveTimer = null;
  const noteInput = h("textarea", {
    placeholder: "随手记：灵感、要点、下一步（会自动保存草稿）",
    text: task.noteDraft || "",
  });
  const notesList = h("div", { class: "list" });

  function rebuildNotesList() {
    const cur = state.data.tasks.find((t) => t.id === sess.taskId);
    const notes = Array.isArray(cur?.notes) ? cur.notes : [];
    notesList.replaceChildren(
      ...notes
        .slice(-5)
        .reverse()
        .map((n) =>
          h(
            "div",
            { class: "card" },
            h("div", { class: "muted" }, new Date(n.createdAt).toLocaleString()),
            h("div", {}, n.text)
          )
        )
    );
  }

  function saveDraftNow() {
    const cur = state.data.tasks.find((t) => t.id === sess.taskId);
    if (!cur) return;
    const nextDraft = noteInput.value;
    if (nextDraft === (cur.noteDraft || "")) return;
    upsertTask({ ...cur, noteDraft: nextDraft, updatedAt: new Date().toISOString() });
  }

  noteInput.addEventListener("input", () => {
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(saveDraftNow, 350);
  });
  noteInput.addEventListener("blur", saveDraftNow);

  function buildPracticeSessionBase(endedAtMsOverride) {
    const endedAtMs = Number.isFinite(endedAtMsOverride) ? endedAtMsOverride : Date.now();
    const startedAtIso = new Date(sess.startedAt).toISOString();
    const endedAtIso = new Date(endedAtMs).toISOString();
    const actualSec = Math.max(0, Math.round((endedAtMs - sess.startedAt) / 1000));
    return {
      id: newId("s"),
      taskId: sess.taskId,
      sopKey: sopKey,
      taskType: task.type,
      startedAt: startedAtIso,
      endedAt: endedAtIso,
      plannedMin: Number(sess.estimateMin || 0),
      actualSec,
      practiceFocus: (sess.practiceFocus || "").trim(),
    };
  }

  const completeBtn = h(
    "button",
    {
      class: "btn btn--primary",
      onclick: () => {
        const draftText = noteInput.value.trim();
        if (draftText) {
          const ok = window.confirm("你有未保存的笔记草稿，是否保存为笔记？");
          if (ok) {
            const cur = state.data.tasks.find((t) => t.id === sess.taskId);
            if (cur) {
              upsertTask({
                ...cur,
                notes: [...(cur.notes || []), { id: newId("n"), text: draftText, createdAt: new Date().toISOString() }],
                noteDraft: "",
                updatedAt: new Date().toISOString(),
              });
              noteInput.value = "";
              rebuildNotesList();
              toast("已保存笔记");
            }
          } else {
            saveDraftNow();
          }
        } else {
          saveDraftNow();
        }
        stopFocusTicker();
        const srec = { ...buildPracticeSessionBase(), result: "success" };
        appendPracticeSession(srec);
        settleSuccess(task.id);
        state.session = null;
        setView("home");
        openSuccessSettleModal({ sessionId: srec.id, sopKey, taskTitle: task.title, sourceTask: { ...task } });
      },
    },
    "完成"
  );
  const abandonBtn = h(
    "button",
    {
      class: "btn btn--danger",
      onclick: () => {
        const ok = window.confirm("确定放弃？将判定失败。");
        if (!ok) return;
        saveDraftNow();
        stopFocusTicker();
        const endedAtMs = Date.now();
        openFailReasonModal({
          title: "这次没完成，主要原因是？（必选）",
          onSubmit: (failReason) => {
            const label = FAIL_REASONS.find((r) => r.code === failReason)?.label || failReason;
            const frec = { ...buildPracticeSessionBase(endedAtMs), result: "fail", failReason, failTrigger: "abandon" };
            appendPracticeSession(frec);
            settleFail(task.id, `失败 ${state.data.settings.failPoints}：${label}`);
            state.session = null;
            setView("home");
          },
        });
      },
    },
    "放弃"
  );

  const saveNoteBtn = h(
    "button",
    {
      class: "btn btn--primary",
      onclick: () => {
        const text = noteInput.value.trim();
        if (!text) {
          toast("笔记不能为空");
          noteInput.focus();
          return;
        }
        const cur = state.data.tasks.find((t) => t.id === sess.taskId);
        if (!cur) return;
        const next = {
          ...cur,
          notes: [...(cur.notes || []), { id: newId("n"), text, createdAt: new Date().toISOString() }],
          noteDraft: "",
          updatedAt: new Date().toISOString(),
        };
        upsertTask(next);
        noteInput.value = "";
        toast("已保存笔记");
        rebuildNotesList();
      },
    },
    "保存为笔记"
  );

  const view = h(
    "div",
    { class: "col" },
    h(
      "div",
      { class: "card" },
      h("div", { class: "muted" }, "执行态（无暂停）"),
      timerEl,
      h("div", { class: "h1", text: task.title }),
      (sess.practiceFocus || "").trim()
        ? h("div", { class: "muted" }, `🎯 本次练习重点：${(sess.practiceFocus || "").trim()}`)
        : null,
      h("div", { class: "muted" }, dod),
      links.length
        ? h(
            "div",
            { class: "meta" },
            h("span", { class: "tag", text: `🔗 ${links.length} links` }),
              h(
              "button",
              {
                class: "btn",
                onclick: () => {
                  openUrlsStable(links, `Links: ${task.title}`);
                },
              },
              "打开链接"
            )
          )
        : null,
      sopSteps.length ? h("div", { class: "divider" }) : null,
      sopSteps.length ? h("div", { class: "muted" }, `SOP（事项：${sopKey}）：`) : null,
      sopSteps.length ? checklist : null,
      h("div", { class: "divider" }),
      h("div", { class: "buttons" }, completeBtn, abandonBtn)
    ),
    h(
      "div",
      { class: "card" },
      h("div", { class: "h1", text: "灵感 / 笔记" }),
      h("div", { class: "muted" }, "输入会自动保存草稿；点“保存为笔记”会生成一条记录。"),
      h("div", { class: "divider" }),
      noteInput,
      h("div", { class: "divider" }),
      h("div", { class: "buttons" }, saveNoteBtn),
      h("div", { class: "divider" }),
      h("div", { class: "muted" }, "最近笔记（最多 5 条）："),
      notesList
    ),
    h(
      "div",
      { class: "card" },
      h("div", { class: "muted" }, "分心了？先把它写进任务池，再回来继续。"),
      h("div", { class: "divider" }),
      h("div", { class: "buttons" }, h("button", { class: "btn", onclick: () => openTaskEditor({ mode: "new" }) }, "+ 快速添加任务"))
    )
  );

  rebuildNotesList();
  stopFocusTicker();
  focusTicker = window.setInterval(() => {
    const left = sess.endsAt - Date.now();
    timerEl.textContent = formatMs(left);
    document.title = `${formatMs(left)} · ${task.title}`;
    if (left <= 0) {
      saveDraftNow();
      stopFocusTicker();
      const endedAtMs = Date.now();
      openFailReasonModal({
        title: "时间到了，主要原因是？（必选）",
        onSubmit: (failReason) => {
          const label = FAIL_REASONS.find((r) => r.code === failReason)?.label || failReason;
          const frec = { ...buildPracticeSessionBase(endedAtMs), result: "fail", failReason, failTrigger: "timeout" };
          appendPracticeSession(frec);
          settleFail(task.id, `失败 ${state.data.settings.failPoints}：${label}`);
          state.session = null;
          setView("home");
          document.title = "Execution Panel (MVP)";
        },
      });
    }
  }, 250);

  return view;
}

function render() {
  stopFocusTicker();
  document.title = "Execution Panel (MVP)";

  let viewEl = null;
  if (state.view === "home") viewEl = renderHome();
  else if (state.view === "tasks") viewEl = renderTaskPool();
  else if (state.view === "settings") viewEl = renderSettings();
  else if (state.view === "sops") viewEl = renderSops();
  else if (state.view === "history") viewEl = renderPracticeHistory();
  else if (state.view === "focus") viewEl = renderFocus();

  appEl.replaceChildren(viewEl);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

renderStats();
render();
registerServiceWorker();
