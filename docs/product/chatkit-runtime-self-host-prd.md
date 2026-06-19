---
doc_type: product_requirement
truth_scope: product
owner_boundary: docs/product
status: active
created: 2026-06-19
updated: 2026-06-19
---

# ChatKit Runtime Self-host PRD

## 1. 背景

campus-web 当前用户问答入口依赖 OpenAI ChatKit CDN 加载浏览器 runtime：

```text
https://cdn.platform.openai.com/deployments/chatkit/chatkit.js
```

实际 Windows 浏览器无法稳定访问该 CDN。请求可能返回 Cloudflare `403 text/html`
或被 Chrome ORB 拦截，导致首页显示“对话界面暂时无法加载”。这类失败发生在
ChatKit runtime 加载阶段，尚未进入 `/api/chatkit` 后端问答接口。

项目约束：

- 保留 ChatKit，不回到 first-party chat UI。
- ChatKit 更新频率低。
- 项目非商业化。
- 当前目标是快速上线并降低用户浏览器对 OpenAI CDN 的直接依赖。

## 2. 目标

- campus-web 自己持有并分发 ChatKit runtime 资产。
- 用户浏览器加载问答 UI runtime 时只访问 same-origin 静态资产。
- 用户浏览器不再需要访问 `cdn.platform.openai.com` 才能打开问答界面。
- 保持现有 `/api/chatkit` 后端协议和 app-api / chatkit-adapter 分工不变。

## 3. 非目标

- 不重新实现聊天 UI。
- 不新增 first-party conversation surface。
- 不引入第三方 CDN 镜像。
- 不让 app-api 在线代理 ChatKit CDN。
- 不做自动热更新 ChatKit runtime。
- 不改变 `/api/chatkit` 后端协议。

## 4. 用户价值

- Windows 侧浏览器无法访问 OpenAI CDN 时，问答页面仍能加载。
- 首页问答入口不再因外部 CDN challenge / ORB 直接不可用。
- 上线风险从“每个用户浏览器都必须能访问 OpenAI CDN”收口为“发布时固定一份可用
  ChatKit runtime 资产”。

## 5. 产品方案

采用 versioned self-host / vendored mirror。campus-web 持有固定版本的 ChatKit
runtime 资产树，例如：

```text
apps/campus-web/public/vendor/openai-chatkit/<runtime-version>/
  chatkit.js
  index-*.html
  <referenced js/css/assets>
  manifest.json
```

`chatkit.js` 会使用 `document.currentScript.src` 推导同目录 iframe HTML，因此
same-origin vendor 目录必须包含完整资产树，不能只复制单个 `chatkit.js` 文件。

默认 runtime URL 改为 same-origin：

```text
/vendor/openai-chatkit/<runtime-version>/chatkit.js
```

## 6. 功能需求

### 6.1 Runtime 加载

- campus-web 默认加载 same-origin ChatKit runtime。
- 浏览器 Network 不再请求
  `https://cdn.platform.openai.com/deployments/chatkit/chatkit.js`。
- ChatKit web component 能正常注册：

```js
customElements.get("openai-chatkit");
```

- ChatKit iframe 从 same-origin vendor 目录加载。
- 发送消息后才进入现有 `/api/chatkit` 链路。

### 6.2 失败体验

- 加载失败时，用户仍看到产品化错误文案。
- 不向用户暴露 CDN、ORB、OpenAI、iframe 或内部 runtime 细节。
- dev console 可以输出 runtime URL 和失败原因，便于本地排障。
- runtime ready timeout 应适配弱网，例如 30 秒，而不是过早判定失败。

### 6.3 Runtime 更新

新增手动更新脚本：

```text
apps/campus-web/scripts/vendor-chatkit-runtime.mjs
```

脚本职责：

- 下载 `chatkit.js`。
- 从 `chatkit.js` 解析 iframe HTML 文件名。
- 下载 iframe HTML。
- 解析 HTML 中引用的同目录 JS / CSS / assets。
- 保存到 versioned vendor 目录。
- 生成 `manifest.json`。
- 校验所有文件非空、content-type 合理、sha256 可复现。
- 不自动提交、不自动上线。

`manifest.json` 至少记录：

```json
{
  "source": "https://cdn.platform.openai.com/deployments/chatkit/chatkit.js",
  "version": "2026-06-17",
  "downloaded_at": "2026-06-19T00:00:00.000Z",
  "files": [
    {
      "path": "chatkit.js",
      "source_url": "https://cdn.platform.openai.com/deployments/chatkit/chatkit.js",
      "sha256": "...",
      "content_type": "application/javascript",
      "bytes": 26209
    }
  ]
}
```

## 7. 配置与 CSP

新增或确认配置项：

```text
VITE_CHATKIT_RUNTIME_SCRIPT_URL=/vendor/openai-chatkit/<runtime-version>/chatkit.js
```

默认值使用 self-hosted runtime。开发和生产保持一致。

CSP 要求：

- `script-src` 支持 `'self'`。
- `frame-src` 支持 `'self'`。
- `https://cdn.platform.openai.com` 不再作为 ChatKit runtime 必需项。
- Cloudflare Turnstile 相关域名保持不变。

## 8. 安全与合规

- 文档中明确：这是项目自持 ChatKit runtime mirror，不是官方 npm runtime。
- 保留 OpenAI license 文件或来源说明。
- 不修改 vendored runtime 内容，除非必须修正 source map 引用；任何修改必须记录。
- 不使用第三方 CDN 二次分发。
- 不把 API key、session、用户数据写入 vendored assets。

## 9. 验收标准

本地验收：

- 阻断或不可访问 `cdn.platform.openai.com`。
- 打开 `http://127.0.0.1:27014/`。
- 首页不再显示“对话界面暂时无法加载”。
- Network 中 ChatKit runtime 请求为：

```text
/vendor/openai-chatkit/<runtime-version>/chatkit.js
```

- runtime 请求状态为 `200`，content-type 为 JavaScript。
- iframe HTML 从同一 vendor 目录加载。
- `customElements.get("openai-chatkit")` 返回已注册组件。
- 发送消息后才访问 `/api/chatkit`。
- console 无 ChatKit runtime load error。

自动化验收：

- loader URL 单测更新为 same-origin。
- CSP 测试更新为允许 self-hosted ChatKit。
- runtime 失败态测试继续通过。
- vendor manifest 校验测试覆盖：
  - manifest 存在；
  - `chatkit.js` 存在；
  - manifest sha256 和实际文件一致；
  - iframe HTML 文件存在。

## 10. 风险与接受

风险：

- 官方未明确承诺 self-host ChatKit runtime 支持。
- ChatKit runtime 资产结构未来可能变化，更新脚本需要随之调整。
- 镜像资产可能落后官方版本。
- 如果 iframe 内部未来硬编码外部域名，仍可能存在外部依赖。

风险接受：

- first-party chat UI 已被产品方向否定。
- ChatKit 更新频率低。
- 项目非商业化。
- 用户浏览器无法访问 OpenAI CDN 是当前上线硬阻塞。
- self-hosted runtime 能把不可控的用户侧 CDN 依赖转为可控的发布资产。
