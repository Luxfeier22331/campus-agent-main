---
doc_type: architecture
owner_boundary: identity-federation
status: active
---

# MUC Wiki 联邦登录

## 文档边界

本文定义 Campus Agent 与 MUC Wiki 的职责、信任关系和账号关联流程。协议 endpoint、client、
scope、claim 和 PKCE 要求只由 `../../contracts/app-api/federation.md` 维护；MediaWiki 安装和
故障操作见 `../../runbooks/federation.md`。

## 关系

```text
用户浏览器
-> MUC Wiki 登录入口
-> App API 联邦授权
-> Campus Agent 账号认证
-> 授权结果
-> MUC Wiki 本地账号关联与权限
```

App API 是身份提供方和联邦策略所有者。MediaWiki 是依赖方，继续拥有 Wiki 本地账号、group、
页面权限和登录 session。Campus Web 只代理明确允许的浏览器路由，不成为身份提供方或通用 App
API 代理。

## 组件职责

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| App API | 用户认证、联邦授权、client policy、签名和允许的身份声明 | Wiki group、页面权限或本地账号生命周期 |
| Campus Web | Campus Agent 登录界面和获准联邦路由传输 | client 注册、claim 决策或 Wiki session |
| MediaWiki | 登录入口、本地账号关联、group 和页面授权 | Campus Agent 密码、session 或个人记忆 |
| 环境配置 | client Secret、公开地址和部署选择 | 改写协议或身份声明语义 |

协议实现使用 Better Auth 的受支持扩展和标准联邦协议，不在仓库维护第二套授权服务器、token
格式或签名实现。

## 信任与数据流

- 浏览器必须先建立有效 Campus Agent 账号会话，联邦授权不能绕过产品登录；
- App API 只向已登记 client 返回其 scope 和 claim policy 允许的身份字段；
- client Secret、签名材料和服务凭据不经过浏览器或 Campus Web 页面；
- profile memory、聊天历史、原始授权数据和运维身份不进入 Wiki claim；
- 联邦 token 只用于协议定义的身份交换，不能成为 App API 通用访问令牌；
- 登出各自清理所属 session，不能假设一个系统的本地账号映射会随另一个系统 session 删除。

精确 issuer、redirect URI、token 生命周期、签名算法和 claim shape 由联邦合同与可执行注册表
维护，架构文档不复制这些字段。

## 账号关联

首次成功登录后，MediaWiki 根据稳定联邦身份建立或查找本地账号映射。后续 Wiki 权限始终由
MediaWiki 判断；App API 不导入 Wiki 密码、session、group 或页面权限，也不把 Campus Agent
产品角色直接解释为 Wiki 权限。

关联失败必须保留明确错误，不自动创建第二种身份路径或回退到共享密码。

## 禁止形态

- 导入或同步 MediaWiki 密码、session 和权限表；
- 向 Wiki client 暴露聊天、记忆或运维凭据；
- 允许浏览器自行注册 client、选择 claim 或跳过同意策略；
- 在 Campus Web、MediaWiki 插件或环境配置中复制联邦协议实现；
- 把联邦登录扩张为任意第三方动态接入能力。

## 相关文档

- `../../contracts/app-api/federation.md`
- `identity-authz.md`
- `../../runbooks/federation.md`
- `../../decisions/adr-0050-campus-web.md`
