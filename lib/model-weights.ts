/**
 * The predictor's tunables, in one place.
 *
 * Both scoring paths read them: the live board (`lib/predict.ts`) and the
 * walk-forward replay (`lib/walk-forward.ts`). They were separate constants once,
 * and the live board's qualifying blend drifted from the replay's, so the sanity
 * check stopped testing the model that actually ships.
 */

export const WEIGHTS = { quali: 0.28, form: 0.36, team: 0.14, consistency: 0.12, champ: 0.1 };

/** Recency weights, oldest round first. */
export const W_RECENCY = [0.1, 0.15, 0.2, 0.25, 0.3];

/**
 * Share of the qualifying factor that the freshest session owns.
 *
 * The grid is set hours before the race, in this car, at this track, so it is the
 * strongest single input on the board. Diluting it with a rolling average of past
 * grids made a back-row start barely matter: last place still scored most of a
 * pole lap's factor, and the simulation kept handing that car a podium. The
 * rolling average is the season-long signal, and it still carries the remainder.
 *
 * Replayed over the 2026 rounds that have qualifying archived, 0.85 names the
 * real winner in 6 of 16 races against 4 at the old 0.4 blend, and ranks that
 * winner higher on average (2.44 against 2.88); 0.9 is identical, so the milder
 * setting is used.
 */
export const LATEST_QUALI_WEIGHT = 0.85;
