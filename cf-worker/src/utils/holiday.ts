/** Returns current time offset to JST (UTC+9), with UTC methods reflecting JST values. */
function jstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function jstDateStr(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function isJpPublicHoliday(dateStr: string): Promise<boolean> {
  try {
    const res = await fetch("https://holidays-jp.github.io/api/v1/date.json");
    if (!res.ok) return false;
    const holidays = (await res.json()) as Record<string, string>;
    return dateStr in holidays;
  } catch {
    return false;
  }
}

/** Returns true if today (JST) is a weekend or Japanese public holiday. */
export async function isHoliday(): Promise<boolean> {
  const now = jstNow();
  const dow = now.getUTCDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) return true;
  return isJpPublicHoliday(jstDateStr(now));
}
