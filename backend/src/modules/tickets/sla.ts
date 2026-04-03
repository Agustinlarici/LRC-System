/**
 * SLA business-hours calculator
 * Business hours: Monday–Friday, 08:00–17:00 Europe/Rome
 */

const TZ = 'Europe/Rome';
const DAY_START_H = 8;
const DAY_END_H   = 17;

function toRome(d: Date): Date {
  // Returns a Date whose local time fields (getHours etc.) represent Rome time
  const str = d.toLocaleString('en-US', { timeZone: TZ });
  return new Date(str);
}

/** Add `businessHours` business hours to `from`, returning the deadline in UTC */
export function addBusinessHours(from: Date, businessHours: number): Date {
  let remaining = businessHours;
  let current = new Date(from);

  while (remaining > 0) {
    const rome = toRome(current);
    const dayOfWeek = rome.getDay();

    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      // Move to Monday 08:00 Rome
      current = nextWorkdayStart(current);
      continue;
    }

    const hRome = rome.getHours() + rome.getMinutes() / 60 + rome.getSeconds() / 3600;

    if (hRome >= DAY_END_H) {
      // Past end of day — jump to next workday start
      current = nextWorkdayStart(current);
      continue;
    }

    // Clamp to start of business if before 08:00
    let effectiveH = Math.max(hRome, DAY_START_H);
    const hoursLeftToday = DAY_END_H - effectiveH;

    if (remaining <= hoursLeftToday) {
      // Deadline falls today
      const targetH = effectiveH + remaining;
      const [y, mo, d] = [rome.getFullYear(), rome.getMonth(), rome.getDate()];
      const deadlineRome = new Date(y, mo, d,
        Math.floor(targetH),
        Math.round((targetH % 1) * 60)
      );
      // Convert from Rome local to UTC
      return romeLocalToUTC(deadlineRome);
    }

    remaining -= hoursLeftToday;
    current = nextWorkdayStart(current);
  }

  return current;
}

/** Calculate elapsed business hours between two UTC timestamps */
export function businessHoursBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let elapsed = 0;
  let current = new Date(start);

  while (current < end) {
    const rome = toRome(current);
    const dayOfWeek = rome.getDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      current = nextWorkdayStart(current);
      continue;
    }

    const hRome = rome.getHours() + rome.getMinutes() / 60 + rome.getSeconds() / 3600;

    if (hRome >= DAY_END_H) {
      current = nextWorkdayStart(current);
      continue;
    }

    const effectiveH = Math.max(hRome, DAY_START_H);
    const hoursLeftToday = DAY_END_H - effectiveH;
    const nextDayStart = nextWorkdayStart(current);

    if (current.getTime() + hoursLeftToday * 3600000 >= end.getTime()) {
      elapsed += (end.getTime() - current.getTime()) / 3600000;
      break;
    }

    elapsed += hoursLeftToday;
    current = nextDayStart;
  }

  return elapsed;
}

function nextWorkdayStart(from: Date): Date {
  // Returns the UTC time corresponding to the next Mon-Fri 08:00 Rome
  const rome = toRome(from);
  let d = new Date(rome.getFullYear(), rome.getMonth(), rome.getDate() + 1, DAY_START_H, 0, 0);

  while (true) {
    const day = d.getDay();
    if (day >= 1 && day <= 5) return romeLocalToUTC(d);
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, DAY_START_H, 0, 0);
  }
}

function romeLocalToUTC(romeLocal: Date): Date {
  // Trick: format a UTC date in Rome tz to find offset, then invert
  const utcGuess = new Date(romeLocal.getTime());
  const romeBack = toRome(utcGuess);
  const diff = romeLocal.getTime() -
    new Date(romeBack.getFullYear(), romeBack.getMonth(), romeBack.getDate(),
      romeBack.getHours(), romeBack.getMinutes(), romeBack.getSeconds()).getTime();
  return new Date(utcGuess.getTime() - diff);
}

/** Returns SLA deadline timestamps for a given priority */
export async function computeSLADeadlines(
  db: any,
  priority: string,
  createdAt: Date
): Promise<{ response_due: Date | null; resolution_due: Date | null }> {
  const [sla] = await db`
    SELECT response_hours, resolution_hours FROM ticket_sla WHERE priority = ${priority}
  `;
  if (!sla) return { response_due: null, resolution_due: null };

  return {
    response_due:    addBusinessHours(createdAt, Number(sla.response_hours)),
    resolution_due:  addBusinessHours(createdAt, Number(sla.resolution_hours)),
  };
}

/** SLA status for display: 'ok' | 'warning' | 'breached' */
export function slaStatus(
  due: Date | null,
  completedAt: Date | null,
  now: Date = new Date()
): 'ok' | 'warning' | 'breached' {
  if (!due) return 'ok';
  const reference = completedAt ?? now;
  if (reference > due) return 'breached';
  const diffMs = due.getTime() - reference.getTime();
  const WARNING_MS = 60 * 60 * 1000; // 1 hour warning
  return diffMs < WARNING_MS ? 'warning' : 'ok';
}
