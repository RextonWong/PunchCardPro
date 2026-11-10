import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings, fromSettingsRow, toSettingsRow } from '../src/userSettings.js';

test('new accounts keep the existing workbook defaults', () => {
  assert.deepEqual(fromSettingsRow(null), defaultSettings);
});

test('all editable settings round-trip through the database row shape', () => {
  const settings = {
    displayName: 'Rexton',
    companyName: 'Test Company',
    exportLayout: 'combined',
    includeEmptyDays: false,
    includeSummary: true,
    defaultSiteId: 'site-1',
  };
  const row = toSettingsRow(settings, 'user-1');
  assert.equal(row.user_id, 'user-1');
  assert.equal(row.company_name, 'Test Company');
  assert.deepEqual(fromSettingsRow(row), settings);
});
