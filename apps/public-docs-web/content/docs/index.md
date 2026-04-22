---
title: 文档目录
description: 使用 Fumadocs 接入的测试文档目录。
---

这个目录只用于验证文档站壳本身，不代表最终的 docs control-plane 已接入。

当前放入两组测试文档：

- `regulations / student_handbook`
- `curriculum / curriculum_plan`

你可以从这里进入：

- [学生手册测试目录](./regulations/student-handbook)
- [培养方案测试目录](./curriculum/curriculum-plan)

重点验证项：

- 中文 Markdown 长文能否自然阅读
- 多层级侧边栏能否承住目录结构
- 搜索结果能否命中中文段落
- Cloudflare Workers 目标下的构建与预渲染是否正常
