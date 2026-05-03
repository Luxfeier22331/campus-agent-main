---
doc_type: inventory
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Target Gap Inventory

This file records the source-backed service-info targets admitted by this workstream.

The selected-write denominator is:

- contact directory: required `phone`; optional `email`, `location`, `office_hours`
- service guide: required `service_process`; optional `service_entry`, `service_material`, `phone`,
  `location`, `office_hours`

## Accepted Targets

| Inventory ID | Surface | Source URL | Source-backed facts | Machine release state | Decision |
| --- | --- | --- | --- | --- | --- |
| `muc-main-homepage-contact` | `contact_directory_lookup` | `https://www.muc.edu.cn/` | campus locations, main phone | optional `email`, `office_hours` recorded as source-not-provided | selected-write released |
| `muc-information-disclosure-contact` | `contact_directory_lookup` | `https://xxgk.muc.edu.cn/xxgk/lxfs.htm` | information disclosure phone/fax and address text | optional `email`, `office_hours` recorded as source-not-provided | selected-write released |
| `muc-information-disclosure-application-process` | `service_guide_lookup` | `https://xxgk.muc.edu.cn/info/1007/1113.htm` | process steps, information portal route, responsible office text | no current preview/release evidence in this workstream | retained candidate, selected-write blocked until preview |
| `muc-information-disclosure-application-form-download` | `service_guide_lookup` | `https://xxgk.muc.edu.cn/info/1007/1114.htm` | application form and approval form download links | required `service_process` absent on this page alone; should be evaluated as a composition component with `muc-information-disclosure-application-process` | retained composition component, selected-write blocked |
| `muc-it-student-campus-card-service-guide` | `service_guide_lookup` | `https://met.muc.edu.cn/info/1027/1127.htm` | campus card process sections and service contact phones | optional `location`, `office_hours` recorded as source-not-provided | selected-write released |

## Excluded Shape

- host-wide expansion from `www.muc.edu.cn`, `xxgk.muc.edu.cn` or `lib.muc.edu.cn`
- news, notices, recruitment, procurement and marketing pages
- pages that do not provide at least one denominator field for contact directory or service guide

## Config Result

- `target-inventory.json` is now `muc_public_target_inventory_v3`.
- Contact and service inventory rows distinguish configured `required_evidence` from optional
  source-provided evidence. Optional evidence absence is source-faithful metadata, not a completeness
  blocker.
- The homepage contact, information disclosure contact and student campus card service guide rows
  are released into current structured projections.
- The application-form row remains a blocked service-guide composition component because it
  contributes material evidence but not the required process evidence on that page alone.
