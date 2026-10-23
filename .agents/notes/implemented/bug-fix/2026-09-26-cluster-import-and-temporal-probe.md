# Agent Note: 集群检索导入空更新集与 Temporal 探针确定性

Status: implemented

## 背景

主 checkout 执行 `dev:init -- --data cluster` 时连续遇到两个阻塞性失败。
其一：`importRetrievalData` 在 `notices.categories` 的第一条 upsert 上稳定返回
`syntax error at end of input`（node-postgres 报文，事务回滚）。`upsertRetrievalRows` 对非键列拼接
`do update set ${updates}`，而 `notices.categories` 的唯一列就是键 `category`，updates 为空，
SQL 以 `do update set` 截断。seed 路径的 upsert 列集不同，从未触发该分支，只有 cluster 导入命中。
其二：`probeLocalTemporalNamespace` 通过 `docker compose exec` 内的 Temporal CLI 以主机名
`temporal:7233` 拨号。Docker Desktop 的内嵌 DNS 代理可能让容器名解析超过 CLI 的 RPC deadline，
单次探针因此以 `unknown` 失败，`ensureLocalTemporalNamespace` 抛错中断 init/doctor。
Compose healthcheck 同样使用主机名但配有 retries:60，因此从未暴露该差异。

## 决策

`upsertRetrievalRows` 在非键列为空时改用 `on conflict ... do nothing`：单列键表没有可更新列，
空集语义即无操作，行为与显式 upsert 等价且幂等。

Temporal 探针改为先用 `docker compose ps -q temporal` 与 `docker inspect` 解析容器当前 IP，
再以 IP 地址拨号，绕过内嵌 DNS；解析失败回退主机名。保留至多 5 次重试（间隔 1s）覆盖容器
启动瞬态。`ensureLocalTemporalNamespace` 的 namespace create 同样使用解析后的地址。

## 未采用方案

- 仅增加探针重试：实测间隔重试 5/5 失败（DNS 首查停顿在间隔后再次出现），概率性缓解不可靠。
- 在 Compose 为 data-plane 网络配置静态 IP 或改 `TEMPORAL_BIND_ON_IP` 后拨 localhost：需要
  重建基础设施容器并改 compose 合同，超出探针可靠性问题的 owner。
- 修改 Compose healthcheck 地址：healthcheck 已有 60 次重试，未见失败，不因探针问题扩大范围。

## 后果

`dev:init -- --data cluster` 与 `dev:doctor` 复用同一显式容器地址解析路径；cluster 导入继续校验
`campus_docs_serving.current_index` 与集群引用一致。容器 IP 由 inspect 动态解析，重建容器后仍正确；
仓库不依赖固定 IP。
