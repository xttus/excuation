import { clearData, loadData, loadRemoteData, newId, saveData, saveRemoteData } from "./storage.js";

const appEl = document.getElementById("app");
const statsEl = document.getElementById("stats");
const toastEl = document.getElementById("toast");
const modalRoot = document.getElementById("modalRoot");

const state = {
  data: loadData(),
  view: "home", // home | items | focus | settings
  session: null,
  sync: "local",
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

function scheduleRemoteSave() {
  window.clearTimeout(remoteSaveTimer);
  remoteSaveTimer = window.setTimeout(async () => {
    const ok = await saveRemoteData(state.data);
    state.sync = ok ? "synced" : "offline";
    renderStats();
  }, 350);
}

async function hydrateRemoteData() {
  const remote = await loadRemoteData();
  if (!remote) {
    state.sync = "offline";
    renderStats();
    scheduleRemoteSave();
    return;
  }
  if (isRemoteNewer(remote, state.data)) {
    state.data = remote;
    saveData(state.data);
    state.sync = "synced";
    renderStats();
    render();
    toast("已同步共享数据");
    return;
  }
  state.sync = "synced";
  renderStats();
  scheduleRemoteSave();
}

function renderStats() {
  const { points, streak } = state.data.stats;
  const syncLabel = state.sync === "synced" ? "已同步" : "本地";
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
    const url = toOpenableUrl(link);
    if (url) valid.push(url);
    else invalid.push(link);
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
    h("div", { class: "buttons" }, h("button", { class: "btn", onclick: () => copyToClipboard(valid.join("\n")) }, "复制全部")),
    h(
      "div",
      { class: "list" },
      ...valid.map((url) =>
        h(
          "div",
          { class: "card" },
          h("div", { class: "muted", text: url }),
          h("div", { class: "buttons" }, h("a", { class: "btn btn--primary", href: url, target: "_blank", rel: "noopener noreferrer" }, "打开"))
        )
      )
    )
  );
  openModal({ title, body });
}

function getItem(itemId) {
  return (state.data.items || []).find((i) => i.id === itemId) || null;
}

function getItemSessions(itemId) {
  return (state.data.sessions || [])
    .filter((s) => s.itemId === itemId)
    .sort((a, b) => String(b.endedAt || "").localeCompare(String(a.endedAt || "")));
}

function getItemStats(item) {
  const sessions = getItemSessions(item.id);
  const success = sessions.filter((s) => s.result === "success").length;
  const fail = sessions.filter((s) => s.result === "fail").length;
  const last = sessions[0] || null;
  const failCounts = {};
  for (const s of sessions) {
    if (s.failReason) failCounts[s.failReason] = (failCounts[s.failReason] || 0) + 1;
  }
  const topFail = Object.entries(failCounts).sort((a, b) => b[1] - a[1])[0];
  return { sessions, total: sessions.length, success, fail, last, topFail };
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
  state.data.sessions = state.data.sessions.filter((s) => s.itemId !== itemId);
  persist();
}

function appendSession(session) {
  state.data.sessions = [...(state.data.sessions || []), session].slice(-500);
  persist();
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
    lastPracticeFocus: "",
    createdAt: new Date().toISOString(),
  };

  const nameInput = h("input", { value: initial.name, placeholder: "例如：写公众号 / 剪视频 / 英语口语" });
  const goalInput = h("textarea", { text: initial.goal, placeholder: "这个事项长期想靠近什么目标？例如：写出更有转化力、有观点、有行动的文章" });
  const stepsInput = h("textarea", {
    text: (initial.steps || []).join("\n"),
    placeholder: "每行一个步骤或检查；可用前缀：! 注意 / @ 检查 / -> 提升点",
  });
  const linksInput = h("textarea", { text: (initial.links || []).join("\n"), placeholder: "共享链接：每行一个，例如文档、素材库、后台" });
  const estimateInput = h("input", { type: "number", min: "1", value: String(initial.defaultEstimateMin || state.data.settings.defaultEstimateMin) });

  const body = h(
    "div",
    { class: "col" },
    h("div", {}, h("label", { text: "事项名" }), nameInput),
    h("div", {}, h("label", { text: "长期目标" }), goalInput),
    h("div", {}, h("label", { text: "步骤与检查" }), stepsInput),
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
            steps: normalizeLines(stepsInput.value),
            links: normalizeLinks(linksInput.value),
            defaultEstimateMin: Math.max(1, Number.parseInt(estimateInput.value || "1", 10)),
            updatedAt: new Date().toISOString(),
          });
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
    value: item.lastPracticeFocus || "",
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
    stats.last ? h("div", { class: "muted" }, `最近一次：${formatDate(stats.last.endedAt)} / ${stats.last.practiceFocus || "未填写练习目标"}`) : null,
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
            practiceFocus: focusInput.value.trim(),
            estimateMin,
            useSteps: Boolean(useStepsInput.checked && !useStepsInput.disabled),
            openLinks: Boolean(openLinksInput.checked && !openLinksInput.disabled),
          });
          ctrl.close();
        },
      },
      "开始练习"
    ),
    h("button", { class: "btn", onclick: () => ctrl.close() }, "取消")
  );

  const ctrl = openModal({ title: "继续练一次", body, footer });
  focusInput.focus();
}

function startPractice(item, opts) {
  if (opts.openLinks && item.links?.length) openLinksPanel(item.links, `共享链接：${item.name}`);
  const startedAt = Date.now();
  state.session = {
    itemId: item.id,
    taskTitle: opts.taskTitle,
    practiceFocus: opts.practiceFocus,
    estimateMin: opts.estimateMin,
    useSteps: opts.useSteps,
    startedAt,
    endsAt: startedAt + opts.estimateMin * 60_000,
    noteDraft: "",
  };
  item.lastPracticeFocus = opts.practiceFocus || item.lastPracticeFocus || "";
  item.defaultEstimateMin = opts.estimateMin;
  item.updatedAt = new Date().toISOString();
  upsertItem(item);
  setView("focus");
}

function buildSessionBase(item, endedAtMs = Date.now()) {
  const sess = state.session;
  return {
    id: newId("s"),
    itemId: item.id,
    itemName: item.name,
    taskTitle: sess.taskTitle,
    goalSnapshot: item.goal || "",
    practiceFocus: sess.practiceFocus || "",
    startedAt: new Date(sess.startedAt).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    plannedMin: sess.estimateMin,
    actualSec: Math.max(0, Math.round((endedAtMs - sess.startedAt) / 1000)),
  };
}

function openSuccessReview(item, sessionBase) {
  let selected = "";
  const reminderInput = h("input", { placeholder: "下次提醒自己什么？例如：开头别解释背景，直接进入场景" });
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
          name: "goalProgress",
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
        if (reminder && addReminderInput.checked) {
          item.steps = [...(item.steps || []), reminder.startsWith("!") || reminder.startsWith("@") || reminder.startsWith("->") ? reminder : `! ${reminder}`];
          item.updatedAt = new Date().toISOString();
          upsertItem(item);
        }
        appendSession({ ...sessionBase, result: "success", goalProgress: selected, reminder });
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

function openFailReview(item, sessionBase, trigger) {
  let selected = "";
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
    )
  );

  const confirmBtn = h(
    "button",
    {
      class: "btn btn--primary",
      disabled: "disabled",
      onclick: () => {
        appendSession({ ...sessionBase, result: "fail", failReason: selected, failTrigger: trigger });
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
      recommended.lastPracticeFocus ? h("div", { class: "doneLine" }, h("span", { text: "下次练习" }), h("strong", { text: recommended.lastPracticeFocus })) : null,
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
      ...items.slice(0, 6).map(renderItemCard)
    ),
    h("div", { class: "homeNav" }, addBtn, itemsBtn, settingsBtn)
  );
}

function renderItemCard(item) {
  const stats = getItemStats(item);
  return h(
    "div",
    { class: "itemCard" },
    h("div", { class: "row" }, h("div", { class: "h1", text: item.name }), h("div", { class: "meta" }, h("span", { class: "tag", text: `${stats.total} 次` }))),
    item.goal ? h("div", { class: "muted", text: item.goal }) : h("div", { class: "muted", text: "还没有长期目标" }),
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
  const recent = stats.sessions.slice(0, 3);
  return h(
    "div",
    { class: "card" },
    h("div", { class: "row" }, h("div", { class: "h1", text: item.name }), h("div", { class: "meta" }, h("span", { class: "tag", text: `${stats.total} 次练习` }), h("span", { class: "tag", text: `${item.steps?.length || 0} 步骤` }), h("span", { class: "tag", text: `${item.links?.length || 0} 链接` }))),
    item.goal ? h("div", { class: "muted", text: `目标：${item.goal}` }) : h("div", { class: "muted", text: "目标：未填写" }),
    item.steps?.length ? h("div", { class: "muted", text: `步骤与检查：${item.steps.slice(0, 3).join(" · ")}${item.steps.length > 3 ? " ..." : ""}` }) : null,
    recent.length
      ? h(
          "div",
          { class: "list" },
          ...recent.map((s) =>
            h(
              "div",
              { class: "muted" },
              `${formatDate(s.endedAt)} / ${s.result === "success" ? GOAL_PROGRESS_LABELS[s.goalProgress] || "完成" : FAIL_REASON_LABELS[s.failReason] || "失败"} / ${s.practiceFocus || s.taskTitle}`
            )
          )
        )
      : null,
    h(
      "div",
      { class: "buttons" },
      h("button", { class: "btn btn--primary", onclick: () => openPracticeSetup(item) }, "继续练一次"),
      h("button", { class: "btn", onclick: () => openItemEditor(item) }, "编辑"),
      h("button", { class: "btn", onclick: () => copyToClipboard((item.steps || []).join("\n")) }, "复制步骤"),
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

  const timerEl = h("div", { class: "timer", text: "00:00" });
  const noteInput = h("textarea", { placeholder: "随手记：发现、卡点、下次提醒", text: sess.noteDraft || "" });
  noteInput.addEventListener("input", () => {
    state.session.noteDraft = noteInput.value;
  });

  const checklist = h(
    "div",
    { class: "checklist" },
    ...(sess.useSteps ? item.steps || [] : []).map((step) => h("label", { class: "check" }, h("input", { type: "checkbox" }), h("div", { class: "taskTitle", text: step })))
  );

  const completeBtn = h(
    "button",
    {
      class: "btn btn--primary",
      onclick: () => {
        stopFocusTicker();
        openSuccessReview(item, buildSessionBase(item));
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
        openFailReview(item, buildSessionBase(item), "abandon");
      },
    },
    "放弃"
  );

  const view = h(
    "div",
    { class: "col" },
    h(
      "div",
      { class: "card" },
      h("div", { class: "muted", text: "执行态（无暂停）" }),
      timerEl,
      h("div", { class: "h1", text: sess.taskTitle }),
      h("div", { class: "muted", text: `事项：${item.name}` }),
      item.goal ? h("div", { class: "focusLine" }, h("span", { text: "长期目标" }), h("strong", { text: item.goal })) : null,
      sess.practiceFocus ? h("div", { class: "doneLine" }, h("span", { text: "本次练习" }), h("strong", { text: sess.practiceFocus })) : null,
      item.links?.length ? h("div", { class: "buttons" }, h("button", { class: "btn", onclick: () => openLinksPanel(item.links, `共享链接：${item.name}`) }, "打开共享链接")) : null,
      checklist.children.length ? h("div", { class: "divider" }) : null,
      checklist.children.length ? h("div", { class: "muted", text: "步骤与检查" }) : null,
      checklist.children.length ? checklist : null,
      h("div", { class: "divider" }),
      h("div", { class: "buttons" }, completeBtn, abandonBtn)
    ),
    h("div", { class: "card" }, h("div", { class: "h1", text: "练习笔记" }), h("div", { class: "divider" }), noteInput)
  );

  stopFocusTicker();
  focusTicker = window.setInterval(() => {
    const left = sess.endsAt - Date.now();
    timerEl.textContent = formatMs(left);
    document.title = `${formatMs(left)} · ${sess.taskTitle}`;
    if (left <= 0) {
      stopFocusTicker();
      openFailReview(item, buildSessionBase(item), "timeout");
    }
  }, 250);

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
