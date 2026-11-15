import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/tokens.css', 'utf8');

function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`нет токена --${name}`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// WCAG AA для обычного текста
const AA = 4.5;

describe('контраст текста', () => {
  it.each([
    ['ink', 'bg'],
    ['ink', 'soft'],
    ['muted', 'bg'],
    ['muted', 'softer'],
    ['muted', 'soft'],
    ['accent', 'bg'],
    ['accent', 'soft'],
    ['bad-text', 'bg'],
    ['bad-text', 'soft'],
    ['ok-text', 'bg'],
    ['ok-text', 'soft'],
  ])('%s на %s не ниже 4.5:1', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(AA);
  });
});
