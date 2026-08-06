"""Run the real publisher against the local Looker stub, with S3 and Secrets Manager faked.

This is the end-to-end loop with no AWS account and no Looker instance: real HTTP to the stub,
the real `looker.py`, the real mapping, the real `check`, and the payload written where the
browser can read it.

Nothing in `publisher/` is modified or reimplemented. The two boto3 call sites are the entire
AWS surface, so they are the only things replaced — anything else would mean this rehearses a
publisher that is not the one that deploys.

    node scripts/looker-stub.mjs &
    python3 scripts/local-publish.py                 # both cadences into dist/v1/data
    python3 scripts/local-publish.py --cadence=live

Exit code is 0 only if every requested cadence published. A scenario that the gate refuses
exits 1 and prints the refusal, which is the point of the hostile scenarios.
"""

import json
import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "publisher"))

OUT = ROOT / "dist"
STUB = os.environ.get("LOOKER_STUB", "http://localhost:8200")


class FakeSecrets:
    def get_secret_value(self, SecretId):
        return {
            "SecretString": json.dumps({"client_id": "local", "client_secret": "local"})
        }


class FakeS3:
    """Writes where the object would land, so the same tree can be served to the browser."""

    def put_object(self, Bucket, Key, Body, **kwargs):
        path = OUT / Key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(Body)
        print(
            f"  wrote {path.relative_to(ROOT)}  ({len(Body)} bytes, {kwargs.get('CacheControl')})"
        )
        return {}


def fake_client(name, *args, **kwargs):
    if name == "secretsmanager":
        return FakeSecrets()
    if name == "s3":
        return FakeS3()
    raise AssertionError(f"the publisher reached for an unexpected AWS client: {name}")


def main():
    cadences = [a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--cadence=")]
    if not cadences:
        # From the registry, not a copy of it. This list was hardcoded and went stale the
        # moment a cadence was added — the same drift that left annual.json unpublished on the
        # deployed stack while the deploy reported success.
        import contract

        cadences = list(contract.CADENCES)

    os.environ.update(
        {
            "LOOKER_BASE_URL": STUB,
            "BUCKET": "local",
            "LOOKER_SECRET_ARN": "local",
            "QUARTERLY_LOOK_ID": "1001",
            "RACEETHNICITY_LOOK_ID": "1002",
            "SHELTERSTATUS_LOOK_ID": "1003",
            "COUNTY_LOOK_ID": "1004",
            "LIVE_LOOK_ID": "2001",
            "WEEKLY_LOOK_ID": "2002",
            "WAITBANDS_LOOK_ID": "2003",
            "ANNUAL_LOOK_ID": "3000",
            "PITCOUNT_LOOK_ID": "3001",
            "NEWLYHOMELESS_LOOK_ID": "3002",
            "FLOWS_LOOK_ID": "3003",
            "COMPARISONS_LOOK_ID": "3004",
            "RATES_LOOK_ID": "3005",
        }
    )

    # boto3 need not be installed to run this. It exists in the Lambda runtime, and the only
    # thing the publisher asks of it is `client`, so a module with that one attribute is a
    # complete substitute here. Installing the real SDK to then replace its single entry point
    # would be ceremony.
    try:
        import boto3
    except ModuleNotFoundError:
        import types

        boto3 = types.ModuleType("boto3")
        sys.modules["boto3"] = boto3
    boto3.client = fake_client

    import app
    import looker

    failures = 0
    for cadence in cadences:
        # The publisher caches its token across warm invocations, which is correct in Lambda and
        # wrong in a loop that may be pointed at a restarted stub.
        looker._token = None
        print(f"\n{cadence}:")
        try:
            print(f"  {app.handler({'cadence': cadence})}")
        except Exception as error:  # noqa: BLE001 - reporting, not handling
            failures += 1
            print(f"  REFUSED  {type(error).__name__}: {error}")

    print()
    if failures:
        print(f"{failures} of {len(cadences)} refused. Nothing was written for those.")
        return 1
    print(f"all {len(cadences)} published into {OUT.relative_to(ROOT)}/v1/data")
    return 0


if __name__ == "__main__":
    sys.exit(main())
