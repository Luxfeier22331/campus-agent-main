---
doc_type: reference
owner_boundary: docs/environment
status: active
---

# 环境文件

## 边界

本文定义本地和部署环境配置的分层规则。供应商与 Secret 所有权见
[Provider 与 Secret](./providers.md)，健康和就绪语义见 [就绪状态](./readiness.md)。精确变量由
所属应用模板、配置解析器和部署清单维护。

## 配置分层

### 仓库根环境

根 `.env` 只为本地共享基础设施提供连接句柄。允许的键以根 [`.env.example`](../../.env.example)
和实际消费者为准，不在本文复制变量清单。在线模型配置、来源凭据和任务输入不进入根环境。

### 应用本地环境

应用只读取自身目录声明的环境文件：

- Worker 字符串变量使用所属应用的 `.dev.vars`；
- Wrangler、数据库工具或本地进程变量使用所属应用的 `.env`；
- 来源适配器只读取自身目录的本地环境文件。

一个应用不得读取其他应用或适配器的环境文件，也不得从根 `.env` 隐式扩散数据库或供应商凭据。

### 命令环境

需要显式运行配置的仓库命令使用 `env/commands/*.env.example`。命令模板只保存变量名和安全示例，
不保存真实值，也不成为常驻应用的配置来源。

任务标识、来源引用、查询目标和其他单次输入通过类型化请求或 CLI 参数传递，不扩张为环境合同。

### 部署环境

Kubernetes、Cloudflare 和外部平台配置由环境仓及所属密钥存储交付。ConfigMap、Secret、平台变量
和在线 Provider Config 各自服务明确消费者，不能互相充当同步源。

## 读取与覆盖

仓库没有跨所有应用的统一环境覆盖顺序。每个应用的解析器、Wrangler 配置或命令入口拥有自己的
读取顺序；新增覆盖规则时应在可执行解析器和所属 README 中说明并测试。

稳定业务事实进入配置、注册表、manifest 或数据库投影。只有会随环境变化的资源地址、凭据和
运行参数才进入环境文件。

## Worktree

Git 不会把被忽略的 `.env` 或 `.dev.vars` 自动带入新 worktree。每个 worktree 使用自身的本地
环境文件或开发者密钥管理器，不在 worktree 之间复制凭据，也不通过仓库脚本分发被忽略文件。

## 相关文档

- [Provider 与 Secret](./providers.md)
- [就绪状态](./readiness.md)
- [供应商密钥操作](../runbooks/provider-secrets.md)
- [Secret 投递决策](../decisions/adr-0066-secret-delivery.md)
