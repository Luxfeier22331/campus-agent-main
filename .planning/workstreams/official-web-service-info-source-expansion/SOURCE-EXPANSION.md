---
doc_type: evidence
status: completed
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Source Expansion Record

## Added Sources

| Inventory ID | Surface | Source URL | Required evidence | Optional evidence observed | Decision |
| --- | --- | --- | --- | --- | --- |
| `muc-information-disclosure-contact` | `contact_directory_lookup` | `https://xxgk.muc.edu.cn/xxgk/lxfs.htm` | `phone` | `location` | selected-write candidate after preview lineage |
| `muc-it-student-campus-card-service-guide` | `service_guide_lookup` | `https://met.muc.edu.cn/info/1027/1127.htm` | `service_process` | `service_entry`, `service_material`, `phone`, `location` | selected-write candidate after preview lineage |

## Deferred Sources

| Source | Reason |
| --- | --- |
| `https://met.muc.edu.cn/fwzn/xsfw.htm` | service-listing page; useful for discovery but not a standalone selected-write service guide |
| `https://met.muc.edu.cn/info/1027/1132.htm` | network-account entry source; current text does not clearly expose the service-process denominator |
| `https://met.muc.edu.cn/info/1027/1129.htm` | VPN entry source; current text exposes entry but not enough process evidence |
| `https://xxgk.muc.edu.cn/info/1007/1114.htm` | material-only form page; remains blocked as standalone service guide until multi-page composition exists |

## Classification Fix

The collector previously applied `negative_patterns` to full page text. That caused the campus-card
service page to be rejected because its body contains `领取通知`, even though the title and source URL
are clearly service-guide shaped. Negative patterns now apply to title/URL page-type evidence, while
body text remains available for denominator evidence extraction.
