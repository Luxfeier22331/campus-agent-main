---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0052
status: accepted
created: 2026-06-01
updated: 2026-06-01
supersedes: ADR-0020
---
# ADR-0052 Self-Hosted Single-Node Qdrant And Native Backups

## Context

`campus-agent` 的 query-serving index 当前规模小，早期 production 更需要可控、
低成本、可恢复的部署面，而不是立即进入 Qdrant Cloud Standard。

`nc-arm-6c` 当前已有 Docker runtime、`/srv` 服务目录和足够磁盘空间；截至
2026-06-01，4 个当前 query-enabled collection 的 snapshot 总量约 `472M`，
服务器 `/` 还有约 `203G` 可用空间。

ADR-0020 以 Qdrant Cloud Standard / Free tier 为中心，导致 backup 方案围绕
Cloud managed backup 与 object-store snapshot bundle 展开。现在该前提不再成立。

## Decision

早期 production 与 staging 默认使用 self-hosted single-node Qdrant。

当前不采用 Qdrant Cloud，不把 Qdrant Cloud Standard automatic backups 作为目标态，
也不再把 Free tier snapshot-to-object-storage bundle 作为默认 backup 主路径。

Qdrant runtime 固定为：

- single-node Qdrant container
- persistent storage under `/srv/lib/campus-agent/qdrant/storage`
- snapshots under `/srv/backups/campus-agent/qdrant-snapshots`
- REST API 只对本机或受控内网开放，不公网裸露 `6333`
- API key 必须由 deploy secret / env 提供；不得进入 repo

## Backup Policy

backup 主路径改为 qdrant-native snapshots。

默认策略：

1. 每次 release 进入 `current`、`previous` 或 `migration_baseline` 保护窗口后，
   为对应 physical collection 创建 collection snapshot。
1. routine retention cleanup 前，必须确认被删除 collection 的恢复窗口已被
   qdrant-native snapshot 覆盖。
1. 每日至少创建一次 current alias family snapshot。
1. 每个 snapshot 必须生成本仓库自己的 metadata sidecar：
   - `backup-manifest.json`
   - `sha256.txt`
   - `restore-command.txt`
1. snapshot 必须保留在 server filesystem，并复制到 off-host archive。
1. staging R2 `campus-agent-derived-staging` 不保存 Qdrant `.snapshot`。

推荐 retention：

- local filesystem daily snapshots: `14` 天
- local weekly snapshots: `8` 周
- off-host daily snapshots: `14` 天
- migration baseline snapshots: 至少覆盖迁移窗口，默认 `30` 天

off-host archive 可以是另一台服务器、独立对象存储 bucket 或人工指定的冷备目录。
它不属于 serving seed bucket，不参与 online query path。

## Restore Policy

restore 顺序固定为：

1. 停止写入目标 Qdrant 或切断 release publish。
1. 从 snapshot 恢复 physical collection。
1. 按 `backup-manifest.json` 中的 `alias_bindings` 重建 alias。
1. 对照 release manifest 校验：
   - physical collection
   - point count
   - `index_release_id`
   - `index_release_manifest_key`
   - `index_release_alias`
1. 运行 retrieval acceptance 或 staging readiness gate。

collection snapshot 本身不承担 alias truth；alias binding 必须来自 manifest。

## Boundaries

不变边界：

- Qdrant 仍是 query-serving index，不是 source truth。
- release manifest、document units、canonical docs 仍是可重建 index 的上游 truth。
- object store / seed artifacts 仍不保存 chunk dump。
- staging R2 只保存 serving seed/object artifacts，不保存 Qdrant snapshots。
- 不把 self-hosted single-node 伪装成 HA 或 managed DR。

当前明确不做：

- 不部署 distributed Qdrant。
- 不引入 Qdrant Cloud。
- 不把 Qdrant API 直接暴露到公网。
- 不用 backup cleanup fallback 猜测 missing manifest。

## Consequences

正面影响：

- backup 与 restore 走 Qdrant 原生 snapshot 能力，减少 Cloud Free tier 特例。
- staging / early production 共享同一类 runtime substrate。
- snapshot 不占用 R2 serving bucket。

代价：

- 我们承担 Qdrant host、volume、API key、upgrade、monitoring、snapshot retention、
  off-host copy 与 restore drill。
- 单节点没有 HA；host 或 volume 故障时依赖最近 off-host snapshot 恢复。
- 需要定期演练 restore，否则 snapshot 只是文件，不是恢复能力。

## Migration From ADR-0020

ADR-0020 标记为 superseded。旧 `qdrant-cloud-backup.md` 正文已退出 branch
tip；需要追溯 cloud/free-tier 操作背景时通过 git history 恢复具体片段。

新的 active staging data-plane runbook 为：

- `docs/runbooks/execution-ops.md`

现有 object-store backup cleanup 命令只用于清理历史 `*/backups/*` bundle；
新的默认 backup 不再写入 derived bucket。

## External References

- Qdrant Snapshots: <https://qdrant.tech/documentation/operations/snapshots/>
- Qdrant Installation: <https://qdrant.tech/documentation/guides/installation/>
- Qdrant Security: <https://qdrant.tech/documentation/operations/security/>
