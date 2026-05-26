# 数据结构设计：导出与 Supabase 同步

这个项目后续最重要的不是把当前 `localStorage` 原样搬到后端，而是把数据拆成可以长期分析的结构。推荐采用两层模型：

1. **导出 JSON 模型**：用于备份、迁移、AI 分析、离线处理。
2. **Supabase 关系型模型**：用于多端同步、登录权限、增量更新和量化分析。

## 一、核心产品对象

当前产品应该围绕 5 类对象组织：

| 对象 | 含义 | 是否长期保留 |
| --- | --- | --- |
| `item` | 一个长期练习事项，比如“工具测评”“写作”“投放复盘” | 是 |
| `step` | 事项下的 SOP 步骤或检查点 | 是，允许归档 |
| `link` | 事项下的资料、文档、后台、案例链接 | 是，允许归档 |
| `practice` | 一次实际练习记录 | 是，最重要的分析数据 |
| `inbox_task` | 临时想到的待办或分心捕捉 | 可完成、可转事项 |

这里的关键设计是：**SOP 属于事项，练习记录引用当时的 SOP 快照**。

原因是 SOP 会变化。如果只在练习记录里保存 step id，未来 SOP 改了，历史记录就解释不清楚。所以每次练习要额外保存当时的步骤文本、类型、顺序和是否勾选。

## 二、推荐导出 JSON 结构

导出时不要只导出当前页面能用的数据，而要导出一个“分析友好”的包：

```json
{
  "exportVersion": 1,
  "schemaVersion": 5,
  "app": "execution-panel",
  "exportedAt": "2026-05-26T10:00:00.000Z",
  "user": {
    "id": "user_xxx",
    "timezone": "Asia/Shanghai"
  },
  "entities": {
    "items": [],
    "steps": [],
    "links": [],
    "practices": [],
    "inboxTasks": []
  },
  "relations": {
    "practiceSteps": [],
    "practiceLinks": []
  },
  "analytics": {
    "daily": [],
    "itemSummaries": []
  }
}
```

### `items`

```json
{
  "id": "item_001",
  "name": "工具测评",
  "goal": "稳定产出高质量测评内容",
  "nextPracticeFocus": "选题前先验证用户痛点",
  "defaultEstimateMin": 30,
  "status": "active",
  "createdAt": "2026-05-26T09:00:00.000Z",
  "updatedAt": "2026-05-26T09:00:00.000Z",
  "archivedAt": null
}
```

### `steps`

```json
{
  "id": "step_001",
  "itemId": "item_001",
  "text": "写的过程必须有 SOP",
  "type": "check",
  "order": 1,
  "createdAt": "2026-05-26T09:00:00.000Z",
  "updatedAt": "2026-05-26T09:00:00.000Z",
  "archivedAt": null
}
```

`type` 建议固定为：

| type | 含义 |
| --- | --- |
| `action` | 要做的动作 |
| `check` | 检查项 |
| `warning` | 容易犯错的提醒 |
| `improvement` | 下次迭代方向 |

### `links`

```json
{
  "id": "link_001",
  "itemId": "item_001",
  "title": "飞书测评文档",
  "url": "https://example.com/doc",
  "order": 1,
  "lastUsedAt": "2026-05-26T09:30:00.000Z",
  "createdAt": "2026-05-26T09:00:00.000Z",
  "updatedAt": "2026-05-26T09:00:00.000Z",
  "archivedAt": null
}
```

### `practices`

```json
{
  "id": "practice_001",
  "itemId": "item_001",
  "itemNameSnapshot": "工具测评",
  "taskTitle": "练一次：工具测评",
  "goalSnapshot": "稳定产出高质量测评内容",
  "focus": "选好了选题",
  "plannedSec": 1800,
  "actualSec": 1710,
  "result": "success",
  "progressRating": "closer",
  "qualityScore": 4,
  "difficultyScore": 3,
  "focusScore": 4,
  "energyScore": 3,
  "stepsTotal": 2,
  "stepsChecked": 2,
  "linksOpenedCount": 1,
  "linksAddedCount": 0,
  "failReason": null,
  "failTrigger": null,
  "note": "发现选题判断还需要一个数据核对步骤。",
  "reminder": "下次开始前先打开数据表。",
  "startedAt": "2026-05-26T09:00:00.000Z",
  "endedAt": "2026-05-26T09:28:30.000Z",
  "createdAt": "2026-05-26T09:28:30.000Z",
  "updatedAt": "2026-05-26T09:28:30.000Z"
}
```

新增的 4 个评分字段建议保留：

| 字段 | 范围 | 含义 |
| --- | --- | --- |
| `qualityScore` | 1-5 | 这次输出质量如何 |
| `difficultyScore` | 1-5 | 难度是否合适 |
| `focusScore` | 1-5 | 专注程度 |
| `energyScore` | 1-5 | 状态/精力 |

这 4 个字段后面非常适合做量化分析：不是只看完成了几次，而是看“哪些 SOP 真的让质量变好”。

### `practiceSteps`

```json
{
  "practiceId": "practice_001",
  "stepId": "step_001",
  "stepTextSnapshot": "写的过程必须有 SOP",
  "stepTypeSnapshot": "check",
  "orderSnapshot": 1,
  "checked": true,
  "checkedAt": "2026-05-26T09:10:00.000Z"
}
```

### `practiceLinks`

```json
{
  "practiceId": "practice_001",
  "linkId": "link_001",
  "action": "opened",
  "titleSnapshot": "飞书测评文档",
  "urlSnapshot": "https://example.com/doc",
  "createdAt": "2026-05-26T09:01:00.000Z"
}
```

`action` 建议固定为：

| action | 含义 |
| --- | --- |
| `opened` | 练习中打开过 |
| `added` | 练习中新增 |

## 三、Supabase 表结构建议

Supabase 推荐使用关系型表，不建议只存一个大 JSON。大 JSON 虽然最快，但后续做统计、筛选、同步冲突处理都会痛苦。

推荐表：

| 表名 | 用途 |
| --- | --- |
| `items` | 长期练习事项 |
| `item_steps` | SOP 步骤 |
| `item_links` | 资料链接 |
| `practices` | 练习记录主表 |
| `practice_steps` | 每次练习的步骤快照与勾选 |
| `practice_links` | 每次练习的链接使用记录 |
| `inbox_tasks` | 收集箱 |

同步时每张表都保留：

| 字段 | 用途 |
| --- | --- |
| `id` | 客户端生成 UUID，便于离线创建 |
| `user_id` | 归属用户，配合 RLS |
| `created_at` | 创建时间 |
| `updated_at` | 修改时间 |
| `deleted_at` | 软删除，用于多端同步 |

## 四、同步策略

第一阶段建议用 **last-write-wins**：

1. 每次本地修改，写入本地缓存。
2. 如果已登录 Supabase，把变更 upsert 到对应表。
3. 页面启动时拉取 `updated_at > lastSyncedAt` 的数据。
4. 如果同一行冲突，以 `updated_at` 更新的一端为准。
5. 删除不做物理删除，写 `deleted_at`。

这样实现成本低，足够支撑个人多端使用。

第二阶段再升级为事件流：

| 表名 | 用途 |
| --- | --- |
| `change_events` | 记录每次 create/update/delete |

只有当你要做复杂协作、撤销历史、跨设备冲突提示时，才需要事件流。现在不建议一开始就做复杂。

## 五、接入 Supabase 的推荐路径

当前代码已经按这个方向拆成 3 层：

| 文件 | 职责 |
| --- | --- |
| `dataModel.js` | schema、默认数据、规范化、旧数据迁移 |
| `localStore.js` | `localStorage` 读写与清空 |
| `remoteStore.js` | 当前自建 `server.js` 的 `/api/data` 同步 |
| `exportStore.js` | 把应用数据整理成导出 JSON |
| `storage.js` | 对旧调用保持兼容的门面 |

后续接 Supabase 时，推荐新增 `supabaseStore.js`，不要把 Supabase 逻辑写回 `app.js`。

### 阶段 1：保留本地缓存，加 Supabase 作为云同步

这是最稳的方案。即使离线也能继续练习，联网后再同步。

前端数据流：

```text
用户操作
  -> 更新内存 state
  -> 保存 localStorage
  -> 加入待同步队列
  -> Supabase upsert
  -> 更新 lastSyncedAt
```

### 阶段 2：增加登录

使用 Supabase Auth。每条业务数据都带 `user_id`，并开启 RLS。

Supabase 官方文档推荐用 RLS 控制用户只能访问自己的行，策略通常基于 `auth.uid() = user_id`。参考：

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/reference/javascript/upsert

### 阶段 3：增加导出

导出时从 Supabase 或本地缓存组装成上面的导出 JSON。

导出按钮应该提供 3 种格式：

| 格式 | 用途 |
| --- | --- |
| JSON | 完整备份、迁移、AI 分析 |
| CSV | 表格分析 |
| Markdown | 人类阅读复盘 |

## 六、不建议的结构

不建议继续长期使用这种结构：

```json
{
  "items": [
    {
      "steps": [],
      "links": [],
      "practices": []
    }
  ]
}
```

原因：

1. 事项变大后，任何小修改都要更新整块数据。
2. 多端同步容易互相覆盖。
3. 练习历史和当前 SOP 混在一起，不利于分析。
4. Supabase 里很难做 `where item_id = ...`、`group by day`、`avg quality_score` 这类统计。

## 七、后续分析可以直接回答的问题

有了这个结构后，后续可以分析：

- 哪个事项最稳定地靠近目标？
- 哪些 SOP 步骤经常没勾选？
- 哪些步骤没勾选时，失败率明显升高？
- 哪类链接最常被打开？
- 哪个时间段练习质量最高？
- 练习时长和质量评分是否相关？
- 哪些失败原因反复出现？
- “提醒”被写入 SOP 后，下次是否减少同类失败？

这才是这个产品真正有价值的地方：不是记录做了什么，而是把练习变成可迭代的系统。
