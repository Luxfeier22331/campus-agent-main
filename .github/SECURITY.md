# 安全策略

## 支持范围

本仓库安全报告覆盖公开的 `campus-agent` 源码、公开配置模板、构建脚本和已记录公开接口。

内部部署数据、私有内容包、production credential、operator-only evidence 和来源派生学校
数据不属于公开仓支持范围。不得将其放入公开 Issue 或 PR。

## 报告漏洞

发现疑似漏洞时，优先通过仓库 Security Advisory 私下报告。该入口不可用时，通过私有
渠道联系维护者，并且只提供脱敏技术信息。

以下内容不得创建公开 Issue：

- Secret、token、password 或其他 credential；
- 私有 object-store key、database URL 或内部 hostname；
- raw notice、source-derived document、包含私有数据的 screenshot/log；
- 可以立即用于攻击的 exploit detail。

## 报告内容

- 受影响 package、app 或 workflow；
- 使用 synthetic data 的最小复现；
- 预期和实际行为；
- 影响评估；
- 相关 commit 或 version。

## 维护者响应

维护者会判断问题是否影响受支持的公开源码，并在需要时协调修复后再公开披露。
