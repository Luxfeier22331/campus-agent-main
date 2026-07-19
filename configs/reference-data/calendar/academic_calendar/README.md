# academic_calendar 参考数据

本目录保存人工核对的校历参考数据和公开合成样例，不是采集任务注册表或模型可见工具。

## 文件

- `source-truth.v1.json`：已核对来源与数据集身份；
- `curated-academic-calendars/`：学期、日期和教学周样例；
- `notice-calendar-arrangements/`：由已核对通知形成的课程调整样例。

目录中的公开文件都是 synthetic fixture。真实发布、来源图片和 OCR 产物属于私有数据或运行
产物。页面、通知或 OCR 结果只有经过校历领域核对后才能成为结构化事实。

当前产品能力和发布边界见 `docs/domains/calendar.md`；在线能力是否存在必须由运行注册表、
handler 和合同共同证明，不能从本目录推断。
