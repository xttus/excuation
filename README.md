# Execution Panel (MVP)

纯前端、无账号、localStorage 持久化的“执行面板”最小版本：只展示一个任务，直接开始，用倒计时 + 即时反馈对抗拖延。

## 使用

推荐用本地静态服务打开（这样离线缓存/Service Worker 才能工作）：

```powershell
python -m http.server 5173
```

然后浏览器打开：

```text
http://localhost:5173/
```

也可以直接双击打开 `index.html`（但离线缓存可能不可用）。

## 数据

- 本地存储 key：`execPanel:v1`
- 清空数据：页面【设置】->【清空数据】

