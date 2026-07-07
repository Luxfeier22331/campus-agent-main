---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0068
status: accepted
created: 2026-07-02
updated: 2026-07-03
---
# ADR-0068: Public Web Search Provider Boundary

## Context

`public_web_search` is the model-visible tool for bounded public official-web
evidence. The first implementation used the Perplexity Search API shape and
the `perplexity_search` transport. That left an ambiguity: the transport wire
contract was treated as if it implied exactly one provider identity.

This blocks admitted third-party PPLX-compatible providers even when they
implement the same strict `/search` wire contract, and it encourages the bad
workaround of recording a compatible provider as official `perplexity`.

The same boundary also needs to admit GPT/OpenAI Responses web search, Gemini
Google Search grounding and Linux.do-hosted OpenAI-compatible Chat Completions
web search as real candidates. Their adoption should be decided by the eval
pipeline against the same source-policy and answer-quality contract, not by
design-time preference.

## Decision

Keep `public_web_search` as the only model-visible capability and make search
providers tool-internal.

- Provider-config role remains `public_web_search`.
- Provider identity is the real configured provider, currently admitted as
  `perplexity`, `perplexity_compatible`, `openai`, `gemini` or `linux_do`.
- Transport adapter is the wire contract, currently `perplexity_search`,
  `openai_responses_web_search`, `gemini_google_search` or
  `openai_chat_completions_web_search`.
- Compatible providers may reuse `perplexity_search` only when they pass the
  same validation and sanitized source projection.
- OpenAI, Gemini and Linux.do search profiles must use their own explicit
  transports; they must not be recorded as `perplexity_compatible`.
- Linux.do prompt roles and Linux.do search roles are separate provider
  profiles. A `public_web_search` Linux.do profile must be `kind=search`; it
  must not be configured as a generic prompt `chat_completions` profile.
- Runtime projection and tool output preserve the real provider identity.
- Runtime defaults are not chosen by this ADR. The public-web-search eval
  pipeline decides which admitted provider profile should be used for serving.

Do not add provider-specific model-visible tools such as `perplexity_search` or
`gpt_search`. Do not expose a browser-facing general search API. Do not add
fallback chains, provider auto-detection, result merging or model-selected
provider routing.

## Consequences

- App-api provider-config admission must validate provider identity and
  transport independently.
- Execution-control must select the transport adapter from `transport`, while
  preserving `provider` as identity in diagnostics and sanitized results.
- A provider that does not implement the admitted wire contract needs a new
  explicit transport adapter decision; it cannot be configured through
  `perplexity_compatible`.
- GPT/OpenAI and Gemini can be evaluated under the same tool without adding new
  model-visible tools or frontend contract variants.
- Search results remain online evidence for one answer. They do not mutate
  official-web source truth, object storage, Qdrant or release manifests.
