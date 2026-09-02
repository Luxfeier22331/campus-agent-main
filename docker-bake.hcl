variable "IMAGE_REVISION" {
  default = "local"
}

variable "NODE_VERSION" {
  default = "24.19.0"
}

variable "IMAGE_SOURCE" {
  default = "https://github.com/MUC-WIKI/campus-agent"
}

group "default" {
  targets = [
    "agent-runtime",
    "campus-agent-schema",
    "campus-docs-index-publisher",
    "execution-control",
    "model-config",
    "notice-classifier",
    "notice-publisher",
    "ops-web",
    "internal-portal-collection",
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

# Historical-only target. It remains addressable for legacy database upgrade work, but is not part
# of the default or candidate release set.
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

target "model-config" {
  inherits   = ["_common"]
  dockerfile = "apps/model-config/Dockerfile"
}

target "notice-classifier" {
  inherits   = ["_common"]
  dockerfile = "jobs/notice-classifier/Dockerfile"
}

target "notice-publisher" {
  inherits   = ["_common"]
  dockerfile = "jobs/notice-publisher/Dockerfile"
}

target "ops-web" {
  inherits   = ["_common"]
  dockerfile = "apps/ops-web/Dockerfile"
}

target "internal-portal-collection" {
  inherits   = ["_common"]
  dockerfile = "jobs/internal-portal-collection/Dockerfile"
  target     = "runtime"
}
