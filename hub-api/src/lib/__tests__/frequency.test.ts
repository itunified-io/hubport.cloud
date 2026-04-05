import { describe, it, expect } from 'vitest';
import { calculateNextDue, VALID_FREQUENCIES, isValidFrequency } from '../frequency.js';

describe('Frequency', () => {
  it('validates known frequencies', () => {
    expect(isValidFrequency('1w')).toBe(true);
    expect(isValidFrequency('2w')).toBe(true);
    expect(isValidFrequency('1m')).toBe(true);
    expect(isValidFrequency('3m')).toBe(true);
    expect(isValidFrequency('6m')).toBe(true);
    expect(isValidFrequency('1y')).toBe(true);
  });

  it('rejects unknown frequencies', () => {
    expect(isValidFrequency('4m')).toBe(false);
    expect(isValidFrequency('daily')).toBe(false);
    expect(isValidFrequency('')).toBe(false);
  });

  it('calculates next due for weekly', () => {
    const from = new Date('2026-04-01');
    const next = calculateNextDue(from, '1w');
    expect(next.toISOString()).toBe(new Date('2026-04-08').toISOString());
  });

  it('calculates next due for biweekly', () => {
    const from = new Date('2026-04-01');
    const next = calculateNextDue(from, '2w');
    expect(next.toISOString()).toBe(new Date('2026-04-15').toISOString());
  });

  it('calculates next due for monthly', () => {
    const from = new Date('2026-04-01');
    const next = calculateNextDue(from, '1m');
    expect(next.toISOString()).toBe(new Date('2026-05-01').toISOString());
  });

  it('calculates next due for quarterly', () => {
    const from = new Date('2026-04-01');
    const next = calculateNextDue(from, '3m');
    expect(next.toISOString()).toBe(new Date('2026-07-01').toISOString());
  });

  it('calculates next due for semi-annually', () => {
    const from = new Date('2026-04-01');
    const next = calculateNextDue(from, '6m');
    expect(next.toISOString()).toBe(new Date('2026-10-01').toISOString());
  });

  it('calculates next due for annually', () => {
    const from = new Date('2026-04-01');
    const next = calculateNextDue(from, '1y');
    expect(next.toISOString()).toBe(new Date('2027-04-01').toISOString());
  });
});
