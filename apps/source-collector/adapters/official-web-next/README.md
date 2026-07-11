# official-web-next

Isolated reference implementation for the redesigned official-web source
adapter.

This adapter intentionally does not connect to `ingestion-control`, Temporal,
app-api, database projections, target admission files or Qdrant. It accepts an
explicit workset, writes source-bucket-shaped artifacts, then builds unpublished
reference document/chunk artifacts from that captured source truth.

Current scope:

- `CheerioCrawler` HTML capture for explicit workset URLs.
- source truth artifacts under `official_web_next/<site_id>/source-assets/...`.
- run artifacts under `official_web_next/<site_id>/runs/<run_id>/...`.
- reference document units, chunks and candidate release manifest.
- local filesystem artifact store for harness runs.

Boundary:

- The workset is the only crawl admission input.
- The adapter is allowed to build unpublished reference document/chunk artifacts
  only to prove source-truth shape and extraction quality.
- Calendar, notice, regulation, curriculum and stable-reference target
  ownership stays outside this adapter.
- Candidate release manifests are proof artifacts only; they do not publish a
  serving alias or current pointer.

Deliberate non-scope:

- no `consumer-denominator`, `target-source-map`, `projection-declarations` or
  `target-inventory` consumption
- no selected write, materialization policy, release publish or alias switch
- no `renderMode: "browser"` until a Playwright capture path is added

Local harness:

```bash
pnpm --dir apps/source-collector exec tsx \
  adapters/official-web-next/src/cli.ts \
  --site-id muc_public \
  --run-id ow-next-run-local \
  --release-id candidate-release-local \
  --workset /path/to/workset.json \
  --artifact-root /tmp/official-web-next-artifacts \
  --ignore-robots
```

`workset.json` is a JSON array:

```json
[
  {
    "url": "https://www.example.edu/",
    "host": "www.example.edu",
    "discoveryMethod": "seed",
    "renderMode": "html"
  }
]
```
