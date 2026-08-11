# status-web

`status-web` 是面向公众的产品可用性状态页 Worker。它与 `campus-web` 现有的班车、食堂等
校园业务状态页面分开。公共页面只读取本 Worker 发布的快照；Cron 通过 App API 匿名端点探测问答，
但不直接读取 PostgreSQL、Langfuse 或 Ops Web。

## 当前范围

- `GET /`：公共状态页；
- `GET /api/status`：`product-availability-snapshot.v1` 只读快照；
- `/go/campus/*`：固定的 Campus 产品入口重定向，只接受页面定义的路径，不接受查询参数；
- Cron：只黑盒探测两个产品信号：从 App API 的 `GET /api/chat/availability` 读取 `campus.qa`，从
  Campus 公共入口的 `/` 读取问答之外的整体站点 `campus.services`，然后发布快照；文档、地图及
  地图地点等静态页面/数据不单独探测；
- 第一版只显示当前状态和过去 30 天按日时间线，不建立事件、维护、通知或订阅模型。

页面在标题后直接展示“校园问答”和“其他服务”两个固定服务行，每行包含当前状态、最近检查时间和过去 30 天时间线，
不增加分组标题、服务计数、折叠详情、单日日期选择器或常态整体汇总横幅。`product-availability-snapshot.v1` 也只接受
按此顺序发布的 `campus.qa` 与 `campus.services`；增加服务必须发布新的合同版本。缺失的历史日期显示为“无历史数据”，
不会伪装成 `unknown`；每个日期用窄竖条表达状态。正常快照不展示
状态计数或全局更新时间，只有快照过期或读取失败时才在服务区域提示数据新鲜度。公共页面不展示开发、预发布或
生产环境徽标，环境只用于快照隔离和运行时配置。时间线日期和页面完整时间统一使用北京时间（`Asia/Shanghai`，
UTC+8），这些实现细节不在页面底部重复说明。30 天时间线沿用参考页的连续轨道布局：条段高约 `32px`、
间隙 `2px`，在移动端铺满卡片内容宽度，桌面轨道上限为 `448px`；页面本身不产生横向滚动。

所有 viewport 共用同一套时间线 DOM 和复合 slider：每项服务只有一个 `role="slider"` 进入 Tab 顺序，`aria-valuemin="1"`、
`aria-valuemax="30"`、当前索引和包含日期/状态的 `aria-valuetext` 同步当前选择。左/下方向键选择前一天，右/上方向键选择后一天，
`Home` 和 `End` 选择首尾日期且不会循环；轨道横坐标的点击、触摸和细指针移动选择最近日期。30 根竖条只作为视觉子元素，
不增加横向滚动。桌面支持 hover、focus 和 click，粗指针设备支持 tap/click；日期结果由
一个页面级 `role="tooltip"` 提示层展示，提示层不承担 live region。页面加载后按固定间隔自动读取快照，常态不
提供手动刷新按钮；初始页面使用与两个服务行同尺寸的静态骨架，首次读取失败时继续保留，等待下一次固定间隔读取；
禁用 JavaScript 时在同一列表内显示启用要求，不把骨架伪装成状态结果。时间线除颜色外还用实心、一道横向空隙、
两道横向空隙、点线轮廓和虚线轮廓区分正常、受影响、中断、未知和无历史数据。页面只通过一个隐藏的 `status`
live region 播报首次成功、服务状态变化、过期、失败和恢复，不播报生成时间、相对时间或时间线浏览动作。

状态页浏览器是匿名公共面，不读取账号、session 或 App API，只读取同源 `GET /api/status`。桌面 header 与 Campus 产品导航保持相同顺序：问答、文档、
校园地图、食堂、同好群、反馈、服务状态；Campus 入口通过 `/go/campus/*` 固定重定向进入配置的公共 origin。
移动 header 使用原生 `dialog` 展开同一组导航；外观操作使用与 Campus 相同的“跟随系统/浅色/深色”三项分段单选，
不增加账号分组。

环境仓应按每 5 分钟触发 Cron；快照 15 分钟未更新后，公共当前状态降为 `unknown`。

浏览器请求使用 10 秒截止时间和 `ETag` 条件缓存。自动读取失败时，如果页面已有快照则保留最近结果并明确提示
无法更新；快照已经过期时只保留历史时间线，当前状态显示为 `unknown`。

`STATUS_QA_ORIGIN` 是 App API 探测入口，问答信号请求其 `/api/chat/availability`；
`STATUS_CAMPUS_ORIGIN` 是 Campus 探测入口，问答之外的整体站点信号请求其 `/` shell。入口可以是 staging
边缘主机，也可以是经过 HTTP 重定向或 Cloudflare custom domain 映射后的规范入口。探测会跟随标准
HTTP 重定向，入口别名不会形成额外的公共服务行。

`CAMPUS_WEB_PUBLIC_ORIGIN` 只用于状态页的固定 Campus 导航重定向，不能替代探测入口；`STATUS_WEB_PUBLIC_ORIGIN`
只用于 Campus Worker 的 `/status` 入口重定向。两者均由环境仓在 staging 上传时通过 Worker plain-text
变量注入，源码配置不写入具体 `muc.wiki` 域名。

## 本地验证

```bash
pnpm --dir apps/status-web typecheck
pnpm --dir apps/status-web test:node
pnpm --dir apps/status-web test:worker
pnpm --dir apps/status-web build:worker
pnpm --dir apps/status-web test:browser
```

`test:node` 同时覆盖 `public/status-page.js` 的时间线锚点、空历史、服务状态归一化、过期判断、请求超时、
自动读取失败、复合 slider、提示层、主题模式和焦点恢复。`test:browser` 是本地 Playwright/Axe 用户行为验证，覆盖 320、
390、768、1023、1024 和 1440 CSS viewport，以及暗色、forced-colors 和 reduced-motion；它不进入 PR 缓存，
也不证明任何环境已部署。
页面脚本由 `public/index.html` 以同源静态模块加载，Worker 不把它编译成新的运行时入口。

本地探测需要让 `STATUS_QA_ORIGIN` 指向 App API，让 `STATUS_CAMPUS_ORIGIN` 指向 Campus Web；如果要验证互链，
同时为两个 Worker 提供各自的本地 public origin。生产和 staging 必须由环境仓提供
`STATUS_QA_ORIGIN`、`STATUS_CAMPUS_ORIGIN`、`CAMPUS_WEB_PUBLIC_ORIGIN`、`STATUS_SNAPSHOT` KV binding、Cron 和 custom domain；
Campus staging 还需要 `STATUS_WEB_PUBLIC_ORIGIN`。源码仓的 staging 配置不声明尚未确认的域名。

## 域名边界

正式公共入口预留为 `status.muc.wiki`。`campus.muc.wiki`、`service.muc.wiki` 等产品入口是被探测
的对象，不是状态 Worker 的别名。环境之间使用独立快照存储，避免把 staging 历史显示在生产页面。
