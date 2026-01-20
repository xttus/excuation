import { clearData, loadData, newId, saveData } from "./storage.js";

const appEl = document.getElementById("app");
const statsEl = document.getElementById("stats");
const toastEl = document.getElementById("toast");
const modalRoot = document.getElementById("modalRoot");

const state = {
  data: loadData(),
  view: "home", // home | tasks | focus | settings | sops
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

function openSuccessSettleModal({ sessionId, sopKey, taskTitle }) {
  let selectedCompare = "";
  let compareApplied = false;

  const compareBlock = h(
    "div",
    { class: "col" },
    h("div", { class: "muted" }, "和上一次同类任务相比，这次感觉如何？（可跳过）"),
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
    placeholder: "例如：发布公众号 / 报销 / 剪辑视频（同类任务用同一项）",
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
          applyCompareIfAny();
          ctrl.close();
          toast(steps.length ? "SOP 已保存" : "SOP 已清空");
        },
      },
      "保存 SOP 并结束"
    ),
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
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) return false;
  const safeTitle = String(title || "链接面板").replace(/[<>]/g, "");
  const items = links
    .map((u) => String(u).trim())
    .filter(Boolean)
    .map((u) => {
      const escaped = u.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<li><a href="${escaped}" target="_blank" rel="noopener noreferrer">${escaped}</a></li>`;
    })
    .join("");
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
  <ul id="list">${items}</ul>
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
}

function openLinksUI(links, title) {
  const body = h(
    "div",
    { class: "col" },
    h("div", { class: "muted" }, "浏览器通常会拦截“一次点击打开很多弹窗”。建议逐个点开，或对 localhost 允许弹窗。"),
    h(
      "div",
      { class: "buttons" },
      h(
        "button",
        { class: "btn btn--primary", onclick: () => openLinkHub(links, title) || toast("弹窗被拦截：请允许弹窗") },
        "打开链接面板（推荐）"
      ),
      h(
        "button",
        { class: "btn", onclick: () => copyToClipboard(links.join("\n")) },
        "复制全部链接"
      )
    ),
    h("div", { class: "divider" }),
    h(
      "div",
      { class: "list" },
      ...links.map((u) =>
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

  const links = getLinks(task);
  const hasLinks = links.length > 0;
  const openLinksInput = h("input", { type: "checkbox", checked: hasLinks ? "checked" : null });
  openLinksInput.disabled = !hasLinks;

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
      h("div", { class: "muted" }, hasLinks ? `${links.length} 个链接` : "未设置链接")
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
  body.appendChild(useSopRow);

  function syncSopAvailability() {
    const key = (sopKeyInput.value || task.title).trim();
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
  sopKeyInput.addEventListener("input", syncSopAvailability);
  syncSopAvailability();

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
            openLinks: Boolean(openLinksInput.checked && hasLinks),
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

function startSession(taskId, opts) {
  const task = state.data.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "todo") return;

  const links = getLinks(task);
  if (opts.openLinks && links.length) {
    // Most browsers block "open many tabs" on one click; prefer a 1-popup hub + in-app list.
    if (links.length === 1) {
      window.open(links[0], "_blank", "noopener,noreferrer");
    } else {
      // Try open a single hub window; even if blocked, we still show in-app list.
      openLinkHub(links, `链接面板：${task.title}`) || toast("弹窗被拦截：已在页面内提供链接列表");
      openLinksUI(links, "打开链接（列表）");
    }
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
    sopKey: opts.sopKey,
    practiceFocus: typeof opts.practiceFocus === "string" ? opts.practiceFocus.trim().slice(0, 60) : "",
  };

  // Sync task fields so next time it’s easier to start.
  upsertTask({
    ...task,
    estimateMin: opts.estimateMin,
    definitionOfDone: opts.definitionOfDone,
    sopKey: opts.sopKey,
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

  const quickAddBtn = h("button", { class: "btn btn--primary", onclick: () => openTaskEditor({ mode: "new" }) }, "+ 快速添加任务");
  const toPoolBtn = h("button", { class: "btn", onclick: () => setView("tasks") }, "任务池");
  const toSettingsBtn = h("button", { class: "btn", onclick: () => setView("settings") }, "设置");

  const actions = h("div", { class: "buttons" }, quickAddBtn, toPoolBtn, toSettingsBtn);

  if (!rec) {
    return h(
      "div",
      { class: "col" },
      h(
        "div",
        { class: "card" },
        h("div", { class: "h1", text: "任务池为空" }),
        h("div", { class: "muted" }, "先加一个“最小可开始”的任务。"),
        h("div", { class: "divider" }),
        actions
      )
    );
  }

  const meta = h(
    "div",
    { class: "meta" },
    rec.importance === "urgent" ? h("span", { class: "tag tag--urgent", text: "🔴 urgent" }) : null,
    h("span", { class: "tag tag--type", text: `type: ${rec.type}` }),
    h("span", { class: "tag", text: `${rec.estimateMin} min` }),
    getLinks(rec).length ? h("span", { class: "tag", text: `🔗 ${getLinks(rec).length}` }) : null,
    getSopKey(rec) ? h("span", { class: "tag", text: `事项：${getSopKey(rec)}` }) : null,
    (rec.notes?.length || 0) > 0 ? h("span", { class: "tag", text: `📝 ${rec.notes.length}` }) : null
  );

  const startBtn = h("button", { class: "btn btn--primary", onclick: () => openStartConfirm(rec) }, "开始");
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
    "跳过"
  );

  return h(
    "div",
    { class: "col" },
    h(
      "div",
      { class: "card" },
      h("div", { class: "muted" }, "当前推荐任务（仅 1 个）"),
      h("div", { class: "row" }, h("div", { class: "col" }, h("div", { class: "h1", text: rec.title }), meta), h("div", { class: "buttons" }, startBtn, skipBtn)),
      rec.definitionOfDone ? h("div", { class: "divider" }) : null,
      rec.definitionOfDone ? h("div", { class: "muted" }, `完成标准：${rec.definitionOfDone}`) : null
    ),
    h("div", { class: "card" }, actions)
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

function renderSops() {
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
        openSuccessSettleModal({ sessionId: srec.id, sopKey, taskTitle: task.title });
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
      getLinks(task).length
        ? h(
            "div",
            { class: "meta" },
            h("span", { class: "tag", text: `🔗 ${getLinks(task).length} links` }),
            h(
              "button",
              {
                class: "btn",
                onclick: () => {
                  const links = getLinks(task);
                  if (links.length === 1) {
                    window.open(links[0], "_blank", "noopener,noreferrer");
                  } else if (links.length > 1) {
                    openLinkHub(links, `链接面板：${task.title}`) || toast("弹窗被拦截：已在页面内提供链接列表");
                    openLinksUI(links, "打开链接（列表）");
                  }
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
