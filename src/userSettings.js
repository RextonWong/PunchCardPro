export const defaultSettings = {
  displayName: '',
  companyName: 'LAND VISION TRADING',
  exportLayout: 'separate',
  includeEmptyDays: true,
  includeSummary: false,
  defaultSiteId: null,
};

export function fromSettingsRow(row) {
  if (!row) return { ...defaultSettings };
  return {
    displayName: row.display_name ?? defaultSettings.displayName,
    companyName: row.company_name ?? defaultSettings.companyName,
    exportLayout: row.export_layout === 'combined' ? 'combined' : 'separate',
    includeEmptyDays: row.include_empty_days ?? defaultSettings.includeEmptyDays,
    includeSummary: row.include_summary ?? defaultSettings.includeSummary,
    defaultSiteId: row.default_site_id ?? null,
  };
}

export function toSettingsRow(settings, userId) {
  return {
    user_id: userId,
    display_name: settings.displayName.trim(),
    company_name: settings.companyName.trim(),
    export_layout: settings.exportLayout,
    include_empty_days: settings.includeEmptyDays,
    include_summary: settings.includeSummary,
    default_site_id: settings.defaultSiteId || null,
    updated_at: new Date().toISOString(),
  };
}
