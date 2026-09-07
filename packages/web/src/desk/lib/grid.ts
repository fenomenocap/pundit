/** Dixon–Coles grid. 1X2 on the desk still comes from the live API.
 *  Totals use a mild-inflation λ split so Over 2.5 can actually move. */

const SCALE = 400;
const BASE = 1.35;
const CAP = 5;
const RHO = -0.1;
const MAX = 10;
/** Blend: 0 = frozen 2.70 total (production). 1 = old geometric blow-up. 0.3 matches the Phase-1 "mild" column. */
const INFLATE = 0.3;

export function mildLambdas(homeElo: number, awayElo: number, hfa = 42): [number, number] {
  const d = homeElo + hfa - awayElo;
  const r = 10 ** (d / SCALE);
  const f = 10 ** (d / (SCALE * 2));
  const geometricTotal = BASE * (f + 1 / f);
  const total = Math.min(2 * BASE + INFLATE * (geometricTotal - 2 * BASE), 2 * CAP);
  return [
    Math.min((total * r) / (1 + r), CAP),
    Math.min(total / (1 + r), CAP),
  ];
}

function poissonPmf(lambda: number) {
  const p = new Array<number>(MAX + 1);
  p[0] = Math.exp(-lambda);
  for (let k = 1; k <= MAX; k++) p[k] = (p[k - 1] * lambda) / k;
  return p;
}

function tau(h: number, a: number, lh: number, la: number) {
  if (h === 0 && a === 0) return 1 - lh * la * RHO;
  if (h === 0 && a === 1) return 1 + lh * RHO;
  if (h === 1 && a === 0) return 1 + la * RHO;
  if (h === 1 && a === 1) return 1 - RHO;
  return 1;
}

export function over25(lh: number, la: number) {
  const home = poissonPmf(lh);
  const away = poissonPmf(la);
  let over = 0;
  let mass = 0;
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const v = home[i] * away[j] * tau(i, j, lh, la);
      mass += v;
      if (i + j > 2) over += v;
    }
  }
  return over / mass;
}
