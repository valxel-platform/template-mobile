#!/usr/bin/env python3
"""Google Play staged rollout: check the release's health, then widen (or halt) it.

The production submit (eas.json) starts the release on the production track at 1% of users
("inProgress"). The Valxel SDLC widens it step by step (valxel-rollout in release.yml): before
each step this checks the crash rate of the version being rolled out against the threshold, from
Play's Android vitals. Vitals arrive once a day, so steps are at least a day apart.

usage: play.py health  --package com.valxel.example [--max-crash-rate 0.01] [--min-users 50]
       play.py rollout --package com.valxel.example --fraction 0.1    (1.0 completes the release)
       play.py halt    --package com.valxel.example

Needs PLAY_SERVICE_ACCOUNT_JSON: a service account with release access to the app in the Play
Console and the Play Developer Reporting API enabled. `pip install -r requirements.txt`.
"""

import argparse
import datetime as dt
import json
import os
import sys

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

PUBLISHER = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
REPORTING = "https://playdeveloperreporting.googleapis.com/v1beta1/apps"
SCOPES = [
    "https://www.googleapis.com/auth/androidpublisher",
    "https://www.googleapis.com/auth/playdeveloperreporting",
]


def session() -> AuthorizedSession:
    info = json.loads(os.environ["PLAY_SERVICE_ACCOUNT_JSON"])
    return AuthorizedSession(service_account.Credentials.from_service_account_info(info, scopes=SCOPES))


def call(s: AuthorizedSession, method: str, url: str, body: dict | None = None) -> dict:
    r = s.request(method, url, json=body, timeout=60)
    if r.status_code >= 400:
        sys.exit(f"{method} {url.split('?')[0]}: {r.status_code} {r.text[:500]}")
    return r.json() if r.content else {}


def crash_rate(s: AuthorizedSession, package: str, version_code: str) -> tuple[float | None, int]:
    """The last complete day's user-perceived crash rate for this version, and its users."""
    # Vitals are daily, in Pacific time; yesterday is the latest complete day.
    day = dt.datetime.now(dt.timezone(dt.timedelta(hours=-8))).date() - dt.timedelta(days=1)
    date = {"year": day.year, "month": day.month, "day": day.day, "timeZone": {"id": "America/Los_Angeles"}}
    nxt = day + dt.timedelta(days=1)
    end = {"year": nxt.year, "month": nxt.month, "day": nxt.day, "timeZone": {"id": "America/Los_Angeles"}}
    body = {
        "timelineSpec": {"aggregationPeriod": "DAILY", "startTime": date, "endTime": end},
        "dimensions": ["versionCode"],
        "metrics": ["userPerceivedCrashRate", "distinctUsers"],
        "filter": f"versionCode = {version_code}",
    }
    rows = call(s, "POST", f"{REPORTING}/{package}/crashRateMetricSet:query", body).get("rows", [])
    for row in rows:
        metrics = {m["metric"]: m.get("decimalValue", {}).get("value") for m in row.get("metrics", [])}
        users = int(float(metrics.get("distinctUsers") or 0))
        rate = metrics.get("userPerceivedCrashRate")
        return (float(rate) if rate is not None else None), users
    return None, 0


def rolling_out(s: AuthorizedSession, package: str) -> list[str]:
    """The version codes of the staged rollout on the production track (read only)."""
    edit = call(s, "POST", f"{PUBLISHER}/{package}/edits")["id"]
    try:
        track = call(s, "GET", f"{PUBLISHER}/{package}/edits/{edit}/tracks/production")
    finally:
        s.request("DELETE", f"{PUBLISHER}/{package}/edits/{edit}", timeout=60)
    for release in track.get("releases", []):
        if release.get("status") in ("inProgress", "halted"):
            return [str(v) for v in release.get("versionCodes", [])]
    sys.exit("no staged rollout in progress on the production track")


def edit_track(s: AuthorizedSession, package: str, change) -> dict:
    edit = call(s, "POST", f"{PUBLISHER}/{package}/edits")["id"]
    track = call(s, "GET", f"{PUBLISHER}/{package}/edits/{edit}/tracks/production")
    releases = track.get("releases", [])
    current = next((r for r in releases if r.get("status") in ("inProgress", "halted")), None)
    if current is None:
        sys.exit("no staged rollout in progress on the production track")
    change(current)
    call(s, "PUT", f"{PUBLISHER}/{package}/edits/{edit}/tracks/production", {"track": "production", "releases": releases})
    call(s, "POST", f"{PUBLISHER}/{package}/edits/{edit}:commit")
    return current


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["health", "rollout", "halt"])
    ap.add_argument("--package", required=True)
    ap.add_argument("--fraction", type=float)
    ap.add_argument("--max-crash-rate", type=float, default=float(os.environ.get("MAX_CRASH_RATE", "0.01")))
    ap.add_argument("--min-users", type=int, default=int(os.environ.get("MIN_USERS", "50")))
    args = ap.parse_args()
    s = session()

    if args.command == "health":
        # The release's newest version code is the one people get.
        version = max(rolling_out(s, args.package), key=int)
        rate, users = crash_rate(s, args.package, version)
        if rate is None or users < args.min_users:
            # Too few people on it yet to judge: hold the rollout where it is (not a failure).
            print(json.dumps({"state": "pending", "description": f"not enough data yet ({users} users)"}))
            return
        healthy = rate <= args.max_crash_rate
        print(
            json.dumps(
                {
                    "state": "success" if healthy else "failure",
                    "description": f"crash-free {100 * (1 - rate):.2f}% of {users} users (floor {100 * (1 - args.max_crash_rate):.2f}%)",
                }
            )
        )
        return

    if args.command == "rollout":
        fraction = args.fraction
        if fraction is None or not 0 < fraction <= 1:
            sys.exit("--fraction must be in (0, 1]")

        def widen(release: dict) -> None:
            if release.get("userFraction") and fraction < release["userFraction"]:
                sys.exit(f"rollout is already at {release['userFraction']}; it only widens")
            if fraction >= 1:
                release["status"] = "completed"
                release.pop("userFraction", None)
            else:
                release["status"] = "inProgress"
                release["userFraction"] = fraction

        release = edit_track(s, args.package, widen)
        print(json.dumps({"versionCodes": release.get("versionCodes"), "status": release["status"], "userFraction": release.get("userFraction")}))
        return

    release = edit_track(s, args.package, lambda r: r.update(status="halted"))
    print(json.dumps({"versionCodes": release.get("versionCodes"), "status": "halted"}))


if __name__ == "__main__":
    main()
