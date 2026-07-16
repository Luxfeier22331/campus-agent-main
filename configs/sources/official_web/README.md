# Official Web 来源配置

本目录保存 `official_web` source channel 的仓库配置。

- `site.json`：site identity 与共享 runtime baseline；
- `hosts.json`：host 准入、crawl/robots policy、分组与 rollout order；
- `seeds.json`：仓库维护的 seed URL 与理由；
- `crawl-policy.json`：共享 URL、content 与 frontier policy；
- `scheduler-policy.json`：lane identity、cadence、host scope 与每次 run 的 budget；
- `credentials.schema.json`：runtime secret 结构，不保存 secret；
- `projection-declarations.json`：target 已明确准入后使用的 page-family action hint；
- `target-source-map.json`：target-first 准入映射；
- `consumer-denominator.json`：下游消费 retained source truth 的 denominator；
- `target-inventory.json`：已准入 target 的运维清单。

host policy group 只在来源层分区；它不会创建新的 source channel、retrieval collection 或
query-serving surface。

scheduler lane 以明确 `lane_id` 作为稳定 run key。不同 `lane_id` 可以共享 `run_intent`；
host 范围与 rollout 顺序由配置文件决定，不在 README 复制具体值。

这些文件是 source-channel 事实，不是 collection serving config；它们不能证明 document、
chunk、index、release 或 serving alias 已发布。

采集、产物、时效状态和在线边界见 `docs/domains/official-web.md`。
