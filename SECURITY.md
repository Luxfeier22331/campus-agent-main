# Security Policy

## Supported Scope

Security reports for this repository should cover public `campus-agent` source
code, public configuration templates, build scripts and documented public
interfaces.

Internal deployment data, private content packs, production credentials,
operator-only evidence and source-derived school data are outside the public
repository support scope. Do not include them in public issues or pull
requests.

## Reporting A Vulnerability

Report suspected vulnerabilities privately to the maintainers through the
repository security advisory channel when it is available. If advisory reporting
is unavailable, contact the maintainers out of band and include only sanitized
technical details.

Do not open a public issue for:

- secrets, tokens, passwords or credential material
- private object-store keys, database URLs or internal hostnames
- raw notices, source-derived documents, screenshots or logs containing private
  data
- exploit details that allow immediate abuse

## What To Include

- affected package, app or workflow
- minimal reproduction using synthetic data
- expected and actual behavior
- impact assessment
- relevant commit or version

## Maintainer Response

Maintainers will triage the report, confirm whether it affects supported public
source, and coordinate a fix before public disclosure when needed.
