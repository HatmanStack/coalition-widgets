"""Looker to S3. The whole Lambda.

  Looker  ->  rows  ->  payload  ->  checks  ->  S3

Fails closed. If anything refuses, nothing is written and the previous payload keeps serving,
because the widgets read the last good object and a partial write is worse than a stale one.
"""

import json
import os
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


def measures_from(rows, spec, cadence):
    if len(rows) != 1:
        raise Refused(f"a measures Look returns one row, got {len(rows)}")
    row = rows[0]
    as_of = row.get(spec["as_of_field"])
    if not isinstance(as_of, str) or not as_of:
        raise Refused(f"{spec['as_of_field']} is missing; the payload would have no as-of")

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


# ---------------------------------------------------------------------------- checks

def check(payload):
    """Everything that must be true before a figure becomes public.

    Small cells and reconciliation are the two that matter. `docs` in the other repo record why:
    a published dashboard showed nine counties holding exactly one person each, and four
    different denominators presented as one population.
    """
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


def build(cadence, rows_by_look):
    spec = contract.LIVE if cadence == "live" else contract.QUARTERLY
    measures, as_of = measures_from(rows_by_look["measures"], spec, cadence)

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
        "measures": measures,
    }
    if cadence != "live":
        payload["breakdowns"] = {
            b.id: breakdown_from(
                rows_by_look[b.id], b, as_of, cadence, measures[b.universe]["value"]
            )
            for b in contract.BREAKDOWNS
            if b.id in rows_by_look
        }
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
        base = os.environ["LOOKER_BASE_URL"]
        bucket = os.environ["BUCKET"]
        secret = json.loads(
            boto3.client("secretsmanager").get_secret_value(
                SecretId=os.environ["LOOKER_SECRET_ARN"]
            )["SecretString"]
        )
        token = looker.login(base, secret["client_id"], secret["client_secret"])

        spec = contract.LIVE if cadence == "live" else contract.QUARTERLY
        rows = {"measures": looker.run_look(base, token, os.environ[spec["look"]])}
        if cadence != "live":
            for b in contract.BREAKDOWNS:
                look = os.environ.get(f"{b.id.upper()}_LOOK_ID")
                if look:
                    rows[b.id] = looker.run_look(base, token, look)

        key = publish(build(cadence, rows), bucket)
    except Exception as error:
        metric(cadence, failed=True, detail=f"{type(error).__name__}: {error}")
        raise

    metric(cadence, failed=False)
    return {"published": key}
