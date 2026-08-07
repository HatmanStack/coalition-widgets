# Phase 5: the infrastructure, authored and validated

## Phase goal

Author the SAM template that would host everything the previous four phases built, and prove it
is correct without an AWS account. Authoring infrastructure and standing it up are different
activities with different risk, and a CloudFront distribution takes ten to fifteen minutes to
converge, which is not a loop worth automating.

Success criteria: `sam validate --lint` and `uvx cfn-lint` both clean; the constraints that
matter are asserted by a test rather than by reading the file; `sam local invoke` runs the
handler against a fixture and prints a payload; `widgets/README.md` tells a human exactly what to
run to deploy it.

Estimated tokens: `~65000`

## Prerequisites

- Phase 4 complete. The publisher is a working local program.
- Read `docs/PLAN.md` section 2 in full. It is a table where every row matters and each explains
  why it is not optional.
- Read [Phase-0.md](Phase-0.md) ADR 13 (the archive and the live lifecycle rule) and section 1
  (the commands an agent never runs).
- SAM CLI 1.158.0 and `uvx cfn-lint` are available. Docker is running. `sam local invoke` needs
  `public.ecr.aws/lambda/python:3.13-x86_64`, which is not cached locally and will be pulled on
  first use. That pull is the only network dependency in this plan.

## Tasks

> **Task 1: The bucket, the origin access control and the bucket policy**
>
> **Goal:** A private bucket reachable only through CloudFront, with versioning on, that a stack
> teardown cannot delete.
>
> **Scope:**
>
> * Files: `widgets/template.yaml`
> * Content: `AWS::S3::Bucket`, `AWS::CloudFront::OriginAccessControl`, `AWS::S3::BucketPolicy`,
>   and the lifecycle rule from ADR 13
> * Patterns: `docs/PLAN.md` section 2 table rows 1 and 3
> * Out of scope: a second bucket. `docs/PLAN.md` 4.4 deleted it: one bucket, one distribution, an
>   `archive/` prefix
>
> **Constraints:**
>
> * `PublicAccessBlockConfiguration` with all four settings true. The bucket is private and is
>   reached only through the distribution
> * `VersioningConfiguration: Enabled`. The archive's correction history lives here and is not
>   served
> * `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`. The distribution hostname is
>   permanent the moment a partner pastes it, and a stack teardown must not be able to take the
>   URL or the data with it
> * Origin Access Control with SigV4, not the legacy Origin Access Identity
> * The bucket policy grants `s3:GetObject` to the `cloudfront.amazonaws.com` service principal,
>   conditioned on `AWS:SourceArn` equal to the distribution ARN. Not a wildcard principal, not a
>   public policy
> * Server-side encryption enabled
> * A `NoncurrentVersionExpiration` rule scoped to the live keys only, per ADR 13. It must not
>   touch the slower archives, whose version history is the audit trail. **Prefix
>   `v1/data/live.` with the trailing dot, plus `v1/data/archive/live/`.** Scoping it to
>   `v1/data/live.json` covers only half the live objects: `live.csv` changes on the same
>   cadence and would accrue roughly 43,000 unexpired versions a month. Corrected after a
>   review found it; the test derives the keys from `publish.py` rather than matching the
>   prefix string
>
> **Acceptance Criteria:**
>
> * [ ] `sam validate --lint --region us-east-1` exits 0
> * [ ] `uvx cfn-lint widgets/template.yaml` exits 0
> * [ ] `rg -n 'OriginAccessIdentity|S3OriginConfig' widgets/template.yaml` returns no matches
> * [ ] The lifecycle rule's prefix filters name only live keys, asserted by the template test in
>       Task 5
>
> **Commit Message Template:**
>
> ```text
> feat(infra): private bucket, OAC and the retain policies
>
> - Retain on delete and replace, because the distribution hostname is permanent once pasted
> - Versioning on: the archive's correction history lives here and is not served
> - Noncurrent-version expiry is scoped to live keys so the slower audit trail survives
> ```

> **Task 2: The distribution, the cache policy and the response headers policy**
>
> **Goal:** An edge that lets the origin's `Cache-Control` decide everything, and serves CORS
> without forwarding `Origin`.
>
> **Scope:**
>
> * Files: `widgets/template.yaml`
> * Content: `AWS::CloudFront::CachePolicy`, `AWS::CloudFront::ResponseHeadersPolicy`,
>   `AWS::CloudFront::Distribution`
> * Patterns: `docs/PLAN.md` section 2 rows 2, 4 and 5, and its "Verified while researching" list
> * Out of scope: a custom domain, an ACM certificate, Route 53, alternate domain names. The
>   `d*.cloudfront.net` name is the product
>
> **Constraints:**
>
> * Cache policy: `MinTTL 0`, `DefaultTTL 60`, `MaxTTL 31536000`, and nothing in the cache key.
>   No headers, no cookies, no query strings. MinTTL 0 is what makes the origin `Cache-Control`
>   win, and every cache decision in Phase 4 depends on it
> * Response headers policy: CORS with `Access-Control-Allow-Origin: *`, plus
>   `X-Content-Type-Options: nosniff` and a `Referrer-Policy`. **Do not forward `Origin`.**
>   Forwarding it without adding it to the cache key is the documented cause of intermittent CORS
>   failures, and with `ACAO: *` there is nothing to vary on
> * Three cache behaviours by path: `/v1/data/archive/*`, `/v1/data/*`, `/v1/*.js`, plus a default
>   behaviour. Because origin `Cache-Control` wins under MinTTL 0, the behaviours differ mainly in
>   documentation value; say so in a template comment rather than silently collapsing them to one
> * `ViewerProtocolPolicy: redirect-to-https`, `AllowedMethods` of GET and HEAD only, `Compress`
>   true
> * `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain` on the distribution
> * No `DefaultRootObject`. There is no site here, only data and a bundle
>
> **Acceptance Criteria:**
>
> * [ ] `sam validate --lint --region us-east-1` and `uvx cfn-lint widgets/template.yaml` both
>       exit 0
> * [ ] `rg -n 'Origin' widgets/template.yaml` shows no header-forwarding configuration that
>       includes `Origin`
> * [ ] The template test in Task 5 asserts MinTTL is 0, the cache key is empty, and both Retain
>       policies are present on the distribution
>
> **Commit Message Template:**
>
> ```text
> feat(infra): distribution, cache policy and response headers policy
>
> - MinTTL 0 and an empty cache key, so the origin Cache-Control the publisher writes wins
> - CORS on the response headers policy, and Origin is never forwarded
> - Retain on the distribution: a recreated distribution breaks every pasted embed at once
> ```

> **Task 3: The function, the schedule, the secret and the alarm**
>
> **Goal:** The compute and its operational surface. The schedule ships disabled, because a
> template that starts publishing on deploy is a template nobody can review safely.
>
> **Scope:**
>
> * Files: `widgets/template.yaml`
> * Content: `AWS::Serverless::Function` with a `ScheduleV2` event, an explicit log group,
>   `AWS::SecretsManager::Secret`, `AWS::CloudWatch::Alarm`, template parameters and outputs
> * Patterns: `docs/PLAN.md` section 2 rows 6, 7, 8 and 9
> * Out of scope: any alarm notification target. The metric is emitted and the alarm is declared;
>   nothing is wired to a topic. `sources/looker.py` is not built and nothing reads the secret
>
> **Constraints:**
>
> * Runtime `python3.13`, 256MB, 30 second timeout, `CodeUri: publisher/`, `Handler: app.handler`
> * `ScheduleExpression` is a template parameter. The event ships `State: DISABLED`, also a
>   parameter, defaulting to `DISABLED`
> * `MIN_BUNDLE` and the bucket name are environment variables. `meta.minBundle` is one integer,
>   read once, passed through; nothing else in the publisher knows what a bundle is
> * IAM is least privilege: `s3:PutObject`, `s3:GetObject` and `s3:PutObjectTagging` scoped to
>   `v1/data/*` in this bucket. Not `S3FullAccess`, not a service wildcard
> * **Plus unconditional `s3:ListBucket` on the bucket ARN, with no `s3:prefix` condition.**
>   Without it S3 answers 403 rather than 404 for an absent key, the sink refuses to read a 403
>   as missing, and the hash read happens before the write, so the first run on an empty bucket
>   raises and every later run raises identically. The stack publishes nothing, ever. The
>   condition is what makes the grant inapplicable: `s3:prefix` is populated only by List*
>   calls, so it cannot be satisfied by the head and get authorization that decides 403 against
>   404. Both the missing grant and the condition that voided it were shipped and caught by
>   review; the test now asserts the grant carries no condition
> * The secret is declared and nothing reads it. Do not add a `GetSecretValue` permission for a
>   consumer that does not exist
> * Alarm on the `PublishFailed` metric, one failure alarms, `TreatMissingData: notBreaching`.
>   `Period` times `EvaluationPeriods` **must not exceed** the 86400 second cap; 86400 itself
>   is allowed and is what the template uses. **The alarm's
>   dimension set must match one the publisher actually emits.** CloudWatch does not roll a
>   dimensioned metric up into a dimensionless one, so a dimensionless alarm needs `app.py` to
>   publish the empty dimension set alongside `["Cadence"]`, or it watches a metric nothing
>   writes and sits in OK through every failure. **And 1 of 24 hourly datapoints**, not 1 of one
>   five-minute period, or an overnight failure self-clears in ten minutes with no notification
>   target to have caught it
> * Log group: an explicitly declared Lambda log group collides with the auto-created one on any
>   already-deployed stack, and `!Sub '/aws/lambda/${FunctionName}'` does not resolve against a
>   sibling resource's `FunctionName` property. Either give the function an explicit name and
>   repeat that literal expression in the log group, or let SAM manage the log group and set
>   retention another way. Whichever is chosen, the deploy runbook in `widgets/README.md` carries
>   the collision warning, because that is where the deployer reads
> * Outputs: bucket name, distribution domain name, distribution id
>
> **Acceptance Criteria:**
>
> * [ ] `sam validate --lint --region us-east-1` and `uvx cfn-lint widgets/template.yaml` both
>       exit 0. cfn-lint is the only thing that catches an unresolvable `!Sub`; a shape test will
>       happily match the literal string
> * [ ] The template test asserts the schedule's `State` parameter defaults to `DISABLED`
> * [ ] The template test asserts no IAM statement in the template contains `s3:*` or a `Resource`
>       of `*`
> * [ ] The template test asserts alarm `Period` times `EvaluationPeriods` is at most 86400
>
> **Commit Message Template:**
>
> ```text
> feat(infra): function, disabled schedule, secret and the PublishFailed alarm
>
> - The schedule ships State DISABLED and its expression is a parameter
> - IAM is scoped to v1/data/* in this bucket, not to the bucket and not to S3
> - The secret is declared and nothing reads it; Looker is phase 7
> ```

> **Task 4: `samconfig.toml`**
>
> **Goal:** The deploy configuration a human uses, checked in, so the deploy command is short and
> the profile and region are not typed by hand each time.
>
> **Scope:**
>
> * Files: `widgets/samconfig.toml`
> * Content: profile `dev`, region `us-east-1`, stack name, capabilities, confirm-changeset on
> * Out of scope: running anything
>
> **Constraints:**
>
> * `confirm_changeset = true`. A deploy that applies without showing a changeset is a deploy
>   nobody reviewed
> * `region = "us-east-1"`. The account's usual default is `us-west-2` and this stack is not there
> * `.gitignore` already excludes `samconfig.local.toml`; the checked-in file holds nothing secret
>
> **Acceptance Criteria:**
>
> * [ ] `rg -n 'profile|region|confirm_changeset' widgets/samconfig.toml` shows `dev`,
>       `us-east-1` and `true`
> * [ ] No secret, account id or bucket name is committed in it
>
> **Commit Message Template:**
>
> ```text
> chore(infra): samconfig for profile dev in us-east-1
>
> - confirm_changeset is on, so no deploy applies without a reviewed changeset
> ```

> **Task 5: Make the template constraints executable**
>
> **Goal:** `docs/PLAN.md` section 2 says each row matters. Reading the file to confirm them rots.
> Assert them.
>
> **Scope:**
>
> * Files: `widgets/tests/infra/test_template.py`, `widgets/README.md`
> * Content: a test module that parses `template.yaml` and asserts the constraints named in Tasks
>   1, 2 and 3
> * Out of scope: reimplementing cfn-lint. The test asserts project decisions, not CloudFormation
>   validity
>
> **Constraints:**
>
> * Parsing SAM YAML needs a loader that tolerates `!Ref`, `!Sub`, `!GetAtt` and the rest. Add a
>   multi-constructor to a `SafeLoader` subclass that turns each tag into a plain marker value
> * This adds `pyyaml` as a development-only dependency. From this phase on the test command is
>   `uv run --with pytest --with pyyaml --no-project pytest`. Update `widgets/README.md` and any
>   earlier documented command. `pyyaml` must not become a runtime dependency and must not be
>   importable from `publisher/`: `test_purity.py` grows a rule covering the whole `publisher/`
>   tree for `yaml`
> * The assertions to carry, at minimum: Retain on both the bucket and the distribution, both
>   `DeletionPolicy` and `UpdateReplacePolicy`; MinTTL 0; an empty cache key; OAC present and OAI
>   absent; `PublicAccessBlockConfiguration` all true; versioning enabled; the schedule State
>   parameter defaulting to DISABLED; no `s3:*` and no `Resource: "*"` in any policy; the
>   lifecycle rule scoped to live keys; alarm `Period` times `EvaluationPeriods` at most 86400
> * Each assertion fails with a message naming the `docs/PLAN.md` row it enforces, so a future
>   reader who trips one finds the reasoning rather than only the rule
>
> **Acceptance Criteria:**
>
> * [ ] The test module asserts every constraint in the list above, one test per constraint
> * [ ] Deliberately remove one `DeletionPolicy: Retain`, watch the test fail, revert, and record
>       what the broken run reported in the commit body
> * [ ] `rg -n 'yaml' widgets/publisher/` returns no matches
> * [ ] Full suite passes with the updated command
>
> **Commit Message Template:**
>
> ```text
> test(infra): assert the template constraints from PLAN section 2
>
> - Retain policies, MinTTL 0, empty cache key, OAC not OAI, private bucket, disabled schedule
> - Each failure message names the PLAN row it enforces
> - pyyaml is development only and is unreachable from publisher/
> ```

> **Task 6: Verify without an account, and write `widgets/README.md`**
>
> **Goal:** Prove the whole slice runs end to end through the SAM path, and hand a human exactly
> what to run to deploy it.
>
> **Scope:**
>
> * Files: `widgets/README.md`, `widgets/tests/` as needed
> * Content: what this slice is, how to run the tests, how to run it locally both with and without
>   Docker, the deploy command for a human, and the deferrals this slice leaves behind
> * Out of scope: `sam build`, `sam deploy`, and any AWS call. A human deploys
>
> **Constraints:**
>
> * `README.md` states plainly that the S3 sink has never run against real S3 and is tested
>   against a stub client. Do not describe it as working
> * It carries the log-group collision warning from Task 3, because the runbook is where the
>   deployer reads
> * It records the ADR 1 deferral: nothing in this slice folds raw categories, and the fold
>   belongs on the source side when `sources/looker.py` arrives. Otherwise the next reader
>   concludes it was forgotten
> * It records the two open questions from `docs/PLAN.md` 4.5 that block a Community Queue
>   households figure and settle the time-series suppression call
> * The deploy section says `sam deploy --guided --profile dev` is run by a human, and says why
>   an agent does not run it
> * No em dashes, no filler, no emoji
>
> **Acceptance Criteria:**
>
> * [ ] `sam validate --lint --region us-east-1` exits 0 and its output is recorded in the commit
>       body
> * [ ] `uvx cfn-lint widgets/template.yaml` exits 0 and its output is recorded
> * [ ] `sam local invoke PublisherFunction --event <a fixture event> --region us-east-1` runs the
>       handler and prints a payload. If the container image pull fails, record the exact error
>       and the fallback (`python3 publisher/app.py <fixture>`) rather than reporting the step as
>       passed
> * [ ] The same `sam local invoke` against a hostile fixture event prints no payload and names
>       the check that fired
> * [ ] `widgets/README.md` contains a runnable test command, a runnable local command, and a
>       deploy command marked as human-only
> * [ ] Full suite passes offline
>
> **Commit Message Template:**
>
> ```text
> docs(infra): widgets README, and verification without an account
>
> - sam validate --lint and cfn-lint both clean, output recorded
> - sam local invoke runs the handler against a fixture and against a hostile fixture
> - README records what has not been proven: the S3 sink has never run against real S3
> ```

## Phase verification

1. `sam validate --lint --region us-east-1` exits 0.
1. `uvx cfn-lint widgets/template.yaml` exits 0.
1. `cd widgets && uv run --with pytest --with pyyaml --no-project pytest -q` passes offline.
1. `sam local invoke` produces a payload from a valid fixture and no payload from a hostile one.
1. Remove one `DeletionPolicy: Retain`, watch the template test fail, revert, record the output.
1. Nothing in this phase ran `sam build`, `sam deploy` or any AWS mutation. State that explicitly
   in the phase report.

## Integration points

The template's `CodeUri: publisher/` and `Handler: app.handler` must match the layout Phase 1
established. If they do not, the layout is right and the template is wrong: `pytest.ini` and the
Lambda have to agree on the import root.

## Known limitations at the end of this slice

- Nothing is deployed. No bucket exists, no distribution exists, no hostname exists.
- The S3 sink is tested against a stub client and has never talked to S3.
- No Looker source, so the pipeline has no live input. The file source is a legitimate product: a
  hand-published payload that passes the same gate is not a stopgap.
- No JavaScript at all. No bundle, no widgets, no docs site, no `widgets.json`. Phases 3 to 6 of
  `docs/PLAN.md`.
- The alarm has no notification target.
- ADR 7 (a residual of one category, or a residual below `MIN_CELL`, fails check 6) is a
  strengthening this plan added. If the user disagrees, the change is one rule in check 6 and one
  hostile fixture.
