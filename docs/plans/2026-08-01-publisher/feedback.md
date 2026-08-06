# Feedback Log

## Active Feedback

See FINAL_REVIEW below. One blocking item, ten notes.

## FINAL_REVIEW

Verdict: **NO-GO**, on one item. Everything else here is a note.

Phases 1 to 4 are in good order and nothing below moves them. The blocking item is in Phase 5,
which by the user's call had no independent review, and it is the kind of defect that only shows
up against a real bucket: it is in the one seam `widgets/README.md` correctly says has never been
exercised.

Method note, since this project holds itself to it: every claim the Phase 5 commit body makes was
re-run rather than read. All of them held. They are listed under "Verified" at the end so the
NO-GO is not mistaken for a general doubt about the phase.

### BLOCKING 1 (implementation-level, Phase 5). The function cannot read its own bucket on the first run, and the condition is self-perpetuating

`widgets/template.yaml:264-275` grants `s3:PutObject`, `s3:GetObject` and `s3:PutObjectTagging`
on `${PublicBucket.Arn}/v1/data/*`. It grants **no `s3:ListBucket` on the bucket itself**.

That is not the harmless-looking least-privilege tightening it appears to be. From the S3 API
reference, for both `HeadObject` and `GetObject`, quoted:

```text
If the object you request doesn't exist, the error that Amazon S3 returns depends on whether you
also have the s3:ListBucket permission.
+ If you have the s3:ListBucket permission on the bucket, Amazon S3 returns an HTTP status code
  404 Not Found error.
+ If you don't have the s3:ListBucket permission, Amazon S3 returns an HTTP status code 403
  Forbidden error.
```

Now follow it through this code:

- `publisher/sinks/s3.py:28` — `NOT_FOUND = ("404", "NoSuchKey", "NotFound")`, and `_missing()`
  at line 91 matches the error code against exactly that tuple.
- So a `403` is **not** a missing object. It propagates, which is the module's documented and
  correct intent: "a permission failure is not an unchanged object either, and swallowing it
  would turn every run into a full write with nobody finding out."
- `publisher/app.py:214-221` evaluates the arguments to `publish.plan_writes` before it calls
  `sink.write`. Python evaluates left to right, so `sink.read_json(index_key())` and then
  `sink.current_hashes(...)` both run **before** a single byte is written.
- `run()` catches, emits `PublishFailed`, and re-raises.

On a freshly created bucket every one of those keys is absent, so the first scheduled run raises
before writing anything. Nothing is written, so on the next run every key is still absent, so it
raises again. **This does not resolve itself.** It is a deadlock, not a first-run blip, and the
alarm fires correctly every time while the cause looks like an IAM problem in a policy that reads
as deliberately and carefully scoped.

It is worth being precise about what this is and is not. It is **not** a privacy defect: the gate
is upstream of the sink and entirely unaffected, and nothing leaks. The failure is fail-closed and
loud, which is the design working. What it means is that the stack as authored publishes nothing,
ever, and the reason is four lines of IAM.

**Fix**, one statement added to the same `Policies` block:

```yaml
- Effect: Allow
  Action: s3:ListBucket
  Resource: !GetAtt PublicBucket.Arn
  Condition:
    StringLike:
      's3:prefix': v1/data/*
```

`Resource` is the bucket ARN and not `${Arn}/v1/data/*`, because `ListBucket` is a bucket-level
action; the prefix condition is what keeps it scoped. `tests/infra/test_template.py`'s wildcard
rule is unaffected, since neither the action nor the resource is a wildcard.

**Why this is blocking rather than a note.** It is the only finding in this review that makes a
deployed stack non-functional, it is in the phase nobody reviewed, and it is invisible to every
control the project has: `sam validate --lint` passes, `cfn-lint` passes, all 22 template tests
pass, and the sink's stub tests pass, because a stub client raises whatever the test tells it to
raise and no test tells it to raise `403`. `widgets/README.md` already says, correctly, that the
error semantics "match botocore's documented behaviour and ha[ve] never met botocore." This is
that gap paying out.

**Worth adding with the fix**, so the next person does not have to rediscover the reasoning: a
test in `tests/publisher/test_sinks.py` asserting that a `403`/`AccessDenied` `ClientError`
propagates rather than being read as a missing object. That pins the intended behaviour and
documents why the IAM statement has to exist, which a comment alone would not survive.

### Note 1 (plan-level). Note 4 was assigned to Phase 5 and Phase 5 did not discharge it

"Notes carried to Phase 5" line 38 says, of the run-that-never-happened case: "**choosing between
them is Phase 5's.**" Three candidates were listed: a success heartbeat with its own missing-data
alarm, an alarm on `FailedInvocations`, or a staleness check on `LastModified`.

Phase 5 did not choose. `widgets/README.md:344-350` reproduces all three candidates verbatim under
"What this slice leaves for later." The only edit Phase 5 made to `feedback.md` was to **add**
Note 6; Notes 4 and 5 were left untouched.

That is a defensible outcome but it is recorded as the wrong kind of thing. An open assignment
became a deferral without anyone deciding to defer it, and the README's framing means a later
reader has no way to tell that a phase was once asked to settle this. Either make the call, or
say in both files that it was consciously pushed past Phase 5 and to where.

For what it is worth the note's own analysis points at `FailedInvocations` as the cheapest of the
three: it needs no code change, only a second `AWS::CloudWatch::Alarm`, and the schedule's
generated resource is already in the template.

### Note 2 (implementation-level). Note 6 is still open and its own measurement says the fix is free

`publisher/gate/checks.py:601`, `:685` and `:733` still carry `contract=_contract` as a default.

Re-measured today at the current suite size, with the degradation proved to have landed first:
dropping the `contract` argument from the `_series_failures` call site at `checks.py:542` leaves
**all 1953 passing**. The series branch of check 4's injected-contract seam is still unasserted,
exactly as Note 6 describes, and Note 6 itself measured that removing the three defaults costs
nothing (1929 passed at the time) and converts the gap from an unasserted property into an
impossible one.

Not blocking, for the reason Note 6 gives: production calls with the default, so behaviour is
identical and nothing publishes that should not. But this is a note whose recommended fix is
three characters per signature, whose cost has already been measured as zero, and which has now
been carried across two phases. It should either be done or explicitly declined.

### Note 3 (plan-level). `s3:PutObjectTagging` is granted and nothing uses it

`template.yaml:274`. `grep -rn "Tagging\|tagging" publisher/` returns nothing: the sink calls
`put_object`, `head_object` and `get_object` and no tagging API exists anywhere in the publisher.

This is plan-level rather than an implementation slip, because `Phase-5.md` Task 3 names all three
actions explicitly. Harmless in isolation, but it is an unused grant sitting inside the one policy
whose stated virtue is that it is minimal, and it is the sort of thing that gets cited later as
precedent for adding one more. Drop it, or write down what is expected to use it.

### Note 4 (implementation-level). The README omits `head_object` from what the boto3 run did not establish

`widgets/README.md:99-104` says the `InvalidAccessKeyId` run "establishes nothing about
`put_object`, which the run never got to, nor about the error-code semantics, nor about metadata
case folding."

`head_object` is not in that list and should be. By the argument-evaluation order in
`app.py:214-221`, `read_json` runs before `current_hashes`, so the run died inside the first
`get_object` and **`head_object` was never called either**. The paragraph is accurate about
everything it asserts, and a reader who is being careful will still come away believing that both
read calls were validated against boto3 when only one was.

This matters more than its size because the surrounding section is explicitly an inventory of what
has and has not been proven, and it is the document later phases will trust. One clause fixes it.

### Note 5 (implementation-level). The `sam local invoke` runbook fails on a stale SSO session with no guidance

Reproduced. Running the README recipe at `widgets/README.md:46-51` exactly as written, on this
machine, gives:

```text
Error: Error when retrieving token from sso: Token has expired and refresh failed
...
An unexpected error was encountered while executing "sam local invoke".
```

`sam local invoke` resolves AWS credentials to inject into the container even when the invocation
is entirely local and `BUCKET` is empty, so a stale SSO session turns a no-network, no-AWS step
into a forty-line botocore traceback. Setting dummy static credentials in the environment makes it
run, which is how both fixtures were verified for this review.

The README presents this recipe as the way to exercise the real runtime. Add the one line, because
the failure mode looks like a broken template rather than an expired login.

### Note 6 (implementation-level). The seven-versus-eight count reads three different ways

`README.md:129` opens with "This has been found seven times, each time by hand" and lists seven.
`README.md:196` then introduces the mutmut survivor as "the eighth instance of the class."
`README.md:264` reconciles them correctly: "Seven of the eight instances were found by a person
attacking a helper they thought to suspect. The eighth was found by a tool that suspected
everything."

The document is internally consistent and the final statement is the right one. The problem is
ordering: the numbered list is a natural stopping point, it is followed by "Each of the seven is
now pinned directly," and the eighth arrives two subsections later inside a passage about
tooling. A reader who has not followed the build and who reads only "What a green suite here does
and does not tell you" carries away seven, all found by hand.

One clause in the lead-in fixes it: "found eight times, seven of them by hand and an eighth by the
mutation run described below."

**On the substantive question, the limit itself is stated accurately and is not overstated.**
Specifically: the criterion is correctly scoped to `corpus.py` and the README says so plainly
rather than implying it covers the module-local helpers; the honest answer to completeness is
given as "whoever last looked found as many as they thought to look for"; and "a green suite is
evidence about the code it exercises, it is not evidence about how much of the code it exercises"
is the correct framing and does not claim more than the evidence supports. Only the count is
untidy.

### Note 7 (implementation-level). The wildcard-policy test inspects the pre-transform template only

`tests/infra/test_template.py:234` walks the parsed template for `Action` and `Resource` keys. Two
gaps, both about future edits rather than the template as it stands:

- A SAM policy template, for example `Policies: [S3FullAccessPolicy: {BucketName: ...}]`, has no
  `Action` key at all. It would pass this test and grant `s3:*` after the transform runs.
- The action rule blocks `"*"` and anything starting with `s3:*`. `logs:*`,
  `secretsmanager:*` or any other service wildcard passes, while the failure message says "not a
  service wildcard."

It meets `Phase-5.md` Task 3's acceptance criterion as literally written, which is why this is a
note. Tightening the action rule to a regex over `^[a-z0-9]+:\*$` costs one line and closes the
second gap. The first needs an assertion that `Policies` entries are inline documents.

### Note 8 (implementation-level). The ignore rules that keep this tree clean are local-only

`__pycache__/`, `.ruff_cache/` and `.pytest_cache/` are excluded through `.git/info/exclude`, not
`.gitignore`. `.git/info/exclude` is per-clone and is not committed, so a fresh clone by anyone
else does not inherit it and their first `git status` is full of bytecode. Three lines in
`.gitignore`.

### Note 9 (housekeeping). Two loose ends in the working tree

- `docs/plans/2026-08-01-publisher/RCA.md` is untracked. It is a substantial retrospective and it
  is currently one `git clean` from gone.
- `tests/publisher/__pycache__/test_zz_prove.cpython-313-pytest-9.1.1.pyc` has no corresponding
  source. A scratch verification module was correctly deleted and its bytecode was left behind.
  Harmless, and it disappears once Note 8 is done and the caches are cleared.

### Note 10 (design judgement, requested). `Architectures: x86_64` is the right call, stated slightly wrong

The decision is sound and should stand. The reasoning holds: the cost delta is roughly 20 percent
of a function that costs about a dollar a month, the workload is nowhere near CPU-bound (the
invocations timed for this review ran 52ms and 85ms), and it is a one-line reversal with no data
migration and no API surface, so it is not a one-way door. The local-invoke parity benefit is real
and observable rather than theoretical: this machine has `public.ecr.aws/lambda/python:3.13-rapid-x86_64`
built and cached and **no** `rapid-arm64`, which corroborates the commit body's account. The
honesty note about the full disk is exactly the right instinct and should be kept.

The wording is what needs amending. `template.yaml:249-253` argues from "matching the developer
architecture," which is stated as though the developer architecture is a fixed property of the
project. It is a property of whoever is sitting down today. On Apple Silicon, or on an arm64 CI
runner, the same sentence argues for the opposite conclusion, because there arm64 is native and
x86_64 is the emulated one. As written, the next maintainer on a different machine reads a
justification that points away from what they should do.

Phrase it as contingent: x86_64 because the maintainer's machine is x86_64 today, revisit when
that stops being true, and the saving is not the deciding factor either way.

### Verified

Re-run rather than accepted. Every one held.

| Claim | Result |
|---|---|
| 1953 tests pass | 1953 passed |
| Suite passes offline | 1953 passed under `unshare -rn`, no interfaces |
| `sam validate --lint --region us-east-1` exits 0 | exit 0 |
| `uvx cfn-lint` exits 0 | exit 0, from repo root and from `widgets/` |
| 22 template tests asserting the PLAN constraints | 22 collected, and they cover every item in Task 5's list |
| Removing a `DeletionPolicy` was verified red | reproduced, and the `AssertionError` text matches the commit body verbatim |
| Reverted byte-identical | `template.yaml` sha256 identical to the committed file |
| pyyaml unreachable from `publisher/` | `import yaml as _y` in a sink turns `test_purity.py` red; no `yaml` in `publisher/` |
| `sam local invoke`, valid fixture | ran in the real `python3.13-x86_64` container: 5 objects, payload printed |
| the same, headers | archive `immutable`, live `max-age=60`, index `max-age=300`, all matching PLAN 3.2 |
| `sam local invoke`, hostile fixture | no payload, named `check_9_population_floor`, emitted EMF in namespace `CoalitionPublisher` matching the alarm |
| samconfig | profile `dev`, `us-east-1`, `confirm_changeset = true`, no secret, no account id, no bucket name |
| No AWS mutation was run in this phase or this review | confirmed; the only AWS contact was Phase 5's `InvalidAccessKeyId`, which is a refused read |

Phases 1 to 4: every file named in `Phase-1.md` through `Phase-4.md` exists, all nine checks are
defined and registered in `CHECKS`, all 21 hostile fixtures and 5 valid fixtures are present, the
four `Cache-Control` constants in `publish.py` match PLAN 3.2 exactly, `CodeUri`/`Handler` match
the Phase 1 layout, no dead public functions, no TODO/FIXME markers, and no secrets in tracked
files.

## Notes carried to Phase 5

Notes 1 to 3 were left by the Phase 3 third review and are closed. Notes 4 and 5 were left by the
Phase 4 re-review and are open, and both are Phase 5's. None of them blocks anything. They are
here because the later implementers read this file.

### Note 4. `TreatMissingData: notBreaching` is correct, must not be changed, and does not close the run-that-never-happened case

Three things, and the first two are the ones a quick reader gets wrong.

**`notBreaching` is the right setting and flipping it would make things worse.** The
`PublishFailed` metric is absent on every successful run by design: it is emitted only when a run
refuses or raises. Setting `breaching` would put the stack into permanent alarm from the first
successful publish onward, which is not a stricter control, it is a broken one. **Do not change
it.**

**A run that never happens cannot be closed from inside `app.py`, by construction.** The defect
the Phase 4 review found was a failure the system observed and did not report, and instrumentation
closed it: `app.py` now emits `PublishFailed` for anything that escapes. A run that never happens
is a failure the system never observes, because the process does not start. No metric emitted from
inside the function can report an invocation that did not occur.

A Lambda timeout belongs in the same family for the same reason. The runtime kills the process
without unwinding, so no `except` block runs and no metric is emitted, and the function's own
instrumentation is exactly as absent as it is when the schedule never fired. So does anything that
reaches `guarded` as a `BaseException` rather than an `Exception`. **`guarded` catching `Exception`
and not `BaseException` is the correct choice and should not change**; the timeout case is not
evidence that the catch is too narrow, it is evidence that this family needs a control outside the
function.

**The fix is a second, different control, and explicitly not a change to `TreatMissingData`.**
Three candidates, and choosing between them is Phase 5's:

- a success heartbeat metric emitted on every published run, with its own alarm on missing data,
- an alarm on the EventBridge rule's `FailedInvocations`,
- a staleness check on the current object's `LastModified`.

Each observes the system from outside the process, which is the property the run-that-never-happened
case requires and which no amount of instrumentation inside `app.py` can supply.

### Note 5. The reporter has no guard of its own, and it is unreachable today

Recorded, deliberately not fixed, and written here rather than only in the resolved review because
Phase 7 is where it becomes reachable.

If an escaping exception's `__str__` raises, `crash_metric` raises inside the `except` block and
two things happen at once: no metric is emitted, and the original exception is replaced by the
reporter's own. Measured:

```text
a sink raising an exception whose __str__ raises:
  outcome:                       RuntimeError   (the reporter's, not the sink's)
  metric emitted:                False
  original exception preserved:  False
```

That is the defect Phase 4 fixed, sitting inside the fix for it, one level further in. It is the
third time that recursion has paid out in this project, after the entry-point instance and the
guard that had the pattern it existed to prevent.

**It is not reachable today and that is why the code is left alone.** Nothing in this system
produces an exception whose `__str__` raises: the gate raises ordinary exceptions, `publish.py`
raises `ValueError`, `file_source` raises `OSError` and `JSONDecodeError`, `select_sink` raises
`ModuleNotFoundError`, and botocore's `ClientError` formats its message in `__init__` and stores
the result. Fixing an unreachable defect in a reporter is how reporters acquire the bugs they exist
to report.

**Phase 7 is where that stops being true.** `sources/looker.py` is the first place arbitrary
third-party exception types enter this system, and an SDK is entitled to raise anything. Whoever
writes it should decide then rather than discover it.

If anyone acts on it, the shape is a bare `except Exception: pass` around the two `print` calls in
`report_crash` only, so a broken reporter costs the metric but not the original traceback, which
is the more valuable of the two.

**It is also the honest answer to "is the guard itself guarded", which nobody had asked.** It is
not, and now that is written down rather than assumed either way.

### Note 6. Half of check 4's injected-contract seam is unasserted, and three defaults are why

Left by the Phase 4 third review. Not a blocker: the shipped behaviour is correct on both
branches, no payload gets through, and the whole risk is test-only. The fix is deleting three
characters' worth of default and it is written out below so nobody has to rediscover it.

**The threading decision it belongs to was right**, and that is worth recording first because the
third review adjudicated it. The Phase 4 re-review wrote a `_min_cell_failures` that reached for
the module binding `_contract`. Threading `contract` through `_series_failures` and
`_breakdown_failures` instead is better and the stated reason is the correct one: all nine checks
have taken `contract=_contract` since Phase 1, checks 3, 6 and 7 already drive that seam with
`SimpleNamespace` stubs, and check 6 threads `contract` through five helpers for exactly this
assertion. A rule reading the module binding would have made
`check_4_type_and_domain(payload, stub_contract(4))` silently ignore the injected threshold, which
is the "control that reports success while checking nothing" shape this phase spent three reviews
on. The reviewer's snippet was the worse of the two and the departure from it was right.

**What is not covered.** `test_a_threshold_lowered_in_the_contract_is_the_threshold_the_check_enforces`
exercises the breakdown branch only. Measured, with the landing proved first:

| Degradation | Measured |
|---|---|
| the injected contract not threaded into `_breakdown_failures` | 1 failed |
| the injected contract not threaded into `_series_failures` | **all 1929 passed** |

So the seam is held on one of its two branches. The commit body's claim that the named test "is
what holds it" is true for breakdowns and not for series.

**The cause is the defaults, and removing them closes it structurally rather than with a second
test.** `_min_cell_failures`, `_series_failures` and `_breakdown_failures` each take
`contract=_contract`. Check 6's five equivalents take `contract` as a required positional and have
no default, which is why this cannot happen there: a call site that forgets the argument is a
`TypeError`, not a silent fallback to the module contract. Measured both ways:

| Change | Measured |
|---|---|
| the three defaults removed, every call site left intact | 1929 passed, so the defaults are not load-bearing |
| defaults removed **and** the series call site drops the argument | **90 failed**, a `TypeError` at the first payload |

So deleting `=_contract` from those three signatures costs nothing, matches the shape check 6
already uses, and converts the gap from an unasserted property into an impossible one. That is the
recommended fix. Parameterizing the injection test over both builders would also work and is
weaker, because it closes this instance rather than the class.

**Why this is a note and not an item.** In production `check_4_type_and_domain` is called with the
default, so `contract is _contract` and threaded or not the behaviour is identical. A series
declaring `minCell: 6` is refused today, verified directly, and all twenty-one hostile sets are
unmoved. Nothing publishes that should not. What is missing is an assertion about a test-only
seam, on one of two branches, in a rule that is otherwise covered in both directions by tests
parameterized over both a breakdown and a series.

## Notes carried to Phase 4 and 5, closed

Left by the Phase 3 third review. All three are closed in Phase 4. They are kept because the
reasoning in Note 1 is cited elsewhere.

### Note 1. One row of the `empty_parameter_set_mark` measurement table is not reproducible

The table in the Phase 3 re-review resolution records:

```text
| COUNT_KIND_POSITIONS | 1 error, exit 2 |
```

That cannot be right, and it is not a transcription slip. `COUNT_KIND_POSITIONS` is never a
parametrize source. It is a lookup dict and a set-equality operand:

```python
@pytest.mark.parametrize("name", FIXTURES)          # FIXTURES is the source, not this dict
def test_the_filter_keeps_exactly_as_many_positions_as_the_fixture_holds(name):
    assert len(list(count_kind_positions(payload))) == COUNT_KIND_POSITIONS[name]

def test_every_valid_fixture_on_disk_has_a_count_kind_position_count():
    assert set(COUNT_KIND_POSITIONS) == set(FIXTURES)
```

Emptying it produces `KeyError` and a set mismatch, never an empty parameter set, so
`empty_parameter_set_mark` has nothing to act on. Re-measured with the degradation proved by
`ast.literal_eval` before the run: **6 failed, 1479 passed, exit 1**, not 1 error at exit 2.

The row's conclusion is right, which is why this is a note. The source is covered, and it was
covered before the ini line by `test_every_valid_fixture_on_disk_has_a_count_kind_position_count`.
Only the mechanism and the numbers are wrong. Correct the row when this file is next touched, or
drop it, since it is not one of the sources the line addresses.

**Closed in Phase 4.** The row is corrected in place rather than dropped, and it now carries the
reason it is not a row about the ini line at all.

The other five rows reproduce exactly, each with the degradation proved first:
`REQUIRED_POSITIONS` 1 error exit 2, `WITHHELD_POINTS` 1 error exit 2, `NON_OBJECTS` 2 errors exit
2, `HOSTILE_INPUTS` 10 errors exit 2, `corpus.valid_paths` 8 errors exit 2. The contrast run with
the line removed gives `WITHHELD_POINTS` at 1484 passed, 1 skipped, exit 0.

Worth naming the shape rather than only the row: this is the second measurement in this table's
history that was plausible and wrong, after the `SOURCE = {} or {...}` degradation that never
degraded. Both were caught, one by the implementer and one here. The general remedy is the one
used to re-measure them: prove the degradation landed before trusting what the run reports. A
degradation that silently does nothing produces the most convincing possible result, which is the
run you expected.

### Note 2. Two of the five instances in `widgets/README.md` are named without their cost

The section is accurate and does not overstate anything, which was the thing that mattered. Items
1, 4 and 5 carry the evidence: blinding `corpus.count_positions` to segments left three property
tests green while a cell of 3, an unsourced 9999 and the forbidden net figure of 219 published
clean; emptying `HOSTILE_INPUTS` reported nine controls as skipped; widening `sourced_figures`
left the suite green and would have passed an off-by-one transcription.

Items 2 and 3, the `kind == "count"` filter and `corpus.withheld_points`, are named and placed but
carry no cost. Both costs are in this file and are one clause each: blinding the filter with
`and "segments" not in path` left all 1383 passing, and rewriting `withheld_points` to yield
nothing left all 1390 passing. Adding them makes all five read the same way, which is what the
list is for.

### Note 3. The mutation-testing recommendation is the open half, and it is a real decision

`widgets/README.md` records it correctly: the vanish half is closed mechanically by one line, the
blind-helper half is not closed and the systematic form is mutation testing scoped to
`tests/gate/corpus.py`, `tests/gate/payloads.py` and the module-local helpers, with a
no-surviving-mutant criterion. All five instances found so far would have been surviving mutants
under it.

Phase 4 or 5 should decide it rather than inherit it. It needs network to install and it is the
only thing that would turn "nobody has found a sixth" into "nothing survives", so leaving it
undecided is the one way this limit quietly becomes permanent.

## Implementation notes

### IMPLEMENTATION 2026-08-01: Phase 4, the publish decisions and the last mile

1894 tests passing, verified offline in a network namespace with no interfaces. Up from 1485.
All twenty-one hostile sets re-measured through `python3 publisher/app.py <fixture>` after the
handler rewiring, and every one matches Phase-0 section 8 unchanged. Nothing in this phase
touches `publisher/gate/`, `contract.py` or any fixture.

#### The five phase verification steps

1. **Full suite offline.** 1894 passed, run under `unshare -rn` with only a downed loopback.
2. **All five valid fixtures print a write plan and a payload and exit 0.** Measured. The plan is
   on stderr and the payload on stdout, which is a deviation recorded below.
3. **All twenty-one hostile fixtures exit non-zero, print no payload, and plan zero writes.**
   Measured, and the third clause is measured directly: no plan is printed for any of them,
   `v1/data` appears in neither stream, and a recording sink is asked for nothing.
4. **`boto3` is imported in `sinks/s3.py` and nowhere else.** Both the token grep the criterion
   names and an AST walk over every import in `publisher/`.
5. **Break the hash by including `meta.generated`.** Run at both levels. At the hash level:
   4 failed, 1559 passed. At the plan level: 9 failed, 1826 passed, and an unchanged rerun under
   a new timestamp plans five writes rather than zero. Nothing else in the suite moves, which is
   the point. With that defect in place the right data goes to the right key with the right
   headers on every run, and the only symptom is that every run is a write.

#### Four places this phase differs from what the plan says, each recorded rather than adjusted to

1. **Task 2's fifth acceptance criterion cannot hold as written.** It asks that the bytes the
   hash is computed over be the same bytes a `Write` carries. They cannot be: the published
   object carries `meta.generated` because the contract requires it, and the hashed bytes must
   not carry it or the skip never fires, which is ADR 11. What is true is that one serializer
   produces both, asserted three ways in
   `test_the_hashed_bytes_are_the_published_bytes_with_the_timestamp_removed`.
2. **Task 1's acceptance regex and Task 3's constraint are in tension.** Task 1 bans
   `import datetime` in `publish.py`; Task 3 permits importing `datetime` for
   `date.isocalendar()`. `from datetime import date` satisfies the regex literally and is the
   form Task 3 asks for. The substantive rule is enforced by two real tests instead: an AST
   import allowlist of six standard library modules, and an AST name walk asserting `now`,
   `today`, `utcnow`, `environ` and `getenv` are referenced nowhere.
3. **Task 6's `rg -n 'boto3'` criterion failed on a docstring.** `app.py`'s metric docstring said
   the log line "needs no boto3 client", which is the opposite of a dependency and still trips a
   token search. Reworded to "AWS SDK client", which means the same and leaves the criterion able
   to say something. Both forms are tested.
4. **The stdout sink prints the plan on stderr, not on stdout.** Task 6 says it prints the plan
   then the payload and does not say on which stream. The split keeps stdout exactly the bytes
   that would be published, which is what makes ADR 12's invariant assertable from outside the
   process and what lets a local run be redirected into a file. The failure path already splits
   the same way.

#### Three additions the tasks do not name

- **The sink interface is three methods rather than two**: `current_hashes(keys)`,
  `read_json(key)` and `write(writes)`. Task 6 names two and separately says `app.py` fetches the
  previous index, and something has to read it. Giving the sink `read_json(key)` rather than a
  `current_index()` is what keeps it free of keys entirely: `app.py` calls
  `sink.read_json(publish.index_key())`, so every key comes from `publish.py` and
  `grep v1/data publisher/sinks/s3.py` returns nothing.
- **`Write` carries a `kind` and a `metadata`.** `kind` names which of the five objects it is, so
  the stdout sink can print the current payload without parsing a key to find it. `metadata` is
  what Task 6 requires the sink to pass through, and it is a tuple of pairs rather than a dict
  because a frozen dataclass holding a dict is frozen in name only.
- **`app.select_sink(environ)`.** The S3 sink needs choosing somewhere, and the environment is
  read in `app.py` because that is the module that owns it. It takes an optional client so a test
  can take the S3 branch without a real one.

#### One thing measured that the plan does not mention

A payload whose sections are present and empty passes the gate. Verified directly:
`gate({"meta": ..., "measures": {}})` returns `Passed` with no failures. It carries no `asOf` and
so describes no archive period. `period_for` refuses it by name rather than inventing one, since
inventing one would need a clock and there is none in `publish.py`. Recorded rather than fixed:
the gate is untouched by this phase, and an exception at that point writes nothing.

**Corrected at the code review.** The sentence above originally read "an exception at that point
is still fail closed at the handler, which writes nothing", quoting ADR 3, and the half it rested
on had never been run. Nothing was written, and no metric was emitted either, so the run was
silent on both streams and on the one metric the only alarm watches. `app.py` now emits
`PublishFailed` for any escaping exception and re-raises, and ADR 3 is corrected. The empty
payload itself is still the gate's business and is still not fixed here.

#### The CSV has eleven columns, and three of them are not in Task 4's list

Task 4 names section, id, label, value, `asOf`, cadence, universe and a withheld marker. Three
more earn their place rather than being added for symmetry. `figure` names the kind of position,
which is what tells a category row from the residual row from the universe row; without it a
reader summing the value column counts the universe among its own parts. `part` carries a segment
or component name, which has no cell among the eight. `unavailable` keeps ADR 8's distinction, and
one column for both would conflate a privacy state with an unpublished year.

The completeness assertion rests on `corpus.count_positions`, the walker the gate's own small
cell, provenance and excluded figure properties rest on, rather than on a second walker written
in `tests/publisher`. That one is pinned by exact per fixture counts, so a blind spot in it goes
red there instead of making the CSV test quieter. The comparison is a multiset, not a set: a CSV
dropping one of `annual.json`'s two 197s passes a set comparison and is what a spreadsheet reader
would then add up wrong. Eighty-four figures across the five fixtures, and the count is asserted.

#### The audit for the Phase 2 defect shape, run against this phase's own tests

Two instances, both found by degrading the helper and re-running rather than by reading it.

1. `test_publish_index.strings_in` mediates an assert-empty. Rewritten to yield nothing, all 1891
   passed.
2. `test_publish_hash.regenerated` stands between every ADR 11 assertion and the thing it is
   about. With the timestamp assignment removed, all 1891 passed, and the module would have been
   comparing a payload against itself.

Both pinned, both verified red against the same degradation at 4 failed. A third was found by the
mutation run below.

**One process note, because the first attempt at this measurement was wrong in the way Clause 4
names.** The first degradation put the early return after `strings_in`'s `isinstance(node, str)`
guard, which still yields dict keys, so the helper was not blinded at all. A temporary
prove-the-landing test module inside the same pytest invocation is what caught it, failing on its
own first assertion before the suite ran. Both recorded runs are with the landing proved that way.

#### Mutation testing, decided by running it

Phase 3's Note 3 asked Phase 4 or 5 to decide this. Decided, adopted scoped to the walkers and
parsers, and run. Full detail in `widgets/README.md`; the short version:

- `mutmut` 3.7 does not run against this layout. Its trampoline is keyed by fully qualified module
  path and stops with "tests recorded trampoline hits but none match any mutant key": the suite
  imports the helper as `corpus`, mutmut expects `tests.gate.corpus`. Adopting it means making
  `tests/` a package.
- `mutmut` 2.4.4 does run, mutating in place. Its own reporting raises `IndexError` in pony's
  bytecode decompiler on Python 3.13, so results come out of `.mutmut-cache` with `sqlite3`.
- `tests/gate/corpus.py`: **62 killed, 1 survived, 63 mutants**, and 62 killed with none
  surviving once the dead helper is deleted. The survivor is the eighth instance of the
  blind-helper class and the first found by a tool rather than by someone suspecting the right
  helper: `hostile_names()` with its glob mutated to match nothing kills no test, because nothing
  calls it. Dead test-support code, unpinned because it had no caller. Deleted, and deleting it
  left all 1894 passing.
- `tests/gate/payloads.py`: **179 killed, 36 survived, 215 mutants.** Corrected at the code
  review; this note first recorded 61 and 10, which was a partial run read before it finished.
  61 + 10 + 144 untested = 215. Twenty of the thirty-six are string-literal mutations and all
  but two of the rest are equivalent in the tests' terms, so the conclusion is unchanged: a
  no-surviving-mutant criterion over that module would be a suppression list pretending to be a
  control, which is why the criterion is scoped to the walkers. The two that are not equivalent
  are `minCell` and `having_bug`'s 1284, both handled in the review resolution.

#### The other two carried notes

- **Note 1.** The `COUNT_KIND_POSITIONS` row is corrected in place to 6 failed, 1479 passed,
  exit 1, with the reason it was never a row about `empty_parameter_set_mark` at all.
- **Note 2.** Items 2 and 3 of the blind-helper list in `widgets/README.md` now carry their costs,
  1383 and 1390 passing.

#### The deliberate breakages

Twenty-four across the six tasks, each proved in effect before the run and each recorded in its
commit body with its measured failure count. Two are worth naming here for what went wrong with
the measurement rather than for the result.

- The Task 1 CSV content type breakage reported "degradation did not land" while it was in effect.
  The landing proof asserted the old text was gone, which an insertion never satisfies. Re-run
  with the landing proved by calling `content_type` on a `.csv` key: same 10 failures.
- The Task 5 archive key breakage did not apply at all on the first attempt, and the guard is why
  that is visible rather than a false green. `archive = archive_key(cadence, period)` appears
  twice in the module, so the edit refused rather than replacing the wrong one.

Both are the same lesson from opposite directions, and it is the one Clause 4 was added for: the
proof that a degradation landed is a thing that can itself be wrong.

### IMPLEMENTATION 2026-08-01: Phase 3, measured failing sets

All twenty-one hostile fixtures, measured through `python3 publisher/app.py <fixture>` and read
off the `PublishFailed` metric rather than off the gate in a unit test. Every one exits 1 and
prints no payload on stdout.

| Fixture | Section 8 expects | Measured in Phase 3 |
|---|---|---|
| `01-shape-looker-error.json` | {1} | {1} |
| `02-allowlist-client-id.json` | {2, 5} | {2, 5} |
| `03-cardinality-row-explosion.json` | {3} | {3} |
| `04-type-formatted-string.json` | {4} | {4} |
| `05-pii-email-in-label.json` | {5} | {5} |
| `06-suppression-named-small-cell.json` | {6, 7} | {6, 7} |
| `07-reconciliation-off-by-one.json` | {7} | {7} |
| `08-live-second-measure.json` | {2, 8} | {2, 8} |
| `09-live-population-floor.json` | {9} | {9} |
| `10-live-segmented.json` | {2, 8} | {2, 8} |
| `11-parenting-youth-households.json` | {2} | {2} |
| `12-clients-on-cq-multiple-times.json` | {2, 5, 8} | {2, 5, 8} |
| `13-series-small-point-folded.json` | {2, 6} | {2, 6} |
| `14-suppressed-residual-discloses.json` | {6} | {6} |
| `15-segment-not-registered.json` | {2} | {2} |
| `16-cq-households.json` | {2} | {2} |
| `17-denominator-mismatch.json` | {7} | {7} |
| `18-precision-rounded.json` | {4} | {4} |
| `19-withheld-point-carries-value.json` | {2, 6, 7}, edited | {2, 6, 7} |
| `20-bool-as-count.json` | {4} | {4} |
| `21-series-carrying-segments.json` | {2} | {2} |

`19` is the one set that differs from what Phase-0 section 8 held before this phase, and section
8 is edited to match rather than the fixture. A point carrying both `withheld` and `value` breaks
the point level's exactly-one-of rule, which is check 2's, and there is no way to write "a
withheld point carrying a value" that does not. The fixture was not bent to hide it.

#### Three corrections to Phase-0, none of them a measured set

1. **Section 8's interactions bullet contradicted its own table on `13`.** The bullet said `06`,
   `13` and `19` break a total as well as a suppression rule; the table row for `13` says {2, 6}.
   Both cannot be right. The table is the authority (the third plan review parsed it as such), so
   `13` is built to reconcile: its `total` is the sum of its two published points, and the fold is
   refused on check 6's own terms, which `Phase-3.md` Task 3 says is the point of the fixture. The
   bullet is corrected and now explains why `13` is the odd one.
2. **Section 9 called `aliceThreshold` "the one breakdown with no residual at all".** That was
   true when three cadence files existed. Section 9's own weekly description specifies
   `olderAdultsOnCq` with 181 + 137 = 318, which leaves nothing over, so there are two. Corrected,
   and `test_alice_threshold_is_the_one_breakdown_with_no_residual` is renamed to
   `test_the_two_exhaustive_breakdowns_carry_no_residual` and now covers both. The old test would
   have kept passing while its name claimed something false, which is the defect class the Phase 2
   review named.
3. **Section 8's row for `19`**, above.

#### Two rules check 6 carries that Phase-0 section 7 does not list

Section 7's check 6 row names "a named category, measure, point or `residual` value in 1 to 4".
Segments and components are the same rule at the two count positions it does not name, and both
are covered. `inflow.segments.veterans` at 3 is three veterans, named, and
`points[2].components.sheltered` at 3 is three sheltered people.

This is not a widening for its own sake. The Phase 2 re-review used exactly
`inflow.segments.veterans` at 3 as its demonstration of a sub-threshold cell, and
`corpus.count_positions` already treats both as published figures, so leaving them out would have
left a hole the small-cell property test can see and the gate cannot.
`test_check_6_fires_at_every_count_position_a_small_cell_could_reach` is what holds the two to the
same coverage: it plants a 3 at every count position the walker yields whose registry kind is
`count`, and requires check 6 to name that exact path. Blinding check 6 to segments turns it red
for `annual.json` while the property test stays green, which is why it exists.

The same reasoning extends the rule to a breakdown `universe` and a series `total`. Both are
published counts, and a universe of 3 is a population of three people however it is labelled.

#### Two rules check 7 carries that Phase-3 Task 4 does not list

Both are implied by `reconciles` rather than added to it, and both are recorded so they read as
decisions.

1. **A series the registry marks `reconciles` and that states no `total` fails.** The allowlist
   makes `total` optional because `pitCount` has no meaningful sum across years, so the
   requirement has to live where the registry can say which series it applies to. Without it a
   reconcilable series could omit the one figure the rule compares against and pass.
2. **A breakdown with no `suppressed` block is not reconciled at all.** The sum is unknowable
   rather than wrong, and reporting a reconciliation failure would be a guess at what was folded.
   Checks 2 and 6 both name the real defect, which is the missing block.

#### The deliberate breakages, and one result that did not go as the plan expected

Phase-3's verification lists two mandatory breakages. Both were run, and the second measured
something the plan did not anticipate.

**Step 4, a tolerance of one in check 7.** As expected. `07-reconciliation-off-by-one.json`
publishes at exit 0, putting a breakdown whose parts sum to 4241 under a stated universe of 4242
on stdout. Nine tests failed, including both off-by-one cases and all four of `07`'s paths through
`test_app.py`.

**Step 5, removing check 6's withheld-point rule. Fixture `19` does not pass.** It still exits
non-zero, reporting {2, 7}: check 2 catches the point carrying two value states, and check 7
catches the leaked value being counted once among the published points and once inside the
withheld residual. Removing the allowlist's exactly-one-of rule as well still leaves it failing
{7}. Only with check 7's series total rule removed too does it publish, at exit 0, printing
`{"label": "2025-02", "value": 2, "withheld": true}`.

That is a better result than the plan expected and it is worth stating plainly: the disclosure
this fixture carries is guarded by three independent controls, and no single one of them is
load bearing on its own. The plan's step 5 assumed one.

Fifteen further breakages were run across the six tasks and are recorded in the commit bodies
with their measured failure counts. The ones worth naming here:

- Removing check 7's cross-measure rule publishes `17-denominator-mismatch.json` at exit 0. That
  fixture reconciles internally against a universe of 2905 while the headline measure in the same
  payload publishes 1263, which is `docs/FINDINGS.md` section 1 exactly, so rule 1 never sees it.
  Rule 2 is the only control on it.
- Hardcoding `MIN_CELL` as a literal 5 inside check 6 fails only the two stub-contract tests and
  nothing else, because every other assertion in the module uses the constant at its real value.
  That is the `test_the_ceilings_are_the_contracts` defect from Phase 2, caught before shipping
  rather than at review.
- Blinding `corpus.count_positions` to a series total and withheld block fails only the three
  tests in `test_count_positions.py`. The small-cell and provenance property tests stay green
  while covering less, which is the Phase 2 finding reproducing on the two new fixtures, and is
  why `POSITION_COUNTS` gained an exact count for each of them.
- Planting a cell of 3 in `weekly.json`, with the universe and its bound measure moved so the
  breakdown still reconciles, is refused end to end: seven tests fail and `app.py` exits 1.

#### The image was re-read, and the third reading agrees

`Phase-3.md` Task 5 requires opening `docs/reference/community-queue-overview.png` before writing
the monthly fixture rather than trusting two prior readings. Done, and nothing was corrected. The
twenty bar values are 81, 10, 2, 2, 3, 38, 35, 15, 23, 7, 58, 45, 71, 49, 72, 117, 160, 147, 177,
206. The axis labels sit on the even-numbered bars, with "January '25" under bar 2 and "July"
under bar 20, which places bar 1 at December 2024 and bar 20 at July 2026. Both sums re-derived:
1311 published, 2 + 2 + 3 = 7 withheld, 1318 total.

#### The audit for the Phase 2 defect shape, run before reporting rather than after being asked

The standing rule's instruction is to assume the same shape exists in what I wrote and go looking
for it. Two instances were found by attacking my own assertions rather than reading them, and both
are fixed.

**Found, and fixed.**

1. `test_a_breakdown_missing_its_suppressed_block_is_not_reconciled_at_all` was written against
   the real race and ethnicity breakdown, whose categories and residual already sum to its
   universe. A check treating a missing `suppressed` block as a zero gets the same answer on that
   payload, so the test passed under both behaviours and established nothing. Measured: making
   check 7 default the block to zero left all 1382 passing. It now uses a universe 21 higher than
   the parts, with the bound measure moved so the cross-measure rule stays quiet, and a paired
   test asserts the same breakdown reconciles with a real block of 21 and not with 20. Verified
   red against the zero-defaulting behaviour: 1 failed, and it is the only one.
2. `count_kind_positions`, the `kind == "count"` filter the check 6 coverage test layers on top of
   `corpus.count_positions`, was pinned by nothing. `corpus.count_positions` is pinned by
   `test_count_positions.py`, but a blind spot in the filter above it would make the coverage test
   quieter rather than red. Measured: adding `and "segments" not in path` to the filter left all
   1383 passing. It now carries an exact count per fixture and a named set of what it drops, and
   the dropped ids are asserted to be exactly the non-count kinds. Verified red with the same
   edit: 2 failed, both new.

The second one is the Phase 2 finding reproducing one layer up, which is worth stating plainly. A
walker gets pinned, a filter is added above it, and the pin does not reach the filter.

**Examined and cleared, each attacked rather than read.** Every empty-result assertion added in
this phase was run against the behaviour it denies.

- Check 6's kind exemptions (`test_a_percent_is_not_a_cell`, `test_an_average_is_not_a_cell`,
  `test_a_currency_is_not_a_cell`). Removing the kind gate fails 12, covering every parameterized
  case from 1 to 4. The 45 case that `Phase-3.md` names does not discriminate, since 45 is above
  `MIN_CELL` under any rule; the 1 to 4 cases are what make the assertion mean something, and both
  are in the same parameterization.
- `test_a_series_the_registry_does_not_reconcile_needs_no_total` and
  `test_a_point_with_no_components_is_not_reconciled`. Removing check 7's `reconciles` gate fails
  14, including `annual.json` end to end. Treating a missing `components` block as an empty sum
  fails 27.
- `test_the_arithmetic_is_integer_throughout` and
  `test_a_float_category_is_left_to_check_4_rather_than_summed`. Widening `_is_whole` to accept
  floats fails the second one.
- `test_the_rule_does_not_fire_when_the_universe_measure_is_absent`. Treating an absent measure as
  a zero fails 6, including fixtures `03` and `05`, which would each gain a spurious check 7.
- `test_check_6_fires_at_every_count_position_a_small_cell_could_reach` cannot go red on a blind
  spot in the walker it uses, and that is accepted under the rule's compensating-control clause.
  The named tests covering that ground are `test_count_positions.py`'s
  `test_the_walker_reaches_exactly_as_many_positions_as_the_fixture_holds` and
  `test_the_walker_reaches_every_kind_of_position_the_fixture_holds`, both run red by blinding
  `corpus.count_positions` to a series total and withheld block, and the filter above it is now
  covered by the two tests added in the item above.
- `test_every_registered_id_belongs_to_exactly_one_cadence` looks structurally guaranteed, since
  an `Entry` carries one cadence. It is not: an entry whose cadence is outside `CADENCES` drops out
  of the partition. Run red by writing `biweekly`.

#### One departure from the task ordering

`Phase-3.md` Task 6 says to register checks 6 and 7 in the check list. They are registered in
Tasks 2 and 4 instead, at the commit where each check and its hostile fixtures land, so that every
commit is green. Task 6 keeps everything else it asks for: the check list asserted to be exactly
nine in the documented order, the union of expected failing sets asserted to cover all nine ids,
and the end-to-end expectation table extended.

One consequence is visible in the history and is deliberate: fixture `06` reads {6} in the Task 2
commit and widens to {6, 7} in the Task 4 commit, with the test docstring saying so at each point.
That is the pattern Phase 1 used for fixture `02` before check 5 existed.

### IMPLEMENTATION 2026-08-01: Phase 2, measured failing sets

All thirteen hostile fixtures that exist at the end of this phase, measured through
`python3 publisher/app.py <fixture>` and read off the `PublishFailed` metric rather than off the
gate in a unit test.

Recorded as of the code review, which moved one of them. `12` is the only set that differs from
what Phase-0 section 8 held before this phase, and section 8 is edited to match rather than the
fixture or the check.

| Fixture | Section 8 expects | Measured in Phase 2 |
|---|---|---|
| `01-shape-looker-error.json` | {1} | {1} |
| `02-allowlist-client-id.json` | {2, 5} | {2, 5} |
| `03-cardinality-row-explosion.json` | {3} | {3} |
| `04-type-formatted-string.json` | {4} | {4} |
| `05-pii-email-in-label.json` | {5} | {5} |
| `08-live-second-measure.json` | {2, 8} | {2, 8} |
| `09-live-population-floor.json` | {9} | {9} |
| `10-live-segmented.json` | {2, 8} | {2, 8} |
| `12-clients-on-cq-multiple-times.json` | {2, 5, 8}, edited | {2, 5, 8} |
| `15-segment-not-registered.json` | {2} | {2} |
| `18-precision-rounded.json` | {4} | {4} |
| `20-bool-as-count.json` | {4} | {4} |
| `21-series-carrying-segments.json` | {2} | {2} |

Phase 1's only disagreement is closed: `02` widened from {2} to {2, 5} when check 5 registered,
which is exactly what its test docstring said would happen. It is {2, 5} and not {2, 4, 5},
because check 4 reads only the keys the contract names and `clientId` is not one of them.

`12` widened too, from {2, 8} to {2, 5, 8}, which section 8 did not anticipate:
`clientsOnCqMultipleTimes` contains `client`, so the scan fires on the id itself. Three
independent controls reporting the same object is what Phase-0 decision 8 asks for.

Phase-2's Integration points calls the check 2 against check 4 cadence collision the predictable
failure of this phase. It did not happen, and it is pinned by two tests rather than left to the
fixtures: `test_check_4_never_consults_the_registry_about_cadence` and
`test_an_unregistered_id_has_no_declared_precision_to_disagree_with`.

#### The check 5 id exemption, tried and removed

Superseded by the code review, and left here rather than deleted because the mistake is the
useful part.

`Phase-2.md` Task 4 makes `client` a PII key substring and says the scan covers key names. The
plain reading scans every key, and `clientsOnCqMultipleTimes` is an excluded id and is a key, so
it puts fixture `12` at {2, 5, 8} rather than the {2, 8} then recorded in four places. I exempted
entry ids the contract names, in `REGISTRY` or in `EXCLUDED`, on the ground that an explicit
ruling says more than a shape.

That was wrong, and the reviewer named why. The two halves of that union have opposite risk
profiles. For an excluded id, check 2 always fires with a named reason and the payload can never
publish, so suppressing a second finding costs nothing; that is the half my justification
described. For a **registered** id, check 2 does not fire at all, because the id is publishable,
so the key scan is the only control on that name, and the exemption is precisely what removed it.
The carve-out was scoped to exactly the wrong union, and I reasoned about the safe half and
applied the conclusion to both.

The exemption is gone in `0a138dc`, fixture `12` is {2, 5, 8}, and Phase-0 section 8 and the two
other locations that carried the old set are edited to match. A payload's set getting one element
wider is the smaller change; bending the check altered behaviour for every payload the gate will
ever see.

The guard I offered for it is the more important half of the finding, and it is in the resolved
review under Item 3.

#### Two readings of Phase-0 section 9, and one contract field widened

1. **ALICE kinds.** Section 9 lists five ALICE figures and closes the sentence with
   "(kind `currency`)". Only the last three are dollars. `aliceHouseholdsBelowThreshold` 80224 and
   `aliceHouseholdsAboveThreshold` 130892 are household counts and are registered `count`, since a
   currency kind would have a widget render 80,224 households as money.
2. **`asOf` follows the vintage of the figure, not the file.** Annual measures are 2025-12-31
   except the national average and the five ALICE figures, which are 2024 data and carry
   2024-12-31. `pitCount` carries the count date 2026-01-29, which is the reason the plain-date
   form of `asOf` exists alongside the timestamp form.
3. **`Entry.span` is a `(first label, last label)` tuple rather than a string.** Phase-0 says a
   span recorded now cannot be invented later. As a pair of labels a test can hold the fixture to
   it, which a prose string cannot, and
   `test_a_series_runs_from_the_first_to_the_last_label_its_registry_entry_records` does. No field
   was added or removed.

#### Check 4 rules that Phase-0 section 7 does not list

Section 7's check 4 row is the authority and was followed. Three additions sit inside ADR 4's
"leaf types and domains" and are recorded here so they read as decisions: `meta.schemaVersion`
must equal the contract's, `meta.minBundle` and `minCell` must be whole numbers of at least one,
and `points`, `categories`, `segments`, `components`, `residual`, `suppressed` and `withheld` must
be the container type the contract says they are. The `minBundle` rule is what finally refuses the
unparseable `MIN_BUNDLE` that `app.py` deliberately passes through rather than repairing.

**A fourth rule, added at review.** Section 7 requires a `precision` other than the registered
value to fail and is silent on `kind`. I first left that gap open, on the ground that an unlisted
check 4 rule could move a recorded failing set in Phase 3. Measured, that risk is zero: the rule
changed no test and moved no set. The objection was also inconsistent with the three rules above,
which were added on the same footing. `kind` and `precision` are now validated by one function,
`_declared_failures`, and a declared kind that disagrees with the registry fails. It is an honesty
defect closed rather than a gate hole: the domain rule applied to a figure is selected by the
registry's kind and never by the declared one, so nothing was ever bypassed. What it prevents is
the failure `contract.py` names in its own comment above the ALICE entries, a widget rendering
80,224 households as a sum of money.

### IMPLEMENTATION 2026-08-01: Phase 1, measured failing sets

Recorded per `Phase-1.md` Task 6, which requires a measured set differing from Phase-0 section 8
to be written down with its reason rather than the fixture bent to match.

| Fixture | Section 8 expects | Measured in Phase 1 | Reason |
|---|---|---|---|
| `01-shape-looker-error.json` | {1} | {1} | agrees |
| `02-allowlist-client-id.json` | {2, 5} | {2} | check 5 is registered in Phase 2 |
| `08-live-second-measure.json` | {2, 8} | {2, 8} | agrees |
| `09-live-population-floor.json` | {9} | {9} | agrees |
| `10-live-segmented.json` | {2, 8} | {2, 8} | agrees |
| `12-clients-on-cq-multiple-times.json` | {2, 8} | {2, 8} | agrees |

Only `02` differs, and it differs by exactly the check that does not exist yet. Its test asserts
`{2}` against the registered check list and its docstring says the Phase 2 implementer widens it
when check 5 lands.

Read against Phase 2: the "Section 8 expects" column above is what section 8 held at the time.
Section 8's row for `12` was later edited to {2, 5, 8}, because check 5 fires on the id itself.
The Phase 1 measurements are unchanged and were correct for a gate with no check 5.

Three construction choices in Phase 1 that section 8 does not state, each made to preserve the
set section 8 records:

1. **`02` puts `clientId` at measure level, not inside a category.** Section 8's interactions
   bullet describes it inside a category. A category needs a breakdown, the only valid base in
   this phase is `live.json`, and a live payload carrying a breakdown fires check 8, which would
   make the set {2, 8} and lose the {2, 5} the table records. At measure level the key is unknown
   at its level and is id-shaped in both key and value, so check 2 fires now and check 5 will fire
   in Phase 2.
2. **`12` carries a fabricated 8888 rather than the real 1.** The attack is that the id is
   unpublishable, not what it counts. A value of 1 would additionally fire check 6 in Phase 3 and
   make the set {2, 6, 8}.
3. **`08`, `10` and `12` use 4242 and 777 rather than real figures**, per Task 6's
   obviously-fabricated constraint, and all stay above `LIVE_POPULATION_FLOOR` so check 9 does not
   join the set. `09` is the stated exception and reuses 28, because the veteran count is the
   attack.

One further division of labour Phase-0 implies but does not state, pinned by `01`: **check 1 owns
the top level exclusively and check 2 owns every level below it.** If check 2 also reported
unknown top level keys, a Looker error object would read {1, 2} rather than the {1} section 8
records. `test_check_2_leaves_the_top_level_to_check_1` asserts it directly.

## Resolved Feedback

### CODE_REVIEW 2026-08-01: Phase 4, re-review

Status: RESOLVED
Verdict: CHANGES_REQUESTED, the outstanding ruling is landed and both notes are taken.

Both blocking items from the first review are resolved, every one of the four notes is resolved,
and the audit turned up a second instance of the defect that is real, correctly diagnosed and
correctly fixed. All of it was re-measured here rather than read. 1914 passed, reproduced, and
reproduced offline under `unshare -rn` with loopback down. Scope clean, prose clean.

One outstanding item, which is a ruling landing rather than a defect, and two notes.

---

#### Item 1, OUTSTANDING. The `minCell` rule was ruled in and is not in the tree

Not a criticism of how this was handled. Measuring it and leaving the decision to the reviewer was
the right call for a gate change in an approved phase, and the measurement was accurate. The
ruling has now been made: it goes in. The phase cannot close with a ruled-in change unmade.

**The measurement was verified rather than the reasoning, and every line of it holds.** Built
independently here, shaped like `_declared_failures`, with the landing proved before the run:

| Claim | Independently measured |
|---|---|
| Recorded sets that move | **0 of 21**, re-measured end to end through `app.py` |
| Tests that change | **0.** 1914 passed with the rule added and no test edited |
| A breakdown declaring `minCell: 6` | refused, `check_4_type_and_domain` at `breakdowns.raceEthnicity.minCell` |
| A series declaring `minCell: 6` | refused, `check_4_type_and_domain` at `series.cqReferrals.minCell` |
| `minCell: 0` | reports **once**, at one path, not twice |
| The five valid fixtures | all still pass, all still plan five objects |

The double-reporting concern is real and the fix for it is the shape that was described. A rule
guarding only on integer-ness makes `minCell: 0` fire twice at one path and breaks
`test_a_universe_a_min_cell_and_a_suppressed_block_are_checked`, which asserts an exact path list.
The version that works is the domain violation **or** the disagreement, never both. For the
avoidance of ambiguity, this is the shape that measures as above:

```python
def _min_cell_failures(path, value) -> list[Failure]:
    domain = _whole_number_failures(path, value, 1)
    if domain:
        return domain
    if value == _contract.MIN_CELL:
        return []
    return [_fault(path, f"the publisher suppresses below {_contract.MIN_CELL}, received "
                         f"{describe(value)}")]
```

called from both existing `minCell` sites in `_series_failures` and `_breakdown_failures`, which
today call `_whole_number_failures` directly. Note `_contract`, not `contract`: `checks.py` binds
the module as `_contract`, and referencing the wrong name is what made the first attempt at this
measurement report 123 failures and 8 empty sets. **The table above is from a run where the
landing was proved first**, which was checked as asked: the unmodified quarterly fixture passes,
`minCell: 6` fires, and `minCell: 0` reports once, all confirmed before the suite was trusted.

Two things to decide while writing it, neither of which changes the measurement:

- **Equality is symmetric and the stated risk is not.** The dangerous direction is `minCell: 10`
  against a publisher that suppressed at 5, which claims protection that does not exist. A
  `minCell: 3` understates protection and endangers nobody, but it is still the payload making a
  false statement about itself. Equality refuses both, matches `_declared_failures`' own shape,
  and costs nothing measured. Recommend equality, with the asymmetry stated in the docstring so
  it reads as a decision rather than an oversight.
- **The extension point, if a per-breakdown threshold is ever wanted**, is a registry field, at
  which point the rule becomes a lookup and is `_declared_failures` exactly. Worth one line in the
  docstring, because the constant right-hand side is the only thing that makes this rule different
  from the two beside it.

Check 4 is the right home. Section 7 puts "a `precision` other than the registered value" there,
this is the same family, and it is what keeps all twenty-one sets stable. A hostile fixture is not
required: `Phase-0.md` section 8 is a fixed inventory of twenty-one and adding a twenty-second
would move a count that four documents assert. Unit coverage in
`tests/gate/test_check_4_type_and_domain.py` is the proportionate place, with the `minCell: 0`
single-report case pinned, since that is the one an obvious implementation gets wrong.

---

#### Item 2, RESOLVED and verified. The entry-point instance

This is the finding, and it is a good one. Reproduced before and after, in a tree checked out at
`6b57b61` for the before, driving both entry points with output captured:

```text
BEFORE the entry-point guard (6b57b61)
  handler with no path at all           outcome=PublishFailed        metrics=0
  handler, BUCKET set, boto3 absent     outcome=ModuleNotFoundError  metrics=0
  main, BUCKET set, boto3 absent        outcome=ModuleNotFoundError  metrics=0

AFTER (9d3d699)
  handler with no path at all           outcome=PublishFailed        metrics=1  Cadence=unknown
  handler, BUCKET set, boto3 absent     outcome=ModuleNotFoundError  metrics=1  Cadence=unknown
  main, BUCKET set, boto3 absent        outcome=ModuleNotFoundError  metrics=1  Cadence=unknown
```

The other three paths were already correct at `6b57b61` and stay correct: unplaceable payload
(`Cadence=quarterly`), rejected payload, unreadable file. A valid payload emits no metric at all,
which is the control that stops "always emit" from passing this.

**`app.guarded` covers both entry points**, confirmed at `app.py:358` and `app.py:381`, and
removing it from both turns 3 tests red rather than the 2 recorded, because the recorded
degradation removed it from `handler` alone. Better than recorded, not worse.

**`report_crash` is genuinely idempotent per exception**, attacked from three directions:

- The same exception instance handed to `report_crash` three times emits **one** metric line and
  one stderr report.
- A second, different instance immediately after emits a second. The marker is on the instance,
  not the module, so a warm container does not go quiet after its first failure. Confirmed at the
  process level too: three consecutive distinct failures in one interpreter, then a different
  failure, then a rejection, then a valid payload, each emitting exactly the right number.
- The rejection path emits one metric, not two, and it keeps its **real** cadence:
  `09-live-population-floor` reports `Cadence=live`, not overwritten to `unknown` by the outer
  guard. Removing `already_reported` from the rejection raise turns `test_the_handler_fails_
  closed_on_a_rejected_payload` red, reproduced.
- Removing the idempotence check turns 3 red, reproduced exactly.

**The traceback still escapes.** Measured at the process level across every path: the crash cases
exit non-zero with exactly one metric line on stdout, the named `PublishFailed:` line on stderr,
**and** the original traceback below it. The clean rejection has no traceback, which is the right
distinction. The original exception type is preserved in every case, so nothing is swallowed into
a `PublishFailed`.

**All twenty-one hostile sets still hold** end to end, each with one metric line, no `error` key,
and a non-zero exit. All five valid fixtures still plan five objects and exit 0.

#### Item 3, RESOLVED and verified. The mutation figure and its cause

- `corpus.py` on the current tree, re-run to completion: **62 killed, 0 survived, 62 mutants.**
  Exactly as claimed. The criterion is met over that module.
- `payloads.py`: 179 / 36 / 215 was already reproduced in the first review, twice.
- **The cause is established, not guessed, and the guard against it works.** `untested` is a real
  `mutmut` status, and the README's assertion fires on precisely the scenario that produced the
  wrong figure. Demonstrated by killing a run partway and reading the cache the way the original
  measurement did:

  ```text
  cache read MID-RUN: {'bad_survived': 6, 'ok_killed': 22, 'untested': 187} | total 215
  README assertion: FIRED -> the run did not finish
  ```

  Same arithmetic as 61 + 10 + 144 = 215. A working control rather than a decorative one, which
  is the distinction this whole phase has been about.
- **`having_bug`'s survivor is pinned and the pin works.** Run red against the exact mutation the
  tool found, at both assignment sites independently, with the landing proved first: 2 failed each
  time, and the paired test is what catches the site the direct assertion does not.

#### Notes 2, 3 and 4, RESOLVED

The criterion's scope is narrowed to what `mutmut` can be pointed at, with the by-hand half named
and pointed at the review's blinding table. `HASH_METADATA`'s docstring now states the lowercase
constraint, the exact symptom of breaking it, and that nothing here can catch it, which is more
than was asked for. `tests/gate/corpus.py` in the diff is accepted as recorded. The README's stub
bullets are in and accurate.

**ADR 3's correction is right.** It states the fact, records that it was false from Phase 1 until
the Phase 4 review, names the three paths, and states the lesson in the document later phases
inherit from. That is the correct place for it.

#### The other fail-safe claims, spot-checked as asked

**ADR 2 holds under attack**, made to fail in five directions rather than read: `Passed.failures`
raises `AttributeError`, `Rejected.payload` raises `AttributeError`, `Rejected(())` raises
`ValueError`, both types are frozen, and a `Rejected` from the real gate over a real hostile
fixture exposes no `payload`. "Publish this bit anyway" cannot be written.

**Phase 2's `MIN_BUNDLE` claim holds** end to end: `MIN_BUNDLE=four` through argv exits 1 with
`check_4_type_and_domain` and the detail `this is a whole number of at least 1, received the
string "four"`. Passed through rather than repaired, exactly as recorded.

One prose point: the resolution says "Three were checked and hold" and then lists two items, ADR
2's (which is itself three assertions) and the `MIN_BUNDLE` note. Both hold. Only the count reads
oddly.

---

#### Note A. The reporter has no guard of its own, and it is the same shape one level in

Found by doing to `report_crash` what this phase did to everything else: making it fail rather
than reading it. If the escaping exception's `__str__` raises, `crash_metric` raises inside the
`except` block, and two things happen at once:

```text
a sink raising an exception whose __str__ raises:
  outcome:                       RuntimeError   (the reporter's, not the sink's)
  metric emitted:                False
  original exception preserved:  False
```

No metric, and the original exception is replaced by the reporter's. That is the defect this
phase just fixed, sitting inside the fix, which is the same recursion that found the entry-point
instance.

**It is a note and not an item, and the reason is reachability.** The entry-point instance was
reachable from ordinary misconfiguration. This one needs an exception type whose `__str__`
raises, and nothing in this system produces one: the gate raises ordinary exceptions,
`publish.py` raises `ValueError`, `file_source` raises `OSError` and `JSONDecodeError`,
`select_sink` raises `ModuleNotFoundError`, and botocore's `ClientError` formats its message in
`__init__` and stores it. So this is not currently reachable and does not justify a fix now.

Worth recording for two reasons. It is the honest answer to "is the guard itself guarded", which
nobody had asked yet. And Phase 7's Looker source is where arbitrary third-party exception types
first enter this system. If anyone does act on it, the shape is a bare
`except Exception: pass` around the two `print` calls in `report_crash` only, so a broken reporter
costs the metric but not the original traceback, which is the more valuable of the two.

#### Note B. On `TreatMissingData: notBreaching`, which is Phase 5's but is being framed in a way that invites the wrong fix

Genuinely Phase 5's to implement. But "the same shape as this finding with a longer fuse"
undersells one difference and, more importantly, points at the wrong lever.

**It is not the same shape, and the difference is what makes it unfixable from inside `app.py`.**
The finding just closed was a failure the system observed and did not report; instrumentation
closed it. A run that never happens is a failure the system never observes, because the process
does not start. No metric emitted from inside the function can close that, by construction. The
same is true of a Lambda timeout, which kills the process without unwinding, so no `except` runs
and no metric is emitted, and of anything that reaches `guarded` as a `BaseException` rather than
an `Exception`. `guarded` catching `Exception` and not `BaseException` is the correct choice and
should not change; the timeout case simply belongs in the same family as the never-ran case.

**And `TreatMissingData: notBreaching` is the right setting and must not be flipped.** The
`PublishFailed` metric is absent on every successful run by design, so `breaching` would put the
stack into permanent alarm. Anyone reading "notBreaching still means a run that never happens is
green" quickly will reach for that setting, and it is the one change that makes things worse.

So it needs saying louder, in one specific way: **the note should say that the fix is a second,
different control and explicitly not a change to `TreatMissingData`.** The candidates are a
success heartbeat metric with its own alarm on missing data, an alarm on the EventBridge rule's
`FailedInvocations`, or a staleness check on the current object's `LastModified`, and choosing
between them is Phase 5's. Saying only "notBreaching has a hole" without saying that hands the
next phase a correct observation attached to the wrong knob.

---

#### Resolution

The one outstanding item is landed and both notes are taken. 1929 passing, up from 1914.

**Item 1, OUTSTANDING. RESOLVED in `4d621d4`.** `_min_cell_failures` is in check 4, called from
both `minCell` sites, shaped as the review wrote it: the domain violation or the disagreement,
never both.

Equality, as recommended, with the asymmetry stated in the docstring so it reads as a decision.
The dangerous direction is a declared threshold above the enforced one, which claims a protection
that was never applied; a threshold below it endangers nobody and is refused anyway, because it is
still the payload making a false statement about itself, because equality is the shape the two
fields beside it use, and because it costs nothing measured. The extension point is recorded too:
a per-breakdown threshold would be a registry field, at which point this becomes
`_declared_failures` exactly.

Re-measured with the rule landed, reproducing the review's table:

| Claim | Measured |
|---|---|
| Recorded sets that move | **0 of 21**, end to end through `app.py` |
| A breakdown declaring `minCell: 6` | refused at `breakdowns.raceEthnicity.minCell` |
| A series declaring `minCell: 6` | refused at `series.cqReferrals.minCell` |
| A breakdown declaring `minCell: 3` | refused |
| `minCell: 0` | 1 finding at 1 path |
| The five valid fixtures | all pass, all plan five objects |

**One departure from the snippet, and the review's own point about `_contract` is the reason for
it.** The snippet referenced `_contract` directly because the enclosing helpers do not bind a
contract. Rather than reach past the parameter, `contract` is threaded through `_series_failures`
and `_breakdown_failures`, both defaulting to `_contract`, so the wrong-name failure cannot recur
and the injectable contract keeps working. `check_4_type_and_domain` has taken an injectable
contract since Phase 1 and check 6 uses it for exactly this kind of assertion; a rule reading the
module binding instead would make that seam a lie for one rule.
`test_a_threshold_lowered_in_the_contract_is_the_threshold_the_check_enforces` holds it, and was
verified red by hardcoding a literal 5.

No twenty-second hostile fixture, as asked. Unit coverage in
`tests/gate/test_check_4_type_and_domain.py`, with the `minCell: 0` single-report case pinned.

Four deliberate breakages, each proved in effect before the run: the rule removed from both call
sites (5 failed), the comparison hardcoded as a literal 5 (1 failed), the rule made one-sided
(2 failed), and both findings reported at one path (7 failed). **Two of the four did not land on
the first attempt and the guards caught both**: the removal target appears twice, once per call
site, so the edit refused rather than replacing one of them; and the double-report edit returned
the wrong thing, which the proof caught by measuring 1 finding where it asserted 2. The counts
above are from the re-runs.

**Note A. RECORDED, not fixed, as Note 5 under "Notes carried to Phase 5".** The finding is exact
and reproduces. It is left alone for the reason given: nothing in this system produces an exception
whose `__str__` raises, and fixing an unreachable defect in a reporter is how reporters acquire the
bugs they exist to report. It is written where Phase 7 will find it, because `sources/looker.py` is
where arbitrary third-party exception types first enter, along with the recommended shape if anyone
acts on it and the observation that it is the honest answer to "is the guard itself guarded", which
nobody had asked.

**Note B. TAKEN, and the framing was mine to fix.** "The same shape with a longer fuse" was wrong
in the way the review says: it points at `TreatMissingData`, which is the one knob that makes
things worse. Rewritten as Note 4 under "Notes carried to Phase 5", saying three things plainly.

That `notBreaching` is correct and must not be changed, with the reason: `PublishFailed` is absent
on every successful run by design, so `breaching` would put the stack into permanent alarm from the
first successful publish onward.

That a run which never happens is one the system never observes, so no metric emitted from inside
the function can close it by construction, and that a Lambda timeout belongs in the same family
because the runtime kills the process without unwinding, so no `except` runs whatever it names.

That the fix is a second, different control and explicitly not a change to `TreatMissingData`, with
the three candidates named: a success heartbeat with its own missing-data alarm, an alarm on
`FailedInvocations`, or a staleness check on `LastModified`. Which one is Phase 5's choice; not
flipping `notBreaching` is not.

**`guarded` catching `Exception` rather than `BaseException` stays as it is**, confirmed, and the
docstring now says why rather than leaving it to be inferred: a `KeyboardInterrupt` is not a
publish failing, and widening the catch would add noise without closing the timeout case, which is
not catchable at all.

**The count is fixed.** "Three were checked and hold" now reads "Two were checked and both hold",
in both places the resolution says it. The reviewer's quotation of the original wording is left
as written, since it is the record of the finding.

#### Verification

- 1929 passed, offline under `unshare -rn` with loopback down. Working tree clean.
- All twenty-one hostile sets re-measured end to end: none moved, every one exits 1.
- All five valid fixtures publish and plan five objects.
- Both acceptance greps still clean: `boto3` only in `sinks/s3.py`, no `v1/data` in it.
- No em dashes in any file this iteration wrote.

---


### CODE_REVIEW 2026-08-01: Phase 4, the publish decisions and the last mile

Status: RESOLVED
Verdict: CHANGES_REQUESTED, both blocking items addressed and all four notes taken. The audit
Item 1 implies found a second instance of the same defect inside the fix for the first one.

Two blocking items, four notes. Everything else in the phase verifies, and most of it verifies
against an independent re-measurement rather than against a reading. The suite is 1894 passed,
reproduced here and reproduced offline under `unshare -rn` with loopback down. Working tree
clean, scope clean: only `widgets/` and `docs/plans/` are touched, and `docs/PLAN.md`, `site/`,
`powerbi/`, `amplify.yml` and the root `README.md` are untouched.

---

#### Item 1, BLOCKING. The empty-payload path raises without emitting `PublishFailed`

The implementation note records this and declines to act on it, on the ground that "an exception
at that point is still fail closed at the handler, which writes nothing." Half of that is right
and the half it rests on is wrong. Measured, not read:

```text
$ python3 publisher/app.py <payload with meta and an empty measures block>
ValueError: a payload with no asOf describes no period, and this module has no clock to
invent one from
exit 1, stdout empty, stderr is a traceback
```

And through the Lambda entry point, with both streams captured:

```text
handler outcome:                 ValueError: a payload with no asOf describes no period ...
stdout captured:                 ''
stderr captured:                 ''
PublishFailed metric emitted:    False
```

Nothing is written and the previous payload keeps serving, so the data half of "fail closed"
holds. The alarm half does not. `report()` is reached only from `isinstance(result, Rejected)`,
so no metric is emitted on any escaping exception, and `Phase-5.md` Task 3 declares the only
alarm this design has on the `PublishFailed` metric with `TreatMissingData: notBreaching`. A run
that takes this path is therefore a silent failure: no metric, no alarm, no output on either
stream, and an alarm that stays in OK because missing data is not breaching. That is worse than
a refusal and it looks identical from outside.

Three things make this blocking rather than a note.

1. **Phase-4 is the phase that made it reachable from a gate-approved payload.** `period_for` is
   new here, and it is the first raise on the success path between `Passed` and the sink. The
   gate hole itself is Phase 1's and is out of scope; the unalarmed exception on the success
   path is this phase's.
2. **`Phase-0.md` ADR 3 states the opposite, and it is false for its own case too.** ADR 3 reads
   "an escaping exception is still fail-closed at the handler (nothing is written, `PublishFailed`
   fires)". Measured by making the gate raise:

   ```text
   ADR 3's case, an exception escaping the gate:
     handler outcome:              RuntimeError: a check raised ...
     PublishFailed metric emitted: False
   ```

   So the parenthetical has never been true, in any phase. It was inherited unmeasured and this
   phase quoted it as the reason not to act.
3. **Phase 5 builds the alarm.** If this ships as written, Phase 5 declares an alarm that cannot
   see a whole class of failure while the ADR says it can.

**What is not being asked for.** Not a gate change. Checks 1, 2, 8 and 9 are Phase 1's, approved,
and `Phase-0.md` section 3's "at least one of the other three" is satisfied by a present empty
section on any reading. Changing the gate here would reopen an approved phase.

**What is being asked for**, and either is sufficient:

- Make `app.py` emit `PublishFailed` for any escaping exception and re-raise, so the metric fires
  on the path the alarm watches and fail-closed keeps meaning what ADR 3 says it means. This is
  the module this phase owns and the change is small. If taken, correct ADR 3's parenthetical
  from a claim to a fact, and add a test that the metric fires on a non-`Rejected` failure.
- Or, if this is judged to belong to Phase 5 with the alarm, say so explicitly: carry it as a
  named note to Phase 5, correct ADR 3's parenthetical now so the false claim stops being
  inherited, and correct the implementation note, which currently records the exception as fail
  closed without qualifying which half.

For the record, this is the only such path. Probed across empty sections at every arrangement, a
`meta.cadence` outside the five, and a non-integer `schemaVersion`: check 4 refuses the last two
even on an otherwise empty payload, and every gate-passing shape that reaches `plan_writes`
either publishes correctly or raises here at `period_for`. One path, three spellings.

---

#### Item 2, BLOCKING. The `payloads.py` mutation figure does not reproduce

`widgets/README.md:142` and this file both record `tests/gate/payloads.py` at **61 killed, 10
survived**. Re-run here with `mutmut` 2.4.4, the same version and the documented command:

```text
tests/gate/payloads.py   ok_killed 179   bad_survived 36   (215 mutants)
```

Run twice to rule out the obvious cause. With a cleared `.mutmut-cache`: 179 / 36. With the
`corpus.py` cache carried forward, which is the run order the README's procedure implies:
corpus.py 62 / 1 and payloads.py 179 / 36, unchanged. `payloads.py` has not been touched since
`1138399` in Phase 3, so it is the same file. The recorded total of 71 is about a third of the
215 mutants the file generates, which is what a truncated run produces, but the cause is not
established here. What is established is that the number is wrong.

**The `corpus.py` result reproduces exactly**, and independently:

```text
tests/gate/corpus.py     ok_killed 62    bad_survived 1
SURVIVED line 43: return sorted(path.name for path in HOSTILE.glob("*.json"))
```

The survivor's claim is confirmed by a second route as well. At `89e6a6f`, `git grep hostile_names`
over `widgets/` returns the definition and nothing else, so it had no caller; it was introduced in
`35950a9` in Phase 1 and never used; and restoring it to the current tree leaves 1894 passing, the
same as deleting it. Dead test-support code, correctly deleted.

**The decision this number supports is right and does not need revisiting.** All 36 survivors were
reconstructed and read, not counted. Twenty are string-literal mutations of labels, `meta` strings
and the Looker error object's own keys. The rest are numeric or default-argument mutations, and of
those, all but two are equivalent in the tests' terms: `value=1308` defaults that stay above the
population floor, `minBundle` 1 to 2, `inflow` 3577 to 3578 and its `veterans` segment 197 to 198
on a measure nothing reconciles, a `pitCount` point 690 to 691 on a series the registry does not
reconcile, `series_total_too_high`'s 388 to 389 which is still too high, and `NON_OBJECTS`'s 0 to
1 which is still not an object. A no-surviving-mutant criterion over that module would be a
suppression list pretending to be a control, exactly as recorded. **The split criterion is sound.**

**Required:** correct the figure in `widgets/README.md:142` and in the implementation note, and
say which run produced it or that the cause is unknown. This is one edit. It is blocking because
both documents exist to be the honest measured record, because the number is the entire evidence
base for the "read the survivors" half of a criterion this project has now adopted, and because
Note 1 of the carried notes says in as many words that this table's history already contains two
measurements that were plausible and wrong. A third, uncorrected, in the document that argues for
measuring things is the wrong place for it to sit.

---

#### Note 1. Two of the 36 survivors are not equivalent, and both are small

Recorded because "read the survivors" was the criterion adopted, and reading all 36 turns up two
the ten-survivor characterisation would not have surfaced. Neither is blocking.

- `"minCell": 5` mutated to 6 survives in both builders because **no check reads the payload's
  `minCell` value**. `checks.py:653` and `:703` validate it as a whole number of at least 1, and
  nothing compares it against `contract.MIN_CELL`. A payload declaring `minCell: 6` while the
  publisher enforces 5 is published. Severity is low: the field is a declaration about the
  source, the enforcement is the contract's constant, and a mismatch misstates nothing that is
  published. It is a gate question and therefore not this phase's to fix. Worth a sentence
  somewhere so the next reader knows the field is carried rather than checked.
- `having_bug`'s `1284` mutated to `1285` survives at both assignment sites. It should not be
  invisible: measured, the mutation adds a second check 7 finding at
  `breakdowns.raceEthnicity.universe`, which is rule 2, the cross-measure rule.

  ```text
  as written: ['check_7_reconciliation'] at breakdowns.raceEthnicity
  mutated   : ['check_7_reconciliation'] at breakdowns.raceEthnicity and .universe
  ```

  The tests assert the set of check ids, so a second finding under the same id is invisible to
  them. The builder's docstring claims "rule 2 is silent by construction, because the denominator
  is right and it is the parts that are short", and nothing pins that claim. Cheap to pin if
  anyone wants it; recorded either way.

#### Note 2. The adopted criterion is not runnable over half its own scope

The criterion reads "no surviving mutant in the walkers and parsers (`corpus.py`, and the
module-local walks the publisher tests rest on)". `mutmut` was run over `corpus.py` and
`payloads.py`, both of which are helper modules with no tests in them. The module-local walks live
inside test modules, so pointing `mutmut` at `tests/publisher/test_publish_csv.py` mutates the
assertions along with the helper and the results stop meaning what the criterion wants them to
mean. Either say the module-local half is done by hand, or say the helpers have to move to a
helper module for the criterion to reach them. As written the criterion promises coverage of
something the tool cannot be pointed at.

For what it is worth, the by-hand version of that half was run here and is clean. Every
collection-returning module-local helper in `tests/publisher` was blinded one at a time, with the
blinding proved inside the same pytest invocation, and every one goes red:

| Helper | Blinded | Result |
|---|---|---|
| `test_publish_csv.rows` | `return []` | 16 failed |
| `test_publish_csv.figures_in` | empty `Counter` | 12 failed |
| `test_publish_csv.values_in` | empty `Counter` | 6 failed |
| `test_publish_index.numbers_in` | yields nothing | 6 failed |
| `test_publish_index.strings_in` | yields nothing | 2 failed |
| `test_publish_plan.plan` | `return ()` | 52 failed |
| `test_publish_plan.keys` | `return ()` | 11 failed |
| `test_publish_plan.stored` | `return {}` | 11 failed |
| `test_sinks.plan` | `return ()` | 3 failed |
| `test_sinks.publisher_modules` | `return []` | 3 failed |
| `test_sinks.imported_roots` | `return set()` | 3 failed |
| `test_sinks.module_level_roots` | `return set()` | 1 failed |
| `test_publish_keys.referenced_names` | `return set()` | 1 failed |
| `test_app.candidate` | `return {}` | 21 failed |

No third instance of the blind-helper shape in this phase's own tests. Clause 4's question, whether
any other degradation this phase silently failed to land, comes back clean on this evidence.

#### Note 3. The hash metadata name depends on S3 lowercasing, and nothing says so

`HASH_METADATA = "payload-hash"` round-trips correctly because it is already lowercase: S3
lowercases user metadata keys, so `head_object` returns it unchanged. A later rename to
`payloadHash` would come back as `payloadhash`, `_stored_hash` would return `None` forever, and
every run would be a full write with no other symptom. That is ADR 11's defect arriving through a
different door, and ADR 11 exists because that defect looks exactly like working code. One
sentence in the `HASH_METADATA` docstring closes it. Not blocking, and worth carrying to Phase 5,
which is where the metadata first meets real S3.

#### Note 4. `tests/gate/corpus.py` was modified despite "the gate is untouched by this phase"

`Phase-4.md` Integration points says the gate is untouched and its tests must still pass
unchanged. `tests/gate/corpus.py` is in the diff, for the `hostile_names` deletion. It is dead
test-support code rather than the gate or a check test, the deletion is justified and recorded,
and 1894 still pass. Naming it so it is a recorded exception rather than an unnoticed one.

---

#### What was verified and is correct

Each of these was re-measured rather than read.

**ADR 14, every decision in `publish.py` and no policy in the sink.** All four acceptance greps
pass verbatim: no impure import in `publish.py`, no `now(`/`today(`/`utcnow` in it,
`rg boto3 widgets/publisher/ --files-with-matches` returns only `sinks/s3.py`, and `v1/data` does
not appear in `sinks/s3.py`. Confirmed by AST as well: an import walk over all nine modules under
`publisher/` finds `boto3` in `sinks/s3.py` and nowhere else, and a token scan finds the string
`boto3` in no other file, so the docstring reword did not just move the problem. `sinks/s3.py`
holds no key, no header value, no threshold and no skip decision. `NOT_FOUND` is knowledge about
the S3 API rather than a publishing policy, which is the right side of that line.

**ADR 11 at both levels, reproduced.** With `meta.generated` restored to the hashed bytes, and the
landing proved first by asserting two payloads differing only in the timestamp hash differently:
10 failed, 1884 passed at HEAD, being the 4 in `test_publish_hash`, the 5 parameterized cases in
`test_publish_plan`, and `test_app.test_an_unchanged_rerun_writes_nothing_at_all`. The plan-level
symptom is exactly as reported: an unchanged rerun under a new timestamp plans **5** writes with
the defect and **0** without it. Nothing else in the suite moves.

**Task 2's fifth acceptance criterion genuinely cannot hold as written**, and this was checked
rather than accepted. `meta.generated` is one of the seven keys check 1 requires, and ADR 11
requires the hash exclude it, so the hashed bytes and the published bytes differ for every payload
the gate can pass. The only payload where they could be equal is one with no `generated`, which
the gate refuses. The substitute,
`test_the_hashed_bytes_are_the_published_bytes_with_the_timestamp_removed`, asserts the property
the criterion was reaching for in three directions and is stronger than a byte comparison would
have been.

**The other three recorded plan differences are accurate.** Task 1's regex and Task 3's constraint
are genuinely in tension and `from datetime import date` satisfies the regex literally while doing
what Task 3 asks; the two AST tests that replace the regex as the substantive control are real and
both go red when blinded. Task 6's `rg boto3` criterion did trip on a docstring and the reword
keeps the criterion able to say something, with both the token form and the AST form tested. The
stderr/stdout split is not specified by Task 6 and the reason given for it is sound: stdout is
exactly the publishable bytes, which is what makes ADR 12's invariant assertable from outside the
process.

**Five objects per run, at every cadence, with the right headers.** All twenty-five rows built and
compared against `Phase-0.md` section 3's table: every key, `Cache-Control` and `Content-Type`
correct, five writes per run, no duplicate key within a run, exactly two distinct `Cache-Control`
values across the ten cadence objects, archive JSON and CSV bodies byte-identical to their current
siblings, and the planned JSON body deserializing to exactly `Passed.payload` for all five.
`live` archives to `2026-08-01` from the payload's `asOf` rather than from the clock, and
`weekly` to `2026-W31`, which `date(2026, 7, 31).isocalendar()` confirms.

**All twenty-one hostile sets unchanged after the handler rewiring.** Re-measured end to end
through `python3 publisher/app.py`, reading the fired set off the `PublishFailed` metric: every one
matches `Phase-0.md` section 8, every one exits 1, and stdout is exactly the one metric line with
no payload and no plan. **Zero writes measured directly, not inferred**: driven through `app.run`
with a recording sink over all twenty-one, the sink received zero calls of any kind, not merely
zero writes. A rejected run does not even ask what is currently published.

**Both self-audit findings confirmed, both pins verified red.** `strings_in` blinded with the
landing proved: 2 failed, and they are the two added. `regenerated` with the timestamp assignment
removed, landing proved: 2 failed, and they are the two added or strengthened. Four together,
matching the commit.

**Three deliberate breakages spot-checked** and all three go red where they should: the sink
building its own `Cache-Control` (2 failed, including the test that compares against the `Write`
records rather than against literals), a withheld point becoming a zero (6 failed), and the index
planned outside the skip (12 failed).

**The index and the CSV.** A five-cadence index built and inspected: it carries `schemaVersion`,
each cadence's current JSON and CSV, and each period's `period`, `asOf`, `schemaVersion` and both
archive paths, which is what `docs/PLAN.md` 4.4 asks for and nothing more. Idempotent over a full
second pass, byte for byte. The CSV carries all 84 figures across the five fixtures, matching
`corpus.count_positions` as a **multiset** at every fixture, with no integer between 1 and 4 in any
value column and withheld points rendered as rows with an empty value and the marker set.

**All five valid fixtures publish** through `app.py`, plan on stderr and payload on stdout, exit 0.

**Notes 1 and 2 of the carried notes are closed correctly.** The `COUNT_KIND_POSITIONS` row now
reads 6 failed, 1479 passed, exit 1, with the reason it was never a row about `empty_parameter_set_mark`.
Items 2 and 3 of the blind-helper list carry their costs.

**Prose and hygiene.** No em dashes in any Phase-4 file or commit message, no emoji, no exclamation
marks. Conventional commits, one per task, atomic, no amends.

#### On the S3 sink, since it has never executed

`boto3` is not installed here, confirmed, and `app.select_sink({"BUCKET": ...})` raises
`ModuleNotFoundError`, which a test asserts. `widgets/README.md` states the limitation correctly
and does not overstate it. What the stub does constrain is worth writing down precisely, because
"tested against a stub" covers two different amounts of assurance:

- It **does** pin the six `put_object` keyword names, and `head_object` and `get_object`'s two
  each, against literals; a sink that dropped `Metadata` or rebuilt a header from the key fails.
- It **does** pin that the sink reads `ClientError` off the client it was handed rather than
  importing botocore, which is what lets the stub raise the error the sink catches.
- It **does not** establish that those names are boto3's names. The stub's contract and the sink
  were written together, so a shared misspelling passes both.
- It **does not** establish the error semantics. `NOT_FOUND = ("404", "NoSuchKey", "NotFound")`
  matches botocore's documented behaviour but has never met botocore.
- It **does not** touch metadata case-folding, value length, IAM, or anything Phase 5 configures.

None of that is a defect in this phase. It is the boundary of what a green suite here means, and
the README's "That is evidence that the sink passes through what it was handed. It is not evidence
that S3 accepts it" is the right sentence. The first three bullets above are worth adding to it.

---

#### Resolution

Both blocking items addressed, all four notes addressed, and the audit Item 1 implies turned up a
second instance of the same defect inside the fix for the first one. 1914 passing, up from 1894.

**Item 1, BLOCKING. RESOLVED in `6b57b61` and `ccdccc3`.** The first option was taken rather than
deferring to Phase 5: a known silent-failure path with a small fix does not wait for a later
phase, and the alarm it needs is already specified.

`app.crash_metric` and `app.report_crash` emit `PublishFailed` on the stream the alarm reads for
anything that escapes, and the exception is re-raised rather than swallowed into a
`PublishFailed`, because the traceback is the only thing that says where it broke. The reviewer's
two measurements, re-run against the fix:

```text
handler outcome:                 ValueError: a payload with no asOf describes no period ...
PublishFailed metric emitted:    True

ADR 3's case, an exception escaping the gate:
  handler outcome:               RuntimeError: a check raised
  PublishFailed metric emitted:  True
```

Three paths reach it and all three are tested: a check that raises, a gate-approved payload the
planner cannot place, and a sink whose write fails. The third is a gain beyond the finding.
Nothing in this system would have reported a failed PUT, and there will be PUTs in Phase 5.

ADR 3's parenthetical is corrected from a claim to a fact, and carries the record that it was
false for four phases and three reviews, because Phase-0 is the document later phases inherit
from. The lesson is written there in one sentence: **a claim in an architecture document that
something fails safely is a claim, not a control, until someone has made it fail and watched.**

**The audit for other unmeasured fail-safe claims, and it found one.** Every claim of that shape
in the plan documents was made to fail rather than read. Two were checked and both hold: ADR 2's
"publish this bit anyway cannot be written" (`Passed` has no `failures`, `Rejected` has no
`payload`, an empty `Rejected` raises), and Phase 2's note that an unparseable `MIN_BUNDLE` is
passed through rather than repaired and refused by check 4 end to end (measured with
`MIN_BUNDLE=four` through argv: exit 1, `check_4_type_and_domain`).

The one that did not hold was in the fix for Item 1, an hour old. `handler` resolves the payload
path and builds the sink **before** `run_path` is entered, so both were outside the new guard:

```text
handler with no path at all                  outcome=PublishFailed        metric=False
handler with BUCKET set and boto3 absent     outcome=ModuleNotFoundError  metric=False
main with BUCKET set and boto3 absent        outcome=ModuleNotFoundError  metric=False
```

Both are misconfiguration: a function deployed with the wrong environment publishes nothing
forever and tells nobody, and a missing `PAYLOAD_PATH` is exactly what Phase-5's schedule will
make reachable. `app.guarded` wraps both entry points, and `report_crash` is idempotent per
exception so a failure passing through three guards emits one metric rather than three. Measured
after: six paths, one metric line each.

**One carried note for Phase 5, found while auditing, and my framing of it was wrong.** I called
it "the same shape as this finding with a longer fuse", which invites the next reader to reach for
`TreatMissingData`, and that is the one change that makes things worse. It is rewritten as Note 4
under "Notes carried to Phase 5" below, where Phase 5 will find it.

**Item 2, BLOCKING. RESOLVED in `01583c2`.** Re-run to completion: `payloads.py` at **179 killed,
36 survived, 215 mutants**, reproducing the review exactly.

The cause is established rather than left unknown. **61 + 10 + 144 untested = 215.** The run had
not finished. It was started in the background and the cache was read while it was still working,
and the partial counts were reported as final. The `untested` row was in my own output at the
time and I did not act on it. `widgets/README.md` and the implementation note both carry the
corrected figure and the cause, and the documented procedure now asserts that no mutant is
`untested` before printing anything, because a cache read mid-run looks exactly like a finished
one except for that row.

Note 1 of the carried notes is right that this is the third such measurement, and the three share
one shape worth naming once: the number a tool hands you is about the run it actually did, and
checking that the run happened is a separate act from reading its result. For a degradation that
means proving it landed; for a long run it means proving it finished.

`corpus.py` re-measured on the current tree as well: **62 killed, 0 survived, 62 mutants.** One
fewer mutant than the phase delivered, the same 62 killed, and the survivor gone with the dead
helper it was in.

**Note 1, the two non-equivalent survivors.**

`having_bug`'s 1284 is pinned, in `01583c2`.
`test_the_having_bug_is_rule_1_only_and_rule_2_is_silent` asserts the exact failure paths and a
paired test asserts that moving either number turns rule 2 on. Run red against the exact mutation
the tool found, with the degradation proved first: 2 failed.

**`minCell` is measured and not acted on, which is what was asked.** The reviewer's question was
whether the registry-disagreement rule already built for `precision` and `kind` is the same shape,
and whether adding `minCell` to it moves any recorded set.

It is nearly the same shape and differs in one way worth stating: `precision` and `kind` compare a
declared field against **that entry's registry value**, and `minCell` would compare a declared
field against a **global constant**, `contract.MIN_CELL`. There is no per-entry `minCell` in the
registry and adding one would be a wider change. So it is the same rule with a fixed right-hand
side rather than a lookup.

The shape matters in one concrete way, found by measuring rather than by reading.
`_declared_failures` reports the domain violation **or** the disagreement, never both, and a
`minCell` rule that does not do the same double-reports: a first attempt that only guarded on
integer-ness made `minCell: 0` fire twice at one path and broke
`test_a_universe_a_min_cell_and_a_suppressed_block_are_checked`, which asserts an exact path list.
Shaped like `_declared_failures`, that goes away.

Measured, with the degradation proved first (the unmodified quarterly fixture still passes,
`minCell: 6` fires check 4, `minCell: 0` reports once rather than twice):

| Question | Measured |
|---|---|
| Recorded sets that move | **0 of 21** |
| Tests that change | **0.** 1911 passed, none edited |
| A breakdown declaring `minCell: 6` | refused, `check_4_type_and_domain` |
| A series declaring `minCell: 6` | refused |

So it costs nothing measurable and closes a payload misstating its own privacy property. It is
still a gate change and the gate is an approved phase, so it is not made here. **The measurement
is the report and the ruling is the reviewer's.** The first attempt at this measurement was
itself wrong, in the way Clause 4 names: the degradation referenced `contract` where `checks.py`
binds `_contract`, so check 4 raised on every payload carrying a `minCell` and the run reported
123 failures and 8 empty sets. The proof step caught it, and the numbers above are from the run
where the proof passed.

**Note 2, the criterion is not runnable over half its own scope. RESOLVED in `01583c2`.** The
scope is narrowed to what the tool can be pointed at, which is `corpus.py`. The module-local
helpers live in the same files as the assertions resting on them, so mutating those files mutates
the assertions and the results stop meaning what the criterion wants. The README now says that
half is done by hand, and points at the review's blinding table as the record of it. Either the
helpers move to a helper module later, or it stays a by-hand exercise; the criterion no longer
promises coverage of something the tool cannot reach.

**Note 3, the hash metadata name. RESOLVED in `01583c2`.** `HASH_METADATA`'s docstring now says
it must stay lowercase, why (S3 lowercases user metadata keys), what a rename would cost (every
run a full write, no other symptom), and that nothing here can catch it because the stub does not
fold case and real S3 does. Carried into `widgets/README.md`'s list of what a stub does and does
not establish.

**Note 4, `tests/gate/corpus.py` in the diff.** Accepted as recorded. It is dead test-support
code rather than the gate or a check test, it was found by a tool rather than reached for, and
the module now has no surviving mutant because of it.

**Also taken from the review.** The five bullets on what the stub client does and does not
establish are in `widgets/README.md` verbatim in substance, including that the stub's contract and
the sink were written together so a shared misspelling passes both.

#### Verification

- 1914 passed, offline. Working tree clean.
- All twenty-one hostile sets re-measured end to end and unchanged.
- Six failure paths measured through the entry points, each emitting exactly one metric line.
- Ten deliberate breakages across the two items, each proved in effect before the run.
- No em dashes in any file this iteration wrote.

---


### CODE_REVIEW 2026-08-01: Phase 3, re-review

Status: RESOLVED
Verdict: CHANGES_REQUESTED, both blocking items addressed and the question answered in the
record. Item 4 is the sharpest finding of the three rounds: the guard built to stop this pattern
had the pattern.

Item 1 is fully closed and I could not get a payload past it. Item 2's third layer is pinned and
the two further layers it found are real. Item 3 is recorded the way a decision should be. The
suite is 1477 green offline, the tree is clean, no recorded set moved, and all three breakages I
re-ran reproduce to the exact count.

Everything below is in test infrastructure rather than in the gate. There is no way to get a bad
payload published. What there is, still, is a way to make the suite cover less without going red,
and two of the three instances arrived in this remediation.

#### What I verified as closed

**The element rule.** All five non-object forms, in both arrays, at the gate and end to end
through argv, source, gate and sink. Ten mutated payloads written to a temporary path and run
through `publisher/app.py`: every one exits 1, prints no payload, and names
`check_4_type_and_domain`. Both unmodified controls (the `HAVING count >= 5` breakdown and the
82-too-high series) still exit 1 naming `check_7_reconciliation`, so the assertions are about the
element rather than about a payload that was going to be refused anyway. The valid quarterly
control still exits 0. All twenty-one hostile sets re-measured and unchanged; all five valid
fixtures still pass.

**The eleven re-run breakages.** Spot-checked three, and each reproduces to the number: tolerance
of one, 10 failed; element rule removed, 38 failed; cross-measure rule removed, 9 failed. The
qualitative claims hold too: fixture `17` still publishes at exit 0 without the cross-measure
rule, and fixture `19` still takes three removals against the post-fix gate, at {2, 7}, then {7},
then exit 0.

**The skip audit's own measurements.** Unregistering check 4 collapses exactly 23 rows.
Unregistering check 2 collapses exactly the five that name it, and exactly three of those five
publish outright: missing `categories`, missing `universe`, and an unregistered breakdown. That is
the right method and it reproduces.

#### Item 4, blocking. Seventeen is not the true count, and the guard that is supposed to keep it true has the same blind spot it exists to prevent

The classification is honest. I traced nine of the audit's payloads with a line tracer to see which
exits they actually reach, rather than trusting that a refused payload took the exit its row names.
Every one takes the exit it claims and the named check genuinely fires. No exit was labelled "the
rule reaching its own answer" to avoid needing a compensating check: all four in-count rule-exits
(`_small_cell`'s legal cell, `_measure_cells`'s kind gate, `_component_reconciliation`'s
components-add-up, `_published_values`'s absent `value`) are genuinely the rule.

The count is not right, and the reason it is not right matters more than the arithmetic.

`test_every_early_exit_in_checks_6_and_7_is_accounted_for` counts three token forms: `return []`,
`return None` and `continue`. `_series_reconciliation` uses a fourth, `return failures`, three
times, and one of those three is a genuine skip:

```python
    published = _published_values(entry)
    residual = _withheld_value(entry)
    if published is None or residual is None or not _is_whole(total):
        return failures
```

Rule 3 does not run there. It is compensated in fact, and I checked all three of its causes: a
non-list `points`, a non-object point and a non-whole point value all reach check 4 through
`_published_values`, an unreadable `withheld` block reaches check 4 through `_withheld_value`, and
a `total` that is a string, a float, a bool, null or a list is check 4's in all five forms. So no
hole. But the exit is neither counted, nor enumerated, nor named in `NOT_SKIPS`, and my tracer
shows two of the audit's own payloads take it without the module knowing.

Two consequences.

1. **The arithmetic does not reconcile.** `NOT_SKIPS = 5` names five rule-exits, but one of them
   (`_series_reconciliation`'s `reconciles` gate) is a `return failures` and is therefore not among
   the 22 the guard counts. So "22 = 5 rules + 17 skips" is wrong in both halves: within the
   counted 22 it is 4 rules and 18 skips, and across all 25 early exits it is 5 rules, 1
   report-then-return, and 19 compensated skips.
2. **The guard's own claim is false for that idiom.** The docstring says "an exit added to either
   check is visible here rather than silently uncovered", and the commit body says "A count cannot
   be talked round." I added a new `return failures` skip inside `_series_reconciliation` and ran
   the guard: it passed. The count was talked round, by an idiom already in use twenty lines away
   from the code it guards.

This is the fifth appearance of the pattern and it is inside the thing built to stop the pattern,
which is why it is worth fixing rather than noting.

**What to do.** Count `return failures` as well, or better, stop counting tokens: walk the module
with `ast` and count `ast.Return` and `ast.Continue` nodes that are not the last statement of their
function body. That is idiom-independent and cannot be routed around by spelling. Then reclassify:
name the uncounted exit, move the `reconciles` gate into whichever half it belongs to, and make
`NOT_SKIPS` plus the tested skips add to whatever the new count is. Run it red by adding an exit in
each idiom and confirming the guard moves for both.

#### Item 5, blocking. Three parameter sources still vanish silently, and two of them arrived in this remediation

The `HOSTILE_INPUTS` finding reproduces exactly as reported: emptied against the pre-remediation
suite it gives `1404 passed, 9 skipped`, exit 0, with the nine per-check totality controls reported
as `got empty parameter set for (payload)`. The pins added for it do go red, 2 failed, which
matches.

But the fix is per-corpus, and the class is still open. I emptied every parametrize source in the
suite in turn, mechanically, and re-ran:

| Source | Emptied | Verdict |
|---|---|---|
| `corpus.valid_paths()` | 7 failed | pinned |
| `test_totality.CORPUS` | 2 failed | pinned |
| `test_exclusions.EXCLUDED_IDS` | 1 failed | pinned |
| `test_app.HOSTILE_NAMES` | 2 failed | pinned |
| `test_app.VALID_NAMES` | 1 failed | pinned |
| `test_check_6.COUNT_KIND_POSITIONS` | 6 failed | pinned |
| `payloads.HOSTILE_INPUTS` | 2 failed | pinned in this remediation |
| `test_count_positions.REQUIRED_POSITIONS` | **1472 passed, 1 skipped** | vanishes green |
| `test_count_positions.WITHHELD_POINTS` | **1476 passed, 1 skipped** | vanishes green |
| `payloads.NON_OBJECTS` | **1457 passed, 4 skipped** | vanishes green |

The three that vanish are the ones worth naming.

- `REQUIRED_POSITIONS` is the hand-written "one of every position the contract can put a published
  figure in", and it is one of the two pins on `corpus.count_positions`, which is layer 1 of this
  whole chain. Empty it and
  `test_the_walker_reaches_every_kind_of_position_the_fixture_holds` disappears.
- `WITHHELD_POINTS` is **the pin written in this remediation for the third layer**. The fix for
  layer 3 is built out of the mechanism layer 4 describes, in the same commit that describes it.
- `NON_OBJECTS` is **the corpus for the blocking finding of the last review**. Empty it and four
  parametrized tests disappear, two in check 4 and two in check 7. The regression would still be
  caught, because `test_skips_are_compensated.py` and `test_app.py` both spell the five forms as
  literals rather than importing the tuple, but that is luck rather than design.

**What to do, and it is one line.** Add to `widgets/pytest.ini`:

```ini
empty_parameter_set_mark = fail_at_collect
```

Verified: baseline unchanged at 1477 passed, and every source above that previously vanished
becomes a collection error instead. `REQUIRED_POSITIONS` emptied gives 1 error, `WITHHELD_POINTS` 1
error, `NON_OBJECTS` 2 errors, `HOSTILE_INPUTS` 10 errors, all at non-zero exit. It closes the
whole class rather than three instances, it covers sources nobody has enumerated, and it covers
the ones added next phase. Per-corpus non-empty assertions are then belt and braces rather than the
control, and the ones already written can stay.

Run it red the same way: add the ini line, empty one source, confirm the error, revert.

#### Item 6, the question about completeness, answered rather than blocking

The brief asks how anyone knows the enumeration of mediating functions is complete, and says that
if the answer is "someone looked carefully" that is the same answer that was true before each of
the four. It is, today. Here is what the mechanical answer looks like, split by sub-class, because
the two halves have different ones.

**The vanish sub-class is completely and mechanically solvable**, and Item 5 is the solution. It is
not an enumeration at all: pytest is made to refuse an empty parameter set, so no one has to have
found the corpora. That converts "someone enumerated them" into "the runner will not collect one".
This half can be closed today and should be.

**The blind-mediator sub-class is mechanically solvable in principle and is not solved here.** The
method that finds it is the one this project has been performing by hand five times: degrade the
mediator, re-run, see whether the suite notices. Done systematically that is mutation testing
scoped to the test-support code, `tests/gate/corpus.py`, `tests/gate/payloads.py` and the
module-local helpers, with the criterion "no surviving mutant". Every one of the five layers found
so far is a surviving mutant under that criterion: blinding `count_positions`, blinding the
`kind == "count"` filter, blinding `withheld_points`, widening `sourced_figures`, emptying
`HOSTILE_INPUTS`. So the tool would have found all five without anyone being clever. `mutmut` and
`cosmic-ray` both do this; neither is installed here and installing needs network, so I am
recommending it rather than demonstrating it, and it is a Phase 4 or 5 decision rather than
something to bolt on now.

**The honest limit, which belongs in the record.** Until something like that runs, the answer to
"is the enumeration complete" is that a reviewer and an implementer each attacked the mediators
they could think of, and five times that has been fewer than the number that existed. The suite
being green is evidence about the code it exercises and is not evidence about how much of the code
it exercises. Write that sentence into `widgets/README.md` or the Phase 4 known-limitations
section, whichever the plan prefers, so the next person inherits the limit rather than the
impression.

#### Also verified

- 1477 passed offline in 3.3s. `git status` clean.
- All twenty-one hostile sets and all five valid fixtures re-measured directly. Nothing moved.
- The empty `components` decision is recorded with its counter-argument and the one-line change
  that would close it, which is what Item 3 asked for.

---

#### Resolution

**Item 4, blocking. RESOLVED in `825baf7`.**

Reproduced before touching it: adding a `return failures` skip inside `_series_reconciliation`
left the guard passing at 35 passed. The finding is exact and the framing is right. The guard was
lexical and the thing it guarded is syntactic, so it knew three spellings out of four, and the
commit body claiming a count cannot be talked round was wrong about its own guard.

Rewritten to walk the syntax, per the recommendation: `ast.Return` and `ast.Continue` nodes that
are not a function's final statement. Counted per function rather than as one total, so an exit
moved between functions is as visible as one added.

**The reclassification, and one number that differs from the review's.** Measured by the AST rule
the review specified: **26** early exits, not 25. Six rules, one report-then-return, nineteen
compensated skips, and `test_the_classification_adds_up_to_the_count` asserts the three add up.

The extra one is `_withheld_value`'s `if "withheld" not in entry: return 0`. The rule the review
gave does count it, and it is a rule rather than a skip: no `withheld` block means a residual of
zero, which is an answer rather than an absence of one. Recorded rather than reconciled by bending
the classification, per the standing instruction about measured sets.

The review's other correction stands and is applied: the `reconciles` gate is a `return failures`
and so was never among the counted exits, which is why "22 = 5 + 17" was wrong in both halves.

**The nineteenth skip had no row and now does.** `_series_reconciliation`'s unreadable-inputs exit
is covered for its one cause that does not already pass through a helper with coverage,
`total`, in five forms. A bool is among them deliberately: `isinstance(True, int)` is True in
Python, so a check 4 that did not exclude it would leave that one form uncompensated.

Run red against all four idioms, each added and reverted:

| Idiom added | Old guard | New guard |
|---|---|---|
| `return failures` | passed | 1 failed |
| `return []` | 1 failed | 1 failed |
| `continue` | 1 failed | 1 failed |
| `return None` | 1 failed | 1 failed |
| one exit moved between functions | passed | 20 failed |

**Item 5, blocking. RESOLVED in `145891c`.** Took the recommended fix unchanged:
`empty_parameter_set_mark = fail_at_collect` in `widgets/pytest.ini`.

The point about which two sources these were is the part worth keeping. `WITHHELD_POINTS` is the
pin written in the previous iteration to close layer 3, so that fix was built out of the mechanism
layer 4 describes, in the same commit that describes it. `NON_OBJECTS` is the corpus for the
previous blocking finding, and the review is right that the regression would still have been caught
only because two other modules happen to spell the five forms as literals, which is luck.

Measured, each source emptied in turn and reverted, with the line in place:

| Source | Emptied |
|---|---|
| `REQUIRED_POSITIONS` | 1 error, exit 2 |
| `WITHHELD_POINTS` | 1 error, exit 2 |
| `COUNT_KIND_POSITIONS` | 6 failed, 1479 passed, exit 1. Corrected below. |
| `NON_OBJECTS` | 2 errors, exit 2 |
| `HOSTILE_INPUTS` | 10 errors, exit 2 |
| `corpus.valid_paths` | 8 errors, exit 2 |

The `COUNT_KIND_POSITIONS` row read "1 error, exit 2" until Phase 4 corrected it, per Note 1 at
the top of this file. It cannot have been that, and not because of a transcription slip:
`COUNT_KIND_POSITIONS` is a lookup dict and a set equality operand, never a parametrize source,
so emptying it produces a `KeyError` and a set mismatch and `empty_parameter_set_mark` has
nothing to act on. The row's conclusion is still right. The source is covered, and it was
covered before the ini line by
`test_every_valid_fixture_on_disk_has_a_count_kind_position_count`, which is not one of the
sources the line addresses.

Contrast run, the same degradation with the line removed: `WITHHELD_POINTS` emptied gives
1484 passed, 1 skipped, exit 0. Baseline unchanged at 1485.

One correction to my own first attempt at this measurement, recorded because it nearly produced a
false result. My first degradation wrote `REQUIRED_POSITIONS = {} or {...}`, which evaluates to
the non-empty dict, so three of the six sources appeared not to be covered by the ini line when in
fact they had never been emptied. Caught by noticing that three passed at exit 0 while three
errored, which is not a distinction the ini line can draw. The degradation was wrong, not the fix.

**Item 6, the question. Answered in `b99b41a`, in `widgets/README.md`.**

Written in my own words, with the split the review draws, because the two halves genuinely have
different answers. The vanish sub-class is closed by Item 5 and does not depend on anyone having
enumerated the corpora. The blind-mediator sub-class is not closed, and the systematic form of what
has been done by hand five times is mutation testing scoped to the test-support modules with a
no-surviving-mutant criterion. All five layers found so far would have been surviving mutants under
it, which is the argument for it: a tool would have found them without anyone being clever about
which helper to suspect. Not installed, needs network, so it is recorded as a Phase 4 or 5
recommendation rather than bolted on.

All five instances are listed with what each cost, so the next reader inherits the evidence rather
than the conclusion, and the limit is stated plainly: a green suite is evidence about the code it
exercises and is not evidence about how much of the code it exercises.

`widgets/README.md` is Phase 5's file and it says so at the top. This is a stub carrying one
section early; Phase 5 writes the rest around it rather than replacing it.

#### Verification

- 1485 passed offline, in a network namespace with no interfaces. Up from 1477.
- Nothing in this iteration touches `publisher/gate/`, `contract.py` or any fixture. All
  twenty-one hostile sets and all five valid fixtures are untouched by construction, and the
  suite that asserts every one of them is green.
- `git status` clean, no em dashes in any file this iteration wrote.

---

### CODE_REVIEW 2026-08-01: Phase 3

Status: RESOLVED
Verdict: CHANGES_REQUESTED, all three items addressed. Item 1 was a real hole and the
diagnosis was exact. Item 2 found a third layer and asked for a fourth; there were two more.

Everything the phase was asked to prove, it proved. The suite is 1390 green offline, the tree is
clean, all five valid fixtures publish, all twenty-one hostile fixtures were re-measured
independently and every set matches the corrected Phase-0 section 8 including `19` at {2, 6, 7}.
The three Phase-0 corrections were each checked against their source and each is right. Both
self-audit tautologies reproduce exactly as reported, in both directions. The fixture 19
three-control result reproduces exactly. The tolerance breakage reproduces and publishes parts
summing to 4241 under a stated universe of 4242.

One blocking finding, found by attacking check 7's skip contract rather than reading it. One
non-blocking finding, which is the third layer of the walker defect the phase brief asked me to
look for.

#### Item 1, blocking. A non-object element in `categories` or `points` turns check 7 off, and no check names it

`_breakdown_parts` returns `None` when a category is not a `dict`, and `_published_values`
returns `None` when a point is not a `dict`. `None` means "the rule does not run". The docstring
justifies that skip on the ground that the malformed value is somebody else's finding: "A
category that is not a whole number is check 4's, and adding it would be arithmetic over
something that is not a number."

That is true for a `dict` category carrying a bad value, and I verified it: a float category or a
string `suppressed.value` both fire check 4. It is **false** for a category that is not an object
at all. Nothing in the gate looks at a non-object element of `categories` or `points`. Check 1
does not descend that far, check 2's `_nested_failures` guards on `isinstance(category, dict)`,
check 4's `_labelled_figure_failures` returns `[]` for a non-dict, check 6 guards the same way,
and check 3 only counts them. So the skip is unconditional and uncompensated.

The consequence is that the defect ADR 1 exists to catch reaches stdout. Measured against the
real quarterly fixture, with the universe and its bound measure both moved to 1284 so that 21
people were dropped upstream and the `suppressed` block still says nothing was folded:

```text
the HAVING bug, unmodified:                        ['check_7_reconciliation']
the HAVING bug plus a None in categories:          PUBLISHES
the HAVING bug plus a 0 in categories:             PUBLISHES
the HAVING bug plus a '' in categories:            PUBLISHES
the HAVING bug plus a [] in categories:            PUBLISHES
the HAVING bug plus a 'White' in categories:       PUBLISHES
a series total 82 too high, unmodified:            ['check_7_reconciliation']
a series total 82 too high plus a None point:      PUBLISHES
```

Running the nine checks individually over the null-category payload returns zero findings from
every one of them. A bare `null` sitting in a `categories` array is invisible to the whole gate,
and its presence is enough to disable rule 1.

Rule 2 does not save this. It compares `universe` against the bound measure and is silent
whenever those two agree, which is exactly the `HAVING count >= 5` shape: the denominator is
right and the parts are short. Rule 2 would still catch the `docs/FINDINGS.md` section 1 shape
(2905 against 1263), so the exposure is bounded, but the bounded part is the case the gate was
built for.

This is not hypothetical input. A sparse or partly-null array is an ordinary artefact of a
serialized result set, which is what `sources/looker.py` will hand this gate in phase 7.

**What to do.** The requirement is that the gate refuse the payload, not that a particular check
do it. The narrower and more consistent fix is check 4: `_breakdown_failures` already faults a
non-object `residual` ("a residual is an object, received ...") and `_count_block_failures`
already faults a non-object block. The symmetric rule for a category element and a point element
is simply missing. Adding it also closes check 6's identical skip, and leaves check 7's
division-of-labour docstring true instead of aspirational.

If instead you make check 7 report the skip itself, say so in the docstring, because the current
text will then be describing the opposite of the code.

Please do not add a twenty-second hostile fixture for this. Phase-0 section 8's inventory and
`test_app.py`'s `test_there_are_twenty_one_hostile_fixtures_numbered_one_to_twenty_one` both fix
the count at twenty-one, and a new numbered file would put this review in conflict with that.
Unit tests in
the check 4 and check 7 modules, plus one end-to-end assertion that the null-category payload
exits non-zero, cover it without touching the inventory.

Run it red first. The assertion that discriminates is the one that fails before the fix and
passes after: assert the gate rejects the payload above, not that check 4 has a new branch.

#### Item 2, not blocking. The walker defect has a third layer, and it is `corpus.withheld_points`

The phase brief asked me to look for one on the reasoning that a defect which recurred
immediately above its own fix will recur again. It does.

`corpus.withheld_points` mediates exactly one assertion,
`test_no_small_cell_reaches_the_payload.py:68 test_no_withheld_point_carries_a_value`, which
asserts an empty list. Nothing pins the walker. Measured: rewriting `withheld_points` to yield
nothing for every payload leaves **all 1390 tests passing**. That is the same shape as the two
the self-audit found, one layer further along the same chain: `corpus.count_positions` is pinned
by `test_count_positions.py`, the `kind == "count"` filter above it is now pinned by
`COUNT_KIND_POSITIONS`, and the sibling walker beside both of them is pinned by nothing.

The tell is visible in the module itself. `test_no_small_cell_reaches_the_payload.py` carries
`test_the_test_is_looking_at_something` for `count_positions` and nothing equivalent for
`withheld_points`. The property that walker serves is one of the two Phase-0 section 5 names for
that module, and `monthly.json` is the only fixture that exercises it, so it arrived this phase.

A compensating control does exist in fact:
`test_valid_fixtures.py:232 test_the_referrals_series_withholds_exactly_three_months` walks the
payload directly and asserts the labels, the count of three, and `all("value" not in point)`,
without going through `corpus.withheld_points`. Planting a value on a withheld point in
`monthly.json` turns 13 tests red, so the data direction is well covered.

But the standing rule's clause 3 permits a test that cannot go red alone only when the clearance
records which named test covers the same ground, and the Phase 3 clearance does not mention
`withheld_points` at all. Either pin the walker the way its sibling is pinned, or record the
compensating control by name. Pinning is cheap and matches what the other two layers got.

#### Item 3, a note only. An empty `components` block skips rule 4 silently

`_component_reconciliation` returns `[]` when `parts` is empty, so `"components": {}` on a point
is not reconciled. Nothing else names it either: check 2 iterates the keys and an empty dict has
none, and check 4's `_block_figures` returns `[]`. Severity is low, because an empty block
publishes no figure and therefore misstates nothing, which is why this is a note rather than an
item. Worth a sentence in the docstring so the next reader knows it was seen.

#### The five adjudications the brief asked for

1. **The Phase-0 edits.** All three verified independently and all three are right. Fixture
   `19`'s row: measured {2, 6, 7}. The interactions bullet: `13` measures {2, 6}, its `total` of
   4242 is 4000 + 242 exactly as claimed, and the old bullet did contradict its own table row.
   Section 9: `weekly.json`'s `olderAdultsOnCq` carries no `residual` and 181 + 137 = 318, so
   `aliceThreshold` is not the only one and the old sentence was false. The prose is now correct.
2. **Fixture 19's check 2 is necessary, not an artefact.** The point level's `exactly_one_of` is
   `{value, withheld, unavailable}` and `_level_failures` counts key presence, not truthiness. A
   point carrying both `withheld` and `value` has two of the three present by construction, so
   there is no way to write this attack that does not trip check 2. The fixture was not bent.
3. **Both tautologies reproduce, in both directions.** Zero-defaulting the missing `suppressed`
   block: 1389 green against the pre-fix test, 1 red against the corrected one, and it is the
   only one. Adding `and "segments" not in path` to `count_kind_positions`: 1383 green against
   the pre-fix module, 2 red against the current one, both new. Third layer: item 2 above.
4. **The two rule sets.** Check 6's widening to segments, components, a breakdown `universe` and
   a series `total` is the right call: every one of those is a position `corpus.count_positions`
   already treats as a published figure, so omitting them left a hole the property test can see
   and the gate cannot, and every one of them widens in the conservative direction and can only
   cause a refusal, never a publish. Check 7's `total`-required-when-`reconciles` rule closes a
   real bypass and is necessary, since rule 3 is otherwise skippable by omitting the one figure
   it compares against. Check 7's skip on a missing `suppressed` block is **safe as documented**:
   the breakdown allowlist makes `suppressed` required, so check 2 fires, and check 6 fires
   independently, and the payload can never publish. The instinct behind the question was right
   about the mechanism and wrong about the instance. The same `return None` has two other exits
   and those are not fail-closed, which is item 1.
5. **The fixture 19 breakage result is real.** Reproduced step by step on a scratch copy: with
   check 6's withheld-point rule removed it exits 1 at {2, 7}; with the allowlist's
   `exactly_one_of` also removed it exits 1 at {7}; with check 7's series total rule also removed
   it exits 0 and prints `{"label": "2025-02", "value": 2, "withheld": true}`. Three independent
   controls, and the plan's step 5 assumed one. Worth keeping in the record.

#### Also verified independently

- 1390 passed offline, 3.1s, no network.
- All twenty-one hostile sets and all five valid fixtures, gated directly rather than through the
  suite. Every set matches the corrected section 8 table.
- `git status` clean after eighteen-plus breakage steps. Nothing left modified.
- The tolerance breakage publishes `categories 4000 + residual 241 + suppressed 0 = 4241` under
  `"universe": 4242`, at exit 0. Ten tests red rather than the nine recorded, and the tenth is
  `test_the_same_breakdown_with_a_suppressed_block_of_21_reconciles`, which did not exist when
  that breakage was run. Not a discrepancy.
- The image was read a fourth time. Twenty bars at 81, 10, 2, 2, 3, 38, 35, 15, 23, 7, 58, 45,
  71, 49, 72, 117, 160, 147, 177, 206, axis labels on the even bars with "January '25" under bar
  2 and "July" under bar 20. `monthly.json`'s published points sum to 1311, withheld 2 + 2 + 3 =
  7, total 1318. All tiles match `weekly.json` and the three exclusions.
- No `float`, `round(` or `abs(` anywhere in check 7. No em dashes in any file this phase wrote.
  No purity ban-list import anywhere under `gate/`.

---

#### Resolution

**Item 1, blocking. RESOLVED in `1138399`.**

The finding reproduces exactly as reported, including all five non-object elements and the series
case, and the nine checks individually returning zero findings over the null-category payload. The
diagnosis is exact and the recommended fix is the right one.

Fixed in check 4, not check 7. `_element_failures` faults an element of `categories` or `points`
that is not an object, symmetric with the rules already there for a non-object `residual` and a
non-object count block. That closes check 6's identical skip in the same line and leaves check 7's
division-of-labour docstring true rather than aspirational.

Measured after the fix, against the same payloads:

| Payload | Before | After |
|---|---|---|
| the HAVING bug, unmodified | {7} | {7} |
| plus a `None`, `0`, `""`, `[]` or `"White"` in categories | PUBLISHES | {4} |
| a series total 82 too high, unmodified | {7} | {7} |
| plus a `None` point | PUBLISHES | {4} |

All twenty-one hostile fixtures are unchanged, so no recorded set moved.

No twenty-second fixture, as asked. The end-to-end case is built in the test and written to a
`tmp_path`, so it goes through the same argv, source, gate and sink as a fixture would while
leaving Phase-0 section 8's inventory and its numbering guard untouched.

Run red first, against the code as it stood: 28 failed, including all five end-to-end cases and
both gate-level assertions. The two paired controls, `test_the_having_bug_is_refused_unmodified`
and `test_a_series_total_that_does_not_add_up_is_refused_unmodified`, stayed green, so the new
assertions are about the element rather than about a payload that was going to be refused anyway.

**The audit the item asked for, in `4412eed`.** `tests/gate/test_skips_are_compensated.py` takes
every early exit in checks 6 and 7 and names the check that fires instead, with a payload that
takes it, asserted at the gate rather than in the check that skipped. Twenty-two exits. Five are
the rule reaching its own answer rather than a decision to look away, and each is named with the
test that covers it. The other seventeen are each demonstrated.

Verified by removing the compensating check rather than by reading it: unregistering check 4
collapses 23 rows, unregistering check 2 collapses exactly the five that name check 2, and three of
those five publish outright, which is what an uncompensated skip looks like from outside.

The completeness guard counts exits in the source. Mechanical on purpose: what made this hole
missable is that reading the skip contract is convincing, because every skip has a plausible
sentence beside it saying whose finding the malformed value is. A count cannot be talked round.

**The distinction the item draws is the lesson and it is recorded.** The suspicion was right about
the mechanism and wrong about the instance. A missing `suppressed` block is safe, because the
allowlist makes it required and check 6 faults its absence independently, and that row is now in
the audit saying so. The same `return None` has three other exits and one of them was the hole. The
conclusion carried forward: a skip contract is not verifiable by reading, because the reading is
what was already done.

**Item 2, not blocking. RESOLVED in `f0fb846`.**

Reproduces exactly: rewriting `corpus.withheld_points` to yield nothing left all 1390 passing.
Pinned rather than cleared, which is what its two siblings got. By path against `monthly.json`, by
the empty result on the other four fixtures, by the point objects it yields rather than only their
paths, by a planted value it must see, and by an `unavailable` point it must not call withheld. The
compensating control the item names is now named in the module docstring as well.

**The fourth layer was asked for and there were two.** Each piece of shared test infrastructure was
degraded and the suite re-run, which is the only way this class is visible:

| Degradation | Result before pinning |
|---|---|
| `corpus.withheld_points` yields nothing | 1458 passed |
| `payloads.HOSTILE_INPUTS` emptied | 1404 passed, 9 skipped |
| `sourced_figures` accepts every neighbour | 1458 passed |
| `corpus.valid_paths` truncated to one fixture | 5 failed, already pinned |

`HOSTILE_INPUTS` is the six-input corpus every per-check `test_check_N_is_total` parameterizes
over. Emptying it reports nine totality controls as skipped rather than failed, and the run stays
green. Now pinned by identity, by length, by every member being unpublishable, and by every member
also appearing in the thirty-input corpus.

`sourced_figures` mediates "every figure is sourced", which is another assert-empty. The data
direction was covered, since planting an unsourced 9999 turns it red, but the parser direction was
not: widening it by one on either side of every row left the suite green and would have let an
off-by-one transcription through. Now pinned by near misses either side of 1263, by the ADR 9 and
ADR 10 figures, by three numerals that appear in the file's prose but not as rows, and by a count.

Each pin verified red against the degradation that motivated it: 3, 2 and 2 failed respectively.

**Item 3, a note. Recorded rather than changed, in `4412eed`.**

Confirmed: `"components": {}` is not reconciled, and nothing else names it. Left as it is on the
review's judgement, since an empty block publishes no figure and so misstates nothing and discloses
nothing. Both the check docstring and
`test_skips_are_compensated.py::test_an_empty_components_block_publishes_and_that_is_a_recorded_decision`
now carry the counter-argument (a decomposition of nothing sums to 0 against a point of 690) and
the one-line change that would close it. Pinned rather than left latent, so whoever revisits it is
deciding rather than discovering, and the test is the place the new answer gets recorded.

#### Breakage steps re-run after these changes

Every step the changes touch, re-run and reproducing:

| Breakage | Measured |
|---|---|
| Phase verification step 4, a tolerance of one | fixture 07 exits 0 and publishes; 10 failed |
| Phase verification step 5, the withheld-point rule | fixture 19 still exits 1 at {2, 7}; 8 failed |
| check 6 blind to segments | 5 failed |
| zero counts as a small cell | 4 failed |
| `MIN_CELL` hardcoded as a literal 5 | 2 failed, both stub-contract tests |
| the ADR 7 count rule removed | 11 failed |
| the cross-measure rule removed | fixture 17 exits 0 and publishes; 9 failed |
| the series total rule removed | 8 failed |
| the point components rule removed | 2 failed |
| `_is_whole` accepting booleans | 2 failed |
| the element rule removed | the HAVING bug plus a null publishes; 38 failed |

Counts are higher than the Phase 3 originals because the new tests cover more ground. Every
original result is preserved: 07 still publishes under a tolerance, 17 still publishes without the
cross-measure rule, and 19 still takes three removals.

1477 passed offline, up from 1390. Working tree clean, purity clean, no em dashes, all twenty-one
hostile sets unchanged, all five valid fixtures exit 0.

---

### CODE_REVIEW 2026-08-01: Phase 2

Status: RESOLVED
Verdict: CHANGES_REQUESTED, both items addressed. Both were adjudications I asked for, and both
went against me on measurement rather than on preference.

#### Item 1. The check 5 id exemption is removed

**Status:** RESOLVED in `0a138dc`.

The reviewer is right, and reason 2 is the one that decides it. The exemption covered
`REGISTRY` union `EXCLUDED`, and those two halves have opposite risk profiles. For an excluded
id, check 2 always fires with a named reason and the payload can never publish, so suppressing
a second finding costs nothing. For a **registered** id, check 2 does not fire at all, because
the id is publishable, so the key scan is the only control on that name, and the exemption is
precisely what removed it. My justification, that the contract has already ruled on the name,
describes the exclusion half only. I wrote it about the half that was safe and applied it to
the union.

Reason 1 also lands. I wrote in the commit body that the resolution "is not to bend the
fixture", which is true and beside the point: the check was bent instead, and that is the
larger change, because it alters behaviour for every payload the gate will ever see rather than
one file.

`and path not in named` is gone, `_contract_named_paths` is deleted, and fixture `12` is
recorded as {2, 5, 8} in the four places that carry it: Phase-0 section 8's table and its
interactions list, `Phase-1.md` Task 6's construction constraint and its acceptance criterion,
and `Phase-2.md`'s Integration points. Each says an exemption is not to be reintroduced and
why. Measured cost of the removal: one line of production code and exactly two red tests, both
fixture `12`. Twelve of the thirteen sets unchanged, all three valid fixtures still `Passed`.

#### Item 2. The check 4 kind gap is closed

**Status:** RESOLVED in `da40bd4`.

My stated reason for deferring, that an unlisted check 4 rule could move a recorded failing set
in Phase 3, does not survive measurement, and the reviewer measured it before I did: zero tests
changed, no set moved. The objection was also inconsistent with the phase, which already
carries three unlisted check 4 rules under ADR 4. That inconsistency is the part worth keeping:
I had already decided the "unlisted" ground was not disqualifying three times, then used it
once as a reason to stop.

`kind` and `precision` are now validated by one function, `_declared_failures`. An unrecognised
value is one finding; a recognised value disagreeing with the registry is a different finding,
and only reportable when the id is registered. The domain rule applied to a figure still comes
from the registry and never from the declared kind, so this remains an honesty defect closed
rather than a gate hole closed. Setting `kind` to `currency` on `aliceHouseholdsBelowThreshold`
in the real annual fixture now exits 1 naming the field, where the reviewer measured `Passed`.

One behaviour changed beyond the rule asked for, recorded because it was not requested: a
`precision` outside the enum on an **unregistered** id is now reported, where before it was not.
That is the same asymmetry one field further down. It moves no recorded set.

#### Item 3. The tautological test, and the audit it prompted

**Status:** RESOLVED in `0a138dc` and `37a7874`.

The reviewer is right that this is the more important finding, and it is mine rather than a
matter of judgement: `test_no_registered_id_is_client_shaped` called `check_5_pii_scan`, the
function that applied the exemption, so it returned `[]` for every registered id by
construction. It asserted that the exemption exempts. I cited it twice as evidence the
exemption cost nothing publishable, and it established nothing. With the exemption gone it
measures the scan, is parameterized over the registry, and was verified red by registering
`Entry(id="clientsServed", ...)`. It carries no list of accepted names, so a future
registration cannot be silenced by appending to one.

The instruction was to look for the same shape elsewhere and report what I found. Two more,
both fixed in `37a7874`, and a list of what was examined and cleared.

**Found, and fixed.**

1. `test_the_ceilings_are_the_contracts_and_not_literals_in_the_check` compared what
   `cardinalities` reported against `contract.MAX_MEASURES` and friends. A check hardcoding 32
   passes it, which is the exact claim in its name. Not the tautology shape, but the same
   defect class: a name claiming more than the body proves. It now passes a stub contract whose
   ceilings match no real constant, plus a second test asserting the property through the
   failures rather than the report. Verified red by hardcoding the category ceiling.
2. `corpus.count_positions` is shared test infrastructure that the small-cell test, the
   provenance test and the ADR 9 and ADR 10 figures test all rest on. All three assert a set is
   empty, so a blind spot in the walker makes all three quieter rather than red, and nothing
   pinned its coverage. `tests/gate/test_count_positions.py` now pins it by kind of position and
   by exact count against hand-written paths. Verified red by blinding the walker to segments,
   and the measured detail is the point: those two new tests were the **only** failures, while
   all three property tests stayed green while covering less.

**Examined and cleared, with the reason each is not the same shape.**

- `test_the_exemption_covers_exactly_one_name`, now
  `test_the_excluded_client_count_is_reported_by_both_controls`. It did discriminate even under
  the exemption, because it scanned ids at a path the exemption did not cover, which is why it
  caught `clientsServed` when its neighbour could not.
- `test_every_key_the_allowlist_names_survives_the_scan` and
  `test_a_contract_key_is_not_client_shaped`. The claim is that the contract vocabulary and the
  patterns do not collide, and widening a pattern turns them red. They discriminate.
- `test_check_4_never_consults_the_registry_about_cadence`,
  `test_an_unregistered_id_has_no_declared_precision_to_disagree_with` and
  `test_check_4_reads_no_unknown_key`. Each asserts `[]` by calling check 4, but each is a claim
  about check 4's behaviour rather than about data the check might be blind to, and a check
  written the other way fires on the payload given. They discriminate.
- `test_a_valid_fixture_sits_under_every_ceiling` and
  `test_the_largest_valid_fixture_leaves_room_on_every_ceiling` measure fixtures through
  `cardinalities`, so an under-counting walker would pass them. Cleared because
  `test_the_annual_headroom_is_a_measured_number` pins the exact counts (14, 3, 1, 1, 6, 2, 137)
  and `test_the_leaf_count_is_over_the_whole_payload` pins 12 for `live.json`, so an
  under-counting walker goes red there.
- The arithmetic tests added in `8759fc7` (`test_a_breakdown_reconciles_to_its_universe_exactly`,
  `test_the_annual_components_sum_to_their_point_totals`,
  `test_a_breakdown_universe_equals_the_measure_it_binds_to`) call no gate function at all. They
  recompute over the fixture JSON, which is the right shape and the reason they are worth having
  before check 7 exists.
- Phase 1's `test_purity.py` already guards its own guard with
  `test_the_ast_walk_would_catch_an_aliased_import`, and the small-cell module already carries
  `test_the_test_is_looking_at_something` and
  `test_a_sub_threshold_cell_is_detected_when_one_is_present`. Both are the pattern I should have
  followed for the check 5 guard and did not.

**The rule I am taking from this.** A test whose subject is data (what the registry holds, what a
fixture contains) must not establish it through a function that can be blind to that data. If the
function is the thing in question, the test has to be able to go red with the function unchanged
and the data changed. Every guard added here was run red against the defect it claims to catch
before being reported as passing.

#### Verification after the changes

1004 passed. All four Phase 2 deliberate-breakage steps re-run after the check 4 and check 5
changes and reproduce identically: the bool removal publishes `"value": true` at exit 0; the
email pattern alone leaves fixture `05` refused by the label character class; both relaxed puts
the address on stdout at exit 0; the raised ceilings publish the 260 row dump. Two new breakages
recorded above. Working tree clean, with no fixture, constant or check left modified.

Measured sets after both items, through `python3 publisher/app.py <fixture>`: 01 {1}, 02 {2,5},
03 {3}, 04 {4}, 05 {5}, 08 {2,8}, 09 {9}, 10 {2,8}, 12 {2,5,8}, 15 {2}, 18 {4}, 20 {4}, 21 {2}.
Only `12` differs from what Phase-0 section 8 recorded before this review, and section 8 is
edited to match.

#### Re-review, 2026-08-01: PHASE_APPROVED

Every claim above was reproduced independently rather than accepted. Nothing was taken on report.

**Both requested items.** The exemption and `_contract_named_paths` are gone, fixture `12`
measures {2, 5, 8} and reads {2, 5, 8} in all four recorded locations, and the other twelve sets
are unchanged. `kind` and `precision` now share `_declared_failures`. The unrequested consequence
is confirmed and is the right semantics: an unregistered id with `precision: "banana"` is now
reported as an enum violation where it was silent before, while an unregistered id with
`rounded5` is still not reported, because the registry declares nothing for it to contradict.
The enum rule is a value-domain rule and the registry-disagreement rule stays gated on
registration, so no check 2 finding moved into check 4.

**The `count_positions` finding is confirmed, and it is the most serious thing found in this
phase.** Blinding the walker to segments fails only the two new tests; the small-cell test, the
provenance test and the ADR 9 and ADR 10 figures test all stay green. The consequence is not
theoretical. With the walker blind, planting `inflow.segments.veterans` at 3 (a sub-threshold
cell), at 9999 (an unsourced figure) and at 219 (the ADR 10 net figure that may never appear)
each left all 52 tests passing. With the walker intact every one of those three goes red. Three
property tests being counted as evidence were silently degradable through one line of shared test
infrastructure that nothing pinned.

**The ceilings finding is confirmed.** The old assertion passes with the measures ceiling
hardcoded as a literal 32, verified by restoring it and hardcoding. Both replacements go red, and
they are not redundant: hardcoding a literal in the report is caught only by the stub-contract
test, while reporting the contract ceiling and comparing against a literal is caught only by
`test_a_ceiling_lowered_in_the_contract_is_the_ceiling_the_check_enforces`.

**Every clearance is correct.** Each was attacked rather than read. Widening a PII substring to
`value` turns both allowlist-vocabulary tests red. Making check 4 consult the registry about
cadence, and making it read unknown keys, each turns exactly its own test red. Breaking a
breakdown sum in the fixture turns the arithmetic test red. The headroom clearance is the one that
needed checking, because the Implementer concedes those two tests do not discriminate alone: with
`cardinalities` blinded to segments the two cleared tests do stay green, and
`test_the_annual_headroom_is_a_measured_number` and the `segments` ceiling test both go red, so
the compensating control is real and correctly named.

**The rule is right and should be carried into Phases 3 to 5, with three amendments.**

1. **Clause 2's antecedent is ambiguous and reads backwards.** "If the function is the thing in
   question, the test has to be able to go red with the function unchanged and the data changed"
   invites the reading that the function is the subject under test, which would call for the
   opposite: vary the function, hold the data. The intended sense is that the function is the
   intermediary standing between the test and its subject. Suggested wording: *when a function
   mediates a test's access to the data it asserts about, the test must go red when the data
   changes and the function does not.*
2. **Add "run it red", because "able to go red" is exactly the claim that gets settled by
   inspection.** The Implementer's own practice already went further than the rule states: "Every
   guard added here was run red against the defect it claims to catch before being reported as
   passing." That sentence is the operationally valuable half and it currently sits in the report
   rather than in the rule. Encode it. The original tautology survived a commit body and an
   implementation note precisely because nobody ran it red.
3. **Add the compensating-control clause the headroom clearance actually relied on.** The rule as
   written has no room for a test that does not discriminate alone, so a reader applying it
   strictly to `test_a_valid_fixture_sits_under_every_ceiling` would either delete it or wrongly
   clear it. The practice used here was sound and should be stated: *a test that cannot go red on
   its own is acceptable only when a named test covering the same ground has been run red, and the
   clearance records which one.*

**Verified at approval.** 1004 passed. All four original breakage steps reproduce identically
after the check 4 and check 5 changes, including the two-stage check 5 result: the email pattern
alone leaves fixture `05` refused, and only relaxing the label character class as well puts the
address on stdout at exit 0. The replaced check 5 guard was verified red by registering
`clientsServed`, which the old one passed. Working tree clean, purity clean, no em dashes.

---

### PLAN_REVIEW 2026-08-01: publisher plan, third review

Status: RESOLVED
Verdict: PLAN_APPROVED. No blocking items. Two notes for the Implementer below, neither of which
withholds approval.

Both open items from the second review are resolved, and both were re-derived from source rather
than taken on report.

**Fixture `12`.** Now {2, 8} in four agreeing locations: the Phase-0 section 8 table, `Phase-1.md`
Task 6's construction constraint, `Phase-1.md` Task 6's acceptance criterion (widened from "`08`
and `10`" to "`08`, `10` and `12`"), and `Phase-2.md`'s Integration points. No fifth location
records the old value. The four remaining `{2}` entries in the table belong to `11`, `15`, `16`
and `21`, which are correct: `11` and `16` sit on `weekly.json` in Phase 3, and `15` and `21` are
Phase 2 fixtures on non-live bases, so checks 8 and 9 do not reach any of them. Section 8 and
`Phase-1.md` Task 6 both now state the rule as a property of the base file, which is what makes
the difference between {2, 8} and {2} legible rather than arbitrary.

**ADR 17's replacement reason 2.** The chain holds from source. Verified step by step:

- `docs/FINDINGS.md:70` gives four labeled slices totalling 1,183 of 1,263. `docs/HANDOFF.md:350`
  gives 720, 322 and 108, which sum to 1,150, so the fourth labeled slice is 33 and the two
  unlabeled hold 1,263 minus 1,183, or 80. 33 + 80 = 113, which is `docs/HANDOFF.md`'s "other or
  unknown 113". Every step is arithmetic and every input is quoted.
- The fourth labeled slice being cleanly labeled is corroborated by `site/dashboard.html:289`,
  whose `unknownNote` distinguishes "the reported other/unknown count" from "values that could not
  be read from the public embed". That is the 33 and the 80 respectively.
- So nothing is left for a truncated label to attach to except the two inside the 80, and
  "Sheltered- No ..." at `docs/FINDINGS.md:129` is one of those two. The objection the Planner
  raised against itself does not survive, and raising it was the right instinct.
- The race parallel that carries the "unlabeled" to "truncated" identification is real:
  `docs/FINDINGS.md:26` says four race labels truncated, `docs/FINDINGS.md:123` says four are too
  small to see, and `docs/HANDOFF.md:349` puts exactly four truncated-and-unnameable categories
  inside the residual of 99. Same counts, same consequence, same phrasing.

The two supporting claims about the audit's own limits are also true as stated:
`docs/FINDINGS.md:6` does record public-embed-only access, the Confidence section does resolve the
analogous race question by saying it needs workspace access, and the "Where to start" priority
list does not name the shelter-status labels anywhere in its five items.

Most importantly, ADR 17 no longer rests the decision on the retracted inference. It confines only
the truncation horn, states plainly that the mislabeling horn is unresolved and that `Sheltered`
at 720 is not ruled out, names the residual risk being accepted, retracts the old claim by name,
and extends the change mechanism to say a named category is among the things that could change.
That is a decision someone can be held to.

**Both over-claims are gone and there is no third copy.** A search for the retired wording across
all seven plan files returns two hits, both inside ADR 17's explicit retraction paragraph, which is
the sentence disowning the claim rather than a surviving instance of it. Phase-0 section 9's
`quarterly.json` paragraph is rewritten and now carries the unresolved half rather than the old
"the three named categories are the ones the audit does not question".

**The semantic cross-check result is true, not merely run.** Reproduced independently by parsing
the Phase-0 section 8 table as authority and diffing every "fires exactly {...}" and "reads exactly
{...}" claim in all six phase files and `README.md` against it: 21 authority rows, per-phase counts
of 6, 7 and 8, zero conflicts, zero fixtures named by more than one phase, zero fixtures in the
table that no phase names, zero fixtures named by a phase that the table omits, and zero
phase-assignment mismatches.

**All four second-review nits are resolved.** `Phase-4.md` Task 1's Patterns line now points at the
Phase-0 section 3 object key table instead of `docs/PLAN.md` 3.2. `Phase-3.md` Task 2's commit
template gains a bullet naming the `residual.value` rule and disambiguates the two `suppressed`
bullets. Phase-0's interactions bullet now reads "puts an id into a file its registry cadence does
not name" and correctly excludes `10`, with `10`'s different shape explained separately in both
Phase-0 and `Phase-1.md`. ADR 17 cites `docs/FINDINGS.md:27` for the count of two and
`docs/FINDINGS.md:129` for the truncation example, which are the correct lines.

**Re-verified at approval.** Prose lint clean across all eight files: no em dashes, no emoji. Every
internal markdown link resolves. Every external reference resolves: `docs/PLAN.md`,
`docs/HANDOFF.md`, `docs/FINDINGS.md`, `docs/reference/community-queue-overview.png`,
`site/dashboard.html`. All fixture arithmetic recomputed and correct: 679+343+142+99=1263,
720+322+108+113=1263, 27445+52779=80224, 181+137=318, the twenty CQ bars summing to 1318 with
1311 published and 7 withheld, and all three Point-in-Time component sums.

---

#### Note 1, not blocking. The "unlabeled equals truncated" step is an interpretation, and is
labeled as one

`docs/FINDINGS.md` uses "unlabeled" in the integrity section, where it is describing slices whose
values were not printed, and "truncated" in the summary table, where it is describing legend labels
cut off mid-word. Those are different attributes of a slice, and `docs/FINDINGS.md` never states
that shelter status's two are the same two. ADR 17 identifies them, flags the identification as
loose phrasing rather than asserting it as a finding, and supports it with the race parallel, which
is the right handling.

Recording it because it is the one join in the chain that is inference rather than arithmetic. It
does not block, for two reasons: the ADR presents it as a reading, and the publish decision does
not depend on it, since the stated basis (the denominator reconciles exactly, the audit did not
place the measure among its five, the risk is to a label rather than a count, and exclusion remains
a one-line change) survives intact even if the identification is wrong. If anyone gets workspace
access, this is the cheapest thing to confirm first, and ADR 17's three-outcome list already says
what each answer costs.

#### Note 2, not blocking. The 33 and 80 are derived, and must never become published categories

The 113 is the transcribed figure and is what `docs/HANDOFF.md:351` carries. The 33 and 80 split is
derived by this plan from `docs/FINDINGS.md`'s arithmetic and exists only to explain what the
residual contains. Phase-2 Task 5 requires it in `PROVENANCE.md`, which is correct.

Stated explicitly because an implementer holding both numbers could reasonably wonder whether to
publish them as two categories, and that would be wrong three times over: it would name categories
the source does not name, it would break the property that makes the residual safe (that its
members are unnamed and combined), and since nobody knows how the 80 splits, one of the two could
be below `MIN_CELL`, which is exactly the disclosure the residual prevents. `shelterStatus`
publishes three named categories and one residual of 113. Nothing else.

### PLAN_REVIEW 2026-08-01: publisher plan, second review

Status: RESOLVED

One blocker, one should-fix and four nits, all addressed. The blocker was introduced by the
previous round's fix to Should fix 1, which is recorded below rather than glossed.

#### Blocking 1. Fixture `12`'s expected set of {2} is unachievable

**Status:** RESOLVED

**Resolution:** The reviewer is right and the diagnosis is exact: pinning the injected id's
cadence to `live` made `12` a `live.json` payload with a second entry, which fires check 8 under
either construction. The plan already carried the correct reasoning at `Phase-0.md` under "One
deliberate exception to the exact-set rule" and applied it only to `test_exclusions.py`.

Took the recommended fix, which preserves the 6, 7, 8 phase counts. `12` is now {2, 8} in all
three recorded locations: the Phase-0 section 8 table, `Phase-1.md` Task 6's construction
constraint, and `Phase-2.md`'s Integration points. Phase-1 Task 6's acceptance criterion is
widened from "`08` and `10`" to "`08`, `10` and `12`".

Section 8's interactions list is rewritten so the rule is stated as a property of the base file
rather than left implicit: `08`, `10` and `12` are all built on `live.json` and check 8 fires on
all three, while `11` and `16` are Phase 3 and sit on `weekly.json`, where checks 8 and 9 do not
apply. `Phase-1.md` Task 6 carries the same note, so a reader in either file sees why one
exclusion fixture reads {2, 8} and two read {2}.

**Process response.** The lesson is that a targeted fix propagated an inconsistency into files it
did not touch, and last round's cross-checks were shape checks that could not have caught it. A
semantic check was added and run: parse the Phase-0 section 8 table as the authority, then find
every "fires exactly {...}" claim in every phase file and diff it against the table. It reports
conflicts, per-phase counts, and fixtures present in one place but not the other. It now returns
no conflicts, 6/7/8, and 21 total. It found the false positive in its own first draft (a regex
matching "12" out of "1263"), which was tightened before the result was trusted.

#### Nit. The fourth interactions bullet says "foreign measure" and lists `10`

**Status:** RESOLVED

**Resolution:** Correct, `10` adds an unregistered segment to the live measure rather than a
foreign id. The bullet now reads "puts an id into a file its registry cadence does not name",
applies to `08`, `11`, `12` and `16`, and states separately that `10` adds no foreign id and that
the live measure's own `cadence` is `"live"` anyway. `Phase-1.md` Task 6's constraint got the same
correction.

#### Should fix 1. ADR 17's second reason claims more support than `docs/FINDINGS.md` gives

**Status:** RESOLVED

**Resolution:** The decision is unchanged. `shelterStatus` publishes. The reason is replaced.

The old text said "every slice `docs/FINDINGS.md` disputes lands inside the unnamed residual" and
that the three named categories "are the ones the audit does not question". That was this plan's
inference presented as the audit's finding, and `docs/FINDINGS.md:72` is a disjunction whose
second horn is not confined to the fourth slice.

The replacement takes the reviewer's recommended support and adds the citation that makes it
decisive. `docs/FINDINGS.md:27` attributes exactly two truncated labels to shelter status and its
integrity section finds exactly two categories it cannot name, holding 80. The row directly above
does the same for race and ethnicity ("four category labels truncated"), and `docs/HANDOFF.md:349`
states that identification outright: the residual of 99 is where the four truncated,
cannot-be-named categories go. Same phrasing, same counts, same consequence, so the shelter
truncation dispute is confined to the residual for the same reason.

**A verification detour worth recording, because it nearly went the other way.** On first pass I
read `docs/FINDINGS.md:129`'s "Sheltered- No ..." as a truncated label sitting on a named
category, which would have made the reviewer's recommended support wrong in the same way as the
text it replaces, and I drafted a rebuttal saying so. Checking it rather than shipping either
version resolved it: `docs/FINDINGS.md`'s four labeled slices are 720, 322, 108 and 33, all four
are transcribed with clean labels in `docs/HANDOFF.md`, and nothing is left for a truncated label
to attach to except the two inside the 80. "Sheltered- No ..." is one of those two. The ADR now
states the objection and its answer, so the next reader does not have to rediscover it, and notes
that `docs/FINDINGS.md`'s "unlabeled" and "truncated" are loose phrasing for the same thing.

The mislabeling horn is stated as unresolved in its own paragraph, with what the audit could and
could not settle (`docs/FINDINGS.md:6`, public embed only; its Confidence section resolves the
analogous race question by saying it needs workspace access; its priority list does not name the
shelter labels at all). The residual risk is then stated plainly: three named categories published
from a source whose own audit says a label may sit on the wrong slice. Four reasons for accepting
it, including that the risk is to a label rather than to a count, so no small cell is exposed and
no denominator is misstated.

A second copy of the retired claim was found and removed. Phase-0 section 9's `quarterly.json`
description restated "every slice the audit disputes is inside that unnamed residual, and the
three named categories are the ones the audit does not question" in a summary sentence pointing at
ADR 17. A grep for the retired phrasing across every plan file caught it after the ADR itself was
fixed. It now states that the truncation half is confined to the residual and the mislabeling half
is not, and points at both halves of the ADR. The scan returns nothing outside ADR 17's own
sentence disclaiming the old reasoning.

ADR 17's correction mechanism is extended as directed. It now enumerates three outcomes and what
each costs, and says outright that a named category is among the things that could change, which
is why the exclusion alternative stays live rather than being closed out. `Phase-2.md` Task 5
requires `PROVENANCE.md` to record the unresolved horn alongside the 33 + 80 decomposition, so the
risk sits next to the figures rather than only in an ADR.

**One over-claim of my own, caught by re-verifying my own draft.** The first version of this
rewrite said `docs/FINDINGS.md` "Where to start" puts resolving the mislabeling behind workspace
access. It does not; its priority list does not mention the shelter labels, and the workspace
access statement is in the Confidence section and is about race and ethnicity. Corrected before
commit. Recording it because it is the same defect class as the finding.

#### Nit. ADR 17's truncation citation is one section off

**Status:** RESOLVED

**Resolution:** Correct. The count of two comes from the summary table at `docs/FINDINGS.md:27`,
and section 3 gives "Sheltered- No ..." as an example. ADR 17 now cites line 27 for the count and
line 129 for the example, and uses the example to answer the objection rather than to establish
the count.

#### Nit. `Phase-4.md` Task 1's Patterns line still points at `docs/PLAN.md` 3.2

**Status:** RESOLVED

**Resolution:** The stale half of the Blocking 2 fix. The Patterns line now points at the Phase-0
section 3 object key table and notes it carries 3.2's three JSON forms plus the two CSV forms
`docs/PLAN.md` names nowhere.

#### Nit. `Phase-3.md` Task 2's commit template omits the `residual.value` rule

**Status:** RESOLVED

**Resolution:** Added as its own bullet naming ADR 17, and the two `suppressed` bullets are
reworded to say `suppressed` so the three rules are distinguishable in the log.

#### Verification of this revision

Re-ran every check from last round plus the new semantic one. Expected-set claims: no conflicts
against the Phase-0 table. Phase counts: 6, 7, 8, total 21. Fixture assignment: every table entry
appears in exactly one phase file and no phase names a fixture absent from the table. Lint: no em
or en dashes, no unlabeled or unclosed code fences, no headings ending in punctuation, across all
eight files. Every citation added or changed in ADR 17 was read from source rather than recalled:
`docs/FINDINGS.md` lines 6, 17, 27, 68 to 73, 129 and the Confidence section, `docs/HANDOFF.md`
line 349, and `site/dashboard.html` lines 288 to 290.

#### Preserved

The testing strategy is untouched. Exact-set assertions, deliberate-breakage steps with observed
output in commit bodies, the AST purity check, `PROVENANCE.md` parsing, the fixed unseeded
totality corpus, stub-client sink tests and ADR 2's `Result` type are all unchanged. No new ADR,
no new fixture, no new machinery was introduced; fixture count stays at 21 and the phase split
stays 6/7/8.

---

### PLAN_REVIEW 2026-08-01: publisher plan, first review

Status: RESOLVED

All three blocking items, all six should-fix items and all five nits are addressed. Three
orchestrator rulings accompanied the review and are recorded with the items they settle.

The review's verified-and-correct list is not re-derived: file paths, section numbers,
`site/dashboard.html:402`, every environment claim in Phase-0 section 6, the fixture arithmetic,
the cardinality headroom, and the absence of forward dependencies between phases all stand as the
reviewer measured them.

---

#### Blocking 1. Phase-4 Task 5 asks for a test that cannot be written

**Status:** RESOLVED

**Resolution:** Corrected to five, listed by key. `Phase-4.md` Task 5's acceptance criterion now
names all five paths explicitly and states that the index is inside the plan, which is what makes
the zero-writes-on-unchanged constraint coherent. The phase goal was reworded from an ambiguous
list to "That is five", naming each. Phase-0 section 3's new object key table states the same
count in the same words, so the two cannot drift.

#### Blocking 2. The CSV object keys are never specified, but a test must assert them

**Status:** RESOLVED

**Resolution:** Orchestrator ruling 2 confirmed this is a gap in the design rather than an
omission from the plan, and assigned the keys to this plan to specify. Phase-0 section 3 gains an
"Object keys" subsection: a five-row table giving key, `Cache-Control` and `Content-Type` for
current JSON, current CSV, archive JSON, archive CSV and the index. The CSV forms are
`v1/data/<cadence>.csv` and `v1/data/archive/<cadence>/<period>.csv`, chosen for the reason
`docs/PLAN.md` 4.4 gives for the archive: a reader holding `quarterly.json` can construct
`quarterly.csv` without reading documentation.

A current CSV shares its JSON's `Cache-Control`, so `docs/PLAN.md` 3.2's "two values, not five"
survives the addition. `Phase-4.md` Task 1's constraint now points at the Phase-0 table instead of
at `docs/PLAN.md` 3.2, and says why the two CSV forms are specified here.

#### Blocking 3. Phase-2 Task 4 counts fixtures that will not exist

**Status:** RESOLVED

**Resolution:** Rewritten as discovery from `fixtures/valid/*.json`, which is the form the
reviewer identified as better because Phase 3 then inherits it unchanged. The criterion also
states that three fixtures exist at the end of Phase 2 and Phase 3 adds two, so a reader is not
left guessing why the count is absent.

#### Should fix 1. Checks 2 and 4 both own the cadence rule

**Status:** RESOLVED

**Resolution:** The two questions are separated and each assigned an owner, in a new Phase-0
section 7 subsection, "Which check owns the cadence rule". Check 2 owns the registry question
(does this id belong in this file) and never reads the object's own `cadence` field. Check 4 owns
the field question (is this value legal and does it agree with `meta.cadence`) and never consults
the registry. Both table rows in section 7 are reworded to say which.

The fixtures are pinned: any hostile fixture that injects a foreign measure writes that measure's
own `cadence` field as the **file's** cadence, so the payload is internally consistent and the
only thing it contradicts is the registry. `08`, `10` and `12` therefore keep {2, 8} and {2} when
check 4 arrives. This is stated in Phase-0 section 8's interactions list, in Phase-1 Task 6's
constraints, in Phase-2 Task 3's constraints, and in Phase-2's Integration points, which now names
this as the predictable failure of that phase and says to verify rather than assume it.

The "Two known interactions" heading over three bullets is fixed. There are now four bullets and
the text says four.

#### Should fix 2. The plan silently overrides `docs/PLAN.md`'s contract

**Status:** RESOLVED

**Resolution:** Orchestrator ruling 1 resolved the precedence deadlock in favour of keeping both
changes and recording each as a narrowly scoped ADR that supersedes `docs/PLAN.md` on that point
only.

Phase-0 section 4 opens with a "Where this plan supersedes `docs/PLAN.md`" preamble naming the two
exceptions and stating that an implementer must not revert either. Two new ADRs follow the
existing fourteen:

- **ADR 15**, the series point shape. States what `docs/PLAN.md` section 3 writes
  (`total` plus sibling component keys), what this plan writes (`value` plus a nested
  `components` block), and four reasons: one rule for count positions instead of four, the
  small-cell property test becoming mechanically writable, components no longer forcing every
  component name of every series into the point-level allowlist, and `total` already meaning the
  across-points sum at series level.
- **ADR 16**, the suppression block. Notes that `docs/HANDOFF.md` is already internally
  inconsistent here (its prose says `{suppressedCategories, suppressedValue}`, its own contract
  example says `"suppressed": {"count": 0, "value": 0}`), so something had to be chosen. Takes the
  nested form for three reasons, and states that constraint 3's semantics are unchanged and only
  the spelling moves.

Both ADRs state their scope explicitly and disclaim everything else. `README.md`'s precedence
paragraph now carries the two exceptions and repeats the do-not-revert instruction, so a reader
who only opens `README.md` gets it too. The preamble also separates ADR 1 and ADR 13, which
resolve open points rather than contradicting anything, so they are not mistaken for silent
deviations.

#### Should fix 3. Hostile fixture 15 does not test what decision 12 is about

**Status:** RESOLVED

**Resolution:** The reviewer is right that the original fixture never reached the registry. `15`
is redefined as the decision 12 case: the registered measure `inflow`, whose registry entry
declares `("veterans",)`, carrying an unregistered `chronic` segment. A new fixture `21` keeps the
case worth keeping, a series carrying a `segments` key at all, which the structural allowlist
rejects at any value. Both are in Phase-0 section 8's table with a paragraph explaining why one
fixture cannot cover both, and both are in Phase-2 Task 5.

`15`'s acceptance criterion now requires the failure detail to name the unregistered segment and
the registered set, so the test proves the registry was consulted rather than the allowlist.

On the related point: the `segments` registry field is scoped to measures. Phase-0's registry
field table says so and says why (the allowlist permits no `segments` key on a series or a
breakdown at any value, so a declaration there could never be consulted). Phase-2 Task 1's
criterion `pitCount.segments == ()` is replaced with one that asserts something real: `inflow` and
`outflow` carry `("veterans",)`, and no series or breakdown entry carries the field at all.

The total is now twenty-one hostile fixtures. `README.md`, `Phase-1.md`, `Phase-2.md`,
`Phase-3.md` and `Phase-4.md` are updated, and Phase-2's phase verification lists the thirteen
that exist at the end of that phase by number.

#### Should fix 4. `shelterStatus` carries a FINDINGS integrity finding the plan does not address

**Status:** RESOLVED

**Resolution:** New **ADR 17**, "`shelterStatus` publishes, and the disputed labels stay inside
the residual". It is a recorded judgement rather than a silence, and it records both consequences
the reviewer identified.

The decision is to publish, for three reasons: `docs/FINDINGS.md`'s own summary table classifies
shelter status as "Readable in part" rather than as one of the five that cannot be republished and
its denominator table lists it as resolving to 1,263; every slice the audit disputes lands inside
the unnamed residual while the three named categories are the three the audit does not question;
and the residual of 113 decomposes as the fourth labeled slice (33) plus the two unlabeled
categories (80), which is the same fold `site/dashboard.html`'s `unknownNote` records.

On the reviewer's second consequence, whether either unlabeled category is below `MIN_CELL`: it is
unknowable without workspace access and it does not change the outcome, because both are unnamed
and combined into 113, so no small cell is published under any decomposition. `suppressed:
{count: 0, value: 0}` is correct and is a statement about what the **publisher** suppressed, which
is nothing; the 113 is a `residual`, meaning the source did not name them, a different fact in a
different field. ADR 17 states that conflating them would be the bug.

The gap the reviewer's ADR 7 observation exposes is closed rather than argued away: **check 6
gains one rule, a `residual.value` in 1 to 4 fails**, exactly as a named category does. A residual
is unnamed but it is still a published count. This costs no new field. It is in Phase-0 section
7's check 6 row, in Phase-3 Task 2's constraints with its reasoning, and as an acceptance
criterion asserting a residual of 3 fires and one of 99 does not.

Phase-2 Task 5 now requires reading ADR 17 before writing the fixture, and requires
`PROVENANCE.md` to record the 33 + 80 decomposition with its `docs/FINDINGS.md` citation, so the
residual's meaning sits next to the figures. The alternative of excluding `shelterStatus` outright
is recorded in ADR 17 as available and as a one-line registry change, with the reason it was not
taken.

#### Should fix 5. Phase-0 section 9 omits required keys the fixtures cannot pass without

**Status:** RESOLVED

**Resolution:** Both. Section 9 now spells out `minCell` and `suppressed: {count: 0, value: 0}` on
all three breakdowns (`raceEthnicity`, `shelterStatus`, `aliceThreshold`) in the JSON shapes the
fixtures will carry, and notes that `aliceThreshold` is the one breakdown with no `residual`,
because `residual` is the only optional key on a breakdown and those two categories are exhaustive
and named.

Phase-2 Task 5's "nothing beyond it" is softened to cover structurally required keys, and adds the
instruction that a required key missing from section 9 gets added to section 9 in the same commit
rather than only to the fixture, so the two do not drift again. A new acceptance criterion asserts
every breakdown in both fixtures carries a `suppressed` block.

#### Should fix 6. Check 9's failure condition names a field that does not exist at that level

**Status:** RESOLVED

**Resolution:** Phase-0 section 7's check 9 row now reads "the live measure's `value`, which is
its own universe, is below `LIVE_POPULATION_FLOOR`". Phase 1 Task 4's criteria already tested
`value` at 28, 99 and 100 and are unchanged.

#### Nits

**Status:** RESOLVED

- **Fixture count.** Phase-0 section 8 said nineteen over a table of twenty. With fixture `21`
  added it is twenty-one everywhere: Phase-0 section 8, `README.md` (which said "at least
  nineteen"), Phase-1 Task 6's out-of-scope line, Phase-2's verification (thirteen at that point,
  listed by number), and all five occurrences in Phase-3 and Phase-4.
- **Purity ban list.** Phase-0 section 5 now carries Task 8's eleven names exactly, `json` file IO
  is gone (it is not an import), and the text says the two copies must not drift and that Task 8's
  is the actionable one. Phase-1 Task 2's shorter seven-name list is replaced by a reference to
  the eleven rather than a third copy.
- **`test_exclusions.py` membership.** Phase-0 section 5 gains "One deliberate exception to the
  exact-set rule", explaining that at Phase 1 the only valid payload is `live.json` so an injected
  id necessarily trips check 8, which would make the test about the fixture rather than the
  exclusion. Phase-1 Task 6 repeats it at the point of use.
- **Test command.** Phase-0 section 5 now gives both forms and says the `--with pyyaml` variant
  applies from Phase 5. `README.md`'s prerequisites name both development-only packages and state
  that neither is reachable from `publisher/`.
- **Stubs and totality introspection.** Phase-0 section 5 states the corpus covers the checks in
  the **registered check list**, not every function in the module, and says why a stub would
  otherwise pass trivially and report coverage it does not have. Phase-1 Task 4's out-of-scope
  line and Task 8's acceptance criterion both say the same.

#### On the parts the review asked not to weaken

Nothing in this revision touches them. Exact-set assertions are unchanged and now cover
twenty-one fixtures. The deliberate-breakage steps with the broken run's output recorded in the
commit body are unchanged in Phases 1 through 5. `test_purity.py` still asserts by AST inspection,
`test_provenance.py` still parses `PROVENANCE.md`, the totality corpus is still fixed and
hand-written with no seed, sink tests still use a stub client with no mocking library, and ADR 2's
`Result` type is unchanged. The one addition to the testing strategy is the documented exception
for `test_exclusions.py`, which the review itself identified as unavoidable and asked to have
stated.

---
