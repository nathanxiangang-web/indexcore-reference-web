# Reference Web Documentation

This repository is kept as a **reference baseline** for future IndexCore consumers.

Use it to answer two questions:

1. How should a clean Web application consume IndexCore?
2. Which responsibilities must stay outside IndexCore?

## Start here

| Goal | Document |
| --- | --- |
| Understand what is safe to copy | [REFERENCE-BASELINE.md](REFERENCE-BASELINE.md) |
| Map pages to IndexCore Q1–Q9 | [ROUTE-CONTRACT-MAP.md](ROUTE-CONTRACT-MAP.md) |
| Start a future product without repeating old coupling | [FUTURE-DEVELOPMENT-CHECKLIST.md](FUTURE-DEVELOPMENT-CHECKLIST.md) |
| Re-run the real Gate 4 validation | [E2E-RUNBOOK.md](E2E-RUNBOOK.md) |
| Read the historical Gate 4 findings | [GATE4-REFERENCE-CONSUMER-REPORT.md](GATE4-REFERENCE-CONSUMER-REPORT.md) |

## Relationship to IndexCore

Authoritative IndexCore usage and HTTP documentation lives in:

- `nathanxiangang-web/index-core/README.md`
- `nathanxiangang-web/index-core/docs/HTTP-API.md`
- `nathanxiangang-web/index-core/docs/INTEGRATION.md`

This repository is a **consumer example**, not the source of truth for the IndexCore contract.

If the code here and the current IndexCore documentation ever disagree, review the current IndexCore contract first.

## Status

Gate 4 is closed.

The accepted reference baseline is the Gate 4 implementation merged to `main` at:

`8f7062216dc9924f64d9ae0367e504c279704857`

The repository should now be treated primarily as:

- a comparison implementation;
- a regression/example client;
- a boundary reference;
- a source of integration lessons.

It is not automatically the starting repository for a future production product.
