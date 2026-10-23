# Agent Note: 食堂地图编辑器 tldraw 许可证来源与构建注入

Status: implemented

## 背景

食堂地图编辑器曾在 [`dining-editor-license.ts`](../../../../apps/ops-web/src/app/dining-studio/dining-editor-license.ts)
中硬编码一枚带过期日期的 tldraw 试用 key。tldraw 在客户端检测到许可证过期后，会先提示并在数秒后隐藏编辑器
内容，维护人员会误以为地图或草稿消失。这与食堂 bootstrap 数据和编辑器交互问题相互独立；本决策只处理许可证
来源、构建注入和验证，不修改地图 bundle、数据库数据或 Ops Web 地图合同。

## 决策

### key 来源

源码只读取构建时的 `import.meta.env.VITE_TLDRAW_LICENSE_KEY`，trim 后空值按未设置处理。本地 loopback 开发
不设置该变量，使用 tldraw 开发模式；部署构建由构建环境提供有效公开 key。公开 key 会编译进客户端资源，
不是服务端密钥，但不写入仓库源码、数据库、对象存储或长期运行时配置，也不绕过 tldraw 自身的校验。

当前 key 是绑定 `ops.muc.wiki` 的 tldraw hobby license。tldraw 按当前 hostname 精确匹配许可证 host
（只额外兼容 `www.` 前缀），各环境泳道共用 `ops.muc.wiki`，因此一枚 key 覆盖全部泳道；编辑器迁到其他
hostname 时必须重新申请或补充域名，否则画布会因域名无效被隐藏。

### 构建注入链路

- `.github/workflows/staging-candidate-publish.yml` 的镜像发布步骤从仓库 secret `TLDRAW_LICENSE_KEY` 设置
  `VITE_TLDRAW_LICENSE_KEY`；`scripts/release/images.mts` 继承进程环境执行 bake。
- `docker-bake.hcl` 的 `ops-web` target 把同名变量映射为 build arg。
- `apps/ops-web/Dockerfile` 只在 build stage 声明 `ARG` 并临时设置 `ENV`，runtime stage 不声明该变量。
- `apps/ops-web/scripts/build.sh` 是三次 Vite 构建的 owner，只报告是否已注入，不输出 key。许可证实际只由
  客户端 `vite build` 消费；SSR 和 `vite.ops.config.ts` 构建不含编辑器，不作为许可证消费者。

PR 镜像证据构建不注入 key，产物处于未授权状态；它只用于构建验证，不进入部署。

## 未采用方案

- **继续替换源码中的试用 key**：只能推迟下一次过期，并把带日期的第三方授权状态写进源码，无法稳定轮换。
- **绕过或删除 tldraw 许可证校验**：改变第三方编辑器运行时行为，也不满足部署授权要求。
- **把 key 放进数据库、对象存储或服务端接口**：客户端仍需获得该值，只增加持久化和权限边界。
- **把 key 写入仓库内临时文件、`temp/` 或仓库外路径**：增加文件生命周期和清理边界，构建环境变量已足够。
- **用 GitHub variable 而非 secret 保存 key**：key 虽公开，但 secret 避免它出现在 workflow 日志，成本相同。

## 后果

- key 轮换由仓库 secret 负责。镜像发布按源码变更选择目标，只更新 secret 不会触发 ops-web 重建；轮换后需随
  ops-web 源码变更或其他命中 ops-web 构建输入的提交发布，新 key 才进入客户端资源。
- secret 缺失时发布不会失败，而是产出未授权的 ops-web 客户端；部署后编辑器会被 tldraw 隐藏。构建日志
  `tldraw license key: configured` 是区分两者的入口。
- 测试覆盖 build.sh 的环境传递与空白值处理（`apps/ops-web/test/build-script.node.test.ts`），以及 Dockerfile
  build/runtime stage 与 bake 映射（`apps/ops-web/test/dockerfile-workspace.test.ts`）。workflow 到 secret 的
  映射没有单独测试，部署后以 `ops.muc.wiki` 编辑器停留后仍可见作为验收。
- 许可证修复不改变地图 bundle、草稿 revision、发布版本、菜单、投稿或其他 Dining 数据行为。
