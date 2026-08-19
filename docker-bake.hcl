variable "IMAGE_REVISION" {
  default = "local"
}

variable "NODE_VERSION" {}

variable "IMAGE_SOURCE" {
  default = "https://github.com/MUC-WIKI/campus-agent"
}

group "default" {
  targets = [
    "agent-runtime",
    "app-api-schema",
    "campus-docs-index-publisher",
    "execution-control",
    "ingestion-control",
    "notice-classifier",
    "ops-web",
    "source-collector",
  ]
}

target "_common" {
  context   = "."
  platforms = ["linux/arm64"]
  attest    = ["type=sbom"]
  args = {
    NODE_VERSION = NODE_VERSION
  }
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

target "campus-docs-index-publisher" {
  inherits   = ["_common"]
  dockerfile = "jobs/campus-docs-index-publisher/Dockerfile"
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

target "notice-classifier" {
  inherits   = ["_common"]
  dockerfile = "jobs/notice-classifier/Dockerfile"
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
