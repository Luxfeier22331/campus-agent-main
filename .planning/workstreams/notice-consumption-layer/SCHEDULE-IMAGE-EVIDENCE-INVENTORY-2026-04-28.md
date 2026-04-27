---
doc_type: audit
status: draft
created: 2026-04-28
updated: 2026-04-28
---

# Schedule Image Evidence Inventory - 2026-04-28

## Scope

本文件冻结第一批 schedule candidate 中图片证据的只读 inventory。

本次只读取：

- 本地 authenticated notice bundle；
- 图片 attachment metadata；
- source bucket object HEAD metadata；
- 图片前后正文上下文。

本次未执行 OCR、VLM、PG write、MinIO write、derived write、source-truth
restore、admission、projection、read-model、Qdrant 或 commit。

完整 image-level manifest：

- `schedule-image-evidence-inventory-2026-04-28.json`

## Summary

| Metric | Count |
| --- | ---: |
| Schedule candidates in first batch | 39 |
| Image-bearing candidate notices | 21 |
| Image evidence entries | 35 |
| Existing source objects | 35 |
| Missing / unreadable image evidence | 0 |
| Candidate notices for OCR dry-run | 21 |

Image-use split:

| Image use | Image entries | Notice count |
| --- | ---: | ---: |
| `schedule_table_image` | 19 | 14 |
| `mixed_schedule_and_guide_image` | 16 | 7 |

Notice-level split:

| Notice image-use set | Notice count |
| --- | ---: |
| `schedule_table_image` | 14 |
| `mixed_schedule_and_guide_image` | 7 |

结论：

- 21 条 image-bearing schedule candidates 均具备可读 source object。
- 35 个 image evidence entries 均有 source object。
- 本批没有执行 OCR；`schedule_table_image` 只是 dry-run 输入候选。
- `mixed_schedule_and_guide_image` 必须在 OCR 后拆分 schedule facts 与
  guide-adjacent facts，不能整条写入 `transport_schedule`。
- 本次修正了同一 notice 多个 bundle 版本的选择逻辑：优先使用
  object-backed/materialized bundle row，而不是较早的 `reference_only` row。

## Missing / Hold

- None.

## Notice Inventory

### `355881`

- 标题：关于开通丰台校区社会实践专车的通知
- 发布时间：`2026-04-25 16:26`
- 来源部门：后勤保障处（后勤集团）、后勤保障处直属党支部
- 图片证据：`1`；source object exists: `1/1`
- 分流：`mixed_schedule_and_guide_image`
  - image `1`: `mixed_schedule_and_guide_image`
    - object: `exists`; size: `1091336`; sha: `5e0a6fde93cc`
    - file: `694db62e-c14c-4f35-8564-17e147226354.png`
    - reasons:
      - `guide_terms_near_image`
      - `route_or_boarding_terms_near_image`
      - `time_literal_near_image`

### `355867`

- 标题：关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知
- 发布时间：`2026-04-25 13:11`
- 来源部门：丰台校区管理委员会
- 图片证据：`3`；source object exists: `3/3`
- 分流：`schedule_table_image`
  - image `1`: `schedule_table_image`
    - object: `exists`; size: `47862`; sha: `91d6d5bc945c`
    - file: `a753da4f-375a-46ad-a1d1-99d28fdbe282.png`
    - reasons: `schedule_table_terms_near_image`
  - image `2`: `schedule_table_image`
    - object: `exists`; size: `38430`; sha: `c1992805c48a`
    - file: `08a8617b-486a-4f9b-805e-382c7357b25e.png`
    - reasons: `schedule_table_terms_near_image`
  - image `3`: `schedule_table_image`
    - object: `exists`; size: `43090`; sha: `53daf52134c0`
    - file: `d01549b8-39db-41a2-96e1-fc391ab0c493.png`
    - reasons: `schedule_table_terms_near_image`

### `355122`

- 标题：关于两校区学生通勤班车增加班次的通知
- 发布时间：`2026-03-18 11:12`
- 来源部门：丰台校区管理委员会
- 图片证据：`1`；source object exists: `1/1`
- 分流：`schedule_table_image`
  - image `1`: `schedule_table_image`
    - object: `exists`; size: `231842`; sha: `fc9a63ccf50c`
    - file: `2ddee1c3-28a5-434e-b0de-e758c3463be3.jpg`
    - reasons: `schedule_table_terms_near_image`

### `354889`

- 标题：关于两校区教师通勤班车班次优化调整的通知
- 发布时间：`2026-03-05 16:50`
- 来源部门：丰台校区管理委员会
- 图片证据：`1`；source object exists: `1/1`
- 分流：`schedule_table_image`
  - image `1`: `schedule_table_image`
    - object: `exists`; size: `178603`; sha: `7c78f9b8e679`
    - file: `0141c9b8-949f-491e-aab2-eff719e57b34.jpg`
    - reasons: `schedule_table_terms_near_image`

### `354777`

- 标题：关于近期丰台校区周末地铁接驳车运营安排的通知
- 发布时间：`2026-02-27 08:06`
- 来源部门：丰台校区管理委员会
- 图片证据：`1`；source object exists: `1/1`
- 分流：`mixed_schedule_and_guide_image`
  - image `1`: `mixed_schedule_and_guide_image`
    - object: `exists`; size: `57015`; sha: `65ce51d0833f`
    - file: `95c6574c-2faa-4e19-9367-344953ad2e7a.png`
    - reasons:
      - `guide_terms_near_image`
      - `schedule_table_terms_near_image`
      - `time_literal_near_image`

### `354578`

- 标题：关于寒假期间两校区通勤班车班次调整的通知
- 发布时间：`2026-01-21 19:50`
- 来源部门：丰台校区管理委员会
- 图片证据：`1`；source object exists: `1/1`
- 分流：`schedule_table_image`
  - image `1`: `schedule_table_image`
    - object: `exists`; size: `119008`; sha: `bfcff89c9fe4`
    - file: `c8bb76c8-383a-4ab0-8522-6418b95f0130.jpg`
    - reasons: `schedule_table_terms_near_image`

### `354533`

- 标题：关于寒假期间两校区通勤班车运营安排的通知
- 发布时间：`2026-01-17 18:24`
- 来源部门：丰台校区管理委员会
- 图片证据：`1`；source object exists: `1/1`
- 分流：`schedule_table_image`
  - image `1`: `schedule_table_image`
    - object: `exists`; size: `66284`; sha: `aa90febbee4f`
    - file: `5c7bfd9a-4f79-49d7-8584-9e8c6c4b70d6.jpg`
    - reasons: `schedule_table_terms_near_image`

### `354270`

- 标题：关于两校区通勤班车新增班次的通知
- 发布时间：`2025-12-30 10:01`
- 来源部门：丰台校区管理委员会
- 图片证据：`1`；source object exists: `1/1`
- 分流：`schedule_table_image`
  - image `1`: `schedule_table_image`
    - object: `exists`; size: `184130`; sha: `c2fc2ef155bc`
    - file: `ef0a6b80-7f2e-4fed-990d-8b8c3032ab9f.jpg`
    - reasons: `schedule_table_terms_near_image`

### `353901`

- 标题：关于两校区通勤班车新增班次的通知
- 发布时间：`2025-12-11 15:40`
- 来源部门：丰台校区管理委员会
- 图片证据：`1`；source object exists: `1/1`
- 分流：`schedule_table_image`
  - image `1`: `schedule_table_image`
    - object: `exists`; size: `171398`; sha: `c1ba5adfa1b3`
    - file: `3f8decfa-2282-411a-b094-f766c32bea7c.jpg`
    - reasons: `schedule_table_terms_near_image`

### `352325`

- 标题：关于丰台校区地铁接驳车优化调整的通知
- 发布时间：`2025-09-25 17:06`
- 来源部门：丰台校区管理委员会
- 图片证据：`3`；source object exists: `3/3`
- 分流：`mixed_schedule_and_guide_image`
  - image `1`: `mixed_schedule_and_guide_image`
    - object: `exists`; size: `49911`; sha: `eba7d36b37c5`
    - file: `dbeae0b9-25f1-4c16-9c48-7dfcd4b52f84.png`
    - reasons:
      - `guide_terms_near_image`
      - `route_or_boarding_terms_near_image`
      - `schedule_table_terms_near_image`
      - `time_literal_near_image`
  - image `2`: `mixed_schedule_and_guide_image`
    - object: `exists`; size: `24228`; sha: `b24f6d9cafc0`
    - file: `de0ded93-6b38-40fc-b60a-dfd0899763a9.png`
    - reasons:
      - `guide_terms_near_image`
      - `route_or_boarding_terms_near_image`
      - `schedule_table_terms_near_image`
      - `time_literal_near_image`
  - image `3`: `mixed_schedule_and_guide_image`
    - object: `exists`; size: `34084`; sha: `7ff27fd898ca`
    - file: `22aa0f2b-19f4-4caa-9f0e-c6017c50109c.png`
    - reasons:
      - `guide_terms_near_image`
      - `route_or_boarding_terms_near_image`
      - `schedule_table_terms_near_image`
      - `time_literal_near_image`

### `351696`

- 标题：关于本学期两校区通勤班车及地铁接驳车恢复运营的通知
- 发布时间：`2025-08-28 16:54`
- 来源部门：丰台校区管理委员会
- 图片证据：`3`；source object exists: `3/3`
- 分流：`mixed_schedule_and_guide_image`
  - image `1`: `mixed_schedule_and_guide_image`
    - object: `exists`; size: `98569`; sha: `196eec731537`
    - file: `0d111edf-b2ee-45eb-8c24-9a3b6e6b9d49.png`
    - reasons:
      - `guide_terms_near_image`
      - `route_or_boarding_terms_near_image`
      - `schedule_table_terms_near_image`
      - `time_literal_near_image`
  - image `2`: `mixed_schedule_and_guide_image`
    - object: `exists`; size: `55113`; sha: `3b78ec569212`
    - file: `5f25998d-5dcb-4ec8-b227-6beaf962ed9e.png`
    - reasons:
      - `guide_terms_near_image`
      - `route_or_boarding_terms_near_image`
      - `schedule_table_terms_near_image`
      - `time_literal_near_image`
  - image `3`: `mixed_schedule_and_guide_image`
    - object: `exists`; size: `33694`; sha: `babb2595aa16`
    - file: `e5573a54-5723-45f0-ab7c-98de4edfc264.png`
    - reasons:
      - `guide_terms_near_image`
      - `route_or_boarding_terms_near_image`
      - `schedule_table_terms_near_image`
      - `time_literal_near_image`

### `351030`

- 标题：关于暑假期间师生通勤班车、地铁接驳车运营调整的通知
- 发布时间：`2025-07-08 09:28`
- 来源部门：丰台校区管理委员会
- 图片证据：`1`；source object exists: `1/1`
- 分流：`schedule_table_image`
  - image `1`: `schedule_table_image`
    - object: `exists`; size: `48680`; sha: `41d5f99c5079`
    - file: `92ccb0ab-f841-442c-9008-fc8886d9ef9c.png`
    - reasons: `schedule_table_terms_near_image`

### `350030`

- 标题：关于通勤班车每周增加临时班次的通知
- 发布时间：`2025-07-03 18:08`
- 来源部门：丰台校区管理委员会
- 图片证据：`1`；source object exists: `1/1`
- 分流：`schedule_table_image`
  - image `1`: `schedule_table_image`
    - object: `exists`; size: `41676`; sha: `087e0919abc9`
    - file: `3f853cb7-9ecf-49b8-b31e-ce35b2612e99.png`
    - reasons: `schedule_table_terms_near_image`

### `349494`

- 标题：关于近期两校区通勤班车及地铁接驳车安排的通知
- 发布时间：`2025-04-24 22:16`
- 来源部门：丰台校区管理委员会
- 图片证据：`4`；source object exists: `4/4`
- 分流：`schedule_table_image`
  - image `1`: `schedule_table_image`
    - object: `exists`; size: `35314`; sha: `2e82ce868398`
    - file: `31e085e2-f290-42af-8391-a463ae5b9da2.png`
    - reasons: `schedule_table_terms_near_image`
  - image `2`: `schedule_table_image`
    - object: `exists`; size: `54976`; sha: `f371efa8749d`
    - file: `8cf48adf-1c47-449b-99db-e1fe5f7f5cb7.png`
    - reasons: `schedule_table_terms_near_image`
  - image `3`: `schedule_table_image`
    - object: `exists`; size: `35820`; sha: `eaf6961f20a5`
    - file: `14c81ba9-4889-4855-9cf1-7073165c5d96.png`
    - reasons: `schedule_table_terms_near_image`
  - image `4`: `schedule_table_image`
    - object: `exists`; size: `54776`; sha: `2eb884b1f10a`
    - file: `f97b456d-e6a6-4528-a034-13898fc3e093.png`
    - reasons: `schedule_table_terms_near_image`

### `348880`

- 标题：关于两校区师生通勤班车运营时间的通知
- 发布时间：`2025-03-28 17:00`
- 来源部门：丰台校区管理委员会
- 图片证据：`1`；source object exists: `1/1`
- 分流：`schedule_table_image`
  - image `1`: `schedule_table_image`
    - object: `exists`; size: `187897`; sha: `94e218d4bcc0`
    - file: `2ad0cb4a-a1e2-40ba-b940-b6913e0a7019.jpg`
    - reasons: `schedule_table_terms_near_image`

### `348457`

- 标题：关于丰台校区地铁接驳车优化调整的通知
- 发布时间：`2025-03-07 08:30`
- 来源部门：丰台校区管理委员会
- 图片证据：`6`；source object exists: `6/6`
- 分流：`mixed_schedule_and_guide_image`
  - image `1`: `mixed_schedule_and_guide_image`
    - object: `exists`; size: `109548`; sha: `ebc21dd52545`
    - file: `711dd4b3-7093-4005-a108-f54a906f7172.jpg`
    - reasons:
      - `guide_terms_near_image`
      - `route_or_boarding_terms_near_image`
      - `schedule_table_terms_near_image`
      - `time_literal_near_image`
  - image `2`: `mixed_schedule_and_guide_image`
    - object: `exists`; size: `242593`; sha: `62f3613011b1`
    - file: `a711957c-6ba0-41cd-abaf-5bbdaedb68ea.jpg`
    - reasons:
      - `guide_terms_near_image`
      - `route_or_boarding_terms_near_image`
      - `schedule_table_terms_near_image`
      - `time_literal_near_image`
  - image `3`: `mixed_schedule_and_guide_image`
    - object: `exists`; size: `195260`; sha: `38fa1107d749`
    - file: `4c068a45-4f95-4d9e-8364-e73db6d76268.jpg`
    - reasons:
      - `guide_terms_near_image`
      - `route_or_boarding_terms_near_image`
      - `schedule_table_terms_near_image`
      - `time_literal_near_image`
  - image `4`: `mixed_schedule_and_guide_image`
    - object: `exists`; size: `163955`; sha: `4de9f7fe99e5`
    - file: `65550f59-3807-429f-a509-2a01a3b38313.jpg`
    - reasons:
      - `guide_terms_near_image`
      - `route_or_boarding_terms_near_image`
      - `schedule_table_terms_near_image`
      - `time_literal_near_image`
  - image `5`: `mixed_schedule_and_guide_image`
    - object: `exists`; size: `115586`; sha: `400797196248`
    - file: `7d984b19-885d-43e8-a217-fe5459eb4c5e.jpg`
    - reasons:
      - `guide_terms_near_image`
      - `route_or_boarding_terms_near_image`
      - `schedule_table_terms_near_image`
      - `time_literal_near_image`
  - image `6`: `mixed_schedule_and_guide_image`
    - object: `exists`; size: `71909`; sha: `679a4bf36acc`
    - file: `d09946b1-d073-49b7-91b9-ef48638176db.jpg`
    - reasons:
      - `guide_terms_near_image`
      - `schedule_table_terms_near_image`
      - `time_literal_near_image`

### `348272`

- 标题：关于通勤班车、地铁接驳车相关调整的通知
- 发布时间：`2025-02-25 17:00`
- 来源部门：丰台校区管理委员会
- 图片证据：`1`；source object exists: `1/1`
- 分流：`mixed_schedule_and_guide_image`
  - image `1`: `mixed_schedule_and_guide_image`
    - object: `exists`; size: `64139`; sha: `5e257c398562`
    - file: `6b9928aa-2e14-49eb-b696-864324039a24.jpg`
    - reasons:
      - `guide_terms_near_image`
      - `route_or_boarding_terms_near_image`
      - `schedule_table_terms_near_image`
      - `time_literal_near_image`

### `248186`

- 标题：关于2025年春季学期两校区通勤班车及地铁接驳车安排的通知
- 发布时间：`2025-02-18 17:35`
- 来源部门：丰台校区管理委员会
- 图片证据：`1`；source object exists: `1/1`
- 分流：`mixed_schedule_and_guide_image`
  - image `1`: `mixed_schedule_and_guide_image`
    - object: `exists`; size: `114850`; sha: `4d9f487e00b9`
    - file: `f8b8e5ae-1218-439e-8bdd-e2b27d5a2d5c.jpg`
    - reasons:
      - `guide_terms_near_image`
      - `schedule_table_terms_near_image`

### `247970`

- 标题：关于近期通勤班车、地铁接驳车运营时间调整的通知
- 发布时间：`2025-01-11 21:50`
- 来源部门：丰台校区管理委员会
- 图片证据：`1`；source object exists: `1/1`
- 分流：`schedule_table_image`
  - image `1`: `schedule_table_image`
    - object: `exists`; size: `45131`; sha: `95d100ab0684`
    - file: `5b38c17c-148c-4966-a851-882e09803684.png`
    - reasons: `schedule_table_terms_near_image`

### `247734`

- 标题：关于增加两校区学生通勤班车班次的通知
- 发布时间：`2024-12-29 10:38`
- 来源部门：丰台校区管理委员会
- 图片证据：`1`；source object exists: `1/1`
- 分流：`schedule_table_image`
  - image `1`: `schedule_table_image`
    - object: `exists`; size: `72796`; sha: `d1aff3357c16`
    - file: `fce8ab1e-8dd0-4cd9-934c-adadc141e0d7.png`
    - reasons: `schedule_table_terms_near_image`

### `237479`

- 标题：关于优化两校区学生通勤班车方案的通知（试行）
- 发布时间：`2023-11-11 15:55`
- 来源部门：丰台校区管理委员会
- 图片证据：`1`；source object exists: `1/1`
- 分流：`schedule_table_image`
  - image `1`: `schedule_table_image`
    - object: `exists`; size: `53483`; sha: `f8e60b1f67e2`
    - file: `d8810641-1d63-4aab-b50d-3c45a4ac6d86.png`
    - reasons:
      - `route_or_boarding_terms_near_image`
      - `schedule_table_terms_near_image`

## OCR Dry-Run Input Recommendation

下一步 OCR dry-run 的最小输入集合应只包含：

- object exists = true；
- image use in `schedule_table_image` or `mixed_schedule_and_guide_image`；
- notice 仍属于第一批 schedule candidate；
- OCR 输出只写 local dry-run artifact，不写 PG / MinIO / derived。

当前推荐 OCR dry-run notice ids：

- `355881`, `355867`, `355122`, `354889`, `354777`, `354578`, `354533`,
- `354270`, `353901`, `352325`, `351696`, `351030`, `350030`, `349494`,
- `348880`, `348457`, `348272`, `248186`, `247970`, `247734`, `237479`

## Guardrails

- `schedule_table_image` 不等于 admission success。
- `mixed_schedule_and_guide_image` 必须拆分 schedule 与 guide facts。
- missing / unreadable image 不得 terminalize 为 schedule truth。
- 后续 projection 只能消费通过 deterministic guard 的结构化结果。
