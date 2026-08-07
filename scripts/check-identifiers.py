#!/usr/bin/env python3
"""The identifier scan, on its own.

`check-scenarios.mjs` proves the two paths a label actually travels — a category value and a
flow segment key — end to end through a fake Looker. This covers what that cannot reach without
one hostile scenario per pattern: that each pattern fires, that the payload's own timestamps do
not trip it, and that the refusal never quotes what it found.

The last of those is the easiest to lose. A refusal is logged, so a message that names the email
address it refused has published the email address to CloudWatch instead of to S3, and the check
then reads as if it worked.

    python3 scripts/check-identifiers.py
"""

import pathlib
import sys
import types

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "publisher"))

# boto3 need not be installed to exercise the checks; nothing here reaches AWS. Same substitute
# `local-publish.py` makes, for the same reason.
try:
    import boto3  # noqa: F401
except ModuleNotFoundError:
    sys.modules["boto3"] = types.ModuleType("boto3")

import app

# One per pattern, plus the placements that nearly get away: an identifier in the middle of a
# sentence, and a seven-digit local number with no area code.
FIRES = [
    ("intake.coordinator@example.invalid", "an email address"),
    ("Referred to casework@example.invalid", "an email address"),
    ("123-45-6789", "a social security number"),
    ("(316) 555-0142", "a telephone number"),
    ("316-555-0142", "a telephone number"),
    ("+1 316 555 0142", "a telephone number"),
    ("555-0142", "a telephone number"),
    ("3165550142", "a telephone number"),
    ("1987-04-12", "a date of birth"),
    ("4/12/1987", "a date of birth"),
    ("Client 10045512", "a run of digits long enough to be a client id"),
]

# Every label this registry actually produces, and the ones whose shape comes closest to a
# pattern without being one. A false positive here refuses a payload that was fine, which costs
# the same as a missed identifier costs trust.
CLEAN = [
    "White",
    "Black or African American",
    "Multi-racial",
    "All other categories",
    "Emergency shelter",
    "Transitional housing",
    "Unsheltered",
    "Other or unknown",
    "Sedgwick",
    "Butler",
    "Harvey",
    "Reno",
    "Sumner",
    "All other counties",
    "Under 30 days",
    "30 to 89 days",
    "90 to 179 days",
    "180 to 364 days",
    "A year or more",
    "2022",
    "2026",
    "2024-2025",
    "all",
    "families",
    "veterans",
    "Median household income",
    "ALICE survival budget",
    "Sedgwick County",
    "National median",
]

AS_OF = "2026-03-31T23:59:59Z"

# The as-of is the one Looker string exempt from the scan, on the grounds that it is a timestamp.
# So it has to actually be one: shaped like an instant AND a real instant. A value that is merely
# shaped like one would be published unread.
TIMESTAMPS = [
    ("2026-03-31T23:59:59Z", True),
    ("2026-02-31T25:61:61Z", False),  # shaped like an instant, is not a moment in time
    ("2026-13-01T00:00:00Z", False),  # month 13
    ("2026-2-3T1:2:3Z", False),  # a date, but not the literal form the exemption assumes
    ("2026-03-31", False),  # a date with no time
    ("intake.coordinator@example.invalid", False),
    ("", False),
]

# Shaped like `build` produces, because the scan walks the payload rather than the four places
# labels are made and the walk is the thing being tested.
PAYLOAD = {
    "meta": {
        "schemaVersion": 1,
        "generated": "2026-08-04T09:12:00Z",
        "cadence": "annual",
        "source": "Coalition HMIS via Looker",
        "disclaimer": "Unaffiliated concept work.",
    },
    "measures": {
        "activelyHomeless": {"value": 1263, "asOf": AS_OF, "cadence": "annual"}
    },
    "breakdowns": {
        "raceEthnicity": {
            "asOf": AS_OF,
            "cadence": "annual",
            "universe": 1263,
            "minCell": 5,
            "categories": [{"label": "White", "value": 1164}],
            "residual": {"label": "All other categories", "value": 99},
        }
    },
    "series": {
        "pitCount": {
            "cadence": "annual",
            "asOf": AS_OF,
            "points": [
                {"label": "2022", "value": 690, "sheltered": 512, "unsheltered": 178}
            ],
        }
    },
    "flows": {"all": {"in": 948, "out": 861, "cadence": "annual", "asOf": AS_OF}},
    "comparisons": {
        "lengthOfStay": {
            "here": 51,
            "there": 141,
            "hereLabel": "Sedgwick County",
            "thereLabel": "National median",
            "cadence": "annual",
            "asOf": AS_OF,
            "kind": "amount",
        }
    },
    "rates": {"retention": {"percent": 87.4, "denominator": 612, "cadence": "annual"}},
}


def replaced(path, value):
    """A copy of PAYLOAD with one string swapped, named by a dotted path."""
    import copy

    out = copy.deepcopy(PAYLOAD)
    node = out
    parts = path.split(".")
    for part in parts[:-1]:
        node = node[int(part)] if part.isdigit() else node[part]
    node[parts[-1]] = value
    return out


def refusal(payload):
    try:
        app.check(payload)
    except app.Refused as error:
        return str(error)
    return None


results = []


def case(name, ok, detail=""):
    results.append((name, ok, detail))


for text, expected in FIRES:
    found = app._identifier_in(text)
    case(
        f"fires: {expected:<46} {text[:24]!r}",
        found == expected,
        f"got {found!r}" if found != expected else "",
    )

for text in CLEAN:
    found = app._identifier_in(text)
    case(f"clean: {text!r}", found is None, f"flagged as {found}" if found else "")

# The payload's own timestamps are dates, and `meta.generated` is one too. Both would trip the
# date pattern if the walk did not know they are not labels.
case("a clean payload raises nothing", refusal(PAYLOAD) is None, refusal(PAYLOAD) or "")

EMAIL = "intake.coordinator@example.invalid"
PHONE = "(316) 555-0142"

# A category label — the case fixtures/hostile/05 describes.
message = refusal(replaced("breakdowns.raceEthnicity.categories.0.label", EMAIL))
case("a category label is refused", message is not None)
case("and the message does not carry it", message is not None and EMAIL not in message)
case(
    "and it says where",
    message is not None and "breakdowns.raceEthnicity.categories[0].label" in message,
    message or "",
)

# A residual label, a series point label, and a comparison label: the other three places a
# string from a Look becomes a published string.
for path, where in [
    (
        "breakdowns.raceEthnicity.residual.label",
        "breakdowns.raceEthnicity.residual.label",
    ),
    ("series.pitCount.points.0.label", "series.pitCount.points[0].label"),
    ("comparisons.lengthOfStay.hereLabel", "comparisons.lengthOfStay.hereLabel"),
]:
    message = refusal(replaced(path, EMAIL))
    case(
        f"refused at {where}",
        message is not None and EMAIL not in message and where in message,
        message or "",
    )

# A segment is a key, not a value, so it is reached by the other branch of the walk — and the
# path cannot be built from the key without putting the identifier back into the message.
import copy

keyed = copy.deepcopy(PAYLOAD)
keyed["flows"] = {PHONE: keyed["flows"]["all"]}
message = refusal(keyed)
case("a flow segment key is refused", message is not None)
case(
    "and the path does not quote the key", message is not None and PHONE not in message
)
case(
    "and it is named by position",
    message is not None and "flows[0], which is the name of the entry" in message,
    message or "",
)

# Nothing else in `check` may run first: every other refusal quotes the label it is about, so a
# small cell whose label is an email must still not produce a message containing the email.
small = replaced("breakdowns.raceEthnicity.categories.0.label", EMAIL)
small["breakdowns"]["raceEthnicity"]["categories"][0]["value"] = 3
small["breakdowns"]["raceEthnicity"]["universe"] = 102
message = refusal(small)
case(
    "an identifier on a small cell does not leak through the small-cell message",
    message is not None and EMAIL not in message,
    message or "",
)

for text, ok in TIMESTAMPS:
    try:
        app._timestamp(text, "as_of", "w")
        refused = False
    except app.Refused:
        refused = True
    case(
        f"as-of {'accepted' if ok else 'refused '}: {text[:30]!r}",
        refused != ok,
        "accepted" if refused != ok else "",
    )

width = max(len(name) for name, _, _ in results)
failures = 0
for name, ok, detail in results:
    if not ok:
        failures += 1
    # Detail only on failure: on a passing run it is the refusal message, and the whole point of
    # that message is that it is safe to print — but forty of them is not a readable test log.
    print(
        f"  {'ok  ' if ok else 'FAIL'}  {name.ljust(width)}  {'' if ok else detail}".rstrip()
    )

print(
    f"\n  {len(results)} identifier checks, all as expected"
    if failures == 0
    else f"\n  {failures} of {len(results)} did not behave as expected"
)
sys.exit(1 if failures else 0)
