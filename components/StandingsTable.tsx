import type { CSSProperties } from "react";
import type { DriverStanding } from "@/lib/f1";
import { flag, initials } from "@/lib/format";
import { teamColour, teamName } from "@/lib/teams";

export default function StandingsTable({
  standings,
  limit = 10,
}: {
  standings: DriverStanding[];
  limit?: number;
}) {
  const rows = standings.slice(0, limit);
  const maxPoints = Math.max(1, ...standings.map((entry) => entry.points));

  return (
    <div className="table-wrap">
      <table className="data-table standings-table">
        <thead>
          <tr>
            <th className="col-pos">Pos</th>
            <th>Driver</th>
            <th className="col-team">Team</th>
            <th className="num col-wins">Wins</th>
            <th className="num">Pts</th>
            <th className="col-bar" aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => {
            const colour = teamColour(entry.constructor.constructorId);
            return (
              <tr
                key={entry.driver.driverId}
                style={{ "--team": colour } as CSSProperties}
                className={entry.position === 1 ? "is-leader" : undefined}
              >
                <td className="col-pos mono">
                  <span className="pos-chip">{String(entry.position).padStart(2, "0")}</span>
                </td>
                <td>
                  <div className="driver-cell">
                    <span className="driver-avatar mono">
                      {entry.driver.code ?? initials(entry.driver.givenName, entry.driver.familyName)}
                    </span>
                    <span className="driver-name">
                      <strong>
                        {entry.driver.givenName} {entry.driver.familyName}
                      </strong>
                      <span className="driver-nationality mono">
                        {flag(entry.driver.nationality)} {entry.driver.nationality}
                      </span>
                    </span>
                  </div>
                </td>
                <td className="team-cell">{teamName(entry.constructor.constructorId, entry.constructor.name)}</td>
                <td className="num mono">{entry.wins}</td>
                <td className="num mono pts">{entry.points}</td>
                <td className="col-bar">
                  <span
                    className="points-bar"
                    style={{ width: `${Math.max(4, (entry.points / maxPoints) * 100)}%` }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
