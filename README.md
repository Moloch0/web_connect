# Web Connect

一个 Tampermonkey/Violentmonkey 用户脚本，用于按网站开启实时连通性监测，并在本地保存最近的检测历史。

## 功能

- 所有网站默认关闭，不会自动发起监测请求。
- 在当前网站右下角打开面板，可单独开启或关闭该网站的监测。
- 默认每 5 秒检测一次，可切换为 10 秒、30 秒或 1 分钟。
- 标签页进入后台或浏览器最小化时自动休眠。
- 可开启“后台标签页也强制监测”，覆盖自动休眠。
- 保存当前网站最近 500 条记录，展示在线率、平均延迟和失败次数。
- 设置和历史由用户脚本管理器保存在本地，不上传到第三方服务。

脚本通过请求当前网站根地址判断连通性。HTTP 200-499 视为在线，HTTP 500 及以上、网络错误和超时视为离线。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)。
2. 点击 [安装最新版 Web Connect](https://raw.githubusercontent.com/Moloch0/web_connect/refs/heads/main/web-connect.user.js)。
3. 确认脚本申请的跨域请求权限，然后刷新网页。

脚本管理器会根据 `@version`、`@downloadURL` 和 `@updateURL` 检查更新。GitHub Raw 可能存在数分钟缓存。

## 使用

打开任意 HTTP 或 HTTPS 网页后，点击右下角的“网络监测：已关闭”，再点击“开启监测”。设置按网站域名保存，进入其他网站时仍然默认关闭。

普通用户脚本只能在网页标签页存在期间运行。关闭标签页、关闭浏览器或让浏览器冻结页面后，脚本无法继续监测；“后台标签页也强制监测”只能覆盖脚本可见的后台休眠逻辑，不能突破浏览器冻结或关闭页面的限制。

## 发布

仓库根目录的 `web-connect.user.js` 是唯一安装入口，不需要构建步骤。

发布新版本时：

1. 同步更新 `web-connect.user.js` 头部、脚本内 `VERSION` 和 `package.json` 中的版本号。
2. 更新 `CHANGELOG.md`。
3. 双击 `publish.cmd`，或在 PowerShell 中运行：

```powershell
.\publish.ps1
```

发布脚本会检查版本号、初始化 Git、提交当前目录并推送到 `main`。首次发布时，如果尚未配置远端且本机已登录 GitHub CLI，脚本会创建公开仓库 `Moloch0/web_connect`；否则会提示先配置 `origin`。

## 权限说明

- `@match http://*/*` / `https://*/*`：在网页中显示关闭状态的控制入口。
- `GM_xmlhttpRequest` 与 `@connect *`：用户主动开启某个网站后，向该网站发送检测请求。
- `GM_getValue` / `GM_setValue`：保存每个网站的开关、间隔和历史记录。

项目采用 [GPL-3.0-or-later](LICENSE) 许可证。
