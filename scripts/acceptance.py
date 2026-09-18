#!/usr/bin/env python3
"""Does this Looker API key do only what it was issued to do?

Run by the HMIS administrator, on her own screen, before the key goes anywhere. Standard library
only, so it runs in AWS CloudShell or anywhere with Python 3:

    curl -sO https://raw.githubusercontent.com/HatmanStack/coalition-widgets/main/scripts/acceptance.py
    python3 acceptance.py --host https://example.cloud.looker.com --look 123

It asks for the client ID and secret without echoing them (or reads LOOKER_CLIENT_ID and
LOOKER_CLIENT_SECRET). Three things must hold:

  run_look     the Look in the public folder runs.                          200 with rows
  own query    a query the key builds itself, from that Look's own fields,
               is refused. Needs explore, which the key must not have.     403
  SQL Runner   the key cannot create a SQL Runner query. Never run.         403

The probe asks for the Look's own aggregate fields, so even a key that should have been refused
gets nothing it could not already see. `--client-field` asks for a named field instead.

It also reports, without deciding, where the account differs from the spec Bitfocus was given:
groups inherited, API keys held, and Looks visible outside the tested Look's folder.

Nothing printed is data: status codes, row counts and counts of things. Never a field value,
never a response body, never the key.

A refusal that is not a 403 — a 404, a 422, an error object in a 200 — says nothing about
permissions, so it is INCONCLUSIVE, not PASS. A malformed query is also refused.

With `--secret <arn>`, a PASS writes the key straight into that Secrets Manager secret, in the
shape the publisher reads. It is typed once and never displayed or sent anywhere else.

Exit: 0 PASS, 1 FAIL, 2 INCONCLUSIVE, 3 could not run.
"""

import argparse
import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter

PASS, FAIL, INCONCLUSIVE, BROKEN = 0, 1, 2, 3
LOOPBACK = {"localhost", "127.0.0.1", "::1"}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect. urllib carries the Authorization header to wherever it is sent,
    and the Looker API has no reason to send it anywhere."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


class Unreachable(Exception):
    pass


def base_url(host):
    """https only, except a loopback address, which is where the mock runs for rehearsal."""
    if "://" not in host:
        host = "https://" + host
    parts = urllib.parse.urlsplit(host)
    if parts.scheme != "https" and not (
        parts.scheme == "http" and parts.hostname in LOOPBACK
    ):
        print(f"refusing {parts.scheme}://: the key would cross the network in clear")
        raise SystemExit(BROKEN)
    path = parts.path.rstrip("/")
    path = path.removesuffix("/api/4.0")
    return f"{parts.scheme}://{parts.netloc}{path}"


def call(base, method, path, token=None, json_body=None, form=None, query=None):
    """(status, parsed body or None). The body is returned to be inspected, never printed."""
    url = f"{base}/api/4.0{path}"
    if query:
        url += "?" + urllib.parse.urlencode(query)
    headers = {"Accept": "application/json"}
    data = None
    if token:
        headers["Authorization"] = f"token {token}"
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif json_body is not None:
        data = json.dumps(json_body).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with _opener.open(request, timeout=30) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    except urllib.error.URLError as e:
        raise Unreachable(str(e.reason)) from None
    try:
        return status, json.loads(raw) if raw else None
    except ValueError:
        return status, None


def rows(n):
    return f"{n} row" if n == 1 else f"{n} rows"


def refusal(status, body):
    """Classify the answer to something the key must not be able to do."""
    if status == 403:
        return PASS, "403 refused"
    if status == 200 and isinstance(body, list):
        return FAIL, f"200, ran and returned {rows(len(body))}"
    if status == 200 and isinstance(body, dict) and body.get("slug"):
        return FAIL, "200, created (not run)"
    if status == 200:
        return INCONCLUSIVE, "200 with an error object, not a refusal"
    if 300 <= status < 400:
        return INCONCLUSIVE, f"{status} redirect, not followed"
    return INCONCLUSIVE, f"{status}, not the 403 a missing permission gives"


def main():
    parser = argparse.ArgumentParser(
        description="Check a Looker API key is scoped before it is stored."
    )
    parser.add_argument(
        "--host", required=True, help="https://your-instance.cloud.looker.com"
    )
    parser.add_argument(
        "--look", required=True, help="ID of a Look in the public folder"
    )
    parser.add_argument(
        "--client-field",
        help="probe with this field (e.g. client.first_name) instead of the Look's own",
    )
    parser.add_argument(
        "--secret", help="Secrets Manager ARN to store the key in on PASS"
    )
    args = parser.parse_args()

    base = base_url(args.host)
    client_id = os.environ.get("LOOKER_CLIENT_ID") or getpass.getpass("Client ID: ")
    client_secret = os.environ.get("LOOKER_CLIENT_SECRET") or getpass.getpass(
        "Client secret: "
    )

    print(f"\nLooker acceptance test   {base}   Look {args.look}\n")

    try:
        status, body = call(
            base,
            "POST",
            "/login",
            form={"client_id": client_id, "client_secret": client_secret},
        )
    except Unreachable as e:
        print(f"  could not reach {base}: {e}")
        return BROKEN
    if status != 200 or not isinstance(body, dict) or not body.get("access_token"):
        print(f"  login     {status}. Check the client ID and secret, and the host.")
        return BROKEN
    token = body["access_token"]

    try:
        return run(base, token, args, client_id, client_secret)
    except Unreachable as e:
        print(f"\n  lost {base} mid-test: {e}")
        return BROKEN
    finally:
        try:
            call(base, "DELETE", "/logout", token)
        except Unreachable:
            pass


def run(base, token, args, client_id, client_secret):
    results = []  # (label, outcome, detail)

    def line(label, outcome, detail):
        mark = {PASS: "ok  ", FAIL: "FAIL", INCONCLUSIVE: "??  "}[outcome]
        print(f"  {mark}  {label:<12}  {detail}")
        results.append((label, outcome, detail))

    # The Look's own model, explore and fields: what the probe is built from, and its folder.
    status, look = call(
        base,
        "GET",
        f"/looks/{args.look}",
        token,
        query={"fields": "id,folder_id,query"},
    )
    query = look.get("query") if status == 200 and isinstance(look, dict) else None
    folder = look.get("folder_id") if status == 200 and isinstance(look, dict) else None

    status, body = call(
        base,
        "GET",
        f"/looks/{args.look}/run/json",
        token,
        query={"apply_formatting": "false", "limit": "500"},
    )
    if status == 200 and isinstance(body, list):
        line("run_look", PASS, f"200, {rows(len(body))}")
    elif status == 200:
        line("run_look", INCONCLUSIVE, "200 with an error object: the Look did not run")
    else:
        line("run_look", INCONCLUSIVE, f"{status}: the key cannot run Look {args.look}")

    if (
        not query
        or not query.get("model")
        or not query.get("view")
        or not query.get("fields")
    ):
        line(
            "own query",
            INCONCLUSIVE,
            "could not read the Look's query to build the probe",
        )
        line("SQL Runner", INCONCLUSIVE, "no model to probe with")
    else:
        fields = [args.client_field] if args.client_field else query["fields"]
        probe = {
            "model": query["model"],
            "view": query["view"],
            "fields": fields,
            "limit": "1",
        }
        line(
            "own query",
            *refusal(*call(base, "POST", "/queries/run/json", token, probe)),
        )
        sql = {"model_name": query["model"], "sql": "SELECT 1"}
        line("SQL Runner", *refusal(*call(base, "POST", "/sql_queries", token, sql)))

    # Where the account differs from the spec. Reported, not judged: the probes above are what
    # decide, and these are the lines to send Bitfocus if they are not what was asked for.
    notes = []
    status, user = call(
        base, "GET", "/user", token, query={"fields": "id,group_ids,credentials_api3"}
    )
    if status == 200 and isinstance(user, dict):
        groups = user.get("group_ids") or []
        keys = [
            k for k in user.get("credentials_api3") or [] if not k.get("is_disabled")
        ]
        if groups:
            notes.append(
                f"the API user is in {len(groups)} group(s); the spec said none"
            )
        if len(keys) > 1:
            notes.append(
                f"the API user holds {len(keys)} active API keys; the spec said one"
            )
    else:
        notes.append(f"could not read the API user ({status})")

    status, looks = call(base, "GET", "/looks", token, query={"fields": "id,folder_id"})
    if status == 200 and isinstance(looks, list):
        by_folder = Counter(str(x.get("folder_id")) for x in looks)
        if folder is None:
            notes.append(
                f"{len(looks)} Looks visible across {len(by_folder)} folder(s)"
            )
        else:
            elsewhere = {f: n for f, n in by_folder.items() if f != str(folder)}
            if elsewhere:
                where = ", ".join(
                    f"folder {f}: {n}" for f, n in sorted(elsewhere.items())
                )
                notes.append(f"Looks visible outside folder {folder} ({where})")
    else:
        notes.append(f"could not list visible Looks ({status})")

    for note in notes:
        print(f"  note  {note}")

    outcomes = {o for _, o, _ in results}
    print()
    if FAIL in outcomes:
        ran = [label for label, o, _ in results if o == FAIL]
        print("FAIL  Do not store this key. It can do more than it was issued for.")
        print(f"      Ran when it should have been refused: {', '.join(ran)}.")
        print(
            "      For Bitfocus: the role should carry access_data and see_looks only —"
        )
        print("      no explore, no use_sql_runner, no group inheritance.")
        return FAIL
    if INCONCLUSIVE in outcomes:
        print(
            "INCONCLUSIVE  Nothing ran that should not have, but the test did not prove the"
        )
        print(
            "      key is scoped. Do not store it yet. The ?? lines say what came back."
        )
        return INCONCLUSIVE

    print("PASS  The key runs its Look and is refused everything else.")
    if not args.secret:
        return PASS
    if notes:
        answer = input(
            "\nThe notes above differ from the spec. Store the key anyway? [y/N] "
        )
        if answer.strip().lower() != "y":
            print("Not stored.")
            return PASS
    return store(args.secret, client_id, client_secret)


def store(arn, client_id, client_secret):
    try:
        import boto3
    except ImportError:
        print(
            "\nboto3 is not installed here, so the key was not stored. CloudShell has it."
        )
        return BROKEN
    region = arn.split(":")[3] if arn.startswith("arn:") else None
    client = boto3.client("secretsmanager", region_name=region)
    value = json.dumps({"client_id": client_id, "client_secret": client_secret})
    result = client.put_secret_value(SecretId=arn, SecretString=value)
    print(f"\nStored in {result['Name']}. It was not displayed and went nowhere else.")
    return PASS


if __name__ == "__main__":
    sys.exit(main())
