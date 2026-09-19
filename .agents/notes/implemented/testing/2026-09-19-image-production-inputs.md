# Agent Note: 镜像生产输入与 PR 增量构建

Status: implemented

## 背景

PR 连续两次成功运行之间只有测试、文档和 Turbo 测试配置变化，旧选择仍重建镜像。Turbo 的
校验任务传播不能代表生产镜像输入；每次与完整 PR base 比较也会重复选择已经验证的源码。
Node 与 Debian tag 在两次运行间解析到不同 digest，进一步增加了重复构建开销。

## 决策

镜像选择由 release 的生产输入映射负责，PR、手动镜像检查和候选发布共用。读取比较前后
workspace 声明的并集，沿生产依赖查找消费者；Ops 编译的 UI、Dining 开发依赖显式保留，
测试专用跨应用依赖只保留 manifest。Dockerfile 包外资源继续显式映射。
实际构建发现 Ops 生产代码直接消费 `ingestion-contracts`，但此前依靠间接依赖带入源码；
补齐 Ops 生产依赖声明，使裁剪与安装均遵循真实消费者。

PR 查询 GitHub 已有运行记录，只使用同 PR 成功工作流中确实成功的镜像 job，取其 reusable
workflow 的 merge SHA。两次 merge 提交可能互不为祖先，因此直接比较树。不可用时选择完整
PR diff；不保存额外基线文件或数据库。普通校验的 base、缓存权限与分组资源约束保持原合同。

Docker context 排除测试、校验配置与本地产物；prune 后移除测试依赖源码，但保留 frozen install
所需 manifest。Go 的模块下载层与生产代码层分开。SQL、schema 和运行时 fixture 保留。

## 未采用方案

- Turbo affected 能统一校验图，但测试边与生产边不同，继续复用会保留已观察到的重复构建。
- 每次比较 PR base 简单可靠，但无法跳过同 PR 已成功验证且没有变化的镜像。
- 固定基础镜像 digest 能稳定缓存，但用户明确不采用，也不新增自动更新流程。
- 额外记录构建 hash 或 receipt 能保存基线，但 GitHub 现有成功运行记录已经满足当前消费者。

## 后果

历史两次运行的 14 个变更文件在新选择中返回空镜像集合。回归覆盖 sibling tree、生产依赖删除、
失败与取消运行排除、跳过的镜像 job、历史查询失败和 merge 对象不可获取。构建复验使用临时
目录与现有 ARM64 builder，不新增性能门禁或浏览器测试。基础 tag 更新仍可能使选中的镜像缓存
失效；这是保留 tag 策略的结果。新增生产开发依赖或包外资源时需更新对应映射。

12 个 ARM64 镜像实际构建通过，无改动热构建耗时 2 秒。测试／Turbo 配置／测试依赖源码变更耗时 7 秒，
Ops 安装、编译与 Go 编译层均命中缓存；Ops 源码变更只重建 Ops，Go 源码变更只执行 Go 构建，
后者整轮 5 秒。仓库脚本 381 项测试、文档、格式及 workflow 检查通过。现有 builder 的本地
缓存上限为 12GB，连续全量构建后出现过未命中；不把本地层常驻当成合同，保留现有 registry 缓存。
