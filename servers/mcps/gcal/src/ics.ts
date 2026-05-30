/**
 * 표준 iCalendar(.ics) 문자열 생성 유틸리티.
 * 의존성 없이 순수 문자열 조작으로 VEVENT를 만든다.
 */

/** ISO 8601 문자열을 iCal DATE-TIME(UTC) 형식으로 변환. */
function toIcalDatetime(iso: string): string {
  // "2024-06-01T10:00:00+09:00" → Date 객체 → UTC "20240601T010000Z"
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

/** iCal 텍스트 값 이스케이프 (RFC 5545 §3.3.11). */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export interface IcsEventOptions {
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  reminderMinutes?: number;
}

export function buildIcsContent(opts: IcsEventOptions): string {
  const uid = `jobpilot-${Date.now()}-${Math.random().toString(36).slice(2)}@gcal-mcp`;
  const dtstart = toIcalDatetime(opts.start);
  const dtend = toIcalDatetime(opts.end);
  const dtstamp = toIcalDatetime(new Date().toISOString());

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//JobPilot//GCal MCP//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapeText(opts.summary)}`,
  ];

  if (opts.location) {
    lines.push(`LOCATION:${escapeText(opts.location)}`);
  }
  if (opts.description) {
    lines.push(`DESCRIPTION:${escapeText(opts.description)}`);
  }

  if (opts.reminderMinutes !== undefined && opts.reminderMinutes >= 0) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(opts.summary)}`,
      `TRIGGER:-PT${opts.reminderMinutes}M`,
      'END:VALARM',
    );
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.join('\r\n');
}
