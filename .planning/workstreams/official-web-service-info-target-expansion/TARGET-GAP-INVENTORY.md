---
doc_type: inventory
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Target Gap Inventory

This file records the source-backed service-info targets admitted by this workstream.

The denominator remains:

- contact directory: `phone`, `email`, `location`, `office_hours`
- service guide: `service_process`, `service_entry`, `service_material`, `phone`, `location`,
  `office_hours`

## Accepted Targets

| Inventory ID | Surface | Source URL | Source-backed facts | Blocking gaps | Decision |
| --- | --- | --- | --- | --- | --- |
| `muc-main-homepage-contact` | `contact_directory_lookup` | `https://www.muc.edu.cn/` | campus locations, main phone | `email`, `office_hours` | retained candidate, selected-write blocked |
| `muc-information-disclosure-application-process` | `service_guide_lookup` | `https://xxgk.muc.edu.cn/info/1007/1113.htm` | process steps, information portal route, responsible office text | `phone`, `location`, `office_hours`; material evidence is incomplete on this page alone | retained candidate, selected-write blocked |
| `muc-information-disclosure-application-form-download` | `service_guide_lookup` | `https://xxgk.muc.edu.cn/info/1007/1114.htm` | application form and approval form download links | `service_process`, `service_entry`, `phone`, `location`, `office_hours` | retained candidate, selected-write blocked |

## Excluded Shape

- host-wide expansion from `www.muc.edu.cn`, `xxgk.muc.edu.cn` or `lib.muc.edu.cn`
- news, notices, recruitment, procurement and marketing pages
- pages that do not provide at least one denominator field for contact directory or service guide

## Config Result

- `target-inventory.json` is now `muc_public_target_inventory_v2`.
- Contact and service inventory rows now carry the full configured `required_evidence`.
- The new application-form row is admitted as a blocked service-guide candidate, not a ready row.
