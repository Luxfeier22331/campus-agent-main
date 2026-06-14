# campus-chatkit-adapter

Internal ChatKit protocol adapter for `campus-web` Q&A.

This service translates ChatKit threads, items, actions, feedback, and stream
events to the `app-api` chat conversation contract. It does not generate
answers, own conversation truth, or call `execution-control` directly.

## Runtime

Required environment variables:

- `APP_API_INTERNAL_BASE_URL`
- `APP_API_INTERNAL_SHARED_SECRET`

Run locally:

```bash
uv run campus-chatkit-adapter
```

The service listens on `127.0.0.1:8765` by default. Missing required runtime
configuration fails closed instead of falling back to a local app-api URL.
