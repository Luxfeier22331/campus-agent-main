# 09-02 MUC High-Frequency Alias Inventory

## Scope

本 inventory 只覆盖当前 repo 已接受、且已经被产品讨论反复提到的中央民族大学 curriculum 高信号 alias。

它不是“全量术语表”，而是当前 phase 的高频上线真相。

## Alias Classes

| alias | canonical target | entity type | default action | serving surface | qrels policy | notes |
| --- | --- | --- | --- | --- | --- | --- |
| `习概` | `习近平新时代中国特色社会主义思想概论` | `course` | `hard_canonical` | `course_facts` | allowed | 单课简称 |
| `马原` | `马克思主义基本原理` | `course` | `hard_canonical` | `course_facts` | allowed | 单课简称 |
| `毛概` | `毛泽东思想和中国特色社会主义理论体系概论` | `course` | `hard_canonical` | `course_facts` | allowed | 单课简称 |
| `史纲` | `中国近现代史纲要` | `course` | `hard_canonical` | `course_facts` | allowed | 单课简称 |
| `形策` | `形势与政策` | `course` | `hard_canonical` | `course_facts` | allowed | 单课简称 |
| `民概` | `中华民族共同体概论` | `course` | `hard_canonical` | `course_facts` | allowed | 单课简称 |
| `思修` | `思想道德与法治` | `course` | `hard_canonical` | `course_facts` | allowed | 当前仍保留为单课简称 |
| `思政课` | `思想政治理论课` | `course_family` | `resolved_family` | `course_facts` | forbidden as single-doc qrels | family alias |
| `思修课` | `思想政治理论课` | `course_family` | `resolved_family` | `course_facts` | forbidden as single-doc qrels | 在本项目里不是单课 alias |
| `思政` | `思想政治理论课` | `course_family` | `resolved_family` | `course_facts` | forbidden as single-doc qrels | 口语 family alias |
| `思政课程` | `思想政治理论课` | `course_family` | `resolved_family` | `course_facts` | forbidden as single-doc qrels | family alias |
| `民族班` | `民族班` | `program_family` | `resolved_family` | `program_family_facts` | forbidden as single-doc qrels | `有哪些` 走 family answer；显式专业时仍可回到 doc alias lane |
| `民族实验班` | `民族班` / ambiguous doc fragment | `program_family` | `context_dependent` | `program_family_facts` + `curriculum_plan` | forbidden as single-doc qrels when unresolved | membership intent 可答 family；独立短片段默认澄清 |
| `基地班` | `基地班` | `program_family` | `context_dependent` | `program_family_facts` + `curriculum_plan` | forbidden as single-doc qrels when unresolved | membership intent 可答 family；generic doc query 默认澄清；deictic + verified major 可 hard resolve |
| `强基计划` | 当前已采集的强基计划培养方案集合 | `program_family` | `context_dependent` | `program_family_facts` + `curriculum_plan` | forbidden as single-doc qrels when unresolved | `有哪些专业` 走 family answer；短片段/单 doc 语义仍回 doc lane |
| `强基` | 当前已采集的强基计划培养方案集合 | `program_family` | `context_dependent` | `program_family_facts` + `curriculum_plan` | forbidden as single-doc qrels when unresolved | 面向 C 端口语 alias；当前成员集合与 `强基计划` 一致 |
| `第二学士学位` | 当前已采集的第二学士学位培养方案集合 | `program_family` | `context_dependent` | `program_family_facts` + `curriculum_plan` | forbidden as single-doc qrels when unresolved | `有哪些专业` 走 family answer；显式专业时仍可回到 doc alias lane |
| `第二学位` | 当前已采集的第二学士学位培养方案集合 | `program_family` | `context_dependent` | `program_family_facts` + `curriculum_plan` | forbidden as single-doc qrels when unresolved | 面向 C 端口语 alias |
| `二学位` | 当前已采集的第二学士学位培养方案集合 | `program_family` | `context_dependent` | `program_family_facts` + `curriculum_plan` | forbidden as single-doc qrels when unresolved | 高频短 alias |
| `实验班` | 当前已采集的“名称里带实验班”的培养方案集合 | `program_family` | `resolved_family` | `program_family_facts` | forbidden as single-doc qrels | 面向 C 端返回当前已采集集合，不表述成官方统一分类 |
| `创新班` | 当前已采集的“名称里带创新班/创新实验班”的培养方案集合 | `program_family` | `resolved_family` | `program_family_facts` | forbidden as single-doc qrels | 面向 C 端返回当前已采集集合，不表述成官方统一分类 |
| `创新实验班` | 当前已采集的“名称里带创新班/创新实验班”的培养方案集合 | `program_family` | `resolved_family` | `program_family_facts` | forbidden as single-doc qrels | 优先落到创新班集合，而不是被 `实验班` 泛匹配抢占 |

## Resolution Notes

- `hard_canonical`
  只用于稳定单实体简称，例如 `习概`、`马原`。
- `resolved_family`
  query 可安全落到 family，但不能静默坍缩成单课或单 doc。
  - 对 `实验班` / `创新班` 这类产品问法，family truth 表示“当前已采集的名称集合”，不是宣称学校存在官方统一 family taxonomy。
- `clarify_first`
  alias 词面天然歧义，默认先澄清，不检索。
- `context_dependent`
  action 取决于 intent。
  - 例如 `基地班有哪些` 是 family answer
  - `强基有哪些专业`、`二学位有哪些专业` 也是 family answer
  - `我这个专业的基地班大二下有什么课` 才可能在 verified major 下硬解析

## Serving Surface Ownership

- `curriculum_plan/query-planning.json`
  负责 single-doc curriculum query 的 doc alias、safe alias、deictic family alias
- `course_facts/alias-governance.json`
  负责课程 / 课程 family alias
- `program_family_facts/family-governance.json`
  负责项目 family answer / clarification

## Eval Policy

- `course_family` / `program_family` alias 不得进入单 doc canonical qrels
- 这类问题应进入两种真相之一：
  - family-aware completed case
  - `needs_clarification` case
- curriculum golden gate 必须接受 `curriculum_plan -> internal facts surface` 的内部切换，否则 alias case 无法成为真实 gate
