function toDate(value: string | number | Date): Date {
  if (value instanceof Date) return value;
  return new Date(value);
}

function getBrowserLocale(): string | undefined {
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }
  return undefined;
}

export function formatDate(date: string | number | Date, locale?: string): string {
  const d = toDate(date);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale ?? getBrowserLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function formatDateTime(date: string | number | Date, locale?: string): string {
  const d = toDate(date);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale ?? getBrowserLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function formatRelative(
  date: string | number | Date,
  now: string | number | Date = new Date(),
  locale?: string,
): string {
  const d = toDate(date);
  const n = toDate(now);
  if (Number.isNaN(d.getTime()) || Number.isNaN(n.getTime())) return "";

  const diffSec = Math.round((d.getTime() - n.getTime()) / 1000);
  const absSec = Math.abs(diffSec);

  const loc = locale ?? getBrowserLocale();
  const rtf = new Intl.RelativeTimeFormat(loc, { numeric: "auto" });

  if (absSec < 45) {
    return rtf.format(diffSec, "second");
  }
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 45) {
    return rtf.format(diffMin, "minute");
  }
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 22) {
    return rtf.format(diffHour, "hour");
  }
  const diffDay = Math.round(diffHour / 24);
  if (Math.abs(diffDay) < 26) {
    return rtf.format(diffDay, "day");
  }
  const diffMonth = Math.round(diffDay / 30);
  if (Math.abs(diffMonth) < 11) {
    return rtf.format(diffMonth, "month");
  }
  const diffYear = Math.round(diffDay / 365);
  return rtf.format(diffYear, "year");
}
