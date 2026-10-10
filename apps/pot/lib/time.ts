/** Deadline wording, in the plainest form that is still accurate. */

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function secondsLeft(deadline: bigint): number {
  return Number(deadline) - Math.floor(Date.now() / 1000);
}

export function isPast(deadline: bigint): boolean {
  return secondsLeft(deadline) <= 0;
}

/** "4 days left", "3 hours left", "12 minutes left", "ended 2 days ago". */
export function deadlineLabel(deadline: bigint): string {
  const left = secondsLeft(deadline);
  if (left <= 0) {
    const ago = -left;
    if (ago < HOUR) return "ended just now";
    if (ago < DAY) return `ended ${Math.floor(ago / HOUR)}h ago`;
    return `ended ${Math.floor(ago / DAY)}d ago`;
  }
  if (left < MIN) return "less than a minute left";
  if (left < HOUR) return `${Math.floor(left / MIN)} minutes left`;
  if (left < DAY) return `${Math.floor(left / HOUR)} hours left`;
  const days = Math.floor(left / DAY);
  return days === 1 ? "1 day left" : `${days} days left`;
}

/** "Sat 12 Oct, 6:00 pm" — the exact moment, for when the vague one isn't enough. */
export function deadlineExact(deadline: bigint): string {
  return new Date(Number(deadline) * 1000).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Turns a datetime-local input value into unix seconds. */
export function localInputToUnix(value: string): bigint {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) throw new Error("Pick a date and time.");
  return BigInt(Math.floor(ms / 1000));
}

/** A datetime-local input value, n days from now, rounded to the hour. */
export function defaultDeadlineInput(daysAhead = 7): string {
  const d = new Date(Date.now() + daysAhead * DAY * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
