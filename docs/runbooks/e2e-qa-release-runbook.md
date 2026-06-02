---
doc_type: runbook
status: active
created: 2026-06-03
updated: 2026-06-03
---
# E2E QA Release Runbook

## 文档边界

本文是上线前 E2E QA 总入口。它串联当前已经存在的 staging、chat、docs、panel 与 observability
runbook，不重复维护每个子流程的全部细节。

本文只用于真实 staging release closeout。它不替代：

- repo unit / typecheck / build gate
- `docs/runbooks/staging-worker-deploy-runbook.md`
- `docs/runbooks/supervisor-api-staging-smoke-runbook.md`
- `docs/runbooks/worker-observability-smoke-runbook.md`

当前默认目标环境是 `mucwiki-edge.link` staging。`hub.muc.wiki` 不属于本文的当前 gate。

## Evidence Directory

每轮 E2E QA 必须先创建独立 evidence 目录：

```bash
export E2E_QA_EVIDENCE_DIR="var/staging-evidence/$(date -u +%Y%m%dT%H%M%SZ)-e2e-qa-release"
mkdir -p "$E2E_QA_EVIDENCE_DIR"
git status --short --branch > "$E2E_QA_EVIDENCE_DIR/git-status.txt"
git rev-parse HEAD > "$E2E_QA_EVIDENCE_DIR/git-head.txt"
```

建议复制模板作为本轮 summary：

```bash
cp docs/runbooks/templates/e2e-qa-release-artifact-template.md \
  "$E2E_QA_EVIDENCE_DIR/SUMMARY.md"
```

## 1. Repo Preflight

先运行不依赖真实 staging 的仓库验证：

```bash
pnpm docs:lint | tee "$E2E_QA_EVIDENCE_DIR/docs-lint.txt"
pnpm decomposition:lint | tee "$E2E_QA_EVIDENCE_DIR/decomposition-lint.txt"
git diff --check | tee "$E2E_QA_EVIDENCE_DIR/git-diff-check.txt"
```

如果本轮包含代码改动，还必须按 `docs/reference/testing-and-verification-lanes.md`
选择对应 unit/typecheck/build lane。文档-only release 不用把全量 runtime tests 伪装成必要 gate。

## 2. Staging Runtime Readiness

先确认 supervisor staging runtime：

```bash
ssh deploy@152.53.241.57 \
  'cd /srv/apps/campus-agent && \
    ./infra/local/staging/status-supervisor-api-staging.sh --check' \
  | tee "$E2E_QA_EVIDENCE_DIR/supervisor-status.txt"
```

通过标准：

- exit code 为 `0`
- 输出包含 strict check 通过信息
- 不出现 `host.docker.internal` 作为 Qdrant runtime URL
- 不出现固定 `172.*` 服务入口

## 3. Public Surface Health

检查当前 staging public surfaces：

```bash
for url in \
  https://api-staging.mucwiki-edge.link/healthz \
  https://api-staging.mucwiki-edge.link/readyz \
  https://hub-staging.mucwiki-edge.link/healthz \
  https://hub-staging.mucwiki-edge.link/readyz \
  https://chat-staging.mucwiki-edge.link/healthz \
  https://chat-staging.mucwiki-edge.link/readyz \
  https://docs-staging.mucwiki-edge.link/readyz \
  https://exec-staging.mucwiki-edge.link/healthz
do
  echo "## $url"
  curl --noproxy '*' -sS -i "$url"
done | tee "$E2E_QA_EVIDENCE_DIR/surface-health.txt"
```

通过标准：

- API、hub、chat、docs health / ready endpoints 返回预期 `200`
- exec `/healthz` 返回 `200`
- 不把 exec `/readyz` 当 public gate；它属于 internal runtime readiness

## 4. Chat E2E

运行真实 staging chat 链路：

```bash
pnpm --dir apps/app-api chat:e2e:staging \
  | tee "$E2E_QA_EVIDENCE_DIR/chat-default.json"

pnpm --dir apps/app-api chat:e2e:staging -- \
  --prompt "民族学本科人才培养方案总学分要求是多少？" \
  | tee "$E2E_QA_EVIDENCE_DIR/chat-curriculum-plan.json"

pnpm --dir apps/app-api chat:e2e:staging -- \
  --prompt "校园网密码怎么改？" \
  | tee "$E2E_QA_EVIDENCE_DIR/chat-alias-campus-network.json"

pnpm --dir apps/app-api chat:e2e:staging -- \
  --prompt "中央民族大学本科学生国家奖学金评审办法" \
  | tee "$E2E_QA_EVIDENCE_DIR/chat-student-rule.json"
```

通过标准：

- 每条命令 exit code 为 `0`
- `request.resultKind=answer`
- 输出包含 `requestId`、`traceId`、`conversationId`
- `historyHasConversation=true`

不接受：

- `retrieval_failed`
- `supervisor_unavailable`
- transport error
- Worker proxy error
- `--expect-result-kind any` 作为 release closeout 通过标准

如果链路成功但答案质量差，记录为 `non-blocking answer-quality badcase`，不要把 transport smoke 标绿为质量验收。

## 5. Docs Reader And Gated Docs

运行 repo-owned gated docs smoke：

```bash
pnpm --dir apps/app-api docs:gated:smoke:staging \
  | tee "$E2E_QA_EVIDENCE_DIR/docs-gated-smoke.json"
```

再抽样 docs surface：

```bash
curl --noproxy '*' -sS -i https://docs-staging.mucwiki-edge.link \
  | tee "$E2E_QA_EVIDENCE_DIR/docs-root.txt"
curl --noproxy '*' -sS -i https://docs-staging.mucwiki-edge.link/readyz \
  | tee "$E2E_QA_EVIDENCE_DIR/docs-readyz.txt"
```

通过标准：

- gated reader 匿名访问被拒绝
- 使用 staging smoke session 后 gated reader 可访问
- docs root 返回可渲染 HTML
- `/readyz` 返回 `200`
- reader asset URL 不包含 `localhost`、`127.0.0.1` 或本地 MinIO endpoint

## 6. Protected Panel And Access

运行 Access service-token smoke：

```bash
pnpm --dir apps/protected-panel-web access:smoke:staging \
  | tee "$E2E_QA_EVIDENCE_DIR/panel-access-service-token.json"
```

通过标准：

- 未认证 `/readyz` 返回 Cloudflare Access redirect
- service token 访问 `/healthz` 与 `/readyz` 返回 `200`
- service token 访问 `/api/overview` 返回 `401 Invalid Access JWT.`

该 smoke 只证明 Access envelope 可由 automation 到达，不代表 human operator identity。

## 7. Browser QA

人工或浏览器自动化至少检查：

- `https://hub-staging.mucwiki-edge.link`
  - launcher 可见
  - Chat / Docs / Panel 入口指向 staging host
  - 不出现 `ayafeed.com`、`localhost`、`127.0.0.1`
- `https://chat-staging.mucwiki-edge.link`
  - 使用 staging smoke identity 后 chat UI 可打开
  - conversations 列表能看到本轮 E2E 创建的新会话
  - 人工发送一条问题能返回 answer
- `https://docs-staging.mucwiki-edge.link`
  - 首页、分类、reader 页面可打开
  - gated 文档未授权不可读，授权后可读
- `https://panel-staging.mucwiki-edge.link`
  - 首次访问进入 Cloudflare Access
  - Access 登录后 panel shell 可加载
  - Overview、Requests、Eval Coverage 页面可打开

每个 surface 至少保存一份 screenshot 或可审计文字证据。console / network 明显错误必须记录。

## 8. Sentry And Axiom Verification

先确认 Sentry lookup token：

```bash
uv run --all-packages python -m scripts.check_sentry_lookup_access --json \
  | tee "$E2E_QA_EVIDENCE_DIR/sentry-lookup.json"
```

Sentry closeout 默认查询 Explore spans，不依赖 issue-list endpoint：

```bash
uv run --all-packages python -m scripts.query_sentry_spans \
  --org-slug linear27 \
  --project 4511351503454208 \
  --environment staging \
  --stats-period 3h \
  --query 'span.description:"POST /api/chat/requests"' \
  --markdown-output "$E2E_QA_EVIDENCE_DIR/sentry-chat-spans.md" \
  | tee "$E2E_QA_EVIDENCE_DIR/sentry-chat-spans.txt"
```

如果 Sentry issue-list endpoint 返回
`403 You do not have permission to perform this action.`，不要把它判为 staging
observability blocker。当前 closeout 以 spans evidence 或 Sentry UI 等价 trace
evidence 为准。

Axiom 使用 `campus-agent-runtime` dataset。查询窗口应覆盖本轮 chat /
projection drain 时间段，并保存：

- query/filter
- row count
- matched request id 或 trace id
- redaction note

## 9. Data Plane Sanity

只读检查远端容器与数据面：

```bash
ssh deploy@152.53.241.57 \
  'cd /srv/apps/campus-agent && \
    docker ps --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"' \
  | tee "$E2E_QA_EVIDENCE_DIR/remote-containers.txt"
```

检查项：

- Qdrant、Postgres、MinIO、supervisor runtime 容器健康
- Qdrant 端口只绑定 host loopback 或 Docker data-plane，不公网暴露
- query-enabled aliases 仍为当前 accepted surfaces
- runtime release manifest 可被 guard 读取
- Qdrant snapshot 不存入 staging R2

## Closeout Rules

E2E QA 通过必须同时满足：

- repo preflight 通过
- staging runtime strict check 通过
- public surfaces health / ready 通过
- chat E2E 覆盖 policy、curriculum、alias 用户问法与默认问法
- docs gated smoke 通过
- panel Access envelope smoke 通过
- browser QA 没有阻断性 console / network / auth 问题
- Sentry 有真实 staging span 或等价 trace evidence
- Axiom 有真实 runtime event evidence
- evidence 完整落盘到本轮目录

禁止通过标准：

- 使用 fallback、兜底、best-effort 或 silent recovery 把失败标绿
- 跳过 Access / auth / readyz 后宣称通过
- 使用 `--expect-result-kind any` 作为 release gate
- 把 Sentry DSN 存在误判为 sink-side verification 通过
- 把 service-token panel smoke 误判为 human operator 已授权

失败必须分类：

- `blocker`
- `non-blocking answer-quality badcase`
- `external credential/config blocker`
- `documentation drift`

不能用“待确认”代替失败原因。
