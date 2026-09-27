/**
 * Report date handling.
 *
 * Convention (matches existing inventory/dashboard code):
 * - Calendar day boundaries use UTC.
 * - dateFrom is inclusive (00:00:00.000 UTC of that day).
 * - dateTo is inclusive (23:59:59.999 UTC of that day).
 * - Period presets (TODAY / 7D / 30D) also use UTC day starts.
 */

export type ReportPeriodPreset = 'ALL' | 'TODAY' | '7D' | '30D' | 'CUSTOM';

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

export function parseInclusiveDateRange(input: {
  period?: ReportPeriodPreset | string;
  dateFrom?: string;
  dateTo?: string;
  from?: string;
  to?: string;
}): DateRange {
  const fromRaw = input.dateFrom ?? input.from;
  const toRaw = input.dateTo ?? input.to;
  const period = (input.period ?? (fromRaw || toRaw ? 'CUSTOM' : '30D')).toUpperCase();

  const end = toRaw ? endOfUtcDay(new Date(toRaw)) : endOfUtcDay(new Date());
  let start: Date;

  if (fromRaw) {
    start = startOfUtcDay(new Date(fromRaw));
  } else if (period === 'ALL') {
    // Far-past lower bound so "all" reports are not clipped by the default 30D window.
    start = startOfUtcDay(new Date('1970-01-01T00:00:00.000Z'));
  } else {
    start = startOfUtcDay(new Date());
    switch (period) {
      case 'TODAY':
      case 'CURRENT':
        break;
      case '7D':
      case 'THIS_WEEK':
        start.setUTCDate(start.getUTCDate() - 6);
        break;
      case '30D':
      case 'THIS_MONTH':
        start.setUTCDate(start.getUTCDate() - 29);
        break;
      case 'LAST_90_DAYS':
        start.setUTCDate(start.getUTCDate() - 89);
        break;
      default:
        start.setUTCDate(start.getUTCDate() - 29);
    }
  }

  return {
    start,
    end,
    label:
      period === 'ALL' && !fromRaw && !toRaw
        ? 'all'
        : `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`,
  };
}

export function startOfUtcDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function endOfUtcDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

export function todayUtc(): Date {
  return startOfUtcDay(new Date());
}

export function daysUntilExpiry(expiryDate: Date, today = todayUtc()): number {
  const expiry = startOfUtcDay(new Date(expiryDate));
  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
}
