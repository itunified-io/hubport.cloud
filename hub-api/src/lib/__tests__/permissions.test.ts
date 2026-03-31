import { describe, it, expect } from 'vitest';
import { PERMISSIONS } from '../permissions.js';

describe('PERMISSIONS', () => {
  // Territory Drawing (Spec 1)
  it('has territory drawing permissions', () => {
    expect(PERMISSIONS.TERRITORIES_DELETE).toBe('app:territories.delete');
    expect(PERMISSIONS.TERRITORIES_SPLIT).toBe('app:territories.split');
    expect(PERMISSIONS.TERRITORIES_IMPORT).toBe('app:territories.import');
    expect(PERMISSIONS.TERRITORIES_SHARE).toBe('app:territories.share');
  });

  // Address & OSM (Spec 2)
  it('has address and OSM permissions', () => {
    expect(PERMISSIONS.ADDRESSES_VIEW).toBe('app:addresses.view');
    expect(PERMISSIONS.ADDRESSES_EDIT).toBe('app:addresses.edit');
    expect(PERMISSIONS.ADDRESSES_IMPORT).toBe('app:addresses.import');
    expect(PERMISSIONS.OSM_REFRESH).toBe('app:osm.refresh');
    expect(PERMISSIONS.OSM_EDIT).toBe('app:osm.edit');
    expect(PERMISSIONS.GAP_DETECTION_VIEW).toBe('app:gapDetection.view');
    expect(PERMISSIONS.GAP_DETECTION_RUN).toBe('app:gapDetection.run');
  });

  // Territory Operations (Spec 3)
  it('has territory operations permissions', () => {
    expect(PERMISSIONS.ASSIGNMENTS_VIEW).toBe('app:assignments.view');
    expect(PERMISSIONS.ASSIGNMENTS_MANAGE).toBe('app:assignments.manage');
    expect(PERMISSIONS.CAMPAIGNS_VIEW).toBe('app:campaigns.view');
    expect(PERMISSIONS.CAMPAIGNS_MANAGE).toBe('app:campaigns.manage');
    expect(PERMISSIONS.CAMPAIGNS_CONDUCT).toBe('app:campaigns.conduct');
    expect(PERMISSIONS.CAMPAIGNS_ASSIST).toBe('app:campaigns.assist');
    expect(PERMISSIONS.CAMPAIGNS_REPORT).toBe('app:campaigns.report');
    expect(PERMISSIONS.CAMPAIGNS_LOCATION_SHARE).toBe('app:campaigns.location_share');
    expect(PERMISSIONS.LOCATION_VIEW).toBe('app:location.view');
  });

  // Groups (Spec 4)
  it('has group permissions', () => {
    expect(PERMISSIONS.GROUPS_VIEW).toBe('app:groups.view');
    expect(PERMISSIONS.GROUPS_EDIT).toBe('app:groups.edit');
  });
});
