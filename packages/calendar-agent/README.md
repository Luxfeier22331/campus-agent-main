# campus-calendar-agent

`packages/calendar-agent` 是 `campus-agent` 中 academic calendar structured capability
的 owner package。

它负责：

- 接收 `calendar-agent` 的 typed agent handoff
- 将 academic calendar payload 映射到 internal query service
- 返回带 source refs / fail-close reason 的 typed `AgentResponse`

它不负责：

- capability inference、planner、Go runtime routing
- official-web ingestion 或 projection 写入
- public supervisor final response assembly
