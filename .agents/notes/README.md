# 决策笔记（Agent Notes）

本目录保存动机、取舍、被否方案和后果；代码、schema 和测试承载当前实现。
文档所有权见 [文档治理](./implemented/process/2026-07-16-documentation.md)，
生命周期理由见 [决策笔记树](./implemented/process/2026-09-16-agent-notes-tree.md)，
写作流程见 [Skill](../skills/write-notes-like-deepseek/SKILL.md)。

## 布局与命名

笔记路径为 `{lifecycle}/{class}/yyyy-mm-dd-topic.md`，日期为话题首次提出日。

- `proposed/`：尚未实施的提案。
- `implemented/`：已落地的决策；理由、备选、边界、禁止行为或重新引入条件仍能指导工作时保留。
- `rejected/`：被否决的提案；仍能阻止有现实吸引力的错误方案时保留，否则删除并修复引用。
- `archived/`：未来指导价值低、仍需保留历史记录的 implemented 笔记；不作为当前依据。
  原文和 `Status: implemented` 保留，归档由目录及唯一的 `Archived:` 行表达。
- `templates/`：写作模板与归档示例，不参与正式笔记的树和格式检查。

全部笔记使用话题命名，文件名和标题不包含 ADR 编号；历史编号只允许出现在正文的历史叙述中。
现存笔记之间用相对 Markdown 链接并以话题名作为显示文字，不用裸编号；不建 `INDEX.md`，用目录和搜索定位。
已删除 ADR 的编号只作历史标识；仍有价值的独有内容必须由现行笔记承接，不能仅指向 Git 历史。
不恢复旧目录或建立跳转页；缺失理由从原文恢复，不把退役自动解释为原决定错误。

## 分类

| class | 覆盖 |
| --- | --- |
| `feature` | 用户或模型可见的新能力、不显然的行为选择 |
| `bug-fix` | 缺陷修复或 postmortem 暴露的缺口 |
| `simplification` | 移除代码、行为或表面，保留所需能力 |
| `architecture` | 交付源码的结构、模块边界、身份、生命周期、合同与所有权 |
| `process` | 周边工具链与工作流：门禁、发布、仓库边界 |
| `testing` | 测试与评测基础设施及策略 |

## 何时写与清理

非平凡改动同批新增或更新至少一篇笔记：行为、架构、跨文件合同、流程工具链、测试策略、
落盘／网络／配置格式，或维护者需要重访的决定。纯排版、错别字、无歧义重命名、
依赖补丁和单模块内自明的修复豁免。

- 新建前按模块和关键词搜索，识别同一决定及其备选；路径、名称、默认值等事实就地更新。
  已实施决定的理由或结论反转须新建并关联旧篇，不能把旧篇改写成相反结论。
- 部分取代：两篇互链，明确被取代条目及仍有效的范围；独立指导价值仍在就保持活动。
- 完全合并后删除：当前 owner 须吸收旧篇独有的理由、备选、代价、必要验证及已知覆盖缺口，
  并修复全部入站链接；Git 历史不能成为这些内容唯一的保存位置。
- 功能新增笔记并入退役笔记前，确认生产代码、配置、schema、持久数据兼容行为、当前文档和
  支持该行为的测试已不再提供该能力；仍有责任则按部分取代处理。
- 归档按未来指导价值判断，不按错误、被取代、年代、篇幅或引用量判断；不批量归档迁移笔记。
  proposed 尚可推进则保留，放弃则转 rejected 并说明原因，不能通过归档跳过结论。

真实故障的经过和漏检原因进入[事故复盘](../../docs/postmortem/README.md)，长期决策仍由笔记维护。

## 文件格式

使用 [implemented](./templates/implemented.md)、[proposed](./templates/proposed.md)、
[rejected](./templates/rejected.md) 模板；[archived](./templates/archived.md) 仅展示归档结果。

- 第一行是 `# Agent Note: 标题`，第二行留空，第三行是 `Status: <lifecycle>`。
  rejected 状态行须追加 `— 原因`；archived 保留原状态，免除当前章节和出站链接检查。
- 所有活动笔记使用同一结构：implemented 要求 `背景`、`决策`、`未采用方案`、`后果`；
  proposed 要求 `背景`、`提案`、`未采用方案`、`验收标准`、`风险`；rejected 要求 `背景`、`提案`、`未采用方案`。
  不按日期豁免迁移笔记；无法恢复的历史权衡说明原记录缺口，不编造方案或验证结果。
  必备章节填写实际内容，语义完整性由评审判断。
- 未采用方案只写真实权衡，先说明其最强论据再解释取舍。
- proposed 转 implemented 时，将提案改写为实际决策，验收与风险并入后果或已落实的验证及覆盖缺口；
  不保留 `提案`、`验收标准`、`迁移计划`、`实施计划` 标题。转 rejected 保留提案及备选，状态行追加拒绝理由。

## 归档操作

在仓库根目录执行；下面的路径为示例，须替换成真实笔记：

```bash
pnpm exec tsx scripts/docs/archive-agent-note.ts \
  .agents/notes/implemented/architecture/2026-08-22-example.md \
  --superseded-by .agents/notes/implemented/architecture/2026-09-16-example.md
```

只接受 implemented 笔记，保留 class 和文件名，不覆盖已有归档。
`--superseded-by` 可选；提供时必须指向另一篇现存 implemented 笔记，参数路径相对仓库根，
命令写入相对归档文件的 Markdown 链接。没有替代笔记时只记录日期。
命令保留原文与原状态，在末尾追加一行 `Archived:`；不自动改其他文档链接。
同批把当前 owner 文档指向现行决策，必要的历史引用指向归档位置。

归档后不再编辑正文。检查器以 Git HEAD 中已提交的归档为冻结基准，拒绝修改和删除；
首次归档只检查标记、原状态和替代目标，提交后才有冻结基准。不维护额外 hash 清单；
不能检出已经进入 HEAD 的历史改写，不等同于 DSH 的独立封存清单与历史基准保证。
归档内部的历史出站链接失效不阻塞日常检查，当前文档指向归档的入站链接仍检查。

## 校验与观察

`pnpm docs:check` 包含笔记树、格式、归档标记与冻结检查、入口预算、当前链接和语言检查。
归档由专用检查器维护，普通笔记格式、Markdownlint、出站链接和语言检查跳过归档正文；
模板不作为正式笔记。默认 `rg` 搜索排除归档；追查历史时显式传入归档目录。

`pnpm docs:notes:anchors` 扫描仓内 Markdown 的链接和反引号路径，统计不同来源文件。
implemented 没有 owner 文档引用时输出 `informational`，高引用量也只是观察项；
报告不进入默认检查，不据此自动归档或补链接。根／docs 分区 README、Skill 和其他笔记的引用
计入总入站数，但不当作 owner 文档引用；模块 README 计为 owner。board 和新增 CI 工作流暂不纳入此治理。
