# Agent Note: 修复食堂地图编辑器过期许可证导致画布隐藏

Status: proposed

## 背景

食堂地图编辑器当前在 [`dining-editor-license.ts`](../../../../apps/ops-web/src/app/dining-studio/dining-editor-license.ts) 中硬编码了一枚带过期日期的 tldraw 试用 key。tldraw 在客户端检测到许可证过期后，会先显示提示并在数秒后隐藏编辑器内容，用户会误以为地图或草稿消失。

这与食堂和楼层 bootstrap 数据补充是两个独立问题。本计划只处理许可证来源、构建注入和验证，不修改地图 bundle、数据库数据、Ops Web 地图合同或新增地图维护能力。

## 提案

### 1. 移除源码中的过期 key

将编辑器许可证改为读取构建时的 `VITE_TLDRAW_LICENSE_KEY`：

- 读取后执行 trim，空字符串按未设置处理；
- 本地 loopback 开发不设置该变量，使用 tldraw 开发模式；
- 部署构建由部署环境提供当前有效的公开 key；
- 不把带日期的试用 key、真实公开 key 或其他凭据继续写入 TypeScript 源码。

公开 key 会出现在客户端构建中，因此它不是服务端密钥。该方案只解决过期 key 的来源和轮换问题，不绕过 tldraw 自身的许可证校验。

### 2. 规范构建时注入入口

扩展现有 `apps/ops-web/scripts/build.sh`，直接读取构建进程的
`VITE_TLDRAW_LICENSE_KEY` 环境变量。构建命令由 CI 或部署环境负责提供该变量，例如：

```bash
VITE_TLDRAW_LICENSE_KEY="$TLDRAW_LICENSE_KEY" pnpm --filter ops-web build
```

入口需要满足以下边界：

- 变量不存在或去除空白后为空时，保持普通本地开发构建行为；
- 只把该变量传给现有三次 Vite 构建，不能写入数据库、对象存储、runtime 环境变量或构建产物清单；它被编译进客户端公开资源属于预期行为；
- 日志只能说明是否已注入，不输出 key；
- 不读取仓库内临时文件，不新增 `--license-file` 参数，不依赖本地 `temp/` 目录；
- CI 优先使用受控的环境变量或部署平台 secret，key 轮换由构建环境负责。

`apps/ops-web/scripts/build.sh` 是 Ops Web 三个 Vite 调用的现有构建 owner，`apps/ops-web/Dockerfile` 的
build stage 是生产镜像构建的真实消费者入口，`docker-bake.hcl` 的 `ops-web` target 是把部署环境参数传入
该 Dockerfile 的 owner。现有 build.sh 只有三条裸 Vite 命令，没有状态输出或可测的环境传递边界；如果需要
报告注入状态或捕获环境继承，改动只应留在这个构建入口，不扩展到运行时 API。

生产镜像必须显式把变量传进 build stage：

- `apps/ops-web/Dockerfile` 的 `build` stage 声明 `ARG VITE_TLDRAW_LICENSE_KEY`，并只在该 stage
  临时设置对应 `ENV`，让其中的 `pnpm --filter ops-web build` 能读取变量；
- `docker-bake.hcl` 的 `ops-web` target 将部署环境提供的变量映射为该 build arg；
- `runtime` stage 不声明、不设置该变量，也不把它作为运行时环境传入最终镜像；Vite 生成的客户端公开资源包含该公开 key 是预期行为；
- key 是公开客户端配置，不按服务端密钥处理，但仍不能写入仓库源码、数据库、对象存储或长期运行时配置。

### 3. 验证和失败边界

补充有意义的构建入口测试，覆盖：

1. 没有环境变量时保持原有构建行为；
2. 通过受控的 Vite stub 或等价构建测试，确认 build.sh 将环境变量传给客户端 `vite build`；
3. 空值或仅空白值按未设置处理；
4. stdout、stderr、Git diff 和构建日志都不出现 key 内容；
5. Docker bake 的 `ops-web` target 能把变量传给 Dockerfile 的 build stage，runtime stage 不把它作为环境变量暴露；
6. 使用虚构 key 的构建不会把 key 写入仓库文件或长期工作区。

许可证实际只由客户端 `vite build` 产物中的 `import.meta.env.VITE_TLDRAW_LICENSE_KEY` 消费；SSR 构建和
`vite.ops.config.ts` 构建不包含地图编辑器。它们仍由同一个 build.sh 入口执行，测试只需确认环境变量不会
被入口意外清除或泄露，不把它们误报为许可证消费者。`trim` 在 TypeScript 源码读取
`import.meta.env` 后执行，构建脚本只负责环境传递。

同时运行现有 `pnpm --filter ops-web typecheck`、Ops Web 相关 Node/DOM 测试、普通构建和文档检查。若宿主浏览器缺少运行库，只调整验证手段，不通过修改宿主 `/mnt`、重置数据库或删除 Docker volume 规避。

### 4. 本地和部署安全边界

本计划只修改仓库内源码、构建脚本、`apps/ops-web/Dockerfile`、`docker-bake.hcl`、测试和相关 README/决策笔记。明确禁止：

- 读取、删除或修改 `/mnt` 下任何路径；
- 连接或修改正式 PostgreSQL、正式对象存储或生产 Kubernetes 资源；
- 修改本地 Dining 数据、运行数据库重置或使用 `--replace`；
- 执行 `pnpm dev:destroy`、`docker compose down --volumes` 或删除 Docker volume；
- 把公开 key 写入数据库、对象存储、`.env.local`、发布记录或任何长期持久化状态；
- 用假 key 以外的未确认生产 key 做本地构建。

### 5. 文档同步

实现完成后更新 `apps/ops-web/README.md`，说明本地 loopback 不设置 key、部署构建需要有效公开 key，以及环境变量构建命令。同步 Docker 构建 owner 文档或注释，说明 key 只作为 build stage 输入，不作为 runtime 环境变量；客户端公开资源包含该公开 key。将本提案按实际结果改写为 implemented 决策，记录许可证来源、构建边界和验证覆盖；不把食堂 bootstrap 计划的内容合并进来。

## 未采用方案

- **继续替换源码中的试用 key**：只能推迟下一次过期，仍会把带日期的第三方授权状态写进源码，无法稳定轮换。
- **绕过或删除 tldraw 许可证校验**：会改变第三方编辑器运行时行为，扩大风险边界，也不能满足部署授权要求。
- **把 key 放进数据库、对象存储或服务端接口**：公开客户端仍需获得该值，增加了无必要的持久化和权限边界。
- **把 key 写入仓库内临时文件或 `temp/` 目录**：这会增加本地文件生命周期和清理边界；直接使用构建环境变量即可满足注入需求。
- **在仓库外或 `/mnt` 下生成构建输入**：扩大宿主磁盘操作范围，无法由项目构建合同证明必要性。

## 可观察结果

实施完成后应能观察到：

- 源码不再包含带过期日期的 tldraw key；
- 本地 loopback 未设置 key 时，编辑器不因历史试用 key 在数秒后隐藏；
- 部署构建可以通过 `VITE_TLDRAW_LICENSE_KEY` 环境变量传入有效公开 key；
- 客户端 Vite 构建能收到 key，build.sh 执行的其他构建不会因该变量被清除或泄露；
- Docker 的 build stage 能收到 key，runtime stage 不把它作为运行时变量暴露；客户端公开资源按预期包含公开 key；
- key 不需要仓库内临时文件，也不写入仓库源码、数据库或对象存储；
- 许可证修复不会改变地图 bundle、草稿 revision、发布版本、菜单、投稿或其他 Dining 数据行为。

## 风险

- 未提供有效部署 key 时，非本地环境仍可能被 tldraw 拒绝；本地开发模式通过不注入 key 规避过期试用 key，不能替代部署配置验收。
- Dockerfile 或 docker-bake 若只在宿主环境设置变量而未传入 build stage，生产镜像构建会退回无 key；测试必须覆盖 ops-web target 到 build stage 的传递。
- 构建环境若未设置或错误设置变量，部署环境仍可能被 tldraw 拒绝；构建日志只能报告注入状态，不得打印变量值。
- 浏览器自动化可能受宿主运行库限制；这只影响验证方式，不改变许可证实现，也不构成操作 `/mnt` 或重置本地数据的理由。
