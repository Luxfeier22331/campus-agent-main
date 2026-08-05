---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---

# staging 对象存储迁移到 RustFS

## 边界

本手册只处理尚未承载 production 的对象存储：本地数据可以重新创建，staging 必须在完整维护窗口内
从 MinIO 迁移到 RustFS。迁移保持两个 bucket 的全部对象版本、删除标记、`VersionId`、
`LastModified`、`ETag`、`Content-Type` 和自定义 metadata；不改变应用的 `OBJECT_STORE_*`、bucket、
region、DTO、schema 或 SDK 合同，也不增加应用双读双写。

RustFS server 固定为 `rustfs/rustfs:1.0.0-beta.12`，`rc` 固定为
`rustfs/rc:v0.1.30`，部署清单同时固定镜像 digest。production 尚未上线，因此没有 production 数据
迁移步骤。`docs_publish` 数据库角色、授权和 Job 已从主干删除，本迁移不得恢复它们；切换后的真实
文档消费检查由 Campus Web `docs:prepare` 承担。

## 合并与 promotion 隔离

正常 promoter 会改写活跃 overlay 顶层的所有 Source remote ref。如果直接合并 Source PR，现有
data-object-store ref 会从 MinIO base 自动推进到 RustFS 稳态 base，绕过迁移。因此按以下顺序提交：

1. GitOps 准备 PR 先增加中性管理 Secret 的投递合同，并把 data-object-store 顶层 remote ref 移入临时
   本地 `source-pin/kustomization.yaml`。父 overlay 只引用 `source-pin` 和 SealedSecret，渲染结果必须
   与当前 MinIO 完全等价；promoter 单测必须证明它不递归改写该 pin。
2. GitOps 准备 PR 完成协调后，在 `staging` Environment 设置两个 `OBJECT_STORE_ADMIN_*`，从 `main`
   运行 `secrets.yml`，合并它生成的 `ops/staging-secrets` PR，并等待 SealedSecret 完成协调。准备 PR
   本身不包含新密文，不能用其合并状态代替凭据投递结果。
3. Source PR 从最新 `origin/main` 合并 RustFS 稳态 base、本地开发改造，以及临时
   `infra/k8s/data-object-store/migration/base`、`migration/cutover` root。`object-store-bootstrap` 保持
   `PostSync`，不添加数据库安装 Job 使用的 `Force=true,Replace=true`。
4. Source 合并后记录真实 commit SHA。GitOps 迁移 PR 在 `source-pin` 中同时引用旧 revision 的 MinIO
   base 和新 SHA 的 `migration/base`；不能使用分支名、候选 SHA 或占位值代替已合并事实。其他
   Application 继续正常 promotion。
5. 切换 PR 把 pin 中的 migration root 改为 `migration/cutover`，此时才更新
   `Application/data-object-store-staging` 的 `campus-agent.io/source-sha`。
6. 验收完成后，稳态 PR 让父 overlay 恢复直接引用新 SHA 的 RustFS `base`，删除 `source-pin`。从此
   data-object-store 重新进入正常 promotion。

前三项完成只表示迁移准备已经交付；`source-pin` 仍固定 MinIO，尚未部署并行 RustFS，也没有复制或
切换数据。实际迁移从第四项开始，必须进入维护窗口并逐项取得后续章节要求的环境证据。

主干在迁移开发期间有新提交时，只把迁移分支变基到最新 `origin/main` 并重跑受影响检查，不把其他
功能分支合并进迁移分支。涉及同一清单的冲突按当前消费者重新推导；数据库 Job 的协调策略不传播到
对象存储 hook。

## 复制兼容前置检查

RustFS 官方文档说明 bucket replication 支持 existing objects、delete 和 delete-marker，但从 MinIO 到
当前固定 RustFS 版本仍是跨实现边界。部署 staging 前必须用仓库固定的 MinIO、`mc`、RustFS 和 `rc`
镜像完成一次临时容器检查，证明已有对象、全部版本、删除标记、显式版本删除、multipart、metadata、
`VersionId`、`LastModified` 和 `ETag` 均符合本手册的迁移合同。任一项不满足时停止迁移，不以普通
`mirror`、应用双写或忽略旧版本代替。

2026-08-03 使用上述固定镜像执行临时容器检查时，两个普通对象版本及 70 MiB multipart 对象的
`VersionId`、size 和 `ETag` 均复制到 RustFS，但 multipart 对象在目标端获得了新的
`LastModified`，见 RustFS issue [#5662](https://github.com/rustfs/rustfs/issues/5662)。当前迁移合同接受
这一项已知例外：源 ETag 必须符合 multipart 形式且与目标 ETag 相同；目标时间不得早于源时间，并且
必须落在本次 replication 的起止窗口内。普通 PUT 和删除标记仍要求时间完全一致。除此以外任一差异
仍阻断迁移；升级 RustFS 后也必须重新执行完整前置检查，不能默认问题已经消失。

## 准备并行目标

1. 在 GitOps `staging` Environment 添加 `OBJECT_STORE_ADMIN_ACCESS_KEY` 和
   `OBJECT_STORE_ADMIN_SECRET_KEY`，值与当前 MinIO root 凭据相同，本次不轮换。把同名 key 投递到
   strict `object-store-secrets`；旧 `MINIO_ROOT_USER` 和 `MINIO_ROOT_PASSWORD` 在 MinIO 仍运行时保留。
2. `source-pin` 同时引用当前已部署的旧 MinIO base 和新 Source SHA 的 `migration/base` root。删除旧
   `object-store-bootstrap` ConfigMap、Job 和已无消费者的 `data-object-store-bootstrap-egress`，避免旧
   `mc` PostSync hook 在切换时访问 RustFS。给旧 MinIO Pod template 增加
   `app.kubernetes.io/instance: minio`，稳定 `Service/object-store` 临时同时选择
   `name=object-store,instance=minio`。旧 `data-object-store-ingress` 的 Pod selector 也必须追加
   `instance=minio`，否则其宽泛 ingress 会同时选中 RustFS。不要修改旧 StatefulSet 的 immutable
   selector。
3. 同步 migration root。确认 `StatefulSet/object-store-rustfs` Ready、新 PVC
   `data-object-store-rustfs-0` Bound，且临时 Service
   `object-store-rustfs-migration:9000` 只选择 `instance=rustfs`。迁移期间保留现有
   `StatefulSet/object-store` staging patch，并为 `object-store-rustfs` 添加独立的 `local-path`
   storageClass patch；不能把旧 patch 直接改名后漏掉仍运行的 MinIO。稳态 PR 再删除旧 patch，只保留
   RustFS 目标。
4. 确认一次性初始化 Job 成功。它只创建 bucket、versioning、IAM 和公开 floorplan policy；为避免复制
   期间删除源数据，此阶段不导入 lifecycle。

## 冻结写入

当前 staging 的活跃对象写入者是 `Deployment/ops-web` 和会执行 `bootstrap-dining` 的
`Job/ops-web-bootstrap`；当前没有部署 ingestion-control 或 source-collector worker。维护窗口用独立
GitOps freeze PR 把 `ops-web` replicas 设为 0，并从渲染中删除 `ops-web-bootstrap`，等待两个 Application
均完成同步后再开始复制。不要用跨 Application 的同步顺序推断写入已经停止；冻结后还要检查 namespace
中不存在其他引用 `object-store-secrets` 的运行中写入 workload。完成切换和只读验收前，不合并
unfreeze PR。

## 复制与核对

应用 `infra/k8s/data-object-store/migration/operator-pod.yaml` 创建临时
`Pod/object-store-migration-operator`。该清单不在任何 Kustomization 中，最长运行 4 小时，只能通过
NetworkPolicy 访问 DNS、旧 MinIO 和新 RustFS；它从同一个 `object-store-secrets` 读取旧
`MINIO_ROOT_*` 和中性 `OBJECT_STORE_ADMIN_*`。Pod Ready 后立即记录 UTC replication 开始时间。

使用 Pod 中固定版 `mc`，为 `campus-agent-source` 和 `campus-agent-derived` 分别启用 bucket
replication，选项必须包含 existing objects、delete 和 delete-marker。使用服务端 replication，不挂载
旧 PVC 到 RustFS，也不以普通 `mirror`、普通 PUT 重传 multipart 或应用双写代替版本复制。等待两个
bucket 的 replication pending/failed 均为 0，记录 UTC replication 结束时间，再停止并删除 replication
rule；保持写入冻结，重新确认 pending/failed 为 0。

固定版 `mc stat --recursive --versions` 遇到当前删除标记会返回 `MethodNotAllowed`，因此不能把该命令
作为证据。在 Source 仓库通过临时 inventory 工具调用 operator Pod 中的固定版 `mc`，分别采集源和
目标的 list，以及每个非删除版本的精确 stat。工具把 list 中的完整 key 和 `versionId` 包在 stat JSONL
外层，不使用 `mc stat` 只返回 basename 的 `name` 作为对象身份。采集文件权限为 `0600`，不得提交、
上传到 Issue 或写入 CI artifact，完成后删除。

先采集 source bucket 的两侧 inventory：

```bash
pnpm exec tsx infra/k8s/data-object-store/migration/inventory.ts \
  collect \
  --namespace campus-agent-staging \
  --alias source \
  --bucket campus-agent-source \
  --ls-output /tmp/source-source.ls.jsonl \
  --stat-output /tmp/source-source.stat.jsonl

pnpm exec tsx infra/k8s/data-object-store/migration/inventory.ts \
  collect \
  --namespace campus-agent-staging \
  --alias target \
  --bucket campus-agent-source \
  --ls-output /tmp/target-source.ls.jsonl \
  --stat-output /tmp/target-source.stat.jsonl

pnpm exec tsx infra/k8s/data-object-store/migration/inventory.ts \
  compare \
  --bucket campus-agent-source \
  --source-ls /tmp/source-source.ls.jsonl \
  --source-stat /tmp/source-source.stat.jsonl \
  --target-ls /tmp/target-source.ls.jsonl \
  --target-stat /tmp/target-source.stat.jsonl \
  --replication-start 2026-08-03T10:05:00.000Z \
  --replication-end 2026-08-03T10:10:00.000Z
```

对 derived bucket 使用 `campus-agent-derived` 和对应的 `*-derived.*.jsonl` 文件名重复执行。`collect`
串行查询非删除版本，key 中的空格、Unicode 和 `/` 都作为一个参数传给 `mc`；失败只输出对象身份哈希。
`compare` 以 `(bucket,key,VersionId)` 合并 list/stat，核对：

- 每个 key 的全部 `VersionId`、删除标记、`IsLatest` 和 `LastModified`；普通 PUT 与删除标记的
  `LastModified` 必须完全一致，multipart 只允许 issue #5662 中限定的时间例外；
- 每个对象版本的 size、`ETag`、`Content-Type` 和自定义 metadata；
- metadata 中存在 `content-sha256` 时必须一致；差异报告只输出对象身份哈希、字段和原因，不输出 key
  或 metadata 值；
- 两个 bucket 的 versioning 状态，以及 derived 的
  `dining/floorplans/*` 匿名读取边界；
- source 凭据不能访问 derived，derived 凭据不能访问 source；
- 抽样普通 CRUD、显式 multipart upload 和按 version 读取。

两个 bucket 的工具退出码都必须为 0，且人工边界检查全部通过。任一集合不一致时保持稳定 Service
指向 MinIO，修复复制并重新全量核对；不能进入部分切换。

## 切换与验收

1. 保持写入冻结，确认 replication rule 已删除，并再次确认最后一轮版本集合一致。
2. GitOps 保留两个 StatefulSet，把 pin 中的 migration root 改为 `migration/cutover`，并让稳定 Service 选择
   `instance=rustfs`。cutover root 此时才允许同 namespace 消费者访问 RustFS 的 TCP 9000；cutover Job
   通过临时 RustFS Service 导入 lifecycle，旧 MinIO 仍由 Git 管理。
3. 确认 `/health/live`、`/health/ready`、source/derived S3 凭据、公开 floorplan 前缀和 lifecycle 均
   正常；随后用 staging 对象存储配置运行 `pnpm --dir apps/campus-web docs:prepare`。
4. 写入仍冻结时若失败，只把稳定 Service selector 恢复到 `instance=minio`。全部只读检查通过后合并
   独立 unfreeze PR，恢复 `ops-web` 和 `ops-web-bootstrap`，再完成一次真实读写；恢复后不再承诺只切
   selector 的无损回退，失败时必须重新冻结并修复 RustFS 或执行经核对的反向迁移。
5. 真实读写通过后，GitOps 改为只引用 Source 的 RustFS 稳态 base。该 base 复用
   `StatefulSet/object-store-rustfs` 和 PVC，并由正式 `object-store-bootstrap` 再次收敛配置。

## 清理

staging 验收完成后由稳定 base 的同步删除 GitOps migration pin、临时 Service/Job/NetworkPolicy
和旧 MinIO StatefulSet，并手动删除临时 operator Pod 和本地 inventory JSONL。确认旧 workload 已
消失、RustFS 稳态持续健康且旧 PVC 不再需要后，再以单独环境操作删除 MinIO PVC。只有最后一个 MinIO
消费者删除后，才从 Secret 投递、SealedSecret、workflow、测试和文档中同时删除
`MINIO_ROOT_USER` 与 `MINIO_ROOT_PASSWORD`。Source 中的临时 migration root
随后整目录删除，并同时删除 `scripts/ci/infra-check.sh` 中运行该目录测试的临时入口；中性的
`OBJECT_STORE_ADMIN_*` 和应用 `OBJECT_STORE_*` 保持。

本地迁移不复用 MinIO volume。首次 `pnpm dev:init` 创建 `local_object-store-data`；旧
`local_minio-data` 的删除是独立人工清理动作，不得连带删除 `local_postgres-data`、数据库或任何
worktree profile。该命令同时创建固定 `campus-agent-derived`，并在 `campus-docs/source.json` 缺失时
写入确定性开发文档；已有来源不覆盖。

## 依据

- RustFS release：<https://github.com/rustfs/rustfs/releases/tag/1.0.0-beta.12>
- RustFS 环境变量：<https://docs.rustfs.com/en/reference/environment-variables>
- RustFS 健康检查：<https://docs.rustfs.com/en/operations/status-check>
- RustFS CLI：<https://docs.rustfs.com/en/operations/rc>
- RustFS bucket replication：<https://docs.rustfs.com/en/administration/data/bucket/replication>
