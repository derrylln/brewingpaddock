#!/usr/bin/env python3
"""Snapshot the current F1 season into data/snapshot.json.

The deployed Worker cannot always reach Jolpica (Cloudflare egress IPs get rate
limited), so every server-rendered page falls back to this file. Regenerate with:

    python3 scripts/build-snapshot.py 2026
"""
import json
import sys
import urllib.request
from datetime import datetime, timezone

BASE = "https://api.jolpi.ca/ergast/f1"
UA = {"User-Agent": "BrewingPaddock/1.0 (snapshot)"}


def get(path):
    req = urllib.request.Request(f"{BASE}/{path}", headers=UA)
    with urllib.request.urlopen(req, timeout=45) as res:
        return json.load(res)


def trim_driver(d):
    return {
        "driverId": d["driverId"],
        "code": d.get("code"),
        "givenName": d["givenName"],
        "familyName": d["familyName"],
        "nationality": d.get("nationality", ""),
        "permanentNumber": d.get("permanentNumber"),
    }


def trim_constructor(c):
    return {"constructorId": c["constructorId"], "name": c["name"]}


def trim_result(r):
    out = {
        "number": r.get("number"),
        "position": r["position"],
        "positionText": r.get("positionText", r["position"]),
        "points": r["points"],
        "Driver": trim_driver(r["Driver"]),
        "Constructor": trim_constructor(r["Constructor"]),
        "grid": r.get("grid", "0"),
        "laps": r.get("laps", "0"),
        "status": r.get("status", ""),
    }
    if r.get("Time"):
        out["Time"] = {"time": r["Time"].get("time")}
    if r.get("FastestLap"):
        out["FastestLap"] = {
            "rank": r["FastestLap"].get("rank"),
            "lap": r["FastestLap"].get("lap"),
            "Time": {"time": (r["FastestLap"].get("Time") or {}).get("time")},
        }
    return out


def main():
    season = int(sys.argv[1]) if len(sys.argv) > 1 else datetime.now().year

    standings_raw = get(f"{season}/driverstandings.json?limit=40")
    constructors_raw = get(f"{season}/constructorstandings.json?limit=20")
    schedule_raw = get(f"{season}/races.json?limit=40")

    standings = []
    for row in standings_raw["MRData"]["StandingsTable"]["StandingsLists"][0]["DriverStandings"]:
        standings.append(
            {
                "position": int(row["position"]),
                "points": float(row["points"]),
                "wins": int(row["wins"]),
                "driver": trim_driver(row["Driver"]),
                "constructor": trim_constructor(row["Constructors"][0]),
            }
        )

    constructors = []
    for row in constructors_raw["MRData"]["StandingsTable"]["StandingsLists"][0]["ConstructorStandings"]:
        constructors.append(
            {
                "position": int(row["position"]),
                "points": float(row["points"]),
                "wins": int(row["wins"]),
                "constructor": trim_constructor(row["Constructor"]),
            }
        )

    schedule = []
    for race in schedule_raw["MRData"]["RaceTable"]["Races"]:
        schedule.append(
            {
                "season": race["season"],
                "round": race["round"],
                "raceName": race["raceName"],
                "Circuit": {
                    "circuitId": race["Circuit"]["circuitId"],
                    "circuitName": race["Circuit"]["circuitName"],
                    "Location": race["Circuit"]["Location"],
                },
                "date": race["date"],
                **{k: race[k] for k in ("time", "FirstPractice", "SecondPractice", "ThirdPractice", "Qualifying", "Sprint", "SprintQualifying", "SprintShootout") if k in race},
            }
        )

    # Every classification of the season (Jolpica caps pages at 100 rows).
    rows = []
    offset = 0
    total = None
    while total is None or offset < total:
        page = get(f"{season}/results.json?limit=100&offset={offset}")
        total = int(page["MRData"]["total"])
        for race in page["MRData"]["RaceTable"]["Races"]:
            for result in race["Results"]:
                rows.append((int(race["round"]), race["raceName"], trim_result(result)))
        offset += 100
        if offset > 2000:
            break

    season_results = {}
    for rnd, name, result in rows:
        entry = season_results.setdefault(rnd, {"round": rnd, "raceName": name, "results": []})
        if not any(r["Driver"]["driverId"] == result["Driver"]["driverId"] for r in entry["results"]):
            entry["results"].append(result)
    for entry in season_results.values():
        entry["results"].sort(key=lambda r: int(r["position"]))

    races = {}
    for entry in season_results.values():
        rnd = entry["round"]
        bundle = {}
        try:
            quali = get(f"{season}/{rnd}/qualifying.json?limit=40")
            qlist = quali["MRData"]["RaceTable"]["Races"][0].get("QualifyingResults", [])
            bundle["quali"] = [
                {
                    "position": q["position"],
                    "Driver": trim_driver(q["Driver"]),
                    "Constructor": trim_constructor(q["Constructor"]),
                    **{k: q[k] for k in ("Q1", "Q2", "Q3") if k in q},
                }
                for q in qlist
            ]
        except Exception:
            bundle["quali"] = []
        try:
            pits = get(f"{season}/{rnd}/pitstops.json?limit=200")
            plist = pits["MRData"]["RaceTable"]["Races"][0].get("PitStops", [])
            bundle["pits"] = [
                {"driverId": p["driverId"], "duration": p["duration"], "lap": p["lap"], "stop": p["stop"]}
                for p in plist
            ]
        except Exception:
            bundle["pits"] = []
        races[str(rnd)] = bundle

    snapshot = {
        "season": season,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "standings": standings,
        "constructors": constructors,
        "schedule": schedule,
        "seasonResults": sorted(season_results.values(), key=lambda r: r["round"]),
        "races": races,
    }

    with open("data/snapshot.json", "w") as f:
        json.dump(snapshot, f, separators=(",", ":"))
    size = len(json.dumps(snapshot))
    print(
        f"season {season}: {len(standings)} drivers, {len(constructors)} teams, "
        f"{len(schedule)} races, {sum(len(r['results']) for r in season_results.values())} results, "
        f"{size/1024:.0f} KiB"
    )


if __name__ == "__main__":
    main()
