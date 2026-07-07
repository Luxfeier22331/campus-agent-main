# Third-Party Notices

This repository is licensed under the Apache License, Version 2.0 unless a file
or directory states otherwise.

This file records source and attribution boundaries that are not automatically
covered by the repository's Apache-2.0 license grant.

## Dependency Licenses

The root `LICENSE` and `NOTICE` files cover repo-owned source code,
configuration, tests and documentation. Third-party package dependencies remain
licensed by their respective upstream authors.

Dependency license inventory for `pnpm`, `uv`, Cargo, Go and Maven dependencies
must be generated and reviewed separately before publishing release artifacts.
Do not treat this file as a complete machine-generated dependency license
report.

## Source Data and Fixtures

The repository contains source-derived configuration, tests, fixtures and
reference data used to validate ingestion and rendering behavior. Source-derived
content keeps its original upstream ownership and license terms. The
Apache-2.0 license for this repository does not relicense upstream campus
website pages, notices, documents or other third-party content.

Known source-derived categories include:

- Synthetic public website snippets and HTML fixtures used by collector tests.
- Synthetic campus notice, document, curriculum or regulation samples used to
  validate ingestion behavior.
- Map loader code and synthetic map fixtures. Real map assets and source
  references live outside the public repo in the configured object-storage data
  boundary.

The tracked source/data publication inventory is maintained in
`docs/reference/open-source-data.md`.

## Map Data

Real GeoJSON, tiles and upstream map references are not committed to the public
repository. When runtime deployments load external map data, keep the upstream
license and attribution metadata with that private/object-storage release.

## Trademarks and Branding

Project names, organization names, logos and other brand identifiers are not
licensed for trademark use by the Apache-2.0 license except as required for
reasonable and customary use in describing the origin of the Work.
