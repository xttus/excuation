# Execution Panel

执行/练习面板：以事项为中心，持续沉淀长期目标、步骤与检查、共享链接和练习记录，让每次练习都更靠近目标。

## 使用

### 单设备静态模式

```powershell
python -m http.server 5173
```

```text
http://localhost:5173/
```

这种方式主要使用浏览器本地存储。

### 多端共享模式

推荐使用内置 Node 服务：

```powershell
node server.js
```

本机打开：

```text
http://localhost:5173/
```

同一局域网内的手机、平板、其他电脑打开这台电脑的局域网 IP，例如：

```text
http://192.168.1.23:5173/
```

注意：不要在其他设备上打开各自的 `localhost:5173`，那会变成各自本机。多端要访问同一台运行 `server.js` 的设备。

## 数据

- 浏览器本地缓存 key：`execPanel:v3`
- 多端共享数据文件：`data/execpanel-v3.json`
- 清空数据：页面【设置】->【清空数据】

顶部状态显示：

- `已同步`：当前页面可以连接共享服务
- `本地`：共享服务不可用，数据暂存在当前浏览器
