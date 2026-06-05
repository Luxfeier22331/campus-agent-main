# Phase H: LibreOffice Conversion Runtime Productization - Pattern Map

**Mapped:** 2026-04-20
**Files analyzed:** 10
**Analogs found:** 9 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/ingestion-core/src/campus_ingestion_core/legacy_office_conversion_client.py`（likely new） | service | request-response | `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer.py` | role-match |
| `packages/ingestion-core/src/campus_ingestion_core/file_asset_legacy_office.py` | service | transform | `packages/ingestion-core/src/campus_ingestion_core/file_asset_legacy_office.py` | exact |
| `apps/ingestion-worker/src/campus_ingestion_worker/normalize_authenticated_notice_legacy_office_attachment.py` | utility | batch | `apps/ingestion-worker/src/campus_ingestion_worker/normalize_authenticated_notice_legacy_office_attachment.py` | exact |
| `apps/ingestion-worker/README.md` | config | batch | `apps/ingestion-worker/README.md` | exact |
| `env/commands/legacy-office-conversion-service.env.example`（likely new） | config | request-response | `env/commands/official-web-handoff-consumer.env.example` | role-match |
| `docs/environment/README.md` | config | request-response | `docs/environment/README.md` | exact |
| `docs/architecture/system/file-asset-loader-architecture.md` | config | transform | `docs/architecture/system/file-asset-loader-architecture.md` | exact |
| `docs/runbooks/legacy-office-conversion-runtime.md`（likely new） | config | request-response | `docs/runbooks/staging-worker-deploy-runbook.md` | role-match |
| `tests/ingestion/test_file_asset_substrate.py` | test | transform | `tests/ingestion/test_file_asset_substrate.py` | exact |
| `tests/ingestion/test_normalize_authenticated_notice_legacy_office_attachment_worker.py` | test | batch | `tests/ingestion/test_normalize_authenticated_notice_legacy_office_attachment_worker.py` | exact |
| `tests/ingestion/test_legacy_office_conversion_client.py`（likely new） | test | request-response | `apps/app-api/test/supervisor-adapter.test.ts` | partial |

## Pattern Assignments

### `packages/ingestion-core/src/campus_ingestion_core/legacy_office_conversion_client.py`（likely new, service, request-response）

**Primary analog:** `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer.py`

**Why this is the closest match**

- 同为 Python internal HTTP seam。
- 已经有 `*_BASE_URL + *_INTERNAL_SHARED_SECRET` 组合。
- 已经把非 2xx / network error 明确映射成 repo-owned error，而不是吞掉。

**Env + auth pattern** (`official_web_handoff_consumer.py` lines 116-147, 893-900):

```python
class HttpOfficialWebExecutionStatusReporter:
    def __init__(self, *, base_url: str, internal_shared_secret: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._internal_shared_secret = internal_shared_secret

    def report(self, *, run_id: str, payload: dict[str, object]) -> None:
        request = urllib_request.Request(
            f"{self._base_url}/api/internal/official-web/runs/{run_id}/ingestion-execution",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "x-app-internal-auth": self._internal_shared_secret,
            },
            method="POST",
        )
```

```python
def _build_status_reporter_from_env() -> OfficialWebExecutionStatusReporter | None:
    base_url = os.getenv("INGESTION_WORKER_APP_API_BASE_URL", "").strip()
    shared_secret = os.getenv("INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET", "").strip()
    if not base_url or not shared_secret:
        return None
```

**Fail-close contract to copy** (`apps/app-api/src/modules/integration/supervisor.ts` lines 416-483):

```ts
const baseUrl = env.SUPERVISOR_API_BASE_URL?.trim();
const sharedSecret = env.SUPERVISOR_API_SHARED_SECRET?.trim();
if (!baseUrl || !sharedSecret) {
  throw new SupervisorTransportError({
    code: "dependency_not_ready",
    message: "Supervisor runtime is not configured.",
    retryable: true,
    status: 503,
  });
}
```

```ts
const headers = new Headers({
  "content-type": "application/json",
  "x-trace-id": payload.traceId,
  "x-worker-origin-auth": sharedSecret,
});
```

**Phase H copy rule**

- 用 `LEGACY_OFFICE_CONVERSION_BASE_URL`、`LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET`、`LEGACY_OFFICE_CONVERSION_TIMEOUT_SECONDS` 复用同一 naming shape。
- client 只负责 bytes + metadata 请求，不持有 source-truth identity。
- service error、timeout、invalid response 全部 fail-close。
- 禁止 service 失败后 silent fallback 到本机 `soffice`。

---

### `packages/ingestion-core/src/campus_ingestion_core/file_asset_legacy_office.py`（service, transform）

**Primary analog:** 继续复用当前文件自身的 outcome / provenance shape；只替换 conversion transport。

**Validation + normalization payload pattern** (`file_asset_legacy_office.py` lines 62-154):

```python
source_extension = input_path.suffix.lower()
normalized_extension = {
    ".doc": ".docx",
    ".xls": ".xlsx",
}.get(source_extension)
if normalized_extension is None:
    raise ValueError("legacy Office normalizer only accepts .doc or .xls inputs")
if not input_path.is_file():
    raise FileNotFoundError(f"legacy Office input not found: {input_path}")
```

```python
return LegacyOfficeNormalizationResult(
    descriptor=FileAssetDescriptor(
        asset_family="legacy_binary_office",
        filename=input_path.name,
        media_type=source_mime_type,
        source_object_key=source_object_key,
        source_sha256=actual_source_sha256,
    ),
    provenance=ArtifactProvenance(
        engine_name="libreoffice-soffice",
        engine_version=engine_version,
    ),
    normalized_extension=normalized_extension,
    normalized_sha256=hashlib.sha256(normalized_bytes).hexdigest(),
    artifact_refs=(
        (
            FileAssetArtifactRef(
                role="normalized_object",
                object_key=normalized_object_key,
                media_type=normalized_media_type,
            ),
        )
        if normalized_object_key is not None
        else ()
    ),
)
```

**Provenance-preserving extraction pattern** (`file_asset_legacy_office.py` lines 160-243):

```python
warnings = tuple(
    dict.fromkeys(
        (
            "normalized_via_legacy_office_conversion",
            *normalized_result.provenance.warnings,
            *normalized_extraction.provenance.warnings,
        )
    )
)
```

```python
provenance=ArtifactProvenance(
    engine_name=(
        f"{normalized_result.provenance.engine_name}"
        f"+{normalized_extraction.provenance.engine_name}"
    ),
    engine_version=";".join(
        part
        for part in (
            normalized_result.provenance.engine_version,
            normalized_extraction.provenance.engine_version,
        )
        if part
    ),
    warnings=warnings,
),
artifact_refs=tuple(
    (*normalized_result.artifact_refs, *normalized_extraction.artifact_refs)
),
```

**Phase H copy rule**

- request 改成 HTTP service 后，`descriptor`、`ArtifactProvenance`、`artifact_refs`、`normalized_sha256`、`extraction_strategy` 保持不变。
- `docx/xlsx` 继续只是 normalization artifact。
- 任何 transport 层失败都必须转成 repo-owned failure，不要污染 provenance 结构。

---

### `apps/ingestion-worker/src/campus_ingestion_worker/normalize_authenticated_notice_legacy_office_attachment.py`（utility, batch）

**Primary analog:** 当前文件自身；如需新增 Phase H smoke / probe shell，再参考 `process_raw_ingestion_job.py`。

**Thin runtime shell pattern** (`normalize_authenticated_notice_legacy_office_attachment.py` lines 18-69):

```python
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Normalize a legacy authenticated notice Office attachment into an OOXML artifact."
    )
    parser.add_argument("--input-path", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--source-object-key")
    parser.add_argument("--source-sha256")
    parser.add_argument("--source-mime-type")
    parser.add_argument("--normalized-object-key")
    return parser
```

```python
def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    result = normalize_authenticated_notice_legacy_office_attachment(
        input_path=Path(args.input_path),
        output_dir=Path(args.output_dir),
        source_object_key=(str(args.source_object_key).strip() or None)
        if args.source_object_key is not None
        else None,
    )
    print(json.dumps(serialize_file_asset_outcome(result), ensure_ascii=False, indent=2))
```

**Generic worker CLI shape** (`process_raw_ingestion_job.py` lines 19-47):

```python
def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = process_raw_ingestion_job(
        request=RawIngestionRequest(
            raw_asset_id=args.raw_asset_id,
            raw_version_id=args.raw_version_id,
            corpus=args.corpus,
            collection=args.collection,
            artifact_mode=args.artifact_mode,
        )
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))
```

**Phase H copy rule**

- worker shell 继续只做 env bootstrap、CLI args、core call、JSON output。
- 不要把 HTTP client / retry / fallback 业务逻辑重新堆回 worker shell。

---

### `apps/ingestion-worker/README.md`（config, batch）

**Primary analog:** 当前 `official_web` seam 文档段。

**Command contract pattern** (`apps/ingestion-worker/README.md` lines 43-89):

```md
- Exposes `POST /api/official-web/handoffs`
- Requires `Authorization: Bearer <token>`
- Exposes `GET /healthz` and `GET /readyz` for local seam checks
- `INGESTION_WORKER_APP_API_BASE_URL`
- `INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET`
```

**Phase H copy rule**

- README 要写清楚 command 名、required env、optional env、行为、health endpoints。
- 明确 service seam 是 internal，不是 public ingress。

---

### `env/commands/legacy-office-conversion-service.env.example`（likely new, config, request-response）

**Primary analog:** `env/commands/official-web-handoff-consumer.env.example`

**Example shape** (`official-web-handoff-consumer.env.example` lines 1-12):

```dotenv
INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_EXECUTION_ROOT_DIR=./var/official-web-handoff-executions
INGESTION_WORKER_APP_API_BASE_URL=http://127.0.0.1:8787
INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET=replace-with-app-api-internal-secret
```

**Phase H copy rule**

- 只放 Phase H command-scoped override，不复制 shared object-store / DB secrets。
- 用 `replace-with-...` 占位，不写假真值。
- worker-side env example 与 service-side env example 分开，不要混成一个 kitchen-sink 文件。

---

### `docs/environment/README.md`（config, request-response）

**Primary analog:** 当前 ingestion-worker -> app-api seam 约束。

**Ownership / same-secret rule** (`docs/environment/README.md` lines 223-228):

```md
- `campus-ingestion-consume-official-web-handoffs` 如需回写 app-owned execution status，
  `INGESTION_WORKER_APP_API_BASE_URL` 应指向 shared `apps/app-api`，
  `INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET` 必须与 `APP_API_INTERNAL_SHARED_SECRET` 保持同值
```

**Service env naming style** (`apps/app-api/.dev.vars.example` lines 19-28):

```dotenv
SUPERVISOR_API_BASE_URL=https://supervisor.internal
SUPERVISOR_API_SHARED_SECRET=replace-with-supervisor-shared-secret
SUPERVISOR_API_TIMEOUT_MS=8000
APP_API_INTERNAL_SHARED_SECRET=replace-with-panel-bridge-secret
```

**Phase H copy rule**

- `LEGACY_OFFICE_CONVERSION_BASE_URL` 指向 internal service。
- `LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET` 必须与 service 端对应 secret 同值。
- timeout 单独列出，不要把 URL 是否存在当成 timeout 开关。

---

### `docs/architecture/system/file-asset-loader-architecture.md`（config, transform）

**Primary analog:** 当前 LibreOffice canonical truth 段。

**Canonical boundary text** (`file-asset-loader-architecture.md` lines 182-204):

```md
- internal self-hosted conversion service
- `JODConverter + LibreOffice` 作为首个自部署实现
- 在业务 worker 里每次直接拉起 `soffice --convert-to` 作为长期生产形态
- 由 legacy binary Office conversion 生成的 `docx/xlsx` 只是 normalization artifact，不是新的 source truth
```

**Phase H copy rule**

- 所有代码 / env / runbook / test 文案都必须回到这段 canonical truth。
- 不要把 “本机装了 soffice” 写成 phase closeout。

---

### `docs/runbooks/legacy-office-conversion-runtime.md`（likely new, config, request-response）

**Primary analog:** `docs/runbooks/dev-backed-supervisor-staging-smoke-runbook.md` + `docs/runbooks/staging-worker-deploy-runbook.md`

**Health check wording pattern** (`dev-backed-supervisor-staging-smoke-runbook.md` lines 77-84):

```bash
curl -sS -i http://127.0.0.1:8081/healthz
curl -sS -i http://127.0.0.1:8081/readyz
```

```md
- `healthz = 200`
- `readyz = 200`
```

**Exit criteria pattern** (`staging-worker-deploy-runbook.md` lines 338-397;
hostname examples updated to the current `mucwiki-edge.link` staging family):

```md
- `https://api-staging.mucwiki-edge.link/healthz`
- `https://api-staging.mucwiki-edge.link/readyz`
- 三个 Worker 已成功 deploy 到 staging
- 三个 `/readyz` 均为 ready
```

**Phase H copy rule**

- runbook 至少要给出本地 / deploy 后两组 `healthz`、`readyz` 检查命令。
- `readyz` 必须代表 JODConverter/LibreOffice manager 真可接任务，不只是进程活着。
- closeout evidence 要写明真实 `.doc/.xls` 资产通过 service seam。

---

### `tests/ingestion/test_file_asset_substrate.py`（test, transform）

**Primary analog:** 当前 legacy-office substrate tests。

**Normalization contract assertions** (`test_file_asset_substrate.py` lines 360-439):

```python
result = normalize_legacy_office_asset(
    input_path=input_path,
    output_dir=output_dir,
    source_object_key="attachments/example/legacy-score-sheet.xls",
    source_mime_type="application/vnd.ms-excel",
    normalized_object_key="campus_notices/operations/normalized/legacy-score-sheet.xlsx",
)
self.assertEqual(result.normalized_extension, ".xlsx")
self.assertEqual(result.descriptor.asset_family, "legacy_binary_office")
self.assertEqual(result.artifact_refs[0].role, "normalized_object")
self.assertEqual(result.provenance.engine_name, "libreoffice-soffice")
```

**Extraction provenance assertions** (`test_file_asset_substrate.py` lines 441-496):

```python
result = extract_legacy_office_text_blocks(
    b"legacy-xls-binary",
    filename="legacy-score-sheet.xls",
    media_type="application/vnd.ms-excel",
    source_object_key="attachments/example/legacy-score-sheet.xls",
)
self.assertEqual(
    result.provenance.engine_name,
    "libreoffice-soffice+spreadsheetml-zip-xml",
)
self.assertIn("normalized_via_legacy_office_conversion", result.provenance.warnings)
```

**Phase H copy rule**

- transport 换成 service 后，这组断言应继续成立。
- 新增的只是 client / timeout / response validation 断言，不是重写 provenance 断言。

---

### `tests/ingestion/test_normalize_authenticated_notice_legacy_office_attachment_worker.py`（test, batch）

**Primary analog:** 当前 worker shell tests。

**CLI plumbing pattern** (`test_normalize_authenticated_notice_legacy_office_attachment_worker.py` lines 20-102):

```python
with (
    patch(
        "campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment.load_worker_env"
    ),
    patch(
        "campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment.normalize_authenticated_notice_legacy_office_attachment"
    ) as normalize,
    patch("sys.stdout", new_callable=io.StringIO) as stdout,
):
    worker.main(
        [
            "--input-path",
            "/tmp/legacy.doc",
            "--output-dir",
            "/tmp/out",
            "--source-object-key",
            "attachments/example/legacy.doc",
        ]
    )
```

```python
payload = json.loads(stdout.getvalue())
self.assertEqual(payload["outcome_type"], "normalization")
self.assertEqual(payload["normalized_extension"], ".docx")
```

**Dependency fail-close pattern** (`test_normalize_authenticated_notice_legacy_office_attachment_worker.py` lines 120-190):

```python
with patch(
    "campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment.shutil.which",
    return_value=None,
):
    with self.assertRaisesRegex(
        RuntimeError,
        "LibreOffice soffice is required",
    ):
        worker.normalize_authenticated_notice_legacy_office_attachment(
            input_path=input_path,
            output_dir=output_dir,
        )
```

**Phase H copy rule**

- 如果 worker shell 改为走 HTTP client，这里要把 missing local `soffice` 断言替换成 missing env / client failure / non-2xx fail-close。
- CLI output shape 继续走 canonical `serialize_file_asset_outcome(...)`。

---

### `tests/ingestion/test_legacy_office_conversion_client.py`（likely new, test, request-response）

**Primary analog A:** `apps/app-api/test/supervisor-adapter.test.ts`

**Request header + body assertions** (`supervisor-adapter.test.ts` lines 82-121):

```ts
expect(fetchImplementation).toHaveBeenCalledWith(
  "https://supervisor.internal/api/v1/answer",
  expect.objectContaining({
    headers: {
      "content-type": "application/json",
      "x-trace-id": "trace_01HQ",
      "x-worker-origin-auth": "shared-secret",
    },
    method: "POST",
  }),
);
```

**Timeout / non-2xx fail-close assertions** (`supervisor-adapter.test.ts` lines 549-606):

```ts
await expect(
  client.execute({
    actor: createActor(),
    context: createContext(),
    conversationId: "conv_01HQ",
    requestId: "req_01HQ",
    traceId: "trace_01HQ",
    userGoal: "图书馆开放到几点？",
  }),
).rejects.toBeInstanceOf(SupervisorTransportError);

await expect(pending).rejects.toMatchObject({
  code: "execution_timeout",
  retryable: true,
  status: 504,
});
```

**Primary analog B:** `tests/ingestion/test_official_web_handoff_consumer.py`

**Injection-first fake dependency pattern** (`test_official_web_handoff_consumer.py` lines 254-366):

```python
class FakeExecutionStatusReporter:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def report(self, *, run_id: str, payload: dict[str, object]) -> None:
        self.calls.append({"run_id": run_id, "payload": dict(payload)})
```

```python
self.assertEqual(reporter.calls, [])
result = consume_handoff_record(
    record_path=record_path,
    settings=OfficialWebHandoffConsumerSettings(
        inbox_dir=inbox_dir,
        execution_root_dir=execution_root_dir,
        source_bucket="campus-rag-source",
    ),
    object_store=object_store,
    declarations_path=declarations_path,
    document_registry=document_registry,
    raw_asset_registry=raw_asset_registry,
    derived_object_store=object_store,
    status_reporter=reporter,
)
self.assertEqual([call["payload"]["status"] for call in reporter.calls], ["running", "staged"])
```

**Phase H copy rule**

- Python test里直接 patch HTTP transport，断言 URL、auth header、sha256 / format request body。
- 至少覆盖 4 类失败：
- missing `BASE_URL` / secret
- timeout
- HTTP 非 2xx
- success payload 缺 `normalized_bytes_b64` / hash / target format

## Shared Patterns

### Internal service env / auth

**Sources**

- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_consumer.py` lines 116-147, 893-900
- `docs/environment/README.md` lines 223-228
- `env/commands/official-web-handoff-consumer.env.example` lines 1-12
- `apps/app-api/.dev.vars.example` lines 19-28

**Apply to**

- `legacy_office_conversion_client.py`
- `docs/environment/README.md`
- `env/commands/legacy-office-conversion-service.env.example`

**Copy rule**

- 用 `*_BASE_URL` + `*_INTERNAL_SHARED_SECRET` + timeout 三件套。
- secret 同值约束写进 env docs，不只写进代码。

### `healthz` / `readyz`

**Sources**

- `apps/ingestion-worker/src/campus_ingestion_worker/official_web_handoff_receiver.py` lines 174-200
- `apps/app-api/test/worker.test.ts` lines 183-292
- `docs/runbooks/dev-backed-supervisor-staging-smoke-runbook.md` lines 77-84
- `docs/runbooks/staging-worker-deploy-runbook.md` lines 338-397

**Apply to**

- service contract docs
- runbook
- 任何 repo-local probe / smoke shell

**Copy rule**

- `healthz` 只证明进程活着。
- `readyz` 必须更严格，失败时返回 fail-close 语义。

### Provenance / artifact semantics

**Sources**

- `packages/ingestion-core/src/campus_ingestion_core/file_asset_legacy_office.py` lines 123-154, 204-243
- `docs/architecture/system/file-asset-loader-architecture.md` lines 182-204

**Apply to**

- `file_asset_legacy_office.py`
- substrate tests
- architecture / runbook wording

**Copy rule**

- raw source 始终保留。
- `docx/xlsx` 始终只是 normalized artifact。
- provenance 要组合 conversion engine 与 downstream OOXML extractor。

### Fail-close tests

**Sources**

- `tests/ingestion/test_file_asset_substrate.py` lines 360-496
- `tests/ingestion/test_normalize_authenticated_notice_legacy_office_attachment_worker.py` lines 20-190
- `apps/app-api/test/supervisor-adapter.test.ts` lines 82-121, 549-606

**Apply to**

- new client tests
- existing worker shell tests
- readiness / smoke verification

**Copy rule**

- 断言具体 error code / status / retryable。
- 不接受 silent fallback。

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/legacy-office-conversion-service/**`（only if Phase H decides to vendor repo-local service source） | service | request-response | repo 里没有现成的 self-hosted process-pool conversion service；现有类比只覆盖 client seam、health contract、env docs、runbook 和 fail-close tests。 |

## Metadata

**Analog search scope:** `packages/ingestion-core`, `apps/ingestion-worker`, `apps/app-api`, `env/commands`, `docs/environment`, `docs/architecture`, `docs/runbooks`, `tests/ingestion`
**Files scanned:** 23
**Pattern extraction date:** 2026-04-20
