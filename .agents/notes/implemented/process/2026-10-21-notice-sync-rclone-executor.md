# Agent Note: 通知源对象同步引入 rclone 执行层

Status: implemented

## 背景

`dev:sync-notices --with-sources` 把 staging 的通知源对象闭包复制到本地开发实例。原实现把
每个对象（正文图片、PDF 附件、元数据 JSON）逐个从远端 S3 读入内存再写本地 RustFS：串行、
无重试、无断点。实际使用中一条月度窗口约数百对象耗时近十分钟，kubectl port-forward 偶发
连接重置会让整个窗口中止重来；同步是本地验证 PDF 附件检索链路的前置步骤，这个成本被反复支付。

## 决策

二进制对象（图片、附件）的复制执行层换成 rclone：闭包解析（读 `source_ref` JSON、校验、
枚举 resources 的 `object_key`）保留在 JS，产出 `--files-from` 清单后调用
`rclone copy --transfers 8 --retries 3 --checksum`。并发、逐对象重试和已存在对象跳过
（即断点续传）由 rclone 承担，自研代码收敛到闭包解析与校验这两件有业务语义的事。

远端配置经 `RCLONE_CONFIG_*` 环境变量传入子进程，不写 rclone.conf：inline `:s3,...`
连接串无法携带 `http://` endpoint（实测 rclone 1.75 解析失败），环境变量同时避免凭据落盘。
rclone 复用同步已建立的同一 port-forward 端口。

传输完整性由 rclone `--checksum` 负责，JS 不再在复制后重读本地副本计算 sha256。元数据 JSON
（`meta.json` 与各 `source_ref`）在闭包解析时以 8 路有界并发读取一次、parse 并做 schema 校验，
写入本地时直接复用这次读到的字节，不再为写入重读远端；这是闭包解析的固有开销，rclone 无法替代。
`data sync --with-sources` 与 `dev:sync-notices` 共用这条路径，不保留逐对象 JS 复制分支。

rclone 进入 nix full shell（nixpkgs 提供，不自建 fetchurl 包；CI shell 不包含，同步工具
不进 CI）。rclone 缺失时同步明确报错提示 `nix develop`，不静默回退 JS 路径——两条路径
两套重试语义，回退会掩盖问题。

## 未采用方案

s5cmd 在纯吞吐上更优，但 `--files-from` 清单选择与后端灵活性上 rclone 更完整，且我们是
按闭包选择复制而非全量镜像。`mc mirror --watch` 面向持续复制，本地验证只需按需快照。

在 JS 内自建并发与重试（p-limit 加重试循环）能复用现有依赖，但等于逐项重造 rclone 已有的
传输语义，后续维护面在自研侧持续存在。

保持原串行实现，仅在 CLI 外部包装循环重试：不解决速度，且每对象无重试的语义未变。

## 后果

首次窗口复制由约 1 对象/秒提升到 rclone 并发（实测 670-822 对象的月度窗口，剩余耗时主要
是闭包解析的远端 JSON 读取）；中断重跑时 rclone 跳过已存在对象，断点续传免费获得；
port-forward 抖动由 rclone 逐对象重试吸收，不再中止窗口。35MB 级 PDF 在 rclone 流式复制
下不再整体进入 Node 堆内存。

`--checksum` 依赖 MinIO/RustFS 的 ETag 一致性；若后续升级出现 ETag 不可靠，再按实际失败
选择 rclone 自身的校验方式，不恢复 JS 侧逐对象重读。升级 nixpkgs 时需同步验证一次
rclone 连接串与 env-var 配置行为。
