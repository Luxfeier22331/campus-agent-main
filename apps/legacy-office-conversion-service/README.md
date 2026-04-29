# legacy-office-conversion-service

Self-hosted `JODConverter + LibreOffice` runtime for legacy Office conversion.

Canonical routes:

- `POST /api/internal/legacy-office/conversions`
- `GET /healthz`
- `GET /readyz`

Required env:

- `LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET`

Optional env:

- `LIBREOFFICE_SERVICE_BIND`
- `LIBREOFFICE_SERVICE_TASK_TIMEOUT_MS`
- `LIBREOFFICE_SERVICE_QUEUE_TIMEOUT_MS`
- `LIBREOFFICE_SERVICE_MAX_TASKS_PER_PROCESS`
- `LIBREOFFICE_SERVICE_WORKDIR`
- `LIBREOFFICE_HOME`

Local build/test via Docker:

```bash
pnpm java:lint
docker build -f apps/legacy-office-conversion-service/Dockerfile --target lint \
  -t campus-legacy-office-conversion:lint .
docker build -f apps/legacy-office-conversion-service/Dockerfile --target \
  unit-tests -t campus-legacy-office-conversion:test .
docker compose --env-file .env \
  -f infra/local/docker-compose.legacy-office-conversion.yml up -d --build
```

Docker targets:

- `lint`
  - 运行 `spotless:check`，用于 Java source lint
- `unit-tests`
  - 运行 Maven 单测
- `package`
  - 产出运行时 jar
