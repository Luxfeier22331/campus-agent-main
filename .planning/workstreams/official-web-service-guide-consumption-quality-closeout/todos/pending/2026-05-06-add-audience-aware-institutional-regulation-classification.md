---
created: 2026-05-06T05:36:33.417Z
title: Add audience-aware institutional regulation classification
area: planning
files:
  - configs/ingestion/regulations/institutional_rules/README.md
  - docs/reference/institutional-regulations-offline-inventory.md
  - docs/architecture/system/retrieval-serving-architecture.md
---

## Problem

`regulations/institutional_rules` currently groups institution-wide stable
regulations by document nature. That is structurally correct, but it does not
express the product-level difference between student-facing and faculty/staff-
facing concerns.

Official-web regulation examples such as `中央民族大学学术委员会章程`,
`中央民族大学教职工代表大会暨工会代表大会工作规程`, and
`中央民族大学岗位设置与聘用管理暂行办法` are institution-wide stable
regulations, but students are unlikely to care about them. They should remain
canonical institutional regulations while also being discoverable as
faculty/staff-oriented policies in downstream docs and RAG experiences.

## Solution

Backlog an audience-aware classification layer before considering a new
collection.

Preferred implementation:

- Keep canonical collection identity under `regulations/institutional_rules`.
- Add stable document metadata such as `audience_tags`, `policy_domain`, and
  `reader_category` during regulation materialization / read-model generation.
- Use the metadata in public docs navigation and filters so faculty/staff-
  oriented rules can appear under a visible `教职工制度` category.
- Teach query planning / alias handling that terms such as `教职工`, `教师`,
  `人事`, `岗位聘用`, `职称评审`, `教代会`, and `学术委员会` should bias toward
  `audience_tags=faculty_staff` or related domains.
- Only consider a future dedicated `regulations/faculty_staff_rules` collection
  after there is enough volume and a real need for independent runtime profile,
  RAG release lane, eval denominator, and product entry.
