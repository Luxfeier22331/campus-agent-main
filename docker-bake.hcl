variable "IMAGE_REVISION" {
  default = "local"
}

variable "IMAGE_SOURCE" {
  default = "https://github.com/MUC-WIKI/campus-agent"
}

group "default" {
  targets = [
    "agent-runtime",
    "app-api-schema",
    "dining-sync",
    "execution-control",
    "ingestion-control",
    "ingestion-control-worker",
    "ops-web",
    "source-collector",
  ]
}

target "_common" {
  context   = "."
  platforms = ["linux/arm64"]
  attest    = ["type=sbom"]
  labels = {
    "org.opencontainers.image.revision" = IMAGE_REVISION
    "org.opencontainers.image.source"   = IMAGE_SOURCE
  }
}

target "agent-runtime" {
  inherits   = ["_common"]
  dockerfile = "apps/agent-runtime/Dockerfile"
}

target "app-api-schema" {
  inherits   = ["_common"]
  dockerfile = "jobs/app-api-schema/Dockerfile"
}

target "dining-sync" {
  inherits   = ["_common"]
  dockerfile = "jobs/dining-sync/Dockerfile"
}

target "execution-control" {
  inherits   = ["_common"]
  dockerfile = "apps/execution-control/Dockerfile"
}

target "ingestion-control" {
  inherits   = ["_common"]
  dockerfile = "apps/ingestion-control/Dockerfile"
  target     = "api"
}

target "ingestion-control-worker" {
  inherits   = ["_common"]
  dockerfile = "apps/ingestion-control/Dockerfile"
  target     = "worker"
}

target "ops-web" {
  inherits   = ["_common"]
  dockerfile = "apps/ops-web/Dockerfile"
}

target "source-collector" {
  inherits   = ["_common"]
  dockerfile = "apps/source-collector/Dockerfile"
  target     = "runtime"
}
