# RCA: why the publisher took ten hours

Written 1 August 2026, immediately after Phase 5, before the final review returned. Covers the
whole run: design conversation, plan, five phases, ten review rounds.

## The numbers

| | |
|---|---|
| Wall clock, first commit to last | 11:22 to 21:34, **10 hours 12 minutes** |
| Design and plan iteration | 11:22 to 14:48, 3h26 |
| Pipeline, planner spawn to Phase 5 | 14:50 to 21:34, 6h44 |
| Commits | 73, of which **12 (16%) are pure `feedback.md` bookkeeping** |
| Publisher source | 3,744 lines |
| Tests | 9,939 lines, **2.65x the source** |
| `feedback.md` | 2,768 lines, **larger than the code it describes** |
| `Phase-0.md` | 961 lines |
| Tests at each phase end | 533, 1004, 1485, 1929, 1953 |

## The shape of it

Phases got monotonically slower, and it was not because they got harder.

| Phase | Implementation window | Review rounds | Total |
|---|---|---|---|
| 1 | 15:53 to 16:12 | 1 | ~40 min |
| 2 | 16:30 to 17:08 | 2 | ~55 min |
| 3 | 17:25 to 18:53 | 3 | ~88 min |
| 4 | 18:56 to 20:58 | 3 | ~122 min |
| 5 (one pass, no loop) | 21:00 to 21:34 | 0 | ~35 min |

Phase 4 took three times Phase 1. Phases 3 and 4 both terminated by hitting the three-iteration
cap, not by converging. **The loop had no natural stopping point, and the cap was doing the work
that a stopping rule should have done.**

## Root causes, ranked by cost

### 1. I added scope to every round. This is the main one.

Every time I routed a review back, I attached something extra. Phase 2: "go looking for the same
shape elsewhere." Phase 3: "look for a fourth layer", then "prove the enumeration is complete."
Phase 4: "check whether that sentence is the only unmeasured safety claim of its kind."

Each was individually defensible and each one worked. Collectively they guaranteed that every
round was strictly larger than the one before, and that no round could come back empty, because a
reviewer told to go looking will find. Finding something triggers another round. That is a loop
with positive feedback and no damping, and the only thing that stopped it was the iteration cap.

The pipeline's own instruction was to route feedback. I treated each routing as an opportunity to
commission new work.

### 2. The recursive audit had no defined end.

One tautological test led to a second, then to shared infrastructure one layer up, then to the
layer above that, then to a fifth, then to mutation testing finding a sixth and seventh. Every
level was real and two of them were serious. But "is there another layer" has the same answer
forever, and nobody ever wrote down what done looked like.

The right form of the question arrived at Phase 3 and was never converted into a rule: not "is
there a fifth layer" but "how would anyone know the enumeration is complete."

### 3. Mutation testing arrived four phases late.

It was found in Phase 4, ran once, and immediately surfaced an eighth instance that five rounds of
careful human-style attention had missed. **All seven previously found by hand would have been
surviving mutants under it.** Had it run in Phase 1, most of the audit recursion above would not
have happened, because the tool does mechanically what three agents did by argument.

I also told an implementer the tool was unavailable, based on a plausible assumption about network
access, and it got the tool running anyway. That assumption cost the phases between.

### 4. The signal protocol burned wall clock on nothing.

An agent's plain text output is discarded; only `SendMessage(to="main")` reaches the orchestrator.
Agents forgot repeatedly. The Phase 3 implementer lost two replies. The Phase 4 implementer went
idle twice without signalling and had to be pinged. One agent was resumed carrying 414 prior
messages.

Each miss is a full round trip: notice the bare idle notification, send a message asking for the
signal, wait. That is minutes each time and it produced no work at all. It is also the reason the
run *looked* hung twice when it was committing steadily.

### 5. Bookkeeping grew faster than the artefact.

`feedback.md` is 2,768 lines against 3,744 lines of source. Sixteen percent of all commits do
nothing but maintain it. Some of that is genuinely valuable and is the reason this document can be
written at all. Much of it is the same finding restated by four parties: implementer reports,
reviewer verifies, implementer resolves, reviewer confirms resolution.

### 6. I used blocked time badly and did not say so.

At 19:55 the pipeline was blocked on a foreground agent and I did document corrections instead of
saying "this is blocked, there is nothing to advance." The work was real and small. Not announcing
it was the error, and it cost the user a "what are you doing."

## What the ten hours actually bought

Being fair to the process before criticising it. Five findings would have shipped without it, and
three are in the safety-critical path:

1. **A single `null` in a categories array disabled exact reconciliation**, and no check noticed.
   The exact `HAVING count >= 5` defect that `FINDINGS.md` documents in the live dashboard
   published clean with one null added. A partly-null array is the ordinary shape of a serialized
   result set, which is what Looker will hand this gate.
2. **ADR 3 claimed the handler was fail closed and it was not.** No metric on any escaping
   exception, empty stdout, empty stderr, alarm green. That sentence was inherited unmeasured
   through four phases and quoted as a reason not to act.
3. **The same defect was inside the fix for it**, one hour old: two entry points outside the new
   guard, including the one a missing `PAYLOAD_PATH` reaches.
4. **Seven blind-mediator instances**, one of which let a sub-threshold cell, an invented figure
   and an explicitly forbidden figure all publish with the suite green.
5. **A tautological test cited twice as evidence** that a PII-scan exemption was safe, which could
   only ever return the answer it was quoted for.

None of those were found by reading. All were found by breaking something on purpose and watching.

## What I would change

1. **Fix the remit per round.** "Address these items. Do not open new lines of inquiry." If a new
   line is worth opening, it becomes its own phase with its own budget, not a rider on a review.
2. **Write the stopping rule before starting.** For a recursive audit: stop at depth two, or as
   soon as a tool can take over, whichever comes first.
3. **Run mutation testing in Phase 1.** It is the mechanical form of the thing that consumed most
   of Phases 2 through 4.
4. **Default reviewer findings to notes.** Blocking should require the finding to let a payload
   through, produce a silent failure, or make a stated fact untrue. I applied that bar only at the
   final iteration of each phase, having watched two phases hit the cap without it.
5. **Make the signal recoverable without a round trip.** An agent writing its signal to a known
   file would make idle-without-signal a read rather than a conversation.
6. **Say "blocked" out loud.** Every time.

## Addendum: the final review returned NO-GO, and it lands on my recommendation

Written after the final review, which came back `NO-GO` on exactly one item.

The blocker is in Phase 5. **The IAM policy grants object actions but no `s3:ListBucket`, so S3
returns 403 rather than 404 for a key that does not exist.** The sink treats only
`("404", "NoSuchKey", "NotFound")` as absent, so the 403 propagates, and because the hash read is
evaluated as an argument to `plan_writes` it happens before anything is written. On an empty
bucket the first run raises before writing, so the keys stay absent, so the next run raises the
same way. The stack as authored publishes nothing, ever.

Every control in this repository passes it. `sam validate`, `cfn-lint`, all 22 template tests and
the stub sink tests are green, because no stub was ever told to raise 403. It lands precisely on
the seam `widgets/README.md` already names: "matches botocore's documented behaviour and has never
met botocore."

**Phase 5 is the one phase that skipped the adversarial loop, and it is the one phase that
failed.** I recommended skipping it, and the reason I gave was that a CloudFormation template has
no privacy logic and that the loop had less to find there. That reasoning was wrong in a way worth
naming precisely: I judged the risk by the *subject matter* of the phase rather than by whether
its controls could see its failure modes. A template has no privacy logic, but it has an IAM
policy, and no test in this repository can execute one. The loop's value was never that it
understood privacy. It was that it kept making things fail on purpose, and the failure mode here
is only visible if you make S3 refuse a request nobody had thought to refuse.

So cause 1 above, adding scope every round, has a mirror image: **I removed the whole loop from
one phase on a single judgement call, and it cost the run its `GO`.** Both errors are the same
error, which is deciding how much verification something needs by how it looks rather than by what
its controls can actually observe.

The reviewer also found that Phase 5 silently converted an open assignment into a deferral. A
Phase 4 note said "choosing between them is Phase 5's"; Phase 5 copied all three candidates into
the README's "leaves for later" and chose none. That is the failure mode this whole build kept
finding, one level up: a thing that reads as handled because it is written down.

## The honest summary

The findings justify a long run. They do not justify this long a run, and the difference is mostly
mine: I kept commissioning work at the point where I was supposed to be routing it, and I did not
notice the pattern until Phase 4 because each individual addition looked like diligence.

The single highest-leverage change is the third one. A tool that runs in minutes found what took
three agents five rounds to find by argument, and it found one more that none of them did.
