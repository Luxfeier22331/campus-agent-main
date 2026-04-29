---
doc_type: index
status: backlog
created: 2026-04-23
updated: 2026-04-23
---

# Workstream: Chat Capacity And Cancellation Hardening

这是 `chat-capacity-and-cancellation-hardening` 的 native backlog workstream 入口。
它记录 public chat 在 100 人同时提问、热点问题削峰、重复提交去重与用户中止体验上的后续硬化缺口。

## Current Status

- status: `backlog`
- reopen rule: 只有在产品范围决定为 public chat 正式收口 100 人同时提问、热点削峰、ChatGPT 式提交/中止体验或 K8s/多实例容量治理时恢复
- current posture: 已完成代码级缺口确认；未进入 active implementation

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- 这条线不重开 `shared product surfaces acceptance / hardening` 的已完成验收结论
- 这条线不把 `supervisor-api` 改造成长同步队列
- 这条线不把产品层限流、身份、会话或请求投影下放到 `supervisor-core`
- 异步长任务队列只在产品接受非实时体验时进入设计，不替代当前同步问答主路径
