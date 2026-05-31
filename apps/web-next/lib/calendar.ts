// Calendar helpers ported from apps/web/src/Chat.tsx.
// - buildGoogleCalendarUrl: builds a calendar.google.com TEMPLATE link.
// - downloadIcs: triggers a browser download of an .ics file.

/** Format a Date as the basic UTC stamp Google Calendar expects: YYYYMMDDTHHMMSSZ. */
function toGCalStamp(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/**
 * Build a Google Calendar "add event" URL.
 * Opens the prefilled event-creation screen in a new tab.
 */
export function buildGoogleCalendarUrl(
  summary: string,
  start: string | Date,
  end: string | Date,
  location?: string,
  details?: string,
): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: summary,
    dates: `${toGCalStamp(start)}/${toGCalStamp(end)}`,
  });
  if (location) params.set("location", location);
  if (details) params.set("details", details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Download an .ics file produced by the calendar API.
 * Creates a Blob, clicks a temporary anchor, then revokes the object URL.
 */
export function downloadIcs(icsContent: string, summary: string): void {
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${summary.replace(/[^\p{L}\p{N}\s-]/gu, "").trim() || "interview"}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
