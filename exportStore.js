import { sanitizeData } from "./dataModel.js";

function byOrder(a, b) {
  return (a.order || 0) - (b.order || 0);
}

function toExportUser(meta = {}) {
  return {
    id: meta.userId || "",
    timezone: meta.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "",
  };
}

export function createExportBundle(data, meta = {}) {
  const source = sanitizeData(data);
  const items = [];
  const steps = [];
  const links = [];
  const practices = [];
  const practiceSteps = [];
  const practiceLinks = [];

  const itemById = new Map(source.items.map((item) => [item.id, item]));

  for (const item of source.items) {
    items.push({
      id: item.id,
      name: item.name,
      goal: item.goal,
      nextPracticeFocus: item.nextPracticeFocus,
      defaultEstimateMin: item.defaultEstimateMin,
      status: item.archivedAt ? "archived" : "active",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      archivedAt: item.archivedAt || null,
    });

    for (const step of [...(item.steps || [])].sort(byOrder)) {
      steps.push({
        id: step.id,
        itemId: item.id,
        text: step.text,
        type: step.type,
        order: step.order,
        createdAt: step.createdAt,
        updatedAt: step.updatedAt || step.createdAt,
        archivedAt: step.archivedAt || null,
      });
    }

    for (const link of [...(item.links || [])].sort(byOrder)) {
      links.push({
        id: link.id,
        itemId: item.id,
        title: link.title,
        url: link.url,
        order: link.order,
        lastUsedAt: link.lastUsedAt || null,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt || link.createdAt,
        archivedAt: link.archivedAt || null,
      });
    }
  }

  for (const practice of source.practices) {
    const item = itemById.get(practice.itemId);
    practices.push({
      id: practice.id,
      itemId: practice.itemId,
      itemNameSnapshot: practice.itemNameSnapshot,
      taskTitle: practice.taskTitle,
      goalSnapshot: practice.goalSnapshot,
      focus: practice.focus,
      plannedMin: practice.plannedMin,
      plannedSec: practice.plannedMin * 60,
      actualSec: practice.actualSec,
      result: practice.result,
      progressRating: practice.progressRating,
      qualityScore: practice.qualityScore || null,
      difficultyScore: practice.difficultyScore || null,
      focusScore: practice.focusScore || null,
      energyScore: practice.energyScore || null,
      stepsTotal: practice.stepsTotal,
      stepsChecked: practice.stepsChecked,
      linksTotal: practice.linksTotal,
      linksOpenedCount: practice.linksOpenedCount,
      linksAddedCount: practice.linksAddedCount,
      failReason: practice.failReason || null,
      failTrigger: practice.failTrigger || null,
      note: practice.note,
      reminder: practice.reminder,
      addedReminderToSteps: practice.addedReminderToSteps,
      startedAt: practice.startedAt || null,
      endedAt: practice.endedAt || null,
      createdAt: practice.createdAt,
      updatedAt: practice.updatedAt,
    });

    const checked = new Set(practice.checkedStepIds || []);
    for (const step of [...(item?.steps || [])].sort(byOrder)) {
      practiceSteps.push({
        practiceId: practice.id,
        stepId: step.id,
        stepTextSnapshot: step.text,
        stepTypeSnapshot: step.type,
        orderSnapshot: step.order,
        checked: checked.has(step.id),
        checkedAt: null,
      });
    }

    const opened = new Set(practice.openedLinkIds || []);
    const added = new Set(practice.addedLinkIds || []);
    for (const link of item?.links || []) {
      if (opened.has(link.id)) {
        practiceLinks.push({
          practiceId: practice.id,
          linkId: link.id,
          action: "opened",
          titleSnapshot: link.title,
          urlSnapshot: link.url,
          createdAt: practice.endedAt || practice.createdAt,
        });
      }
      if (added.has(link.id)) {
        practiceLinks.push({
          practiceId: practice.id,
          linkId: link.id,
          action: "added",
          titleSnapshot: link.title,
          urlSnapshot: link.url,
          createdAt: practice.endedAt || practice.createdAt,
        });
      }
    }
  }

  return {
    exportVersion: 1,
    schemaVersion: source.schemaVersion,
    app: "execution-panel",
    exportedAt: new Date().toISOString(),
    user: toExportUser(meta),
    entities: {
      items,
      steps,
      links,
      practices,
      inboxTasks: source.inbox,
    },
    relations: {
      practiceSteps,
      practiceLinks,
    },
    analytics: {
      daily: [],
      itemSummaries: [],
    },
  };
}

export function createExportJson(data, meta = {}) {
  return JSON.stringify(createExportBundle(data, meta), null, 2);
}
