#!/usr/bin/env python3
"""Pull one real qualifying/race lap pair from OpenF1 and write a compact fixture.

Usage: python3 scripts/fetch-telemetry.py <session_key> <out.json>
The site prefers live OpenF1 data; this fixture is the cached fallback.
"""
import json
import sys
import urllib.request

BASE = "https://api.openf1.org/v1"
UA = {"User-Agent": "Mozilla/5.0 (BrewingPaddock/1.0)"}


def get(path):
    req = urllib.request.Request(BASE + path, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def integrate(points):
    """Attach cumulative distance (m) from speed samples."""
    out = []
    dist = 0.0
    prev = None
    for p in points:
        if prev is not None:
            dt = (p["ts"] - prev["ts"]) / 1000.0
            dt = max(0.0, min(dt, 1.0))
            v = ((p["speed"] + prev["speed"]) / 2.0) / 3.6
            dist += v * dt
        p["distance"] = round(dist, 2)
        out.append(p)
        prev = p
    return out


def main():
    session_key = int(sys.argv[1])
    out_path = sys.argv[2]
    session = get(f"/sessions?session_key={session_key}")[0]
    drivers = get(f"/drivers?session_key={session_key}")
    by_number = {d["driver_number"]: d for d in drivers}

    laps = get(f"/laps?session_key={session_key}")
    best = {}
    for lap in laps:
        ld = lap.get("lap_duration")
        if not ld or lap.get("is_pit_out_lap"):
            continue
        n = lap["driver_number"]
        if n not in by_number:
            continue
        if n not in best or ld < best[n]["lap_duration"]:
            best[n] = lap

    ranked = sorted(best.values(), key=lambda l: l["lap_duration"])[:2]
    payload = {
        "session": {
            "sessionKey": session_key,
            "name": session.get("session_name"),
            "year": session.get("year"),
            "circuit": session.get("circuit_short_name"),
            "country": session.get("country_name"),
            "date": session.get("date_start"),
        },
        "drivers": [],
    }

    for lap in ranked:
        n = lap["driver_number"]
        d = by_number[n]
        start = lap["date_start"]
        from datetime import datetime, timedelta

        t0 = datetime.fromisoformat(start.replace("Z", "+00:00"))
        t1 = t0 + timedelta(seconds=float(lap["lap_duration"]) + 5)
        q = (
            f"/car_data?session_key={session_key}&driver_number={n}"
            f"&date%3E={t0.strftime('%Y-%m-%dT%H:%M:%S')}"
            f"&date%3C={t1.strftime('%Y-%m-%dT%H:%M:%S')}"
        )
        rows = get(q)
        pts = []
        for r in rows:
            ts = datetime.fromisoformat(r["date"].replace("Z", "+00:00")).timestamp() * 1000
            pts.append(
                {
                    "ts": ts,
                    "speed": r.get("speed") or 0,
                    "throttle": r.get("throttle") or 0,
                    "brake": r.get("brake") or 0,
                    "gear": r.get("n_gear") or 0,
                    "drs": r.get("drs") or 0,
                }
            )
        if len(pts) < 20:
            continue
        base = pts[0]["ts"]
        for p in pts:
            p["ts"] = p["ts"] - base
        pts = integrate(pts)
        target = 320
        step = max(1, len(pts) // target)
        sample = pts[::step]
        if sample[-1] is not pts[-1]:
            sample.append(pts[-1])

        payload["drivers"].append(
            {
                "number": n,
                "code": d.get("name_acronym"),
                "name": d.get("full_name"),
                "team": d.get("team_name"),
                "colour": "#" + (d.get("team_colour") or "888888"),
                "lapNumber": lap["lap_number"],
                "lapTime": lap["lap_duration"],
                "sectors": [
                    lap.get("duration_sector_1") or 0,
                    lap.get("duration_sector_2") or 0,
                    lap.get("duration_sector_3") or 0,
                ],
                "points": [
                    {
                        "t": round(p["ts"] / 1000, 3),
                        "d": p["distance"],
                        "v": p["speed"],
                        "th": p["throttle"],
                        "br": p["brake"],
                        "g": p["gear"],
                        "drs": p["drs"],
                    }
                    for p in sample
                ],
            }
        )

    with open(out_path, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    print("wrote", out_path, "drivers:", [(d["code"], d["lapTime"], len(d["points"])) for d in payload["drivers"]])


if __name__ == "__main__":
    main()
