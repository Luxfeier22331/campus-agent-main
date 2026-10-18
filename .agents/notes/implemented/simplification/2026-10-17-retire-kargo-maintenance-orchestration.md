# Agent Note: 移除 Kargo Stage 维护编排

Status: implemented

## 背景

[无 UI Kargo 发布编排](../process/2026-10-13-kargo-headless-release.md)让 Kargo 根据 Source 候选的
`maintenanceRequirements` 和 GitOps 计划中的未完成维护状态，在同一个 Stage 里选择普通发布或
`agent-control-schema-rename` 维护阶段。这个选择被写成多个复合表达式：候选是否声明 profile、计划中
是否已有完成标记、维护是否进行中、当前 Freight 是否比维护候选更新，以及维护身份属于哪个 Promotion。
每个普通步骤和维护步骤都重复嵌入这些表达式，生成的 Stage 远大于普通发布本身所需。

引入后的修复集中在这些表达式上：条件拼接、变量求值时机、任务变量默认值和失败传播。同一个选择还在
TypeScript 中重复判断，两边结论出现过分歧。完成状态也有两处记录：计划的 `completedMaintenance` 和
`releases/staging-migrations/` 中的完成文件。prepare 冻结的维护状态没有正式修正入口，修正候选时只能
人工同时修改计划、overlay 和阶段产物。

该 profile 已由维护流程完成并写入完成文件。维护阶段、受控 Application 列表、流量切换和 verify 后的
Cloudflare 步骤都按这一次 schema/role 迁移写死，下一次停机迁移的阶段和应用集合不会相同。

## 决策

从 GitOps 的 Kargo 生成器移除维护编排，staging 和 manual Stage 只保留普通发布路径；Stage 不再读取
上一份计划，execute 任务不再接收维护 profile 和启用条件。render contract 拒绝维护步骤和读取上一份
计划的步骤，不经重新设计就无法加回维护分支。

`releases/staging-migrations/` 中的 `maintenanceProfile` 是维护 requirement 的唯一完成记录。候选组装
和 prepare 共用同一个读取函数：前者过滤已完成的 requirement，后者对仍未完成的 requirement 直接失败。
计划文件不再保存完成标记。prepare 的拒绝是下一次迁移需要重新接入维护流程的入口信号。

维护执行代码、`kargo-execute.yml` 的 `maintenance-*` action 和 `maintenance-staging` Application 不再
由 Kargo 调用，随旧 role、旧 Secret 的退役发布一起移除，不在本次单独删除。2026-10-18 的退役发布删除了
这些执行代码和 schema 镜像的 `maintenance` 子命令；Source migration 回收 `execution_control` 经 rename
保留的授权后，GitOps 以 CNPG `ensure: absent` 删除该 role，并删除旧 Secret、发布窗口 key 与
`maintenance-staging`。完成记录的唯一写入方随执行代码删除，下一次迁移接入时自带写入方。

下一次需要停机迁移时，按该迁移的实际阶段重新设计 Kargo 接入，并遵守以下原则：

- 是否进入维护、维护候选和维护身份只由 TypeScript 判定一次，Kargo 只读取一个结果，不在多个步骤里
  重复复合表达式；
- 完成状态只有一个记录位置；
- prepare 冻结的状态需要正式修正入口，修正时不能靠人工同时修改多处产物；
- 选择逻辑用固定输入输出的用例测试，Kargo 端的表达式按同一组用例求值。

## 未采用方案

### 保留生成器，按登记的 profile 生成维护步骤

这样可以保留已经调通的维护流水线，下一次迁移只需登记 profile。但生成器写死了这一次迁移的阶段、
应用列表和流量步骤，下一次迁移仍要按实际结构重写；在已完成 profile 的情况下保留它，只会让决策层、
一致性检查和第二种渲染测试继续服务一条不会被选中的路径。需要参考时可以从 Git 历史恢复。

### 为当前 profile 增加修正命令和 Promotion 重建命令

修正命令能解决冻结状态无法修改的问题，但唯一使用场景是一个已完成、即将退役的 profile，其校验规则
也无法复用到下一次迁移。重建 Promotion 已有 Kargo 原生入口：为同一 Freight 新建 Promotion 或使用
`kargo promote`；把修改集群的操作放进只读的 release-status 工具旁边，会扩大它的权限边界。

## 后果

- 生成的 Stage 只描述普通发布；表达式测试只覆盖普通路径和合并前检查，不再模拟维护计划。
- main 上已有计划中的 `completedMaintenance` 字段在下一次 prepare 重写计划时消失，读取方不再依赖它。
- 候选声明新的维护 requirement 时，自动发布在 prepare 失败并停在该 Promotion；这是预期行为，直到
  新迁移的 Kargo 接入完成。
- 维护执行代码已删除；`releases/staging-migrations/` 的完成记录与候选过滤保留，prepare 仍对未完成的
  requirement 失败。
