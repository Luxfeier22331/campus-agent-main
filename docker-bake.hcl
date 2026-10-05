variable "IMAGE_REVISION" {
  default = "local"
}

variable "NODE_VERSION" {
  default = "24.21.0"
}

variable "IMAGE_SOURCE" {
  default = "https://github.com/MUC-WIKI/campus-agent"
}

group "default" {
  targets = [
    "document-ocr",
    "agent-runtime",
    "campus-agent-schema",
    "campus-docs-index-publisher",
	"campus-rag-index-publisher",
    "notice-pipeline-worker",
    "execution-control",
    "campus-search-service",
    "model-config",
    "notice-artifacts-worker",
    "ops-web",
  ]
}

group "heavy" {
  targets = [
    "ops-web",
    "execution-control",
    "campus-search-service",
    "model-config",
  ]
}

group "standard" {
  targets = [
    "document-ocr",
    "agent-runtime",
    "campus-agent-schema",
    "campus-docs-index-publisher",
    "campus-rag-index-publisher",
    "notice-pipeline-worker",
    "notice-artifacts-worker",
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

target "campus-agent-schema" {
  inherits   = ["_common"]
  dockerfile = "jobs/campus-agent-schema/Dockerfile"
}

target "campus-docs-index-publisher" {
  inherits   = ["_common"]
  dockerfile = "jobs/campus-docs-index-publisher/Dockerfile"
}

target "campus-rag-index-publisher" {
  inherits   = ["_common"]
  dockerfile = "jobs/campus-rag-index-publisher/Dockerfile"
}

target "execution-control" {
  inherits   = ["_common"]
  dockerfile = "apps/execution-control/Dockerfile"
}

target "model-config" {
  inherits   = ["_common"]
  dockerfile = "apps/model-config/Dockerfile"
}

target "ops-web" {
  inherits   = ["_common"]
  dockerfile = "apps/ops-web/Dockerfile"
}

target "document-ocr" {
  inherits = ["_common"]
  dockerfile = "jobs/document-ocr/Dockerfile"
}

target "notice-pipeline-worker" {
  inherits = ["_common"]
  dockerfile = "apps/notice-pipeline-worker/Dockerfile"
}

target "notice-artifacts-worker" {
  inherits = ["_common"]
  dockerfile = "apps/notice-artifacts-worker/Dockerfile"
}

target "campus-search-service" {
  inherits = ["_common"]
  dockerfile = "apps/campus-search/Dockerfile"
}
