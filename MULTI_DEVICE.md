# 多端共享使用步骤

多端共享必须使用 `node server.js` 启动。普通静态服务器只能打开网页，但没有 `/api/data` 接口，页面会显示“未连接共享服务”。

## 1. 在电脑上启动共享服务器

在项目目录运行：

```powershell
cd D:\code\2026\execuate
node server.js
```

看到类似输出才算启动成功：

```text
Execution Panel shared server: http://localhost:5173/
Open one of these URLs on your phone. Prefer Wi-Fi/LAN, avoid virtual adapters:
  http://10.130.58.5:5173/ (WLAN)
  http://172.18.192.1:5173/ (virtual adapter, usually not for phone)
Health check: http://localhost:5173/api/health
```

如果 `5173` 被占用，程序会自动尝试下一个端口，例如 `5174`。手机必须打开命令行里实际打印出来的端口。

## 2. 电脑先确认服务可用

电脑浏览器打开：

```text
http://localhost:5173/api/health
```

如果实际端口是 `5174`，就打开：

```text
http://localhost:5174/api/health
```

正常会看到：

```json
{"ok":true,"mode":"shared"}
```

然后电脑再打开：

```text
http://localhost:5173/
```

页面右上角显示“已连接共享服务”表示 `/api/data` 可用。

## 3. 手机打开正确的局域网地址

手机和电脑要在同一个 Wi-Fi 下。

手机不要打开：

```text
http://localhost:5173/
```

`localhost` 在手机上指的是手机自己，不是电脑。

手机应该打开命令行输出的局域网地址，例如：

```text
http://10.130.58.5:5173/
```

如果命令行打印了多个地址，优先选择标着 `WLAN`、`Wi-Fi`、`以太网` 的地址。不要优先选 `vEthernet`、`VMware`、`VirtualBox`、`WSL`、`Docker` 这类虚拟网卡地址，它们通常只有电脑内部能访问。

## 4. 手机先测健康检查

在手机浏览器直接打开：

```text
http://10.130.58.5:5173/api/health
```

正常应该看到：

```json
{"ok":true,"mode":"shared"}
```

如果电脑能打开 `localhost:5173/api/health`，但手机打不开 `电脑IP:5173/api/health`，问题通常不是代码，而是网络或防火墙。

常见原因：

- 电脑和手机不在同一个 Wi-Fi。
- Windows 防火墙拦截了 Node。
- Windows 弹出 Node 防火墙提示时，没有允许“专用网络”。
- 手机打开的是虚拟网卡地址，例如 `172.x.x.x` 的 `vEthernet` 地址。
- 手机打开的端口和命令行打印的端口不一致。
- 电脑正在用 `python -m http.server`，不是 `node server.js`。
- 电脑睡眠、关机，或者运行 `node server.js` 的命令行窗口关闭了。
- 当前 Wi-Fi 开启了 AP 隔离，禁止同一 Wi-Fi 下的设备互相访问。

## 5. 数据保存在哪里

共享模式下有两份数据：

```text
浏览器 localStorage：每台设备自己的本地缓存
data/execpanel-v4.json：node server.js 维护的共享数据
```

新设备第一次打开时，会优先采用服务器里的数据，不会再用空本地数据覆盖服务器。

## 6. 推荐操作顺序

```text
1. 电脑运行 node server.js
2. 电脑打开 localhost:端口/api/health，确认 ok
3. 电脑打开 localhost:端口/
4. 手机打开 命令行打印的 Wi-Fi/LAN 地址 + /api/health，确认 ok
5. 手机打开 命令行打印的 Wi-Fi/LAN 地址
6. 在任意设备新增或修改内容
7. 另一台设备刷新页面后看到一致数据
```

当前同步是轻量版：保存后会上传到服务器，另一台设备刷新后拉取最新数据。后续接 Supabase 后，可以升级成账号级多端同步。
