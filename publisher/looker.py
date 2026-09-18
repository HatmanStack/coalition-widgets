"""Looker API 4.0, standard library only.

`urllib` rather than the SDK so the Lambda has nothing to install: the managed Python runtime
provides `boto3` and this needs nothing else.

Two things about this API that are easy to get wrong and expensive to miss:

- `apply_formatting=false` or counts arrive as `"1,263"` strings rather than numbers.
- **Looker answers errors with HTTP 200 and an error object.** A client that checks the status
  code and hands the body on turns an error into a payload, so the shape is checked here.
"""

import json
import time
import urllib.parse
import urllib.request

# Cached across warm invocations; the login is ~1s. Until it expires, not forever: a warm
# container can outlive the hour a token lasts, and the failure then reads as a 401 from a key
# that was fine a minute ago.
_token = None
_expires = 0.0

_LOOPBACK = {"localhost", "127.0.0.1", "::1"}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect. urllib carries the Authorization header to wherever it is sent,
    so a redirect would hand the token to a host nobody configured. The Looker API has no reason
    to issue one; if it does, the request fails and says so."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_open = urllib.request.build_opener(_NoRedirect).open


def _base(base_url: str) -> str:
    """The instance URL without a trailing slash.

    A Lambda Function URL ends in one, and so does a base URL somebody pastes out of a browser.
    Without this the request goes to `https://host//api/4.0/login`, which some servers route and
    some reject, and the failure reads as a credential problem rather than a typo.
    """
    parts = urllib.parse.urlsplit(base_url)
    # https only. Plain http is allowed to a loopback address, which is where the local stub runs.
    if parts.scheme != "https" and not (
        parts.scheme == "http" and parts.hostname in _LOOPBACK
    ):
        raise LookerError(
            f"LOOKER_BASE_URL must be https (got {parts.scheme or 'no scheme'}://): the key and "
            f"token would otherwise cross the network in clear"
        )
    return base_url.rstrip("/")


def login(base_url: str, client_id: str, client_secret: str) -> str:
    global _token, _expires
    if _token and time.time() < _expires:
        return _token
    base_url = _base(base_url)
    body = urllib.parse.urlencode(
        {"client_id": client_id, "client_secret": client_secret}
    ).encode()
    request = urllib.request.Request(
        f"{base_url}/api/4.0/login", data=body, method="POST"
    )
    with _open(request, timeout=15) as response:
        body = json.loads(response.read())
    _token = body["access_token"]
    # Five minutes early, so a token is never handed to a run that outlasts it.
    _expires = time.time() + int(body.get("expires_in", 3600)) - 300
    return _token


def run_look(base_url: str, token: str, look_id: str, limit: int = 500) -> list[dict]:
    """The rows a Look returns, or a refusal naming what arrived instead."""
    query = urllib.parse.urlencode(
        {"apply_formatting": "false", "cache": "true", "limit": limit}
    )
    request = urllib.request.Request(
        f"{_base(base_url)}/api/4.0/looks/{look_id}/run/json?{query}",
        headers={"Authorization": f"token {token}"},
    )
    with _open(request, timeout=30) as response:
        body = json.loads(response.read())

    if isinstance(body, dict):
        raise LookerError(
            f"look {look_id}: Looker returned an error with HTTP 200: "
            f"{body.get('message', body)!r}"
        )
    if not isinstance(body, list):
        raise LookerError(f"look {look_id}: expected rows, got {type(body).__name__}")
    if len(body) >= limit:
        # The limit doubles as a tripwire. An aggregate Look returning the maximum means it is
        # no longer an aggregate Look, and the likeliest reason is that it was repointed at
        # client level.
        raise LookerError(
            f"look {look_id}: returned {len(body)} rows, at the limit of {limit}. An aggregate "
            f"Look does not do that; check whether it now returns client-level rows."
        )
    return body


class LookerError(Exception):
    """Looker did not return a row set this can use."""
