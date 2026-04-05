import { describe, it, expect } from 'vitest';
import { isValidTransition, getValidTransitions } from '../status-machine.js';

describe('Status Machine', () => {
  it('allows reported → under_review', () => {
    expect(isValidTransition('reported', 'under_review')).toBe(true);
  });

  it('allows reported → rejected', () => {
    expect(isValidTransition('reported', 'rejected')).toBe(true);
  });

  it('rejects reported → approved (must go through under_review)', () => {
    expect(isValidTransition('reported', 'approved')).toBe(false);
  });

  it('allows under_review → approved', () => {
    expect(isValidTransition('under_review', 'approved')).toBe(true);
  });

  it('allows under_review → forwarded_to_ldc', () => {
    expect(isValidTransition('under_review', 'forwarded_to_ldc')).toBe(true);
  });

  it('allows under_review → rejected', () => {
    expect(isValidTransition('under_review', 'rejected')).toBe(true);
  });

  it('allows approved → in_progress', () => {
    expect(isValidTransition('approved', 'in_progress')).toBe(true);
  });

  it('allows approved → forwarded_to_ldc', () => {
    expect(isValidTransition('approved', 'forwarded_to_ldc')).toBe(true);
  });

  it('allows forwarded_to_ldc → in_progress', () => {
    expect(isValidTransition('forwarded_to_ldc', 'in_progress')).toBe(true);
  });

  it('allows forwarded_to_ldc → resolved', () => {
    expect(isValidTransition('forwarded_to_ldc', 'resolved')).toBe(true);
  });

  it('allows in_progress → resolved', () => {
    expect(isValidTransition('in_progress', 'resolved')).toBe(true);
  });

  it('allows resolved → closed', () => {
    expect(isValidTransition('resolved', 'closed')).toBe(true);
  });

  it('allows resolved → in_progress (reopen)', () => {
    expect(isValidTransition('resolved', 'in_progress')).toBe(true);
  });

  it('rejects closed → anything (terminal)', () => {
    expect(isValidTransition('closed', 'reported')).toBe(false);
    expect(isValidTransition('closed', 'in_progress')).toBe(false);
  });

  it('rejects rejected → anything (terminal)', () => {
    expect(isValidTransition('rejected', 'reported')).toBe(false);
    expect(isValidTransition('rejected', 'under_review')).toBe(false);
  });

  it('returns valid transitions for a status', () => {
    expect(getValidTransitions('reported')).toEqual(['under_review', 'rejected']);
    expect(getValidTransitions('closed')).toEqual([]);
  });
});
