// ==UserScript==
// @name         Web Connect - Website Connectivity Monitor
// @name:zh-CN   Web Connect - 网页连通性监测
// @namespace    https://github.com/Moloch0/web_connect
// @version      0.1.0
// @description  Monitor the current website, pause in background tabs, and keep local connectivity history.
// @description:zh-CN 按网站开启连通性监测，后台自动休眠，并在本地记录历史结果。
// @author       Moloch0
// @license      GPL-3.0-or-later
// @homepageURL  https://github.com/Moloch0/web_connect
// @supportURL   https://github.com/Moloch0/web_connect/issues
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      *
// @downloadURL  https://raw.githubusercontent.com/Moloch0/web_connect/refs/heads/main/web-connect.user.js
// @updateURL    https://raw.githubusercontent.com/Moloch0/web_connect/refs/heads/main/web-connect.user.js
// ==/UserScript==

(function initWebConnect(global) {
  "use strict";

  if (global.__webConnectInjected) return;
  global.__webConnectInjected = true;

  const VERSION = "0.1.0";
  const ROOT_ID = "web-connect-root";
  const STORE_KEY = "web-connect.sites.v1";
  const DEFAULT_INTERVAL_MS = 5000;
  const REQUEST_TIMEOUT_MS = 5000;
  const MAX_HISTORY = 500;
  const RECENT_ROWS = 30;
  const siteKey = global.location.origin;
  const targetUrl = `${siteKey}/`;

  let store = readStore();
  let site = normalizeSite(store[siteKey]);
  let timer = null;
  let request = null;
  let checking = false;
  let failures = 0;
  let lastResult = site.history.at(-1) || null;
  let root;
  let panel;
  let launcher;
  let controls;

  function normalizeSite(value) {
    const input = value && typeof value === "object" ? value : {};
    return {
      enabled: input.enabled === true,
      forceBackground: input.forceBackground === true,
      intervalMs: [5000, 10000, 30000, 60000].includes(input.intervalMs)
        ? input.intervalMs
        : DEFAULT_INTERVAL_MS,
      history: Array.isArray(input.history) ? input.history.slice(-MAX_HISTORY) : [],
    };
  }

  function readStore() {
    try {
      const value = GM_getValue(STORE_KEY, "{}");
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveSite() {
    store[siteKey] = site;
    try {
      GM_setValue(STORE_KEY, JSON.stringify(store));
    } catch (_) {
      // Monitoring continues even when the userscript manager cannot persist data.
    }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(text, action, className = "") {
    const node = element("button", className, text);
    node.type = "button";
    node.dataset.action = action;
    return node;
  }

  function currentMode() {
    if (!site.enabled) return "off";
    if (document.hidden && !site.forceBackground) return "sleeping";
    return "active";
  }

  function modeLabel(mode = currentMode()) {
    if (mode === "active") return checking ? "检测中" : "监测中";
    if (mode === "sleeping") return "休眠";
    return "已关闭";
  }

  function formatTime(value) {
    if (!value) return "--";
    return new Date(value).toLocaleString([], {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function resultLabel(result) {
    if (!result) return "尚无检测结果";
    if (result.ok) return `在线 · HTTP ${result.status} · ${result.latency} ms`;
    const reason = result.error || (result.status ? `HTTP ${result.status}` : "连接失败");
    return `离线 · ${reason}`;
  }

  function statistics() {
    const history = site.history;
    const online = history.filter((item) => item.ok);
    const avg = online.length
      ? Math.round(online.reduce((sum, item) => sum + (Number(item.latency) || 0), 0) / online.length)
      : 0;
    return {
      total: history.length,
      online: online.length,
      offline: history.length - online.length,
      rate: history.length ? Math.round((online.length / history.length) * 100) : 0,
      avg,
    };
  }

  function record(result) {
    lastResult = result;
    failures = result.ok ? 0 : failures + 1;
    site.history.push(result);
    if (site.history.length > MAX_HISTORY) site.history.splice(0, site.history.length - MAX_HISTORY);
    saveSite();
    render();
  }

  function cancelRequest() {
    if (!request) return;
    try {
      request.abort?.();
    } catch (_) {
      // Some userscript managers do not expose an abortable request handle.
    }
    request = null;
    checking = false;
  }

  function stopScheduler() {
    if (timer) global.clearTimeout(timer);
    timer = null;
    cancelRequest();
  }

  function schedule(delay = site.intervalMs) {
    if (timer) global.clearTimeout(timer);
    timer = null;
    if (currentMode() !== "active") return;
    timer = global.setTimeout(() => {
      timer = null;
      void checkConnectivity();
    }, delay);
  }

  function finish(result) {
    request = null;
    checking = false;
    record(result);
    schedule();
  }

  function checkConnectivity() {
    if (currentMode() !== "active" || checking) return;
    checking = true;
    render();
    const startedAt = performance.now();
    const separator = targetUrl.includes("?") ? "&" : "?";
    const url = `${targetUrl}${separator}_web_connect=${Date.now()}`;

    request = GM_xmlhttpRequest({
      method: "HEAD",
      url,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      onload(response) {
        const latency = Math.max(0, Math.round(performance.now() - startedAt));
        const status = Number(response.status) || 0;
        finish({
          at: Date.now(),
          ok: status >= 200 && status < 500,
          status,
          latency,
          error: status >= 500 || status === 0 ? `HTTP ${status || "未知"}` : "",
        });
      },
      onerror() {
        finish({ at: Date.now(), ok: false, status: 0, latency: 0, error: "网络错误" });
      },
      ontimeout() {
        finish({
          at: Date.now(),
          ok: false,
          status: 0,
          latency: REQUEST_TIMEOUT_MS,
          error: `超时（>${REQUEST_TIMEOUT_MS} ms）`,
        });
      },
      onabort() {
        request = null;
        checking = false;
        render();
      },
    });
  }

  function applyRuntimeState(immediate = false) {
    stopScheduler();
    if (currentMode() === "active") schedule(immediate ? 0 : site.intervalMs);
    render();
  }

  function injectStyles() {
    if (document.getElementById(`${ROOT_ID}-style`)) return;
    const style = element("style");
    style.id = `${ROOT_ID}-style`;
    style.textContent = `
#${ROOT_ID}{--wc-bg:#fff;--wc-fg:#202124;--wc-muted:#687078;--wc-border:#d7dadd;--wc-control:#f5f6f7;--wc-green:#18794e;--wc-red:#b42318;--wc-amber:#8a6100;position:fixed;right:16px;bottom:16px;z-index:2147483000;color:var(--wc-fg);font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:light}
#${ROOT_ID} *{box-sizing:border-box;letter-spacing:0}
#${ROOT_ID} button,#${ROOT_ID} select{font:inherit;color:inherit;border:1px solid var(--wc-border);background:var(--wc-control);border-radius:6px}
#${ROOT_ID} button{cursor:pointer;padding:7px 10px}#${ROOT_ID} button:disabled{cursor:default;opacity:.5}
#${ROOT_ID} :focus-visible{outline:2px solid currentColor;outline-offset:2px}
#${ROOT_ID} .wc-launcher{display:flex;align-items:center;gap:7px;min-height:36px;background:var(--wc-bg);box-shadow:0 2px 10px #0002;font-weight:650}
#${ROOT_ID} .wc-dot{width:9px;height:9px;border-radius:50%;background:var(--wc-muted);flex:none}
#${ROOT_ID}[data-mode=active] .wc-dot{background:var(--wc-green)}#${ROOT_ID}[data-mode=sleeping] .wc-dot{background:var(--wc-amber)}
#${ROOT_ID}[data-result=offline][data-mode=active] .wc-dot{background:var(--wc-red)}
#${ROOT_ID} .wc-panel{position:absolute;right:0;bottom:44px;width:min(360px,calc(100vw - 24px));max-height:calc(100dvh - 76px);overflow:auto;padding:14px;border:1px solid var(--wc-border);border-radius:8px;background:var(--wc-bg);box-shadow:0 7px 24px #0003}
#${ROOT_ID} .wc-panel[hidden]{display:none!important}#${ROOT_ID} .wc-header,#${ROOT_ID} .wc-actions,#${ROOT_ID} .wc-summary{display:flex;align-items:center;gap:8px}
#${ROOT_ID} .wc-header{justify-content:space-between;margin-bottom:10px}#${ROOT_ID} .wc-title{font-size:15px;font-weight:700}#${ROOT_ID} .wc-version{margin-left:6px;color:var(--wc-muted);font-size:11px;font-weight:400}
#${ROOT_ID} .wc-close{border:0;background:transparent;padding:2px 6px;font-size:20px;line-height:1}
#${ROOT_ID} .wc-site{overflow-wrap:anywhere;color:var(--wc-muted);font-size:12px;margin-bottom:12px}
#${ROOT_ID} .wc-status{padding:10px;border:1px solid var(--wc-border);border-radius:6px;background:var(--wc-control)}
#${ROOT_ID} .wc-status strong{display:block;margin-bottom:3px}#${ROOT_ID} .wc-status-line{overflow-wrap:anywhere}
#${ROOT_ID} .wc-actions{margin-top:10px;flex-wrap:wrap}#${ROOT_ID} .wc-primary{background:var(--wc-fg);border-color:var(--wc-fg);color:var(--wc-bg)}
#${ROOT_ID} .wc-option{display:flex;align-items:center;gap:8px;margin:12px 0}#${ROOT_ID} input{accent-color:var(--wc-fg)}
#${ROOT_ID} .wc-field{display:grid;grid-template-columns:80px minmax(0,1fr);align-items:center;gap:8px;margin:10px 0}#${ROOT_ID} select{width:100%;padding:6px}
#${ROOT_ID} .wc-note{color:var(--wc-muted);font-size:12px;margin:8px 0}
#${ROOT_ID} .wc-summary{display:grid;grid-template-columns:repeat(3,1fr);margin:12px 0 8px;border-top:1px solid var(--wc-border);padding-top:12px}
#${ROOT_ID} .wc-stat{text-align:center}#${ROOT_ID} .wc-stat strong{display:block;font-size:15px}#${ROOT_ID} .wc-stat span{color:var(--wc-muted);font-size:11px}
#${ROOT_ID} .wc-history-head{display:flex;align-items:center;justify-content:space-between;margin:8px 0 5px;font-weight:650}#${ROOT_ID} .wc-clear{padding:4px 7px;font-size:11px}
#${ROOT_ID} .wc-history{display:grid;gap:3px;max-height:220px;overflow:auto}#${ROOT_ID} .wc-row{display:grid;grid-template-columns:74px 52px minmax(0,1fr);gap:7px;padding:5px 3px;border-bottom:1px solid var(--wc-border);font-size:11px}
#${ROOT_ID} .wc-ok{color:var(--wc-green);font-weight:700}#${ROOT_ID} .wc-bad{color:var(--wc-red);font-weight:700}#${ROOT_ID} .wc-detail{overflow-wrap:anywhere;color:var(--wc-muted)}
@media(prefers-color-scheme:dark){#${ROOT_ID}{--wc-bg:#1f2123;--wc-fg:#edf0f2;--wc-muted:#aeb5bc;--wc-border:#484c50;--wc-control:#292c2f;--wc-green:#6ed5a2;--wc-red:#ff9b91;--wc-amber:#e7c15c;color-scheme:dark}}
@media(max-width:600px){#${ROOT_ID}{right:10px;bottom:10px}#${ROOT_ID} .wc-panel{width:calc(100vw - 20px);max-height:calc(100dvh - 64px)}}
`;
    document.head.append(style);
  }

  function buildPanel() {
    panel = element("section", "wc-panel");
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-labelledby", "web-connect-title");

    const header = element("div", "wc-header");
    const title = element("div", "wc-title", "Web Connect");
    title.id = "web-connect-title";
    title.append(element("span", "wc-version", `v${VERSION}`));
    const close = button("×", "close", "wc-close");
    close.setAttribute("aria-label", "关闭面板");
    header.append(title, close);

    const siteName = element("div", "wc-site", siteKey);
    const status = element("div", "wc-status");
    const statusMode = element("strong");
    const statusLine = element("div", "wc-status-line");
    const statusTime = element("div", "wc-note");
    status.append(statusMode, statusLine, statusTime);

    const actions = element("div", "wc-actions");
    const toggle = button("开启监测", "toggle", "wc-primary");
    const checkNow = button("立即检测", "check");
    actions.append(toggle, checkNow);

    const forceLabel = element("label", "wc-option");
    const force = element("input");
    force.type = "checkbox";
    force.dataset.field = "force";
    forceLabel.append(force, document.createTextNode("后台标签页也强制监测"));

    const intervalLabel = element("label", "wc-field");
    const intervalText = element("span", "", "检测间隔");
    const interval = element("select");
    interval.dataset.field = "interval";
    for (const [value, label] of [[5000, "5 秒"], [10000, "10 秒"], [30000, "30 秒"], [60000, "1 分钟"]]) {
      const option = element("option", "", label);
      option.value = String(value);
      interval.append(option);
    }
    intervalLabel.append(intervalText, interval);

    const note = element("p", "wc-note", "默认只在此网站、当前标签页可见时运行。关闭标签页后无法继续监测。");
    const summary = element("div", "wc-summary");
    const rate = element("div", "wc-stat");
    const rateValue = element("strong");
    rate.append(rateValue, element("span", "", "在线率"));
    const average = element("div", "wc-stat");
    const averageValue = element("strong");
    average.append(averageValue, element("span", "", "平均延迟"));
    const failureCount = element("div", "wc-stat");
    const failureValue = element("strong");
    failureCount.append(failureValue, element("span", "", "失败次数"));
    summary.append(rate, average, failureCount);

    const historyHead = element("div", "wc-history-head");
    historyHead.append(element("span", "", "最近记录"), button("清空", "clear", "wc-clear"));
    const history = element("div", "wc-history");

    panel.append(header, siteName, status, actions, forceLabel, intervalLabel, note, summary, historyHead, history);
    controls = {
      statusMode,
      statusLine,
      statusTime,
      toggle,
      checkNow,
      force,
      interval,
      rateValue,
      averageValue,
      failureValue,
      history,
    };
    root.append(panel);

    panel.addEventListener("change", (event) => {
      if (event.target === force) {
        site.forceBackground = force.checked;
        saveSite();
        applyRuntimeState(true);
      }
      if (event.target === interval) {
        site.intervalMs = Number(interval.value);
        saveSite();
        applyRuntimeState(false);
      }
    });
  }

  function renderHistory() {
    if (!controls) return;
    const fragment = document.createDocumentFragment();
    const recent = site.history.slice(-RECENT_ROWS).reverse();
    if (!recent.length) fragment.append(element("div", "wc-note", "还没有历史记录。"));
    for (const item of recent) {
      const row = element("div", "wc-row");
      const time = element("span", "", new Date(item.at).toLocaleTimeString());
      const state = element("span", item.ok ? "wc-ok" : "wc-bad", item.ok ? "在线" : "离线");
      const detail = item.ok
        ? `HTTP ${item.status} · ${item.latency} ms`
        : item.error || `HTTP ${item.status || "未知"}`;
      row.append(time, state, element("span", "wc-detail", detail));
      fragment.append(row);
    }
    controls.history.replaceChildren(fragment);
  }

  function render() {
    if (!root) return;
    const mode = currentMode();
    root.dataset.mode = mode;
    root.dataset.result = lastResult?.ok === false ? "offline" : lastResult?.ok ? "online" : "none";
    launcher.querySelector(".wc-label").textContent = `网络监测：${modeLabel(mode)}`;
    launcher.title = lastResult ? resultLabel(lastResult) : "打开 Web Connect";
    if (!controls) return;

    controls.statusMode.textContent = modeLabel(mode);
    controls.statusLine.textContent = resultLabel(lastResult);
    controls.statusTime.textContent = lastResult
      ? `最后检测：${formatTime(lastResult.at)}${failures ? ` · 连续失败 ${failures} 次` : ""}`
      : "开启后将立即进行第一次检测";
    controls.toggle.textContent = site.enabled ? "关闭监测" : "开启监测";
    controls.toggle.classList.toggle("wc-primary", !site.enabled);
    controls.checkNow.disabled = mode !== "active" || checking;
    controls.force.checked = site.forceBackground;
    controls.force.disabled = !site.enabled;
    controls.interval.value = String(site.intervalMs);

    const stats = statistics();
    controls.rateValue.textContent = stats.total ? `${stats.rate}%` : "--";
    controls.averageValue.textContent = stats.online ? `${stats.avg} ms` : "--";
    controls.failureValue.textContent = String(stats.offline);
    renderHistory();
  }

  function openPanel() {
    if (!panel) buildPanel();
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    render();
    controls.toggle.focus({ preventScroll: true });
  }

  function closePanel() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus({ preventScroll: true });
  }

  function setupUi() {
    if (!document.body || document.getElementById(ROOT_ID)) return;
    injectStyles();
    root = element("div");
    root.id = ROOT_ID;
    launcher = button("", "open", "wc-launcher");
    launcher.setAttribute("aria-label", "打开网页连通性监测");
    launcher.setAttribute("aria-expanded", "false");
    launcher.append(element("span", "wc-dot"), element("span", "wc-label", "网络监测：已关闭"));
    root.append(launcher);
    document.body.append(root);

    root.addEventListener("click", (event) => {
      const action = event.target.closest?.("button[data-action]")?.dataset.action;
      if (action === "open") {
        if (panel && !panel.hidden) closePanel();
        else openPanel();
      } else if (action === "close") {
        closePanel();
      } else if (action === "toggle") {
        site.enabled = !site.enabled;
        saveSite();
        applyRuntimeState(site.enabled);
      } else if (action === "check") {
        stopScheduler();
        void checkConnectivity();
      } else if (action === "clear") {
        site.history = [];
        lastResult = null;
        failures = 0;
        saveSite();
        render();
      }
    });

    document.addEventListener("click", (event) => {
      if (panel && !panel.hidden && !root.contains(event.target)) closePanel();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && panel && !panel.hidden) closePanel();
    });
    document.addEventListener("visibilitychange", () => applyRuntimeState(!document.hidden));
    global.addEventListener("pagehide", stopScheduler, { once: true });

    try {
      GM_registerMenuCommand(site.enabled ? "关闭当前网站监测" : "开启当前网站监测", () => {
        site.enabled = !site.enabled;
        saveSite();
        applyRuntimeState(site.enabled);
      });
      GM_registerMenuCommand("打开 Web Connect 面板", openPanel);
    } catch (_) {
      // The floating control remains available when menu commands are unsupported.
    }

    applyRuntimeState(site.enabled && !document.hidden);
  }

  setupUi();
})(globalThis);
