# 通知分类评测数据

数据分类：`internal-only-not-for-public-repo`，仓库公开前移除，见 `docs/policies/public-source-data.md`。

- `titles.tsv`：内部通知 ID、门户栏目 ID 与名称、标题，是 `classify:eval` 的输入；保存判定标准答案时的标题，
  门户之后改标题不影响评测。
- `labels.tsv`：标准答案，`source` 为 `rule_lane` 或 `dual_model`，`judge` 是模型标签落定时的判定文本版本；
  不收人工特判，判不对的改规则或判定文本。
- `experiments/`：建立与修订标准答案的试标数据，每次一个目录：模型调用记录、逐版本的改动与结果。

运行与结果解读见 `docs/runbooks/ingestion/ingestion.md` 的「分类评测」。改标准答案时同批在决策笔记记录原因。
