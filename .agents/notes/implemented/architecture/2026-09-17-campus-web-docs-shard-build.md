# Agent Note: Campus Web 文档构建分片

Status: implemented

## 背景

`staging-candidate-publish` 从 `1e0d88590`（2026-09-15）起连续失败，
失败点固定在 `Build Campus Web staging candidate`：

```text
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

`build-campus-web.ts` 先后运行两次 `vite build`：`app` 目标构建学生端 SPA，
`docs` 目标构建文档站。日志显示 app 目标正常完成，OOM 发生在随后的 docs 目标。

`docs` 目标由 `findHtmlInputs` 把每个文档页面注册为独立的 Rollup 入口，
当前为 373 页、HTML 合计约 89 MB，单次构建需要同时持有全部页面的模块图与产物。
构建内存因此随文档总量增长，而不受单页大小约束。

[钉住 rolldown 1.2.3](../../archived/process/2026-09-16-rolldown-memory-pin.md)
先把 rolldown 固定在回归前版本换取通过，并已指出分片是上限再次被突破时的后手。
该笔记落地次日构建再次 OOM：固定版本只降低系数，没有改变内存随页数增长的趋势。

在受限构建环境中用真实文档内容复现并对照测量：

| 配置 | rolldown 1.2.3（固定） | rolldown 1.2.9（不固定） |
| --- | --- | --- |
| docs 单次构建（373 页） | OOM | OOM |
| docs 分 2 片 | OOM | 未测 |
| docs 分 3 片 | 通过 | 通过 |
| docs 分 6 片 | 通过 | 通过 |

单次构建在固定与不固定两侧都失败，分片在两侧都通过：决定构建能否完成的是
单次构建承载的入口数量，而不是 rolldown 版本。

## 决策

`docs` 目标按分片多次构建，每片独立进程，构建后立即合并进 `dist/client`。

- `config/docs-shard.ts` 维护分片解析与输入划分。文档首页与 404 页两个入口
  进入每个分片，其余页面按稳定顺序取模分配，保证覆盖且不重复。
- `build-campus-web.ts` 默认 `DEFAULT_DOCS_SHARD_TOTAL = 6`，逐片运行
  `vite build` 并在每片后调用既有 `mergeDocsClientBuild()`。
- 分片各自写出 `docs-bundle-graph.json`，`writeMergedDocsBundleGraph` 合并后
  再执行 `checkBundleBudgets()`，使预算检查覆盖全量文档产物；同名 chunk 内容
  不一致时失败，不静默取其一。
- 分片数由 `CAMPUS_WEB_DOCS_SHARD_TOTAL` 覆盖，`CAMPUS_WEB_DOCS_SHARD_INDEX`
  供单片调试；两者缺省时不分片，保持既有单次构建行为。
- 同批删除 `pnpm-workspace.yaml` 的 `rolldown: 1.2.3` override，解析回 1.2.9，
  与 vite 8.3.0 声明的 `~1.2.6` 范围一致，不再强制 vite 使用其范围外的版本。

峰值内存随分片大小而非文档总量增长，实测阈值位于 125～187 输入之间，
选择 6 片（每片约 63 页）保留增长余量。

## 未采用方案

**继续固定 rolldown，或再固定 Vite 到 8.2.1。** 在 override 生效的前提下测量，
失败边界还能进一步落到 Vite `8.2.1 → 8.3.0`，固定版本确实降低峰值。但真实文档
下单次构建在固定版本时同样 OOM，说明固定只推迟失败；同时 override 把 rolldown
压到 vite 声明范围之外，长期阻塞两者升级。分片在不固定的 1.2.9 上通过，
因此删除 override 而不是叠加更多固定。

**提高 `--max-old-space-size`。** 该选项只约束 V8 老生代。构建结束时
`heapUsed=764MB / heapTotal=906MB / rss=1491MB`，约 585 MB 位于
`@rolldown/binding-linux-x64-gnu` 的原生分配，不受该选项管辖；实测提高取值
反而抬高 RSS，把 V8 可处理的错误变成进程被杀。仓库因此不设置 `NODE_OPTIONS`：
V8 会依据运行环境自行推导堆上限，写死任何数值都会与实际约束漂移。

**放宽构建内存限制。** 构建预算由运行环境所有者维护，不在本仓库内调整；
且该方案不改变内存随文档增长的趋势。

## 后果

- docs 构建从 1 次进程变为 6 次，额外约 1.9 s/片 启动开销，相对约 40 s 的 docs
  构建可接受；`pnpm --dir apps/campus-web build` 实测 8 次 vite 构建、退出码 0。
- 文档页数增长不再线性推高单次峰值；超出余量时调整 `DEFAULT_DOCS_SHARD_TOTAL`
  即可，无需改动构建结构。
- 合并后的 bundle graph 是预算检查的唯一输入；分片间共享 chunk 必须一致，
  否则构建失败并指出冲突 chunk。
- rolldown 与 vite 恢复正常升级路径；后续 bump 以受限环境下分片 docs 构建通过
  为验收标准，不再依赖 override。
- 验证：删除 override 并清装解析到 rolldown 1.2.9 后，真实文档全量构建产出
  373 页、`404.html` 与 `index.html` 齐备、HTML 资源引用无缺失、bundle 完整性
  检查通过；受限构建环境下 6 片与 3 片均通过，同配置单片仍 OOM。
