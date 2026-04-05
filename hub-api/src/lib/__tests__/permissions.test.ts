import { describe, it, expect } from 'vitest';
import { PERMISSIONS } from '../permissions.js';

describe('FACILITIES PERMISSIONS', () => {
  it('has facilities view permission', () => {
    expect(PERMISSIONS.FACILITIES_VIEW).toBe('app:facilities.view');
  });
  it('has manage facilities cleaning permission', () => {
    expect(PERMISSIONS.MANAGE_FACILITIES_CLEANING).toBe('manage:facilities.cleaning');
  });
  it('has manage facilities grounds permission', () => {
    expect(PERMISSIONS.MANAGE_FACILITIES_GROUNDS).toBe('manage:facilities.grounds');
  });
  it('has manage facilities maintenance permission', () => {
    expect(PERMISSIONS.MANAGE_FACILITIES_MAINTENANCE).toBe('manage:facilities.maintenance');
  });
  it('has manage facilities preventive permission', () => {
    expect(PERMISSIONS.MANAGE_FACILITIES_PREVENTIVE).toBe('manage:facilities.preventive');
  });
  it('has facilities report permission', () => {
    expect(PERMISSIONS.FACILITIES_REPORT).toBe('facilities:report');
  });
});
