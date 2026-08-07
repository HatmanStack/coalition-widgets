# The publisher

Implementation plan for `docs/plans/2026-08-01-publisher/brainstorm.md`. Phases 0 and 1 of
`docs/PLAN.md`, plus the authoring half of its phase 2.

## Overview

The platform publishes the Coalition to End Homelessness's public HMIS figures as JSON on a CDN.
The publisher is the write half. It takes a candidate payload, runs it through a gate of nine
pure checks, and writes the survivors to S3. The gate is the point of the system: the source is
HMIS data, client-level records are PII, and the gate is the only thing standing between a
changed Looker query and client-level data on a public CDN.

This plan builds the field contract, the measure registry, valid fixtures drawn only from real
published figures, twenty-one hostile fixtures each written to defeat a named check, the
gate as a pure library, the pure publish decisions above the sink, the handler and adapters that
wire them together, and the SAM template describing the bucket, distribution, function and
schedule. Everything runs end to end locally, from a file source to a printed payload, with no
AWS account and no credentials.

It does not deploy. `sam deploy` and `sam build` are run by a human against the `dev` SSO
profile. No agent runs either command. Verification here is `sam validate --lint`, `cfn-lint`,
`pytest`, and `sam local invoke` against a fixture.

## Prerequisites

| Requirement | State in this environment | Command that proved it |
|---|---|---|
| Python 3.13 | 3.13.13 on PATH | `python3 --version` |
| pytest, development only | 9.1.1 via uv, not installed in the project | `uv run --with pytest --no-project pytest --version` |
| SAM CLI | 1.158.0 | `sam --version` |
| cfn-lint | 1.53.3 via uvx, not installed globally | `uvx cfn-lint --version` |
| Docker, for `sam local invoke` | Engine 29.4.0, daemon reachable | `docker info` |
| AWS credentials | Not required by anything in this plan | n/a |

`uv` is the package manager for this environment. Never call `pip` directly. Nothing in this
plan adds a runtime dependency: `boto3` comes from the managed Lambda runtime and everything
else is standard library.

Two development-only packages, neither installed in the project and neither reachable from
`publisher/`: `pytest` throughout, and `pyyaml` from Phase 5, which the template test uses to
parse `template.yaml`. From Phase 5 the test command is
`uv run --with pytest --with pyyaml --no-project pytest`.

## Phase summary

| Phase | Goal | Tokens |
|---|---|---|
| [Phase 0](Phase-0.md) | The law: payload contract, ADRs, conventions, testing strategy | reference, not implemented |
| [Phase 1](Phase-1.md) | Walking skeleton. `live.json` end to end, checks 1, 2, 8, 9 | ~65000 |
| [Phase 2](Phase-2.md) | Checks 3, 4, 5. `quarterly.json` and `annual.json` end to end | ~80000 |
| [Phase 3](Phase-3.md) | Checks 6 and 7. `weekly.json` and `monthly.json`, the withheld-point branch | ~90000 |
| [Phase 4](Phase-4.md) | The pure publish decisions, archive, `index.json`, CSV, the S3 sink | ~75000 |
| [Phase 5](Phase-5.md) | SAM template, `samconfig.toml`, `widgets/README.md`, account-free verification | ~65000 |

Each phase is a vertical slice that ends somewhere you could stop. Phase 1 publishes the fast
measure end to end. Phases 2 and 3 each bring two more cadence files through the same path.
Phase 4 turns one payload into the full set of objects a run writes. Phase 5 describes the
infrastructure that would host them.

## Navigation

- [Phase-0.md](Phase-0.md), the payload contract and every decision the phases inherit
- [Phase-1.md](Phase-1.md), walking skeleton
- [Phase-2.md](Phase-2.md), structural and PII checks
- [Phase-3.md](Phase-3.md), suppression and reconciliation
- [Phase-4.md](Phase-4.md), publish decisions and sinks
- [Phase-5.md](Phase-5.md), infrastructure as authored code
- [feedback.md](feedback.md), the review channel

## Sources of truth

`docs/PLAN.md` is the design. The brainstorm is the scope. Where this plan appears to disagree
with `docs/PLAN.md`, `docs/PLAN.md` wins and the disagreement is a defect in this plan.

**Two stated exceptions**, both narrowly scoped and both recorded as ADRs in
[Phase-0.md](Phase-0.md) section 4: ADR 15 (the shape of a series point) and ADR 16 (the name and
nesting of the suppression block) supersede `docs/PLAN.md` on those specific fields and on nothing
else. `docs/PLAN.md` will be corrected to match after this work lands. An implementer must not
revert either one, and the precedence rule above governs everything not listed there.

Every figure in a valid fixture comes from `docs/HANDOFF.md` "The real data", `docs/FINDINGS.md`,
or `docs/reference/community-queue-overview.png`, and `widgets/fixtures/PROVENANCE.md` records
which.
