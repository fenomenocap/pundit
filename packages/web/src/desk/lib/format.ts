export function fmtOdds(n: number) {
  return n >= 10 ? n.toFixed(1) : n.toFixed(2);
}

export function fmtPct(n: number, digits = 0) {
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtEdge(n: number) {
  const v = n * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}pp`;
}

export function fmtMoney(n: number) {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-GB", {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `−${formatted}` : formatted;
}

export function fmtKickoff(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

export function fmtKickoffShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

export function poisson(lambda: number) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

export function accaPrice(prices: number[]) {
  return prices.reduce((a, b) => a * b, 1);
}

export function signedClass(n: number) {
  if (n > 0.005) return "text-up";
  if (n < -0.005) return "text-down";
  return "text-quiet";
}
