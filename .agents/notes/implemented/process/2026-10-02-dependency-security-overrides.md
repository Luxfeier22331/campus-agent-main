# Agent Note: 传递依赖安全更新的覆盖范围

Status: implemented

## 背景

Dependabot 已确认 Node 与 Python 锁文件中的若干依赖存在漏洞。Miniflare 固定旧版 undici，
原 markdownlint-cli2 固定旧版 js-yaml 与 markdown-it，仅刷新锁文件无法升级这些依赖。
既有 brace-expansion 与 fast-uri override 的目标版本也已进入新的受影响范围。
安全更新后，用户要求继续更新已盘点的常规依赖，保留 Worker 的 Vitest 4 和 Node 24。

## 决策

沿用 pnpm-workspace.yaml 作为 override 的唯一清单，更新既有安全版本约束。
对 Miniflare 的固定依赖使用限定上游的 override，保持其他消费者的版本选择。
markdownlint-cli2 升级后已直接使用安全的 js-yaml、markdown-it 和 smol-toml，删除相应临时覆盖。
上游不再请求受影响版本后删除对应覆盖，并核对依赖解析、frozen install 与漏洞扫描结果。
依赖范围已允许安全版本的 gRPC、ip-address、js-yaml 和 urllib3 直接更新锁文件，不新增 override。

本次按用户明确范围保留 RAGAS 及其 DiskCache 依赖，也不改变它们的扫描例外配置。

Cloudflare Vite 插件与 Wrangler 配套升级。Worker 测试池仍依赖 Vitest 4，其三个消费者
App API、Campus Web 和 Status Web 保持 Vitest 4；原 Vitest 5 消费者只更新本主版本。
Node 24.21.0 已是核对时的 24 系列最新版本，保留运行时锁定，Node 类型定义更新到 24 系列。

## 未采用方案

全局覆盖 undici 能统一修复版本，但其范围与其他库的可选 peer 范围相交，可能将使用 undici 8
的解析改为 undici 7。当前受影响的固定版本来自 Miniflare，因此只覆盖该上游。
统一到 Vitest 5 可以减少测试框架版本数，但不符合当前 Worker 测试池的 peer 合同，也违反用户约束。
安全更新先采用兼容的传递依赖；用户授权常规更新后，再升级上游并删除已无必要的覆盖。

## 后果

固定旧依赖的开发和校验工具可以继续使用，受影响的传递依赖得到更新。临时覆盖仍需随上游版本
重新评估；锁文件更新和测试只能说明源码依赖状态，GitHub 告警关闭及部署结果由后续流程确认。
