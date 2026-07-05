import { describe, it, expect } from 'vitest';
import { clampPercentage, formatCurrency, formatMonthLabel, createId } from '../src/format.js';

describe('clampPercentage', () => {
  it('clamps values into the 0-100 range', () => {
    expect(clampPercentage(-10)).toBe(0);
    expect(clampPercentage(150)).toBe(100);
    expect(clampPercentage(42)).toBe(42);
  });

  it('treats non-finite input as 0', () => {
    expect(clampPercentage(NaN)).toBe(0);
    expect(clampPercentage(undefined)).toBe(0);
  });
});

describe('formatCurrency', () => {
  it('formats a positive GBP amount', () => {
    expect(formatCurrency(1234.5, 'GBP')).toBe('£1,234.50');
  });

  it('formats a negative amount with a leading minus sign', () => {
    expect(formatCurrency(-42, 'GBP')).toBe('-£42.00');
  });

  it('falls back to GBP for an unknown currency code', () => {
    expect(() => formatCurrency(10, 'NOTACODE')).not.toThrow();
  });

  it('treats non-finite amounts as zero', () => {
    expect(formatCurrency(NaN, 'GBP')).toBe('£0.00');
  });
});

describe('formatMonthLabel', () => {
  it('renders a YYYY-MM key as a short month/year label', () => {
    expect(formatMonthLabel('2026-03')).toMatch(/Mar.*2026/);
  });

  it('returns "Unknown" for an empty value', () => {
    expect(formatMonthLabel('')).toBe('Unknown');
  });
});

describe('createId', () => {
  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createId()));
    expect(ids.size).toBe(50);
  });
});
