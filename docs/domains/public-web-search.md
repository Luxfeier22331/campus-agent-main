---
doc_type: index
truth_scope: execution
owner_boundary: domains/public-web-search
status: active
created: 2026-07-02
updated: 2026-07-03
---
# Public Web Search

This is the canonical human document for the `public_web_search` typed tool and
its online public official-web evidence boundary.

## Boundary

`public_web_search` exists to find bounded, browser-safe evidence from public
Central Minzu University official websites when governed internal knowledge is
missing, incomplete or likely stale.

In scope:

- public official website facts, guides and notices under `muc.edu.cn` and its
  subdomains
- HTTPS source URLs, titles and short snippets suitable for answer grounding
- online补缺 for public official pages that are not yet covered by the
  governed official-web ingestion/RAG data plane

Out of scope:

- private portals, authenticated systems and `my.muc.edu.cn`
- arbitrary public internet search outside MUC official-web hosts
- official-web ingestion, target admission, object storage writes, Qdrant
  indexing or accepted source-truth mutation
- raw page body extraction, raw provider response exposure or provider trace
  replay

## Tool

The only model-visible tool for this domain surface is `public_web_search`.
Provider names such as Perplexity, Brave, Google or OpenAI-compatible search
models are implementation details and must not become separate model-visible
tools.

The executable contract is owned by:

- `packages/contracts/schemas/public-web-tool-contracts.v1.schema.json`
- `configs/runtime/tools.v4.json`
- `configs/runtime/workflow-artifacts.v2.json`

This human document does not define new wire fields. It summarizes how the
tool should be understood and consumed.

## Provider Adapter

The long-term runtime shape is:

```text
public_web_search
  -> tool-internal search provider adapter
  -> canonical public_web_evidence projection
```

Provider configuration is split into explicit layers:

- tool id: `public_web_search`, the only model-visible search tool
- provider role: `public_web_search`, the provider-config role consumed by
  execution-control
- provider identity: the real admitted provider name, such as `perplexity`,
  `perplexity_compatible`, `openai`, `gemini` or `linux_do`
- transport adapter: the explicit wire contract, currently
  `perplexity_search`, `openai_responses_web_search`,
  `gemini_google_search` or `openai_chat_completions_web_search`
- browser projection: sanitized `public_web_evidence`

The first provider implementation is Perplexity Search API. Perplexity is a
provider identity, not the external contract. A compatible provider may reuse
the same `perplexity_search` transport only when explicitly admitted by the
provider inventory and runtime validation. Compatible providers must keep their
real provider identity; they must not be recorded as official Perplexity.

OpenAI Responses web search, Gemini Google Search grounding and Linux.do-hosted
OpenAI-compatible Chat Completions web search are admitted as candidate provider
transports under the same tool boundary. They must preserve the same
model-visible tool and canonical output projection. Whether a candidate becomes
the default serving config is decided by the public-web-search eval pipeline,
not by design-time preference.

The tool must not rely on a generic prompt profile that asks a model to behave
like a search API as the long-term default shape. A Chat Completions web-search
transport is admissible only when it exposes provider-side web-search citations
and is configured as `kind=search`. The tool also must not add provider fallback
chains, provider merge policy or model-selected provider routing unless a
dedicated owner document explicitly admits those behaviors.

## Provider Candidate Classes

Provider selection starts from the evidence contract, not from provider brand.
Candidate providers fall into three classes:

- ranked search API: returns structured ranked URL results that can be directly
  projected into `public_web_evidence`
- hosted web grounding: lets a model call a hosted search/grounding tool and
  returns citations or annotations that must be normalized into
  `public_web_evidence`
- SERP / site-search wrapper: returns search-engine result pages or site-search
  output that may be useful only if the ranked search and hosted grounding
  candidates fail eval

Ranked search APIs are the cleanest fit for this tool because the tool needs
bounded URL evidence, not a second answer-writing model. Hosted grounding can
still be evaluated when it preserves URL citations and passes the same source
policy. SERP wrappers are not first-choice serving candidates because they add
provider-specific ranking noise without improving the model-visible contract.

## Provider Candidate Matrix

Only the admitted rows may be configured as runtime provider profiles. Candidate
rows need an explicit adapter and validation change before serving.

| provider | class | status | domain control | output shape | notes |
| --- | --- | --- | --- | --- | --- |
| Perplexity Search API | ranked search API | admitted through `perplexity` + `perplexity_search` | `search_domain_filter` | ranked `results[]` with title, URL and snippet | first implementation shape |
| Perplexity-compatible Search API | ranked search API | admitted through `perplexity_compatible` + `perplexity_search` | must implement the same strict transport | same as `perplexity_search` | provider identity must remain `perplexity_compatible` |
| OpenAI Responses web search | hosted web grounding | admitted through `openai` + `openai_responses_web_search` | `allowed_domains` / `blocked_domains` on the Responses web search tool | citations / source annotations normalized by adapter | good domain-control candidate; not a separate model-visible tool |
| Gemini Google Search grounding | hosted web grounding | admitted through `gemini` + `gemini_google_search` | no accepted equivalent domain allowlist in current repo contract | `url_citation` annotations normalized by adapter | must rely on post-search source-policy validation and eval evidence |
| Linux.do Chat Completions web search | hosted web grounding | admitted through `linux_do` + `openai_chat_completions_web_search` | no accepted equivalent domain allowlist in current repo contract | Chat Completions `url_citation` annotations normalized by adapter | search profile is separate from Linux.do prompt profiles |
| Tavily Search | ranked search API | candidate only | `include_domains` / `exclude_domains` | ranked results with optional answer/content fields | promising adapter candidate if cost and quality beat admitted options |
| Exa Search | ranked search API | candidate only | `includeDomains` / `excludeDomains` | ranked results with optional contents/highlights | promising adapter candidate if official-web recall is strong |
| Claude Web Search | hosted web grounding | candidate only | must be reverified before adapter admission | cited model output | provider binding and cost are heavier for current tool scope |
| SerpAPI / DataForSEO / Google Programmable Search | SERP / site-search wrapper | candidate only | provider-specific | SERP or site-search result records | use only if first-tier candidates fail eval |

Official provider references used for this matrix:

- OpenAI Responses web search domain filtering:
  `https://developers.openai.com/api/docs/guides/tools-web-search#domain-filtering`
- OpenAI Chat Completions web search citations:
  `https://developers.openai.com/api/docs/guides/tools-web-search#output-and-citations`
- Perplexity Search API:
  `https://docs.perplexity.ai/api-reference/search-post`
- Tavily Search API:
  `https://docs.tavily.com/documentation/api-reference/endpoint/search`
- Exa Search API:
  `https://exa.ai/docs/reference/search`
- Gemini Google Search grounding:
  `https://ai.google.dev/gemini-api/docs/google-search`
- Claude Web Search:
  `https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool`

## Source Policy

Returned sources must be bounded public official-web URL evidence:

- URL uses `https`
- host is `muc.edu.cn` or a subdomain of `muc.edu.cn`
- host is not `my.muc.edu.cn`
- source carries title, URL and snippet
- raw provider response, raw HTML, raw page body and unrestricted source body
  remain forbidden

The browser-facing and model-facing surfaces consume sanitized projection only.
Provider-local identifiers, search ranking internals, request payloads and raw
response bodies are not source truth.

## Relationship To Official Web And RAG

Official-web ingestion remains the long-term data plane for accepted public
official-web source truth. `public_web_search` is an online补缺 tool, not a
replacement for ingestion, release gates or governed RAG.

Search results may support a single answer as public official-web evidence.
They do not automatically enter object storage, Qdrant, release manifests,
operator accepted source truth or merged documentation truth.

Repeated public-web-search hits for the same missing page should be treated as
a signal to improve official-web target admission and ingestion coverage in a
separate data-plane change.

## Failure Semantics

The tool fails closed when evidence cannot be proven.

Failure cases include:

- missing or inactive provider configuration
- provider authentication, quota, timeout or upstream error
- invalid provider response shape
- no source under the allowed public MUC official-web URL policy
- duplicated, empty or disallowed source fields

The tool must not convert unsupported provider text into an ungrounded answer.
It must surface a diagnosable failure outcome for the execution path instead.

## Eval And Smoke

Public-web-search agent eval is the first tool-specific slice of
`agent-tool-use`. It verifies routing, source policy, required source coverage
and source count through the sanitized `tool_trajectory.v1` contract.

The active deterministic scores are owned by
`packages/eval-langfuse/assets/registries/langfuse_score_registry.v1.json`;
the eval lane and projection boundary are owned by `../reference/eval.md`,
`../reference/eval-map.md` and `../contracts/tool-trajectory.md`.

Operational command details belong in runbooks; this document only owns the
tool boundary.

## Owner Documents

- Tool contract: `../contracts/README.md`
- Official-web source-channel architecture: `../architecture/domains/official-web/architecture.md`
- Provider inventory: `../environment/providers.md`
- Provider boundary decision:
  `../decisions/adr-0068-public-web-search-provider-boundary.md`
- Eval reference: `../reference/eval.md`
- Tool trajectory contract: `../contracts/tool-trajectory.md`
- Runtime smoke procedure: `../runbooks/execution-smoke.md`
