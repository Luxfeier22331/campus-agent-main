# Agent Note: Artifact 身份的规范排序

Status: implemented

## 背景

artifact 身份路径（摘要、manifest、发布对象排序以及钉住其字节的测试）曾用
`localeCompare` 和 `toLocaleLowerCase("und")` 决定对象键排序和字节编码。ICU 排序依赖
运行 locale：同一份输入在不同环境（`LC_ALL`=de_DE / zh_CN / C）下产生不同的 manifest
字节和 sha256 身份，破坏可复现性，也让跨环境重新验证已发布 artifact 的 canonical
JSON 校验失败。已观察到的事实：`embeddings` 与 `embeddingSpace` 的键序在 ICU 排序与
UTF-16 码元序下不同，导致 `scripts/dev/fixtures/product-data` 的已提交 manifest 不再
通过 canonical JSON 校验。

## 决策

- 新增 `campus-contracts/canonical-order` 导出
  `compareCanonicalStrings(left, right)`：纯 UTF-16 码元序比较
  （`left < right ? -1 : left > right ? 1 : 0`），与 `Array.prototype.sort()` 默认序一致，
  不依赖 locale。artifact 身份路径一律使用它。
- `toLocaleLowerCase("und")` 改为 `toLowerCase()`（sparse-vector 两个 owner）。
- 显示排序保留显式 locale（如 docs reader 标题的
  `title.localeCompare(right.title, "zh-CN")`），不受本决策约束。
- 新增门禁 `scripts/ci/check-canonical-order.mts`（root script
  `canonical-order:check`）：在 scoped 路径内禁止隐式 locale 的
  `localeCompare`（少于 2 参）与无参 `toLocaleLowerCase()/toLocaleUpperCase()`；
  注释、字符串字面量与非源码文件不检查，模板插值体内的真实调用会检查。门禁经
  `REPOSITORY_CHECK_REGISTRY` 的 `canonical-order` 条目接入 evidence.mts 与 pr.yml，
  触发路径与 `CANONICAL_ORDER_PATHS` 保持同一列表。
- 因依赖闭包扩大（campus-rag-index-publisher、notice-index-publisher、dining 新增
  `campus-contracts` 生产依赖），contracts 源变更现在也会选择这两个 publisher 镜像与
  notice-artifacts-worker；`scripts/release/image-targets.test.ts` 已按新闭包钉住。
- 已提交的 dev fixture manifest 按码元序重排并换新身份；chunk-run 与其 ndjson
  字节本就符合码元序，未变。

## 未采用方案

- **按 locale 显式化（统一传 `"und"`）**：仍依赖 ICU 数据版本，排序会随 Node/ICU 升级
  漂移，身份依旧不可复现。
- **用 `Intl.Collator` 固定 locale**：同样绑定 ICU 版本，且无法与默认 `sort()` 序一致。
- **把显示排序一并改掉**：显示顺序是产品行为（zh-CN 拼音序对用户正确），不属于
  artifact 身份；改动会改变用户可见行为且无身份收益。
- **门禁扫描全仓**：显示排序、运行时 UI 排序、tldraw、app-api 归一化等合法使用
  locale 的代码量大且属 display/搜索域，全部禁掉需要逐处豁免，超出本决策的信任边界。

## 后果

artifact 身份不再随运行 locale 或 ICU 数据变化；跨环境重建同一输入得到相同 sha256。
消费 canonical manifest 的读取路径（`isCanonicalManifest`、`readManifest`）用同一
比较器生成期望字节，校验与写入一致。已发布的历史 artifact 若曾由非 C locale 生成，
其 manifest 在新代码下的 canonical 校验会失败——这是既有数据与新的 locale 无关合同的
冲突，由各 artifact 的重新发布 owner 处理，不在本决策内修复。门禁只覆盖
`CANONICAL_ORDER_PATHS` 列出的身份路径；新增 artifact owner 时须同步把路径加入该列表
与 registry（`scripts/ci/check-canonical-order.test.ts` 断言两者一致）。
