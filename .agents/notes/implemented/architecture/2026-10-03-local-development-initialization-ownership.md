# Agent Note: 本地开发初始化与数据域 owner

Status: implemented

## 背景

本地初始化曾把运行服务的环境投影、provider 凭据导入、模型配置 seed、定时任务设置和多类产品数据合并为一个 `dev:init` 流程。这样 Ops 页面即使只需要空表和服务，也会被问题运行时和业务 seed 阻塞；全局数据存在性与替换则把彼此独立的领域绑在一起。

旧有 [协作开发产品数据初始化](../process/2026-09-17-product-data-initialization.md) 中关于 profile 隔离、统一 schema owner、独立通知 upsert、检索目录原子激活、样例制品及按需诊断的决策仍有效；该笔记中把完整产品数据纳入 `dev:init`、把 Ops 与 core 设为相同数据范围，以及 `cluster-content` 的结论由本笔记部分取代。

## 决策

`dev:init --target <target>` 只准备 target 所需环境、基础设施、统一 schema 与必要记录，不导入外部凭据、不 seed 模型、不初始化业务数据或 schedule。`dev:local` 提供显式的环境、基础设施、schema、credentials、models、schedule、data 操作；doctor 将 config、infra、schema、data、startup、runtime 分开诊断。target 由真实消费者组合，不递归启动其运行时依赖；provider-backed 的 Hindsight 单独显式启动。

业务数据按通知、群组、食堂和交通分域初始化；Docs 有独立对象闭包，retrieval 保持 Docs、通知和当前索引的一致 owner 闭包。seed 和 sync 只触及所选领域，已有领域保留并跳过，替换必须对明确领域传 `--replace`。通知 lookup 字典不代表通知业务数据已存在；通知替换遇到班车引用时需要把交通域一并纳入。通知普通同步继续使用独立的日期选择、来源对象和 upsert 路径并保留本地额外记录。模型 seed 先检查指定名称，只对缺失项读取对应 provider 输入，不覆盖已保存配置。

不保留旧 `dev:init --data/--replace` 执行兼容；旧调用迁移到 `dev:local data seed|sync --domain ...`。现有 worktree profile、资源身份和存储卷保持不变，不引入第二套 schema owner、全局数据事务或额外持久化编排状态。

## 未采用方案

继续让 `dev:init` 完成一站式全产品初始化，命令更短，也能保证新环境数据齐全；但它迫使只需要服务和 schema 的消费者承担模型、provider 与互不相关的数据依赖。改为按实际工作显式调用后，命令略多，owner 和失败位置更清楚，也能按需要准备最小本地环境。

按 target 自动导入所有模型配置可减少首次点击，但会要求无关 provider 凭据，并可能将开发者现存配置与初始化生命周期混合。模型 owner 保留可重复 seed 能力，但只对显式请求且尚缺失的配置写入。

## 后果

初始化、数据同步、模型配置和服务健康可以分别验证。文档和脚本调用需使用新 `dev:local` 子命令；不存在通过旧 `dev:init` 参数触发隐式数据工作的兼容路径。新增数据域时由该域 owner 声明自己的表和资源闭包，不扩展其他域的默认 seed、sync 或 doctor。
