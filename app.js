import { clearData, hasLocalData, loadData, loadRemoteState, newId, saveData, saveRemoteData } from "./storage.js";

const appEl = document.getElementById("app");
const statsEl = document.getElementById("stats");
const toastEl = document.getElementById("toast");
const modalRoot = document.getElementById("modalRoot");

const state = {
  data: loadData(),
  view: "home", // home | items | focus | settings
  session: null,
  sync: "local",
  localHadData: hasLocalData(),
};

let focusTicker = null;
let remoteSaveTimer = null;

const FAIL_REASONS = [
  { code: "difficulty_misjudge", label: "难度判断失误" },
  { code: "interrupted", label: "专注被打断" },
  { code: "steps_bad", label: "步骤与检查不合理" },
  { code: "goal_unclear", label: "目标不清晰" },
  { code: "bad_state", label: "状态不好" },
];

const GOAL_PROGRESS = [
  { code: "closer", label: "更靠近目标" },
  { code: "same", label: "差不多" },
  { code: "off", label: "偏离目标" },
];

const FAIL_REASON_LABELS = Object.fromEntries(FAIL_REASONS.map((r) => [r.code, r.label]));
const GOAL_PROGRESS_LABELS = Object.fromEntries(GOAL_PROGRESS.map((r) => [r.code, r.label]));

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

function persist() {
  state.data = saveData(state.data);
  state.localHadData = true;
  renderStats();
  scheduleRemoteSave();
}

function isRemoteNewer(remote, local) {
  const remoteTime = Date.parse(remote?.updatedAt || "");
  const localTime = Date.parse(local?.updatedAt || "");
  if (!Number.isFinite(remoteTime)) return false;
  if (!Number.isFinite(localTime)) return true;
  return remoteTime > localTime;
}

function hasMeaningfulData(data) {
  return Boolean((data?.items || []).length || (data?.practices || []).length || (data?.inbox || []).length);
}

function scheduleRemoteSave() {
  window.clearTimeout(remoteSaveTimer);
  remoteSaveTimer = window.setTimeout(async () => {
    const ok = await saveRemoteData(state.data);
    state.sync = ok ? "synced" : "offline";
    renderStats();
  }, 350);
}

async function hydrateRemoteData() {
  const remoteState = await loadRemoteState();
  if (!remoteState.reachable) {
    state.sync = "offline";
    renderStats();
    return;
  }

  const remote = remoteState.data;
  if (remote && (!state.localHadData || !hasMeaningfulData(state.data) || isRemoteNewer(remote, state.data))) {
    state.data = remote;
    saveData(state.data);
    state.localHadData = true;
    state.sync = "synced";
    renderStats();
    render();
    toast("已同步共享数据");
    return;
  }

  state.sync = "synced";
  renderStats();
  if (hasMeaningfulData(state.data)) scheduleRemoteSave();
}

function renderStats() {
  const { points, streak } = state.data.stats;
  const syncLabel = state.sync === "synced" ? "已连接共享服务" : "未连接共享服务";
  statsEl.replaceChildren(
    h("div", { class: "pill" }, "points ", h("code", { text: String(points) })),
    h("div", { class: "pill" }, "streak ", h("code", { text: String(streak) })),
    h("div", { class: `pill ${state.sync === "synced" ? "pill--ok" : "pill--warn"}` }, syncLabel)
  );
}

function setView(view) {
  state.view = view;
  document.documentElement.classList.toggle("focusMode", view === "focus");
  render();
}

function stopFocusTicker() {
  if (!focusTicker) return;
  window.clearInterval(focusTicker);
  focusTicker = null;
}

function openModal({ title, body, footer, onClose, dismissible = true }) {
  modalRoot.setAttribute("aria-hidden", "false");
  modalRoot.replaceChildren(
    h(
      "div",
      { class: "modal", role: "dialog", "aria-modal": "true" },
      h(
        "div",
        { class: "modalHeader" },
        h("div", { class: "modalTitle", text: title || "" }),
        dismissible ? h("button", { class: "btn btn--ghost", onclick: () => closeModal() }, "关闭") : null
      ),
      h("div", { class: "divider" }),
      body,
      footer ? h("div", { class: "divider" }) : null,
      footer
    )
  );

  function closeModal() {
    modalRoot.setAttribute("aria-hidden", "true");
    modalRoot.replaceChildren();
    modalRoot.onclick = null;
    onClose?.();
  }

  modalRoot.onclick = dismissible
    ? (e) => {
        if (e.target === modalRoot) closeModal();
      }
    : null;
  return { close: closeModal };
}

function formatDate(value) {
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

function formatMs(ms) {
  const clamped = Math.max(0, ms);
  const totalSec = Math.floor(clamped / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function normalizeLines(value) {
  return String(value || "").split(/\r?\n/g).map((s) => s.trim()).filter(Boolean);
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

function stepText(step) {
  return typeof step === "string" ? step : String(step?.text || "").trim();
}

function stepId(step) {
  return typeof step === "string" ? stepText(step) : String(step?.id || step?.text || "").trim();
}

function linkUrl(link) {
  return typeof link === "string" ? link : String(link?.url || "").trim();
}

function linkTitle(link) {
  return typeof link === "string" ? "" : String(link?.title || "").trim();
}

function linkId(link) {
  return typeof link === "string" ? linkUrl(link) : String(link?.id || link?.url || "").trim();
}

function linkLabel(link) {
  const title = linkTitle(link);
  if (title) return title;
  const url = linkUrl(link);
  try {
    return new URL(toOpenableUrl(url) || url).hostname || url;
  } catch {
    return url || "未命名链接";
  }
}

function parseLinkLine(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;
  const parts = raw.split("|");
  if (parts.length >= 2) {
    const title = parts.shift().trim();
    const url = parts.join("|").trim();
    if (!url) return null;
    return { ...createLink(url), title };
  }
  return createLink(raw);
}

function createStep(text) {
  const s = String(text || "").trim();
  const type = s.startsWith("@") ? "check" : s.startsWith("!") ? "warning" : s.startsWith("->") || s.startsWith("↑") ? "improvement" : "action";
  return s ? { id: newId("step"), text: s, type, order: 0, createdAt: new Date().toISOString(), archivedAt: "" } : null;
}

function createLink(url) {
  const s = String(url || "").trim();
  return s ? { id: newId("link"), url: s, title: "", order: 0, createdAt: new Date().toISOString(), lastUsedAt: "", archivedAt: "" } : null;
}

function toOpenableUrl(raw) {
  const s0 = String(raw || "").trim();
  if (!s0) return null;
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s0);
  const isLikelyLocal =
    /^(localhost)([:/]|$)/i.test(s0) ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(s0);
  const candidate = hasScheme ? s0 : `${isLikelyLocal ? "http" : "https"}://${s0.replace(/^\/\//, "")}`;
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制到剪贴板");
  } catch {
    toast("复制失败：请手动复制");
  }
}

function openLinksPanel(links, title = "共享链接") {
  const valid = [];
  const invalid = [];
  for (const link of links || []) {
    const rawUrl = linkUrl(link);
    const url = toOpenableUrl(rawUrl);
    if (url) valid.push({ id: linkId(link), url });
    else invalid.push(rawUrl);
  }
  if (!valid.length) {
    toast("没有可打开的链接");
    return;
  }
  if (invalid.length) toast(`有 ${invalid.length} 个链接格式不对，已跳过`);

  const body = h(
    "div",
    { class: "col" },
    h("div", { class: "muted" }, "逐个打开更稳定，也可以复制全部链接。"),
    h("div", { class: "buttons" }, h("button", { class: "btn", onclick: () => copyToClipboard(valid.map((l) => l.url).join("\n")) }, "复制全部")),
    h(
      "div",
      { class: "list" },
      ...valid.map((link) =>
        h(
          "div",
          { class: "card" },
          h("div", { class: "muted", text: link.url }),
          h("div", { class: "buttons" }, h("a", { class: "btn btn--primary", href: link.url, target: "_blank", rel: "noopener noreferrer" }, "打开"))
        )
      )
    )
  );
  openModal({ title, body });
}

function getItem(itemId) {
  return (state.data.items || []).find((i) => i.id === itemId) || null;
}

function getItemPractices(itemId) {
  return (state.data.practices || [])
    .filter((s) => s.itemId === itemId)
    .sort((a, b) => String(b.endedAt || "").localeCompare(String(a.endedAt || "")));
}

function getItemStats(item) {
  const practices = getItemPractices(item.id);
  const success = practices.filter((s) => s.result === "success").length;
  const fail = practices.filter((s) => s.result === "fail").length;
  const last = practices[0] || null;
  const failCounts = {};
  const progressCounts = { closer: 0, same: 0, off: 0 };
  let totalChecked = 0;
  let totalSteps = 0;
  for (const s of practices) {
    if (s.failReason) failCounts[s.failReason] = (failCounts[s.failReason] || 0) + 1;
    if (progressCounts[s.progressRating] !== undefined) progressCounts[s.progressRating] += 1;
    totalChecked += Number(s.stepsChecked || 0);
    totalSteps += Number(s.stepsTotal || 0);
  }
  const topFail = Object.entries(failCounts).sort((a, b) => b[1] - a[1])[0];
  const completionRate = practices.length ? Math.round((success / practices.length) * 100) : 0;
  const closerRate = practices.length ? Math.round((progressCounts.closer / practices.length) * 100) : 0;
  const stepCheckRate = totalSteps ? Math.round((totalChecked / totalSteps) * 100) : 0;
  return { practices, total: practices.length, success, fail, last, topFail, progressCounts, completionRate, closerRate, stepCheckRate };
}

function sortedItems() {
  return [...(state.data.items || [])].sort((a, b) => {
    const sa = getItemStats(a).last?.endedAt || a.updatedAt || "";
    const sb = getItemStats(b).last?.endedAt || b.updatedAt || "";
    return String(sb).localeCompare(String(sa));
  });
}

function getRecommendedItem() {
  const items = sortedItems();
  if (!items.length) return null;
  const noSession = items.find((i) => getItemStats(i).total === 0);
  if (noSession) return noSession;
  return items[0];
}

function upsertItem(item) {
  const idx = state.data.items.findIndex((i) => i.id === item.id);
  if (idx >= 0) state.data.items[idx] = item;
  else state.data.items.push(item);
  persist();
}

function deleteItem(itemId) {
  state.data.items = state.data.items.filter((i) => i.id !== itemId);
  state.data.practices = state.data.practices.filter((s) => s.itemId !== itemId);
  persist();
}

function appendPractice(practice) {
  state.data.practices = [...(state.data.practices || []), practice].slice(-500);
  persist();
}

function addInboxTask(title, note = "") {
  const text = String(title || "").trim();
  if (!text) return null;
  const task = {
    id: newId("inbox"),
    title: text,
    note: String(note || "").trim(),
    status: "todo",
    promotedToItemId: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.data.inbox = [task, ...(state.data.inbox || [])];
  persist();
  return task;
}

function updateInboxTask(taskId, patch) {
  state.data.inbox = (state.data.inbox || []).map((t) => (t.id === taskId ? { ...t, ...(patch || {}), updatedAt: new Date().toISOString() } : t));
  persist();
}

function deleteInboxTask(taskId) {
  state.data.inbox = (state.data.inbox || []).filter((t) => t.id !== taskId);
  persist();
}

function promoteInboxTask(task) {
  openItemEditor({
    id: newId("i"),
    name: task.title,
    goal: "",
    steps: [],
    links: [],
    defaultEstimateMin: state.data.settings.defaultEstimateMin,
    nextPracticeFocus: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _fromInboxId: task.id,
  });
}

function openItemEditor(item) {
  const isNew = !item;
  const initial = item || {
    id: newId("i"),
    name: "",
    goal: "",
    steps: [],
    links: [],
    defaultEstimateMin: state.data.settings.defaultEstimateMin,
    nextPracticeFocus: "",
    createdAt: new Date().toISOString(),
  };

  const nameInput = h("input", { value: initial.name, placeholder: "例如：写公众号 / 剪视频 / 英语口语" });
  const goalInput = h("textarea", { text: initial.goal, placeholder: "这个事项长期想靠近什么目标？例如：写出更有转化力、有观点、有行动的文章" });
  let stepsDraft = [...(initial.steps || [])];
  let draggingStepIndex = null;
  const stepsList = h("div", { class: "stepEditor" });
  const newStepInput = h("input", { placeholder: "新增步骤或检查，例如：@ 开头是否有具体场景？" });
  const linksInput = h("textarea", { text: (initial.links || []).map((l) => `${linkTitle(l) ? `${linkTitle(l)} | ` : ""}${linkUrl(l)}`).join("\n"), placeholder: "共享链接：每行一个；推荐格式：选题库 | https://..." });
  const estimateInput = h("input", { type: "number", min: "1", value: String(initial.defaultEstimateMin || state.data.settings.defaultEstimateMin) });

  function moveStep(from, to) {
    if (to < 0 || to >= stepsDraft.length || from === to) return;
    const next = [...stepsDraft];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    stepsDraft = next;
    rebuildSteps();
  }

  function rebuildSteps() {
    stepsList.replaceChildren(
      ...(stepsDraft.length
        ? stepsDraft.map((step, index) =>
            h(
              "div",
              {
                class: "stepRow",
                draggable: "true",
                ondragstart: () => {
                  draggingStepIndex = index;
                },
                ondragover: (e) => e.preventDefault(),
                ondrop: (e) => {
                  e.preventDefault();
                  if (draggingStepIndex === null) return;
                  moveStep(draggingStepIndex, index);
                  draggingStepIndex = null;
                },
              },
              h("div", { class: "stepHandle", text: "↕" }),
              h("div", { class: "stepText", text: stepText(step) }),
              h("button", { class: "btn", onclick: () => moveStep(index, index - 1) }, "↑"),
              h("button", { class: "btn", onclick: () => moveStep(index, index + 1) }, "↓"),
              h("button", { class: "btn btn--danger", onclick: () => { stepsDraft = stepsDraft.filter((_, i) => i !== index); rebuildSteps(); } }, "删")
            )
          )
        : [h("div", { class: "muted", text: "还没有步骤与检查。" })])
    );
  }

  function addStepFromInput() {
    const value = newStepInput.value.trim();
    if (!value) {
      newStepInput.focus();
      return;
    }
    stepsDraft = [...stepsDraft, createStep(value)];
    newStepInput.value = "";
    rebuildSteps();
  }

  rebuildSteps();

  const body = h(
    "div",
    { class: "col" },
    h("div", {}, h("label", { text: "事项名" }), nameInput),
    h("div", {}, h("label", { text: "长期目标" }), goalInput),
    h(
      "div",
      {},
      h("label", { text: "步骤与检查（可拖动排序）" }),
      stepsList,
      h("div", { class: "inlineAdd" }, newStepInput, h("button", { class: "btn", onclick: addStepFromInput }, "+ 添加"))
    ),
    h("div", {}, h("label", { text: "共享链接" }), linksInput),
    h("div", {}, h("label", { text: "默认预计用时（分钟）" }), estimateInput)
  );

  const footer = h(
    "div",
    { class: "buttons" },
    h(
      "button",
      {
        class: "btn btn--primary",
        onclick: () => {
          const name = nameInput.value.trim();
          if (!name) {
            toast("事项名不能为空");
            nameInput.focus();
            return;
          }
          upsertItem({
            ...initial,
            name,
            goal: goalInput.value.trim(),
            steps: stepsDraft.map((s, order) => (typeof s === "string" ? createStep(s) : { ...s, order })).filter((s) => stepText(s)),
            links: normalizeLines(linksInput.value).map(parseLinkLine).filter(Boolean).map((link, order) => ({ ...link, order })),
            defaultEstimateMin: Math.max(1, Number.parseInt(estimateInput.value || "1", 10)),
            updatedAt: new Date().toISOString(),
          });
          if (initial._fromInboxId) {
            updateInboxTask(initial._fromInboxId, { status: "done", promotedToItemId: initial.id });
          }
          ctrl.close();
          toast(isNew ? "已创建事项" : "已保存事项");
          render();
        },
      },
      isNew ? "创建事项" : "保存"
    ),
    h("button", { class: "btn", onclick: () => ctrl.close() }, "取消")
  );

  const ctrl = openModal({ title: isNew ? "新建事项" : "编辑事项", body, footer });
  nameInput.focus();
}

function openPracticeSetup(item) {
  const stats = getItemStats(item);
  const taskInput = h("input", { value: `练一次：${item.name}`, placeholder: "这次具体要完成什么？" });
  const focusInput = h("input", {
    value: item.nextPracticeFocus || "",
    maxlength: "80",
    placeholder: "这一次更靠近目标的一小步是什么？",
  });
  const estimateInput = h("input", { type: "number", min: "1", value: String(item.defaultEstimateMin || state.data.settings.defaultEstimateMin) });
  const useStepsInput = h("input", { type: "checkbox", checked: item.steps?.length ? "checked" : null, disabled: item.steps?.length ? null : "disabled" });
  const openLinksInput = h("input", { type: "checkbox", checked: item.links?.length ? "checked" : null, disabled: item.links?.length ? null : "disabled" });

  const body = h(
    "div",
    { class: "col" },
    h("div", { class: "h1", text: item.name }),
    item.goal ? h("div", { class: "muted" }, `长期目标：${item.goal}`) : h("div", { class: "muted" }, "这个事项还没有长期目标。建议先补一句目标。"),
    stats.last ? h("div", { class: "muted" }, `最近一次：${formatDate(stats.last.endedAt)} / ${stats.last.focus || "未填写练习目标"}`) : null,
    h("div", { class: "divider" }),
    h("div", {}, h("label", { text: "本次任务" }), taskInput),
    h("div", {}, h("label", { text: "本次练习目标" }), focusInput),
    h("div", {}, h("label", { text: "预计用时（分钟）" }), estimateInput),
    h("label", { class: "check" }, useStepsInput, h("div", {}, h("div", { class: "taskTitle", text: "加载步骤与检查" }), h("div", { class: "muted" }, item.steps?.length ? `${item.steps.length} 条` : "该事项还没有步骤与检查"))),
    h("label", { class: "check" }, openLinksInput, h("div", {}, h("div", { class: "taskTitle", text: "打开共享链接" }), h("div", { class: "muted" }, item.links?.length ? `${item.links.length} 个` : "该事项还没有共享链接")))
  );

  const footer = h(
    "div",
    { class: "buttons" },
    h(
      "button",
      {
        class: "btn btn--primary",
        onclick: () => {
          const taskTitle = taskInput.value.trim();
          if (!taskTitle) {
            toast("本次任务不能为空");
            taskInput.focus();
            return;
          }
          const estimateMin = Math.max(1, Number.parseInt(estimateInput.value || "1", 10));
          startPractice(item, {
            taskTitle,
            focus: focusInput.value.trim(),
            estimateMin,
            useSteps: Boolean(useStepsInput.checked && !useStepsInput.disabled),
            openLinks: Boolean(openLinksInput.checked && !openLinksInput.disabled),
          });
          ctrl.close();
        },
      },
      "开始练习"
    ),
    h(
      "button",
      {
        class: "btn",
        onclick: () => {
          item.nextPracticeFocus = focusInput.value.trim();
          item.defaultEstimateMin = Math.max(1, Number.parseInt(estimateInput.value || "1", 10));
          item.updatedAt = new Date().toISOString();
          upsertItem(item);
          ctrl.close();
          toast("已保存为下次练习目标");
          render();
        },
      },
      "保存为下次目标"
    ),
    h("button", { class: "btn", onclick: () => ctrl.close() }, "取消")
  );

  const ctrl = openModal({ title: "继续练一次", body, footer });
  focusInput.focus();
}

function startPractice(item, opts) {
  if (opts.openLinks && item.links?.length) openLinksPanel(item.links, `共享链接：${item.name}`);
  const startedAt = Date.now();
  const initialOpenedLinkIds = opts.openLinks ? (item.links || []).map(linkId).filter(Boolean) : [];
  state.session = {
    itemId: item.id,
    taskTitle: opts.taskTitle,
    focus: opts.focus,
    estimateMin: opts.estimateMin,
    useSteps: opts.useSteps,
    checkedStepIds: [],
    openedLinkIds: initialOpenedLinkIds,
    addedLinkIds: [],
    startedAt,
    endsAt: startedAt + opts.estimateMin * 60_000,
    noteDraft: "",
  };
  item.nextPracticeFocus = opts.focus || item.nextPracticeFocus || "";
  item.defaultEstimateMin = opts.estimateMin;
  item.updatedAt = new Date().toISOString();
  upsertItem(item);
  setView("focus");
}

function buildPracticeBase(item, endedAtMs = Date.now()) {
  const sess = state.session;
  const checkedStepIds = Array.isArray(sess.checkedStepIds) ? sess.checkedStepIds : [];
  const openedLinkIds = Array.isArray(sess.openedLinkIds) ? sess.openedLinkIds : [];
  const addedLinkIds = Array.isArray(sess.addedLinkIds) ? sess.addedLinkIds : [];
  const stepsTotal = sess.useSteps ? (item.steps || []).filter((s) => !s.archivedAt).length : 0;
  const linksTotal = (item.links || []).filter((l) => !l.archivedAt).length;
  return {
    id: newId("practice"),
    itemId: item.id,
    itemNameSnapshot: item.name,
    taskTitle: sess.taskTitle,
    goalSnapshot: item.goal || "",
    focus: sess.focus || "",
    startedAt: new Date(sess.startedAt).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    plannedMin: sess.estimateMin,
    actualSec: Math.max(0, Math.round((endedAtMs - sess.startedAt) / 1000)),
    note: String(sess.noteDraft || "").trim(),
    stepsTotal,
    stepsChecked: checkedStepIds.length,
    checkedStepIds,
    linksTotal,
    linksOpenedCount: openedLinkIds.length,
    linksAddedCount: addedLinkIds.length,
    openedLinkIds,
    addedLinkIds,
  };
}

function openSuccessReview(item, practiceBase) {
  let selected = "";
  const reminderInput = h("input", {
    value: practiceBase.note || "",
    placeholder: "下次提醒自己什么？例如：开头别解释背景，直接进入场景",
  });
  const addReminderInput = h("input", { type: "checkbox", checked: "checked" });

  const progressList = h(
    "div",
    { class: "col" },
    ...GOAL_PROGRESS.map((opt) =>
      h(
        "label",
        { class: "check" },
        h("input", {
          type: "radio",
          name: "progressRating",
          value: opt.code,
          onchange: (e) => {
            selected = e.target.value;
            confirmBtn.disabled = !selected;
          },
        }),
        h("div", {}, h("div", { class: "taskTitle", text: opt.label }))
      )
    )
  );

  const body = h(
    "div",
    { class: "col" },
    item.goal ? h("div", { class: "muted" }, `长期目标：${item.goal}`) : null,
    h("div", { class: "muted" }, "这次是否更靠近事项目标？"),
    progressList,
    practiceBase.note ? h("div", { class: "noteBox" }, h("div", { class: "muted", text: "本次笔记" }), h("div", { text: practiceBase.note })) : null,
    h("div", { class: "divider" }),
    h("div", {}, h("label", { text: "下次提醒（可选）" }), reminderInput),
    h("label", { class: "check" }, addReminderInput, h("div", {}, h("div", { class: "taskTitle", text: "加入步骤与检查" }), h("div", { class: "muted" }, "把这条提醒沉淀到该事项里，下次会自动出现")))
  );

  const confirmBtn = h(
    "button",
    {
      class: "btn btn--primary",
      disabled: "disabled",
      onclick: () => {
        const reminder = reminderInput.value.trim();
        let addedReminderToSteps = false;
        if (reminder && addReminderInput.checked) {
          const reminderText = reminder.startsWith("!") || reminder.startsWith("@") || reminder.startsWith("->") ? reminder : `! ${reminder}`;
          item.steps = [...(item.steps || []), createStep(reminderText)];
          item.updatedAt = new Date().toISOString();
          upsertItem(item);
          addedReminderToSteps = true;
        }
        appendPractice({ ...practiceBase, result: "success", progressRating: selected, reminder, addedReminderToSteps });
        state.data.stats.points += state.data.settings.completePoints;
        state.data.stats.streak += 1;
        state.session = null;
        persist();
        ctrl.close();
        setView("home");
        toast(`完成 +${state.data.settings.completePoints}`);
      },
    },
    "完成复盘"
  );

  const ctrl = openModal({ title: "完成复盘", body, footer: h("div", { class: "buttons" }, confirmBtn), dismissible: false });
}

function openFailReview(item, practiceBase, trigger) {
  let selected = "";
  const addNoteInput = h("input", { type: "checkbox", checked: practiceBase.note ? "checked" : null, disabled: practiceBase.note ? null : "disabled" });
  const body = h(
    "div",
    { class: "col" },
    h("div", { class: "muted" }, trigger === "timeout" ? "时间到了，主要原因是什么？" : "这次没完成，主要原因是什么？"),
    ...FAIL_REASONS.map((reason) =>
      h(
        "label",
        { class: "check" },
        h("input", {
          type: "radio",
          name: "failReason",
          value: reason.code,
          onchange: (e) => {
            selected = e.target.value;
            confirmBtn.disabled = !selected;
          },
        }),
        h("div", {}, h("div", { class: "taskTitle", text: reason.label }))
      )
    ),
    practiceBase.note ? h("div", { class: "noteBox" }, h("div", { class: "muted", text: "本次笔记" }), h("div", { text: practiceBase.note })) : null,
    h("label", { class: "check" }, addNoteInput, h("div", {}, h("div", { class: "taskTitle", text: "把笔记加入步骤与检查" }), h("div", { class: "muted" }, "失败时的卡点通常最值得下次提醒")))
  );

  const confirmBtn = h(
    "button",
    {
      class: "btn btn--primary",
      disabled: "disabled",
      onclick: () => {
        let addedReminderToSteps = false;
        if (practiceBase.note && addNoteInput.checked) {
          const noteText = practiceBase.note.startsWith("!") || practiceBase.note.startsWith("@") || practiceBase.note.startsWith("->") ? practiceBase.note : `! ${practiceBase.note}`;
          item.steps = [...(item.steps || []), createStep(noteText)];
          item.updatedAt = new Date().toISOString();
          upsertItem(item);
          addedReminderToSteps = true;
        }
        appendPractice({ ...practiceBase, result: "fail", failReason: selected, failTrigger: trigger, reminder: practiceBase.note, addedReminderToSteps });
        state.data.stats.points += state.data.settings.failPoints;
        if (state.data.settings.streakResetOnFail) state.data.stats.streak = 0;
        state.session = null;
        persist();
        ctrl.close();
        setView("home");
        toast(`失败 ${state.data.settings.failPoints}：${FAIL_REASON_LABELS[selected] || selected}`);
      },
    },
    "记录失败"
  );

  const ctrl = openModal({ title: "失败复盘", body, footer: h("div", { class: "buttons" }, confirmBtn), dismissible: false });
}

function renderHome() {
  const recommended = getRecommendedItem();
  const items = sortedItems();
  const addBtn = h("button", { class: "btn", onclick: () => openItemEditor() }, "+ 新建事项");
  const itemsBtn = h("button", { class: "btn", onclick: () => setView("items") }, "事项库");
  const settingsBtn = h("button", { class: "btn", onclick: () => setView("settings") }, "设置");
  const inboxInput = h("input", { placeholder: "临时任务、突然想到的事..." });
  const captureInbox = () => {
    const task = addInboxTask(inboxInput.value);
    if (!task) {
      inboxInput.focus();
      return;
    }
    inboxInput.value = "";
    toast("已放进收集箱");
    render();
  };

  if (!recommended) {
    return h(
      "div",
      { class: "homeShell" },
      h(
        "section",
        { class: "emptyState" },
        h("div", { class: "eyebrow", text: "从一个事项开始" }),
        h("div", { class: "displayTitle", text: "创建一类想持续变好的事情" }),
        h("div", { class: "lead", text: "事项会保存长期目标、步骤与检查、共享链接和每次练习记录。" }),
        h("div", { class: "primaryRow" }, h("button", { class: "btn btn--primary btn--xl", onclick: () => openItemEditor() }, "+ 新建第一个事项"))
      )
    );
  }

  const stats = getItemStats(recommended);
  const topFail = stats.topFail ? `${FAIL_REASON_LABELS[stats.topFail[0]] || stats.topFail[0]} ${stats.topFail[1]} 次` : "暂无";

  return h(
    "div",
    { class: "homeShell" },
    h(
      "section",
      { class: "practiceHero" },
      h("div", { class: "eyebrow", text: "推荐继续练习" }),
      h("div", { class: "displayTitle", text: recommended.name }),
      h(
        "div",
        { class: "meta" },
        h("span", { class: "tag", text: `${stats.total} 次练习` }),
        h("span", { class: "tag", text: `成功 ${stats.success}` }),
        h("span", { class: "tag", text: `失败 ${stats.fail}` }),
        recommended.steps?.length ? h("span", { class: "tag", text: `步骤 ${recommended.steps.length}` }) : null,
        recommended.links?.length ? h("span", { class: "tag", text: `链接 ${recommended.links.length}` }) : null
      ),
      recommended.goal ? h("div", { class: "focusLine" }, h("span", { text: "长期目标" }), h("strong", { text: recommended.goal })) : null,
      recommended.nextPracticeFocus ? h("div", { class: "doneLine" }, h("span", { text: "下次练习" }), h("strong", { text: recommended.nextPracticeFocus })) : null,
      h("div", { class: "muted", text: `常见问题：${topFail}` }),
      h(
        "div",
        { class: "primaryRow" },
        h("button", { class: "btn btn--primary btn--xl", onclick: () => openPracticeSetup(recommended) }, "继续练一次"),
        h("button", { class: "btn btn--xl", onclick: () => openItemEditor(recommended) }, "编辑事项"),
        recommended.links?.length ? h("button", { class: "btn btn--xl", onclick: () => openLinksPanel(recommended.links, `共享链接：${recommended.name}`) }, "打开链接") : null
      )
    ),
    h(
      "section",
      { class: "homeGrid" },
      h("div", { class: "sectionTitle", text: "全部事项" }),
      ...items.map(renderItemCard)
    ),
    h(
      "section",
      { class: "card" },
      h("div", { class: "row" }, h("div", { class: "h1", text: "收集箱" }), h("div", { class: "muted", text: "临时待办不进入事项主线" })),
      h("div", { class: "divider" }),
      h("div", { class: "inlineAdd" }, inboxInput, h("button", { class: "btn", onclick: captureInbox }, "+ 记一下")),
      h("div", { class: "divider" }),
      renderInboxList()
    ),
    h("div", { class: "homeNav" }, addBtn, itemsBtn, settingsBtn)
  );
}

function renderInboxList() {
  const tasks = [...(state.data.inbox || [])].filter((t) => t.status !== "done");
  if (!tasks.length) return h("div", { class: "muted", text: "收集箱是空的。" });
  return h("div", { class: "list" }, ...tasks.map(renderInboxTask));
}

function renderInboxTask(task) {
  return h(
    "div",
    { class: "inboxRow" },
    h("div", {}, h("div", { class: "taskTitle", text: task.title }), task.note ? h("div", { class: "muted", text: task.note }) : null),
    h(
      "div",
      { class: "buttons" },
      h("button", { class: "btn", onclick: () => { updateInboxTask(task.id, { status: "done" }); toast("已完成"); render(); } }, "完成"),
      h("button", { class: "btn btn--primary", onclick: () => promoteInboxTask(task) }, "转为事项"),
      h("button", { class: "btn btn--danger", onclick: () => { deleteInboxTask(task.id); toast("已删除"); render(); } }, "删除")
    )
  );
}

function renderItemCard(item) {
  const stats = getItemStats(item);
  return h(
    "div",
    { class: "itemCard" },
    h("div", { class: "row" }, h("div", { class: "h1", text: item.name }), h("div", { class: "meta" }, h("span", { class: "tag", text: `${stats.total} 次` }))),
    item.goal ? h("div", { class: "muted", text: item.goal }) : h("div", { class: "muted", text: "还没有长期目标" }),
    stats.total
      ? h("div", { class: "meta" }, h("span", { class: "tag", text: `完成率 ${stats.completionRate}%` }), h("span", { class: "tag", text: `靠近率 ${stats.closerRate}%` }), h("span", { class: "tag", text: `步骤 ${stats.stepCheckRate}%` }))
      : null,
    stats.last ? h("div", { class: "muted", text: `最近：${formatDate(stats.last.endedAt)}` }) : h("div", { class: "muted", text: "还没有练习记录" }),
    h(
      "div",
      { class: "buttons" },
      h("button", { class: "btn btn--primary", onclick: () => openPracticeSetup(item) }, "继续练"),
      h("button", { class: "btn", onclick: () => openItemEditor(item) }, "编辑")
    )
  );
}

function renderItemsView() {
  const items = sortedItems();
  return h(
    "div",
    { class: "col" },
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "row" },
        h("div", { class: "h1", text: "事项库" }),
        h("div", { class: "buttons" }, h("button", { class: "btn btn--primary", onclick: () => openItemEditor() }, "+ 新建事项"), h("button", { class: "btn", onclick: () => setView("home") }, "返回"))
      ),
      h("div", { class: "divider" }),
      items.length ? h("div", { class: "list" }, ...items.map(renderItemDetailCard)) : h("div", { class: "muted", text: "还没有事项。" })
    )
  );
}

function renderItemDetailCard(item) {
  const stats = getItemStats(item);
  const recent = stats.practices.slice(0, 3);
  return h(
    "div",
    { class: "card" },
    h("div", { class: "row" }, h("div", { class: "h1", text: item.name }), h("div", { class: "meta" }, h("span", { class: "tag", text: `${stats.total} 次练习` }), h("span", { class: "tag", text: `${item.steps?.length || 0} 步骤` }), h("span", { class: "tag", text: `${item.links?.length || 0} 链接` }))),
    stats.total
      ? h(
          "div",
          { class: "metricGrid" },
          h("div", { class: "metricBox" }, h("div", { class: "muted", text: "完成率" }), h("strong", { text: `${stats.completionRate}%` })),
          h("div", { class: "metricBox" }, h("div", { class: "muted", text: "靠近目标" }), h("strong", { text: `${stats.closerRate}%` })),
          h("div", { class: "metricBox" }, h("div", { class: "muted", text: "步骤勾选" }), h("strong", { text: `${stats.stepCheckRate}%` }))
        )
      : null,
    item.goal ? h("div", { class: "muted", text: `目标：${item.goal}` }) : h("div", { class: "muted", text: "目标：未填写" }),
    item.steps?.length ? h("div", { class: "muted", text: `步骤与检查：${item.steps.slice(0, 3).map(stepText).join(" · ")}${item.steps.length > 3 ? " ..." : ""}` }) : null,
    recent.length
      ? h(
          "div",
          { class: "list" },
          ...recent.map((s) =>
            h(
              "div",
              { class: "noteBox" },
              h(
                "div",
                { class: "muted" },
                `${formatDate(s.endedAt)} / ${s.result === "success" ? GOAL_PROGRESS_LABELS[s.progressRating] || "完成" : FAIL_REASON_LABELS[s.failReason] || "失败"} / ${s.focus || s.taskTitle} / 步骤 ${s.stepsChecked || 0}/${s.stepsTotal || 0} / 链接 +${s.linksAddedCount || 0}`
              ),
              s.note ? h("div", { text: s.note }) : null
            )
          )
        )
      : null,
    h(
      "div",
      { class: "buttons" },
      h("button", { class: "btn btn--primary", onclick: () => openPracticeSetup(item) }, "继续练一次"),
      h("button", { class: "btn", onclick: () => openItemEditor(item) }, "编辑"),
      h("button", { class: "btn", onclick: () => copyToClipboard((item.steps || []).map(stepText).join("\n")) }, "复制步骤"),
      h(
        "button",
        {
          class: "btn btn--danger",
          onclick: () => {
            const ok = window.confirm(`确定删除事项及其练习记录？\n\n${item.name}`);
            if (!ok) return;
            deleteItem(item.id);
            toast("已删除事项");
            render();
          },
        },
        "删除"
      )
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
        state.localHadData = false;
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
      h("div", { class: "row" }, h("div", { class: "h1", text: "设置" }), h("div", { class: "buttons" }, h("button", { class: "btn", onclick: () => setView("home") }, "返回"))),
      h("div", { class: "divider" }),
      h("div", { class: "formRow" }, h("div", {}, h("label", { text: "默认预计用时（分钟）" }), defaultEstimateMin), h("div", {}, h("label", { text: "完成奖励 points" }), completePoints)),
      h("div", { class: "formRow" }, h("div", {}, h("label", { text: "失败惩罚 points（负数）" }), failPoints), h("div", {}, h("label", { text: "失败清零 streak" }), h("div", { class: "check" }, streakReset, h("div", { class: "muted" }, "开启：失败 streak=0；关闭：失败不影响 streak")))),
      h("div", { class: "divider" }),
      h("div", { class: "buttons" }, saveBtn, resetBtn)
    )
  );
}

function renderFocus() {
  const sess = state.session;
  if (!sess) {
    setView("home");
    return h("div");
  }
  const item = getItem(sess.itemId);
  if (!item) {
    state.session = null;
    setView("home");
    return h("div");
  }

  const timerEl = h("div", { class: "timer timer--focus", text: "00:00" });
  const noteInput = h("textarea", { class: "practiceNotes", placeholder: "记录发现、卡点、下次提醒。这里会进入复盘和练习记录。", text: sess.noteDraft || "" });
  noteInput.addEventListener("input", () => {
    state.session.noteDraft = noteInput.value;
  });
  const linkTitleInput = h("input", { placeholder: "链接名称，例如：草稿文档" });
  const linkInput = h("input", { placeholder: "链接地址" });
  const linksList = h("div", { class: "list" });
  const distractInput = h("input", { placeholder: "分心了？把想到的事丢进收集箱" });

  function rebuildFocusLinks() {
    linksList.replaceChildren(
      ...(item.links?.length
        ? item.links.map((link) =>
            h(
              "div",
              { class: "linkRow" },
              h("div", {}, h("div", { class: "taskTitle", text: linkLabel(link) }), h("div", { class: "muted", text: linkUrl(link) })),
              h(
                "div",
                { class: "buttons" },
                h("button", {
                  class: "btn",
                  onclick: () => {
                    const id = linkId(link);
                    state.session.openedLinkIds = Array.from(new Set([...(state.session.openedLinkIds || []), id].filter(Boolean)));
                    openLinksPanel([link], "打开链接");
                  },
                }, "打开")
              )
            )
          )
        : [h("div", { class: "muted", text: "还没有共享链接。" })])
    );
  }

  function addFocusLink() {
    const value = linkInput.value.trim();
    if (!value) {
      linkInput.focus();
      return;
    }
    const newLink = createLink(value);
    newLink.title = linkTitleInput.value.trim();
    item.links = [...(item.links || []), { ...newLink, order: item.links?.length || 0 }];
    item.updatedAt = new Date().toISOString();
    upsertItem(item);
    state.session.addedLinkIds = Array.from(new Set([...(state.session.addedLinkIds || []), newLink.id]));
    linkTitleInput.value = "";
    linkInput.value = "";
    rebuildFocusLinks();
    toast("链接已加入事项");
  }

  function captureDistractor() {
    const task = addInboxTask(distractInput.value);
    if (!task) {
      distractInput.focus();
      return;
    }
    distractInput.value = "";
    toast("已放进收集箱，继续当前练习");
  }

  rebuildFocusLinks();

  function currentStepIndex() {
    const ids = new Set(sess.checkedStepIds || []);
    return (sess.useSteps ? item.steps || [] : []).findIndex((step) => !ids.has(stepId(step)));
  }

  function rebuildChecklistHeader() {
    const total = sess.useSteps ? (item.steps || []).length : 0;
    const checked = (sess.checkedStepIds || []).length;
    stepProgressEl.textContent = `${checked} / ${total}`;
  }

  function refreshChecklistState() {
    rebuildChecklistHeader();
    const current = currentStepIndex();
    Array.from(checklist.children).forEach((row, index) => {
      row.classList.toggle("sopStep--current", index === current);
    });
  }

  const stepProgressEl = h("span", { class: "tag", text: "0 / 0" });
  const checklist = h(
    "div",
    { class: "checklist" },
    ...(sess.useSteps ? item.steps || [] : []).map((step, index) => {
      const id = stepId(step);
      const input = h("input", {
        type: "checkbox",
        checked: (sess.checkedStepIds || []).includes(id) ? "checked" : null,
        onchange: (e) => {
          const current = new Set(state.session.checkedStepIds || []);
          if (e.target.checked) current.add(id);
          else current.delete(id);
          state.session.checkedStepIds = Array.from(current);
          refreshChecklistState();
        },
      });
      const isCurrent = index === currentStepIndex();
      const typeLabel = step?.type === "check" ? "检查" : step?.type === "warning" ? "提醒" : step?.type === "improvement" ? "提升" : "动作";
      return h(
        "label",
        { class: `check sopStep ${isCurrent ? "sopStep--current" : ""}` },
        input,
        h("div", {}, h("div", { class: "meta" }, h("span", { class: "tag", text: `${index + 1}` }), h("span", { class: "tag", text: typeLabel })), h("div", { class: "taskTitle", text: stepText(step) }))
      );
    })
  );
  rebuildChecklistHeader();

  const completeBtn = h(
    "button",
    {
      class: "btn btn--primary",
      onclick: () => {
        stopFocusTicker();
        openSuccessReview(item, buildPracticeBase(item));
      },
    },
    "完成"
  );

  const abandonBtn = h(
    "button",
    {
      class: "btn btn--danger",
      onclick: () => {
        const ok = window.confirm("确定放弃？将进入失败复盘。");
        if (!ok) return;
        stopFocusTicker();
        openFailReview(item, buildPracticeBase(item), "abandon");
      },
    },
    "放弃"
  );

  const view = h(
    "div",
    { class: "practiceShell" },
    h(
      "section",
      { class: "practiceTop" },
      timerEl,
      h("div", { class: "practiceTop__main" }, h("div", { class: "eyebrow", text: `事项：${item.name}` }), h("div", { class: "h1", text: sess.taskTitle }), sess.focus ? h("div", { class: "muted", text: `本次练习：${sess.focus}` }) : null, item.goal ? h("div", { class: "muted", text: `长期目标：${item.goal}` }) : null),
      h("div", { class: "buttons practiceTop__actions" }, completeBtn, abandonBtn)
    ),
    h(
      "section",
      { class: "practiceWorkspace" },
      h(
        "div",
        { class: "card practicePanel practicePanel--steps" },
        h("div", { class: "row" }, h("div", { class: "h1", text: "步骤与检查" }), stepProgressEl),
        h("div", { class: "divider" }),
        checklist.children.length ? checklist : h("div", { class: "muted", text: "该事项还没有步骤与检查。" })
      ),
      h(
        "div",
        { class: "card practicePanel practicePanel--notes" },
        h("div", { class: "h1", text: "练习笔记" }),
        h("div", { class: "divider" }),
        noteInput
      ),
      h(
      "aside",
      { class: "practiceTools" },
      h(
        "div",
        { class: "card practiceTool practiceTool--links" },
        h("div", { class: "h1", text: "共享链接" }),
        h("div", { class: "divider" }),
        linksList,
        h("div", { class: "divider" }),
        h("div", { class: "linkAdd" }, linkTitleInput, linkInput, h("button", { class: "btn", onclick: addFocusLink }, "+ 加入事项"))
      ),
      h(
        "div",
        { class: "card practiceTool practiceTool--capture" },
        h("div", { class: "h1", text: "分心捕捉" }),
        h("div", { class: "muted", text: "想到别的事，先记下，不打断当前练习。" }),
        h("div", { class: "divider" }),
        h("div", { class: "inlineAdd" }, distractInput, h("button", { class: "btn", onclick: captureDistractor }, "+ 放进收集箱"))
      )
      )
    )
  );

  function updateFocusTimer() {
    const left = sess.endsAt - Date.now();
    timerEl.textContent = formatMs(left);
    document.title = `${formatMs(left)} · ${sess.taskTitle}`;
    if (left <= 0) {
      stopFocusTicker();
      openFailReview(item, buildPracticeBase(item), "timeout");
    }
  }

  stopFocusTicker();
  updateFocusTimer();
  focusTicker = window.setInterval(updateFocusTimer, 250);

  return view;
}

function render() {
  stopFocusTicker();
  document.title = "Execution Panel";

  let viewEl = null;
  if (state.view === "home") viewEl = renderHome();
  else if (state.view === "items") viewEl = renderItemsView();
  else if (state.view === "settings") viewEl = renderSettings();
  else if (state.view === "focus") viewEl = renderFocus();

  appEl.replaceChildren(viewEl || h("div"));
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "file:") return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

renderStats();
render();
hydrateRemoteData();
registerServiceWorker();
