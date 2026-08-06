"""Looker to S3. The whole Lambda.

  Looker  ->  rows  ->  payload  ->  checks  ->  S3

Fails closed. If anything refuses, nothing is written and the previous payload keeps serving,
because the widgets read the last good object and a partial write is worse than a stale one.
"""

import json
import os
import re
from datetime import datetime, timezone

import boto3

import contract
import looker

NAMESPACE = "CoalitionPublisher"


class Refused(Exception):
    """The payload may not be published."""


# ---------------------------------------------------------------------------- map


def _whole(value, field):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise Refused(
            f"{field} must be a whole number, got {value!r}. A string here means "
            f"apply_formatting was not false."
        )
    return value


def _number(value, field):
    """A quantity that is not a count of people: dollars, days, a percentage.

    Separate from `_whole` because those may legitimately be fractional, and because the
    small-cell rule must not be applied to them — a median income of 3 dollars is wrong, but it
    does not identify anybody, and refusing it as if it did would teach whoever reads the error
    the wrong lesson about what the rule protects.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise Refused(
            f"{field} must be a number, got {value!r}. A string here means "
            f"apply_formatting was not false."
        )
    if value < 0:
        raise Refused(f"{field} is negative, got {value!r}")
    return value


def _only_named(row, allowed, where):
    """A field nobody asked for is an error, not something to skip over.

    The mapping below reads the fields it wants by name, so an extra column never reaches the
    payload on its own. That is exactly why this is needed: without it a Look that grew a column
    publishes clean and nothing anywhere says the Look changed. The change most worth catching
    is one that added a client identifier, and it would be the quietest.
    """
    unknown = sorted(set(row) - allowed)
    if unknown:
        raise Refused(
            f"{where}: fields nobody asked for: {unknown}. Either the Look changed or the "
            f"contract is out of date, and neither is safe to guess at."
        )


def measures_from(rows, spec, cadence):
    if len(rows) != 1:
        raise Refused(f"a measures Look returns one row, got {len(rows)}")
    row = rows[0]
    _only_named(
        row,
        {m.field for m in spec["measures"]} | {spec["as_of_field"]},
        f"{cadence} measures",
    )
    as_of = row.get(spec["as_of_field"])
    if not isinstance(as_of, str) or not as_of:
        raise Refused(
            f"{spec['as_of_field']} is missing; the payload would have no as-of"
        )

    out = {}
    for m in spec["measures"]:
        if m.field not in row:
            raise Refused(f"{m.field} is missing, so {m.id} cannot be produced")
        out[m.id] = {
            "value": _whole(row[m.field], m.field),
            "asOf": as_of,
            "cadence": cadence,
        }
    return out, as_of


def breakdown_from(rows, spec, as_of, cadence, universe):
    categories, residual = [], None
    for row in rows:
        _only_named(row, {spec.label_field, spec.value_field}, spec.id)
        label, value = row.get(spec.label_field), row.get(spec.value_field)
        if not isinstance(label, str) or not label:
            raise Refused(f"{spec.id}: category label must be a string, got {label!r}")
        value = _whole(value, spec.value_field)
        if label in contract.RESIDUAL_LABELS:
            residual = {"label": label, "value": value}
        elif any(c["label"] == label for c in categories):
            raise Refused(f"{spec.id}: {label!r} appears twice")
        else:
            categories.append({"label": label, "value": value})
    return {
        "asOf": as_of,
        "cadence": cadence,
        "universe": universe,
        "minCell": contract.MIN_CELL,
        "categories": categories,
        "residual": residual,
    }


# ---------------------------------------------------------------------------- identifiers

# Field *names* are allowlisted, so a column called `client_email` cannot reach the payload.
# Field *values* were not looked at at all, so an email address arriving as a category label
# published: the label column is allowlisted, and nothing downstream reads what is inside it.
#
# These patterns are structural. They find identifiers that have a shape, and they do NOT find
# personal names — nothing here should be read as if they did. A name is not distinguishable
# from a place name by inspection ("Sedgwick" is both a county and a surname), so a name
# arriving as a label is still uncovered and the derived table is still the thing that has to
# not produce one.
#
# A full calendar date is included because in HMIS that is a date of birth. The cost is that a
# series labelled by ISO date rather than by year would be refused; every label this registry
# produces is a year, a place, or a band, and a point labelled `1987-04-12` is worth a person
# looking at whichever way it got there.
IDENTIFIERS = (
    ("a social security number", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    ("an email address", re.compile(r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}")),
    (
        "a telephone number",
        re.compile(
            r"""(?<!\d)(?:
                    (?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}
                  | \d{3}[.-]\d{4}
                )(?!\d)""",
            re.VERBOSE,
        ),
    ),
    (
        "a date of birth",
        re.compile(r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}/\d{1,2}/\d{2,4}\b"),
    ),
    ("a run of digits long enough to be a client id", re.compile(r"\d{7,}")),
)

# The only strings in a payload that did not come out of a Look. Everything else is scanned,
# so a block type added later is covered on the day it is added rather than the day somebody
# remembers this list exists.
NOT_FROM_LOOKER = frozenset(
    {
        "meta",  # written here, and `generated` is a timestamp
        "asOf",  # a timestamp, and a timestamp contains a date
    }
)


def _identifier_in(text):
    for what, pattern in IDENTIFIERS:
        if pattern.search(text):
            return what
    return None


def _scan(node, path):
    """Every string in the payload, with where it sits — never with what it says.

    A walk, rather than a check at each of the four places a label is built today. Those four
    became four one at a time and a fifth would arrive uninspected. Dictionary keys are scanned
    as well as values, because a flow's segment name is a key.

    What this yields is logged, so it must not quote the string. A key that is itself an
    identifier is named by position for the same reason.
    """
    if isinstance(node, str):
        found = _identifier_in(node)
        if found:
            yield path, found
    elif isinstance(node, dict):
        for i, (key, value) in enumerate(node.items()):
            found = _identifier_in(key) if isinstance(key, str) else None
            if found:
                here = f"{path}[{i}]"
                yield f"{here}, which is the name of the entry", found
            else:
                here = f"{path}.{key}" if path else str(key)
            if key not in NOT_FROM_LOOKER:
                yield from _scan(value, here)
    elif isinstance(node, list):
        for i, item in enumerate(node):
            yield from _scan(item, f"{path}[{i}]")


# ---------------------------------------------------------------------------- checks


def check(payload):
    """Everything that must be true before a figure becomes public.

    Small cells and reconciliation are the two that matter. `docs` in the other repo record why:
    a published dashboard showed nine counties holding exactly one person each, and four
    different denominators presented as one population.
    """
    # Identifiers first, and alone. Every other refusal below quotes the label it is about, and
    # a refusal is logged — so a payload carrying an identifier is refused before anything that
    # would repeat it gets to run.
    identifiers = list(_scan(payload, ""))
    if identifiers:
        raise Refused(
            "; ".join(f"{where} looks like {what}" for where, what in identifiers)
            + ". The values are withheld from this message, because a refusal is logged and "
            "logging an identifier moves it rather than stops it."
        )

    problems = []

    for name, breakdown in payload.get("breakdowns", {}).items():
        cats = breakdown["categories"]
        residual = breakdown.get("residual")
        universe = breakdown["universe"]

        for c in cats:
            if 0 < c["value"] < contract.MIN_CELL:
                problems.append(
                    f"{name}: {c['label']!r} is {c['value']}, below the "
                    f"minimum cell of {contract.MIN_CELL}"
                )
        if residual and 0 < residual["value"] < contract.MIN_CELL:
            # A remainder is unnamed but still a published count, and a remainder of one to four
            # is a small cell wearing a different label.
            problems.append(
                f"{name}: residual is {residual['value']}, itself below the minimum cell"
            )

        total = sum(c["value"] for c in cats) + (residual["value"] if residual else 0)
        if total != universe:
            problems.append(
                f"{name}: parts sum to {total} against a universe of {universe}"
            )

    # Series and flows are counts of people, so the small-cell rule reaches them too. It would be
    # absurd to refuse a category of 3 in a breakdown and publish a PIT year of 3 beside it.
    for name, series in payload.get("series", {}).items():
        for point in series["points"]:
            for key, value in point.items():
                if key == "label" or not isinstance(value, int):
                    continue
                if 0 < value < contract.MIN_CELL:
                    problems.append(
                        f"series {name}: {point['label']} {key} is {value}, below the "
                        f"minimum cell of {contract.MIN_CELL}"
                    )

    for segment, flow in payload.get("flows", {}).items():
        for key in ("in", "out"):
            if 0 < flow[key] < contract.MIN_CELL:
                problems.append(
                    f"flows {segment}: {key} is {flow[key]}, below the minimum cell of "
                    f"{contract.MIN_CELL}"
                )

    # A rate over a handful of households discloses them however it is rounded: at a denominator
    # of 6, every possible percentage maps back to an exact count.
    for name, rate in payload.get("rates", {}).items():
        if rate["denominator"] < contract.MIN_CELL:
            problems.append(
                f"rate {name}: denominator is {rate['denominator']}, below the minimum cell of "
                f"{contract.MIN_CELL}. A percentage over that few people is the people."
            )

    # A count of people is a count of people wherever it appears. The small-cell rule reached
    # breakdown categories but not headline measures, so a subgroup of three veterans would have
    # published as a measure while three veterans in a breakdown category was refused.
    for name, m in payload.get("measures", {}).items():
        if m.get("kind", "count") == "count" and 0 < m["value"] < contract.MIN_CELL:
            problems.append(
                f"measure {name} is {m['value']}, below the minimum cell of {contract.MIN_CELL}"
            )

    live = [m for m, v in payload.get("measures", {}).items() if v["cadence"] == "live"]
    if len(live) > 1:
        # Two fast measures let an observer cross-difference successive snapshots: the total
        # drops by one and a segment drops by one in the same minute, so a specific person left.
        problems.append(f"live may carry one measure, got {live}")
    for m in live:
        if payload["measures"][m]["value"] < 100:
            problems.append(
                f"{m} is {payload['measures'][m]['value']}, below the live population floor "
                f"of 100. A one-person change against a small list identifies somebody."
            )

    if problems:
        raise Refused("; ".join(problems))
    return payload


# ---------------------------------------------------------------------------- publish

CACHE = {"live": "public, max-age=60"}
DEFAULT_CACHE = "public, max-age=3600"


def spec_for(cadence):
    """What produces this cadence, or a refusal.

    The lookup this replaced was `LIVE if cadence == "live" else QUARTERLY`. Its bare `else` meant
    an unrecognised cadence ran the quarterly Looks and published them under that cadence's
    filename, so `{"cadence": "annual"}` wrote quarterly figures stamped `"cadence": "annual"` and
    every check passed — the checks read values, and the lie was in the label.
    """
    try:
        return contract.CADENCES[cadence]
    except KeyError:
        raise Refused(
            f"{cadence!r} is not a cadence this publishes. Known: "
            f"{sorted(contract.CADENCES)}."
        ) from None


# --- annual blocks -----------------------------------------------------------------------
#
# Each of these takes the rows of one Look and produces one block of the annual payload. They
# follow the same three rules as everything upstream: an unnamed field is an error, nothing is
# repaired, and a partial block is not a block.


def _as_of(rows, spec, look):
    """The as-of every annual block stamps on itself.

    Read from the block's own rows rather than passed down from the caller. The annual file has
    no headline measure to take a date from, and threading one date through every block would
    let a series from one refresh sit beside a rate from another with nothing to show it.
    """
    field = spec["as_of_field"]
    value = rows[0].get(field)
    if not isinstance(value, str) or not value:
        raise Refused(f"{look}: {field} is missing, so the block has no as-of")
    return value


def series_from(rows, spec, cadence, as_of_field):
    """One series per registered id, from rows discriminated by a label column."""
    allowed = {spec.label_field, spec.value_field, as_of_field} | {
        f for _, f in spec.parts
    }
    points = []
    for row in rows:
        _only_named(row, allowed, spec.id)
        label = row.get(spec.label_field)
        if not isinstance(label, str) or not label:
            raise Refused(f"{spec.id}: point label must be a string, got {label!r}")
        point = {
            "label": label,
            "value": _whole(row.get(spec.value_field), spec.value_field),
        }
        for key, field in spec.parts:
            point[key] = _whole(row.get(field), field)
        if spec.parts:
            # A stacked series whose parts do not sum to its total draws a bar that disagrees
            # with the number printed above it. Same rule as a breakdown against its universe.
            total = sum(point[key] for key, _ in spec.parts)
            if total != point["value"]:
                raise Refused(
                    f"{spec.id}: {label} parts sum to {total} against a total of {point['value']}"
                )
        points.append(point)

    if not points:
        raise Refused(f"{spec.id}: no points, so the series cannot be produced")
    labels = [p["label"] for p in points]
    if len(set(labels)) != len(labels):
        raise Refused(f"{spec.id}: a year appears twice: {labels}")
    points.sort(key=lambda p: p["label"])
    return {
        "cadence": cadence,
        "asOf": _as_of(rows, {"as_of_field": as_of_field}, spec.id),
        "points": points,
    }


def flows_from(rows, spec, cadence, as_of_field):
    """Inflow and outflow per segment. `all` is required: the widget defaults to it."""
    allowed = {spec.segment_field, spec.in_field, spec.out_field, as_of_field}
    as_of = _as_of(rows, {"as_of_field": as_of_field}, "flows")
    out = {}
    for row in rows:
        _only_named(row, allowed, "flows")
        segment = row.get(spec.segment_field)
        if not isinstance(segment, str) or not segment:
            raise Refused(f"flows: segment must be a string, got {segment!r}")
        if segment in out:
            raise Refused(f"flows: segment {segment!r} appears twice")
        out[segment] = {
            "in": _whole(row.get(spec.in_field), spec.in_field),
            "out": _whole(row.get(spec.out_field), spec.out_field),
            "cadence": cadence,
            "asOf": as_of,
        }
    if "all" not in out:
        raise Refused(
            f"flows: no 'all' segment, which every widget falls back to. Got {sorted(out)}."
        )
    return out


def comparisons_from(rows, specs, cadence, as_of_field):
    """Here against elsewhere. Not counts of people, so no small-cell rule applies."""
    by_id = {}
    for spec in specs:
        allowed = {
            spec.here_field,
            spec.there_field,
            spec.here_label_field,
            spec.there_label_field,
            as_of_field,
        }
        match = [r for r in rows if spec.here_field in r]
        if not match:
            continue
        row = match[0]
        _only_named(row, allowed, spec.id)
        by_id[spec.id] = {
            "here": _number(row.get(spec.here_field), spec.here_field),
            "there": _number(row.get(spec.there_field), spec.there_field),
            "hereLabel": row.get(spec.here_label_field),
            "thereLabel": row.get(spec.there_label_field),
            "cadence": cadence,
            "asOf": _as_of(rows, {"as_of_field": as_of_field}, spec.id),
            "kind": "amount",
        }
    return by_id


def rates_from(rows, specs, cadence, as_of_field):
    by_id = {}
    for spec in specs:
        allowed = {spec.percent_field, spec.denominator_field, as_of_field}
        match = [r for r in rows if spec.percent_field in r]
        if not match:
            continue
        row = match[0]
        _only_named(row, allowed, spec.id)
        percent = _number(row.get(spec.percent_field), spec.percent_field)
        if not 0 <= percent <= 100:
            raise Refused(f"{spec.id}: percent is {percent}, outside 0 to 100")
        by_id[spec.id] = {
            "percent": percent,
            "denominator": _whole(
                row.get(spec.denominator_field), spec.denominator_field
            ),
            "cadence": cadence,
            "asOf": _as_of(rows, {"as_of_field": as_of_field}, spec.id),
        }
    return by_id


def build(cadence, rows_by_look):
    spec = spec_for(cadence)
    as_of_field = spec["as_of_field"]

    payload = {
        "meta": {
            "schemaVersion": 1,
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "cadence": cadence,
            "source": "Coalition HMIS via Looker",
            "disclaimer": (
                "Unaffiliated concept work. Not produced, authorised or endorsed by "
                "United Way of the Plains or the Coalition to End Homelessness."
            ),
        },
    }

    # `.get` rather than `[...]`, because a cadence carries only the block types it has. The
    # annual file has no headline measures and the live file has no breakdowns, and neither
    # should need an empty entry written into the registry to say so.
    as_of = None
    if spec.get("measures"):
        measures, as_of = measures_from(rows_by_look["measures"], spec, cadence)
        payload["measures"] = measures

    if spec.get("breakdowns"):
        payload["breakdowns"] = {
            b.id: breakdown_from(
                rows_by_look[b.id],
                b,
                as_of,
                cadence,
                payload["measures"][b.universe]["value"],
            )
            for b in spec["breakdowns"]
            if b.id in rows_by_look
        }

    for s in spec.get("series", ()):
        if s.id in rows_by_look:
            payload.setdefault("series", {})[s.id] = series_from(
                rows_by_look[s.id], s, cadence, as_of_field
            )

    if spec.get("flows") and "flows" in rows_by_look:
        payload["flows"] = flows_from(
            rows_by_look["flows"], spec["flows"], cadence, as_of_field
        )

    if spec.get("comparisons") and "comparisons" in rows_by_look:
        payload["comparisons"] = comparisons_from(
            rows_by_look["comparisons"], spec["comparisons"], cadence, as_of_field
        )

    if spec.get("rates") and "rates" in rows_by_look:
        payload["rates"] = rates_from(
            rows_by_look["rates"], spec["rates"], cadence, as_of_field
        )

    return check(payload)


def publish(payload, bucket, client=None):
    client = client or boto3.client("s3")
    key = f"v1/data/{payload['meta']['cadence']}.json"
    body = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/json; charset=utf-8",
        CacheControl=CACHE.get(payload["meta"]["cadence"], DEFAULT_CACHE),
    )
    return key


def metric(cadence, failed, detail=""):
    """CloudWatch embedded metric format, emitted as a log line so it needs no SDK call and no
    IAM permission and still fires when the function has no network."""
    envelope = {
        "_aws": {
            "Timestamp": int(datetime.now(timezone.utc).timestamp() * 1000),
            "CloudWatchMetrics": [
                {
                    "Namespace": NAMESPACE,
                    # Both dimension sets. CloudWatch does not roll a dimensioned metric up into
                    # a dimensionless one, so an alarm with no Dimensions needs the empty set or
                    # it watches a metric nothing writes.
                    "Dimensions": [["Cadence"], []],
                    "Metrics": [{"Name": "PublishFailed", "Unit": "Count"}],
                }
            ],
        },
        "Cadence": cadence,
        "PublishFailed": 1 if failed else 0,
    }
    if detail:
        envelope["detail"] = detail
    print(json.dumps(envelope))


# ---------------------------------------------------------------------------- handler


def handler(event, _context=None):
    cadence = (event or {}).get("cadence", "quarterly")
    try:
        # First, before any I/O: an unknown cadence should not reach the secret or the login.
        spec = spec_for(cadence)

        base = os.environ["LOOKER_BASE_URL"]
        bucket = os.environ["BUCKET"]
        secret = json.loads(
            boto3.client("secretsmanager").get_secret_value(
                SecretId=os.environ["LOOKER_SECRET_ARN"]
            )["SecretString"]
        )
        token = looker.login(base, secret["client_id"], secret["client_secret"])

        # One Look per block, named by an environment variable derived from the block's id. A
        # block whose Look ID is unset is left out of the payload rather than published empty.
        rows = {}
        if spec.get("measures"):
            rows["measures"] = looker.run_look(base, token, os.environ[spec["look"]])

        wanted = [b.id for b in spec.get("breakdowns", ())]
        wanted += [s.id for s in spec.get("series", ())]
        if spec.get("flows"):
            wanted.append("flows")
        if spec.get("comparisons"):
            wanted.append("comparisons")
        if spec.get("rates"):
            wanted.append("rates")

        for block in wanted:
            look = os.environ.get(f"{block.upper()}_LOOK_ID")
            if look:
                rows[block] = looker.run_look(base, token, look)

        key = publish(build(cadence, rows), bucket)
    except Exception as error:
        metric(cadence, failed=True, detail=f"{type(error).__name__}: {error}")
        raise

    metric(cadence, failed=False)
    return {"published": key}
