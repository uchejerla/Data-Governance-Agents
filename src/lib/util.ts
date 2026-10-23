import type { Classification, Severity } from '../types';

export const DAY_MS = 86_400_000;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'as',
  'is', 'are', 'be', 'been', 'that', 'this', 'it', 'its', 'we', 'our', 'you', 'your', 'data', 'all',
  'any', 'may', 'must', 'each', 'which', 'when', 'where', 'who', 'how', 'what', 'if', 'not', 'no',
]);

export function parseIso(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function daysSince(value?: string): number | null {
  const d = parseIso(value);
  if (!d) return null;
  return Math.round((startOfToday().getTime() - d.getTime()) / DAY_MS);
}

export function isoDate(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function addDays(days: number, from: Date = startOfToday()): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

export function addBusinessDays(days: number, from: Date = startOfToday()): Date {
  const d = new Date(from.getTime());
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return d;
}

export function formatDate(value?: string | Date): string {
  const d = value instanceof Date ? value : parseIso(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function relativeDays(value?: string): string {
  const days = daysSince(value);
  if (days === null) return 'never';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days > 1) return `${days} days ago`;
  return `in ${Math.abs(days)} days`;
}

export function classificationRank(c?: Classification): number {
  switch (c) {
    case 'Restricted':
      return 3;
    case 'Confidential':
      return 2;
    case 'Internal':
      return 1;
    case 'Public':
      return 0;
    default:
      return 2; // Unclassified data is treated as Confidential (POL-CLS-01 §5.1).
  }
}

export function severityRank(s: Severity): number {
  switch (s) {
    case 'Critical':
      return 4;
    case 'High':
      return 3;
    case 'Medium':
      return 2;
    default:
      return 1;
  }
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .map(stem)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

export function normalizePhrase(text: string): string {
  return tokenize(text).sort().join(' ');
}

export function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const item of setA) if (setB.has(item)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

export function percent(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function prettyList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
