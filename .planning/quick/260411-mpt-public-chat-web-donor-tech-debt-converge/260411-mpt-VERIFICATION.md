# 260411-mpt Verification

## Database / Runtime Repair

- `pnpm --dir apps/app-api db:bootstrap`
  - exit `0`
  - reapplied shared-product chat bootstrap migrations including `0004_chat_message_structured_parts.sql`
- `curl -sf http://127.0.0.1:8081/readyz`
  - exit `0`
- `curl -sf http://127.0.0.1:5173/readyz`
  - exit `0`

## Wave 5 Fixed Gates

- `pnpm --dir apps/public-chat-web typecheck`
  - exit `0`
- `pnpm --dir apps/public-chat-web exec vitest run test/public-chat-router-cutover.test.ts test/chatbot-vendor-runtime-parity.test.ts test/public-chat-donor-diff-whitelist.test.ts test/public-chat-donor-diff-classification.test.ts`
  - exit `0`
  - `4` files passed, `29` tests passed
- `pnpm --dir apps/public-chat-web test:worker`
  - exit `0`
  - `22` files passed, `84` tests passed
- `pnpm --dir apps/public-chat-web build`
  - exit `0`
  - build completed; Vite emitted chunk-size warnings only

## Browser Smoke

Evidence root:

- [20260411T163903+0800-public-chat-wave5-closeout](/home/reptilian/code/campus-agent/.tmp/local-smoke/20260411T163903+0800-public-chat-wave5-closeout)

Observed flow:

- `/login` loaded and accepted smoke identity sign-in
- `/chat` empty state rendered
- first send created `conversationId=f2803d0b-b3f5-461c-8c75-34d9fb392646`
- request ledger recorded `requestId=req_c308e702a9694ed5a428f31c2664562a`
- request ledger recorded `traceId=trace_e8caf18bc120450f8a5c5c32d38d5304`
- same-site `POST /api/chat/requests` returned `200`
- sidebar updated with the new conversation without manual reload
- page reload preserved the same `conversationId` and sidebar history row

Typed outcome:

- handled upstream timeout: `Supervisor execution exceeded 8000ms timeout.`

Non-blocking notes:

- pre-login `GET /api/me` `401` responses are expected before session establishment
- the evidence pack still contains the earlier failed attempt in the raw network log because the browser session was reused; the authoritative post-repair facts are the later `POST /api/chat/requests => [200]` entry plus the stored conversation/request rows in local Postgres
