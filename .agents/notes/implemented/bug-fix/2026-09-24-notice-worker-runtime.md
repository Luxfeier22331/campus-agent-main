# Agent Note: 通知 Worker 的运行时依赖与启动验证

Status: implemented

## 背景

TypeScript 检查与 esbuild 构建没有覆盖 Node 加载阶段，构建产物的第三方依赖和 CommonJS
运行时边界因此可能在启动时才暴露；Go 检查也依赖其 Nix 环境提供 C 编译器。

## 决策

通知 Worker 沿用采集 Job 对第三方库的 external 边界，直接声明构建产物需要解析的
生产依赖。工作区业务代码仍然打包，第三方库通过原生 Node 模块加载保留包内资源和
CommonJS 语义。验证包含构建产物连接本地 Temporal、进入 RUNNING 并正常停止。

`ci-go` 由现有 Nix 环境提供 `pkgs.stdenv.cc`，满足启用 cgo 的标准库编译需求，
不依赖 runner 主机偶然安装的编译器。

## 未采用方案

只补 `pg` 可以修复第一条启动错误，但真实启动已证实仍有后续错误，因此补齐同一
入口的依赖边界。为打包文件注入 `require` 能处理内置模块调用，但不能保留第三方
包的相对资源布局，采用采集 Job 已有的 external 配置。

关闭 cgo 可以免装编译器，但会改变已有 Go 检查的编译路径，本次补齐其工具环境。

## 后果

Worker 维护者须同时维护 external 列表和直接生产依赖；新增第三方依赖时以真实启动
结果确认可用性。未新增运行时安装、集群补丁或重试机制。

构建产物启动和 Go 编译的验证由对应 package/CI 检查维护；镜像发布与环境健康由既有 Source
与 GitOps 流程验收。
