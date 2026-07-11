---
doc_type: policy
truth_scope: repository
owner_boundary: docs/policies
status: active
created: 2026-07-01
updated: 2026-07-10
---
# Public Source And Data Policy

## Boundary

This policy governs source, fixtures, config and data-like artifacts that are
tracked in the public repository.

It does not govern private content packs, object-store artifacts, production
databases or internal operator evidence.

## Allowed In Public Repo

- source code, schemas, validators, migrations and public docs
- synthetic fixtures that preserve behavior without source-derived content
- self-authored low-frequency product seeds when ownership is documented
- attribution-only metadata that does not copy restricted source content
- `.env.example` / `.dev.vars.example` templates with placeholders only
- namespace-neutral Kubernetes workload bases with placeholder deployment
  inputs

## Not Allowed In Public Repo

- secrets, tokens, passwords, database URLs or private object-store keys
- raw notices, source-derived documents, collected HTML, OCR output or canonical
  document artifacts
- real source-derived qrels, answer-quality cases or eval gold truth unless
  redistribution rights and license boundaries are explicit
- real map tiles, third-party GeoJSON or generated publication artifacts
- current serving truth such as release current pointers or mutable production
  projections
- real cluster names, machine names, private hostnames, IP/CIDR topology,
  environment Helm values, Argo Applications or encrypted secret inventory

## Provenance Classes

Every non-code fixture or data-like source that remains tracked must fit one
class:

- `synthetic`: created only for tests or examples
- `self-authored`: authored by this project and not copied from a restricted
  upstream
- `source-derived-publicly-redistributable`: derived from a source whose
  redistribution rights are documented
- `internal-only-not-for-public-repo`: must be removed or replaced before
  publication

## Runtime Content Rule

Runtime content is not read from git. Tool, status, docs and product surfaces
consume DB/read-model state and object-store artifacts through the documented
runtime boundaries. Git may hold code, contracts, validators and synthetic
examples.

## Required Checks

- Run `pnpm repo:static` before publication-sensitive changes.
- Run the public source-token and source-clean guards after editing fixtures,
  source configs, public assets or eval samples.
- Run the dependency license policy check after changing dependency locks.
- Run a separate git-history secret scan before making a private repository
  public. Working-tree checks do not prove history is clean.
