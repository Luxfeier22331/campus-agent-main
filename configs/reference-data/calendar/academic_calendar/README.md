# academic_calendar 参考数据

`academic_calendar` 是人工整理的结构化数据，不作为 campus-services runtime tool 暴露。

本目录是 reference data，不是 ingestion-control collection；不声明 task registry、serving
config、retrieval alias 或模型可见的结构化工具。

## 来源事实

- `source-truth.v1.json` 声明 `calendar/academic_calendar` 已核对的 source truth；
- `curated-academic-calendars/synthetic-2026.v1.json` 是公开仓库的 synthetic baseline
  fixture；
- `notice-calendar-arrangements/synthetic-course-adjustment.v1.json` 是通知派生校历安排的公开
  synthetic fixture；
- Official Web page/image ref 只作为 evidence；只有图片的 collector candidate 未形成结构化
  curated artifact 前，不能直接提升为当前事实；
- authenticated notice artifact 只能通过 source-truth admission 覆盖或补充 baseline。runtime
  lookup 不扫描 raw notice export、raw HTML、OCR asset 或通用 RAG 来获取校历事实。

## 发布

该 reference-data scope 没有有效 ingestion-control task registry。此前未对应真实默认 TS
handler 的 `structured_projection_publish` 与 `operator_projection_snapshot` 声明已删除。

本 collection 没有有效 Python publish CLI。若校历发布重新进入 ingestion-control，必须在同一
次变更中增加真实 TS handler 与对应 registry task，不得恢复占位 task，也不得从 raw HTML、
OCR asset 或通用 RAG 推断不完整投影。

## 公开仓库边界

本目录跟踪的文件都是 synthetic source-truth fixture。真实校历 release、source image、OCR
evidence 与 service-question smoke report 属于私有 data/artifact 边界，不随仓库许可证发布。
