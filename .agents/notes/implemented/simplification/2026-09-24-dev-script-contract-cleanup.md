# Agent Note: 本地开发脚本合同清理

Status: implemented

## 背景

独立 worktree 数据平面落地后，`scripts/dev` 中仍保留了共享基础设施时代的旧资源修复 API、固定容器名探测和多个无消费者导出。初始化参数还暴露了没有实际行为的 `--repair`，产品数据初始化会在当前 profile 缺少 Docs source 时回退读取固定共享 bucket，破坏了 profile 数据 owner 的边界。

## 决策

保留所有仍被 CLI、生命周期、迁移流程、应用配置生成或测试实际消费的脚本文件；删除仓库内确认无消费者的导出和测试辅助，包括旧数据库删除函数、环境路径和密码别名、旧实例资源修复分类、旧 Qdrant 容器探测 overload、未使用的命令执行辅助以及 seed 表兼容别名。Qdrant 测试改为验证当前 profile 端口和 profile 凭据合同。

本地初始化不再接受没有实现语义的 `--repair` 参数。产品数据已有部分状态时只诊断当前 profile 的数据；不再读取固定共享 bucket 作为隐式回退。当时保留的 V1/V2 解析与升级兼容分支现已由[独立数据平面的硬切决策](../architecture/2026-09-24-independent-worktree-data-plane.md)取代；只接受 V3，旧文件和资源人工清理后重新初始化。

V3 硬切复核后，product-snapshot 投影与 pending 同步状态不再有生产读写方：托管环境不再把 `OBJECT_STORE_DOCS_SOURCE_KEY` 指向快照对象，消费方始终使用固定的 `campus-docs/source.json` 键；`product-data-state` 收缩为销毁实例时清理旧 `var/dev` 残留文件。

## 未采用方案

- **在脚本清理时同时删除全部 V1/V2 兼容解析**：当时仍有一次性迁移消费者，因此留待独立硬切决策处理；后续已完成退役。
- **保留无消费者导出以便未来使用**：没有 CLI、生产调用或文档入口，继续保留只会扩大脚本表面并掩盖 owner；需要新能力时重新按实际消费者加入。
- **保留共享 bucket fallback**：它会让独立 worktree 重新依赖共享数据 owner，并使本地状态来源不可由 profile 判断。

## 后果

`scripts/dev` 的公开表面更接近当前 CLI 和真实调用链；旧 profile 不再被读取或升级。缺失或不完整的当前 profile Docs source 会直接进入诊断和显式初始化路径，开发者需要使用明确的 `--replace` 修复当前数据，旧 profile 则清理后重新初始化，不会静默借用共享数据。验证覆盖了 dev 生命周期、产品数据、Qdrant profile 连接和端口探测。
