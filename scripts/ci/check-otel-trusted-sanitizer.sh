#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
config="${1:-$repo_root/infra/otel/collector-staging-template.yaml}"

if [[ $# -gt 1 || ! -f "$config" || -L "$config" ]]; then
  echo "Usage: $0 [collector-staging-template.yaml]" >&2
  exit 2
fi

if [[ "$(rg -c '^[[:space:]]*transform/trusted_credentials:[[:space:]]*$' "$config" || true)" != 1 ]]; then
  echo "Collector template must define exactly one trusted credential sanitizer." >&2
  exit 1
fi

sanitizer="$({
  awk '
    /^[[:space:]]*transform\/trusted_credentials:[[:space:]]*$/ {
      found = 1
      match($0, /[^[:space:]]/)
      indent = RSTART - 1
      print substr($0, indent + 1)
      next
    }
    found {
      if ($0 ~ /^[[:space:]]*$/) {
        print ""
        next
      }
      match($0, /[^[:space:]]/)
      if (RSTART - 1 <= indent) {
        exit
      }
      print substr($0, indent + 1)
    }
    END {
      if (!found) {
        exit 1
      }
    }
  ' "$config"
})" || {
  echo "Failed to read the trusted credential sanitizer." >&2
  exit 1
}

expected=$(cat <<'EOF'
transform/trusted_credentials:
  error_mode: propagate
  trace_statements:
    - 'delete_matching_keys(span.attributes, "(?i)(authorization|cookie|credential|jwt|password|secret|api[._-]?key|access[._-]?token|refresh[._-]?token|observability[._-]?canary|(^|[._-])headers?([._-]|$))")'
    - 'delete_matching_keys(resource.attributes, "(?i)(authorization|cookie|credential|jwt|password|secret|api[._-]?key|access[._-]?token|refresh[._-]?token|observability[._-]?canary|(^|[._-])headers?([._-]|$))")'
    - 'delete_matching_keys(instrumentation_scope.attributes, "(?i)(authorization|cookie|credential|jwt|password|secret|api[._-]?key|access[._-]?token|refresh[._-]?token|observability[._-]?canary|(^|[._-])headers?([._-]|$))")'
EOF
)

if [[ "$sanitizer" != "$expected" ]]; then
  echo "Collector trusted sanitizer does not match the credential-only contract." >&2
  diff -u <(printf '%s\n' "$expected") <(printf '%s\n' "$sanitizer") >&2 || true
  exit 1
fi

rg -Fq \
  'processors: [memory_limiter, resource/campus, filter/drop_marked, transform/trusted_credentials, batch]' \
  "$config" || {
  echo "Agent runtime Langfuse pipeline is missing the trusted sanitizer." >&2
  exit 1
}
rg -Fq \
  'processors: [memory_limiter, resource/campus, filter/drop_marked, transform/trusted_credentials, transform/hindsight_langfuse, batch]' \
  "$config" || {
  echo "Hindsight Langfuse pipeline is missing the trusted sanitizer before enrichment." >&2
  exit 1
}

if rg -q 'OTEL_COLLECTOR_(AXIOM|LANGFUSE)_AUTH_HEADER' "$config"; then
  echo "Collector template must consume canonical credentials instead of prebuilt auth headers." >&2
  exit 1
fi

rg -Fq 'basicauth/langfuse:' "$config" || {
  echo "Collector template must derive Langfuse Basic auth with the basicauth extension." >&2
  exit 1
}
