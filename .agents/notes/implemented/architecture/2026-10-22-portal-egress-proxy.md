# Agent Note: 门户与 OCR 出口代理

Status: implemented

## 背景

集群在境外，门户只对校园网和校园隧道开放。通知采集原先只能在本机经代理运行。集群 Worker 要直接回填和同步，
就需要一条从集群进校园网的出口。

这条出口的吞吐决定回填时长和单次采集能否在 60 分钟活动时限内完成。跨境往返已经计入，建连延迟不是瓶颈。
可用的出口机是 sq-nixos。它的家宽上行（eno1）比校园隧道（wg0）的上行高两个数量级，门户请求则必须从 wg0 出。

## 决策

- 业务侧只消费既有的 `INTERNAL_PORTAL_PROXY_SERVER`，采集代码不感知出口拓扑。GitOps 只给
  `notice-pipeline-worker` 注入集群内地址 `campus-egress.campus-egress:3128`。
- 集群内自管 Headscale，只服务这一条出口。ACL 按 tag 只允许 `tag:cluster-egress` 访问 `tag:campus-egress:3128`。
- 集群侧连接器是普通 tailscaled 加 socat 旁车，节点状态放在 PVC，宣告固定公网端点。宿主机 nc-arm-6c 对
  Pod 出站 UDP 保持源端口，保证两端走直连而不是 DERP 中继。
- sq-nixos 侧在独立网络命名空间里运行内核 TUN 的 tailscaled。它的 WireGuard 流量经 eno1 回传，命名空间只把
  tailnet 的 3128 转给宿主机 HTTP 代理。代理只放行 `*.muc.edu.cn` 的 80/443，用校园 DNS 解析，从 wg0 出站；
  其他目标一律拒绝。
- 同一出口服务 `document-ocr` 访问 Paddle（2026-10-23）。集群直连百度上行只有 5–9 KB/s，2–4 MB 的图片提交在
  300 秒内传不完；sq-nixos 家宽上行约 5 MB/s。代理只为 `paddleocr.aistudio-app.com` 和结果主机
  `pplines-online.bj.bcebos.com` 的 443 开一条经 eno1、用家宽 DNS 的路由，不放行 `bcebos.com` 后缀。
  OCR 不改代码，GitOps 注入 `HTTPS_PROXY` 与 `NODE_USE_ENV_PROXY=1`，Node 24 的 `fetch` 据此走代理，
  集群内的 HTTP 依赖不受影响。
- 一次性 auth key 只在节点没有状态时注入。tailscaled 在节点进入 Running 前，每次启动都会重发配置里的 key，
  已用过的 key 会被控制面拒绝。

## 未采用方案

- **集群直连门户或经公网转发**：门户不对外开放，这条路不存在。
- **sing-box 内嵌 tailscale endpoint**：它的 gVisor 用户态 TCP 单连接吞吐只有内核方案的几分之一。
  `system_interface` 模式又会与宿主机个人 tailscaled 争用路由表 52、ip rule 和 `ts-*` 链。
- **官方镜像的 egress 模式（`TS_TAILNET_TARGET_IP`）**：containerboot 的 `! -i tailscale0` DNAT 会劫持
  WireGuard 的 UDP 回包，直连建不起来。
- **Tailscale Kubernetes operator**：依赖 SaaS OAuth API，Headscale 没有提供。
- **tailnet 流量走 wg0**：wg0 上行太低，吞吐不足以支撑附件回传。

## 后果

- 出口跨三个所有者：本仓只拥有代理变量的消费；连接器、Headscale 和 NetworkPolicy 归 GitOps 仓；
  sq-nixos 命名空间、代理和路由规则归 nixos-config。宿主机源端口规则见 nc-arm-6c 的 `/srv/infra/inventory.md`。
- 直连条件（固定端点、源端口保持、sq-nixos eno1 UDP DNAT）缺一项就退回 DERP 中继。中继下吞吐明显下降，
  但链路仍然可用，所以要按 GitOps runbook 用 `tailscale ping` 判断，不能只看请求是否成功。
- 采集 Worker 串行下载附件，实际吞吐受单连接上限约束。若回填或同步再次逼近活动时限，应把附件下载改为
  有限并发，而不是加宽代理放行范围或换出口。
- 门户附件回传与 OCR 上传共用 sq-nixos eno1 上行。互相挤占时先降 `document-ocr` 的 `--concurrency`；Paddle 换用
  新的结果主机时，在 nixos-config 补放行主机，不放宽到后缀。
- `ops-web-internal-portal-check` 尚未接入代理；需要它在集群内真实访问门户时，复用同一地址并补对应
  NetworkPolicy。

## 相关文档

- [内部门户认证](../../../../docs/runbooks/access/portal-auth.md#集群门户出口)
- [采集运行](../../../../docs/runbooks/ingestion/ingestion.md)
- [内部门户通知来源合同](./2026-08-14-internal-portal-notice-source.md)
