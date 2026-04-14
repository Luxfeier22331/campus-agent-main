---
doc_type: reference
status: active
created: 2026-04-12
updated: 2026-04-12
---

# Provider `/responses` 接口契约异常问题报告（2026-04-12）

## 文档目的

本文为面向供应商的正式问题报告，用于说明以下 OpenAI 兼容端点在 `POST /responses` 路径上的异常行为：

- `https://www.su8.codes/codex/v1`
- `https://cn2.su8.codes/codex/v1`

本次问题复现使用的模型为 `gpt-5.4`。

## 问题摘要

`POST /responses` 在返回 HTTP `200` 且 `status="completed"` 的情况下，响应体中没有任何可消费的模型输出内容。

当前观测到的典型响应特征如下：

- `status = "completed"`
- `usage.output_tokens > 0`
- `output = []`
- 不包含可用的 `output_text`

该现象可通过多种请求形状稳定复现，包括最小文本生成请求。
相同 API Key、相同 Base URL、相同模型下，`POST /chat/completions` 可正常返回文本结果。

## 影响范围

目前该端点不能被视为符合 OpenAI `Responses API` 契约的可用实现，因为成功响应中缺失可消费的生成结果。

这会直接阻塞我们基于 `/responses` 的评测运行时，包括：

- 文本生成
- 结构化输出生成

## 受影响端点

- `https://www.su8.codes/codex/v1/responses`
- `https://cn2.su8.codes/codex/v1/responses`

## 对照成功端点

- `https://www.su8.codes/codex/v1/chat/completions`

该对照端点在相同认证信息与相同模型下可正常返回 assistant 文本。

## 复现条件

- 复现日期：`2026-04-12`
- 时区：`Asia/Shanghai`
- 模型：`gpt-5.4`
- 认证方式：Bearer Token
- 请求类型：非流式文本生成请求

## 最小复现步骤

### 用例 A：`/responses` 最小文本请求

```bash
curl --silent --show-error \
  https://www.su8.codes/codex/v1/responses \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4",
    "input": "Reply with OK only."
  }'
```

### 实际结果

HTTP 状态：

```text
200 OK
```

代表性响应摘录：

```json
{
  "id": "resp_0774c37ba72537440169dabae8adbc81968124f8fa72fc6347",
  "model": "gpt-5.4",
  "object": "response",
  "status": "completed",
  "output": [],
  "usage": {
    "input_tokens": 22,
    "output_tokens": 5,
    "total_tokens": 27
  }
}
```

### 期望结果

对于成功完成的文本生成请求，响应体应包含可消费的生成结果，例如：

- `output_text`，或
- `output[*].content[*]` 中的文本内容

## 其他复现变体

该问题并非只出现在单一请求形状下。

### 用例 B：`/responses` message-array 请求

```bash
curl --silent --show-error \
  https://www.su8.codes/codex/v1/responses \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4",
    "input": [
      {
        "role": "user",
        "type": "message",
        "content": [
          {
            "type": "input_text",
            "text": "Reply with OK only."
          }
        ]
      }
    ]
  }'
```

代表性响应摘录：

```json
{
  "id": "resp_070b8488b30aca2a0169dabaea329c81978ae86a445c0dba46",
  "model": "gpt-5.4",
  "object": "response",
  "status": "completed",
  "output": [],
  "usage": {
    "input_tokens": 22,
    "output_tokens": 5,
    "total_tokens": 27
  }
}
```

### 用例 C：`/responses` 带附加参数的请求

请求体：

```json
{
  "model": "gpt-5.4",
  "stream": false,
  "input": [
    {
      "role": "user",
      "type": "message",
      "content": "Reply with OK only."
    }
  ],
  "temperature": 0.0,
  "reasoning": {
    "effort": "none"
  },
  "text": {
    "format": {
      "type": "text"
    },
    "verbosity": "low"
  },
  "max_output_tokens": 16
}
```

代表性响应摘录：

```json
{
  "id": "resp_040b9efa2fe9bcc00169dabae985b081958b31452bda58dc96",
  "model": "gpt-5.4",
  "object": "response",
  "status": "completed",
  "output": [],
  "usage": {
    "input_tokens": 22,
    "output_tokens": 5,
    "total_tokens": 27
  }
}
```

该结果表明问题并非由某一个可选参数触发。无论是最小请求还是带附加参数的请求，都会出现相同的空输出现象。

## 已确认的复现 ID

以下响应均已确认出现“请求完成但无可消费输出”的问题：

- `www` 文本 preflight：`resp_0e2dc0f8d13af07b0169daae032ae481959eae035a32525af4`
- `www` 结构化 preflight：`resp_0ba1f4ad6ada37680169daaed07a008197809698ff40777c0a`
- `www` 最小文本请求：`resp_0774c37ba72537440169dabae8adbc81968124f8fa72fc6347`
- `www` message-array 请求：`resp_070b8488b30aca2a0169dabaea329c81978ae86a445c0dba46`
- `www` 附加参数文本请求：`resp_040b9efa2fe9bcc00169dabae985b081958b31452bda58dc96`
- `cn2` 文本 preflight：`resp_08f4286ece55bdb20169dab6633e608196a07a9b4c7f509220`
- `cn2` 结构化 preflight：`resp_0610780f6f5e4d740169dab66629b48190a2972bf6d7962477`

## 跨端点对照结果

以下请求在同一 provider、同一 API Key、同一模型下可以成功返回文本：

```bash
curl --silent --show-error \
  https://www.su8.codes/codex/v1/chat/completions \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4",
    "messages": [
      {
        "role": "user",
        "content": "Reply with OK only."
      }
    ]
  }'
```

代表性成功响应摘录：

```json
{
  "id": "chatcmpl_38ae17e86aa1435eb3a81dcf184fac37",
  "model": "gpt-5.4",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "finish_reason": "stop",
      "message": {
        "role": "assistant",
        "content": "OK"
      }
    }
  ]
}
```

该对照结果说明：

- API Key 有效
- 模型可访问
- Base URL 可访问
- 问题集中出现在 `/responses` 路径

## 补充观察

在至少一组 `/responses` 复现中，响应体中回显的部分参数值与请求值不一致：

- 请求：`temperature = 0.0`
- 响应：`temperature = 1.0`
- 请求：`max_output_tokens = 16`
- 响应：`max_output_tokens = null`

这可能意味着 `/responses` 兼容层还存在附加的参数处理问题。
但本次报告的主问题仍然是：响应状态已完成，但缺失生成输出。

## 请供应商协助确认

请协助确认以下事项：

1. `gpt-5.4` 是否应被你方 `POST /responses` OpenAI 兼容端点正式支持。
2. 若已支持，请协助定位为何返回 `status="completed"` 时，响应体中没有任何可消费的生成内容。
3. 请确认该问题是否与以下因素之一相关：
   - `gpt-5.4` 这个模型别名
   - `/responses` 兼容层实现
   - 特定请求形状
   - `www` 与 `cn2` 两个部署入口是否同时受影响

## 参考资料

- OpenAI Responses 迁移说明：<https://developers.openai.com/api/docs/guides/migrate-to-responses>
- OpenAI 文本生成说明：<https://developers.openai.com/api/docs/guides/text>
- SU8 Codex 接入说明：<https://doc.su8.codes/zh/integrations/codex-cli/>
