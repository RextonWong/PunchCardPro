import * as XLSX from 'xlsx';

function worksheetName(lorryId, usedNames) {
  const base = String(lorryId).replace(/[:\\/?*[\]]/g, '-').replace(/^'+|'+$/g, '').trim() || 'Lorry';
  let name = base.slice(0, 31);
  let suffix = 1;
  while (usedNames.has(name.toLowerCase())) {
    const ending = ` (${++suffix})`;
    name = base.slice(0, 31 - ending.length) + ending;
  }
  usedNames.add(name.toLowerCase());
  return name;
}

export function buildMonthlyWorkbook(site, month, options = {}) {
  const entries = site.entries.filter((entry) => String(entry.date).startsWith(`${month}-`));
  if (!entries.length) throw new Error('There are no saved entries to export for this month.');
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set();
  const [year, monthNumber] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const companyName = String(options.companyName || 'LAND VISION TRADING').trim();
  const lorryIds = [...new Set(entries.map((entry) => entry.loriId))].sort();
  const sections = lorryIds.map((lorryId) => {
    const lorryEntries = entries.filter((entry) => entry.loriId === lorryId);
    const rows = [
      [companyName], [site.name.toUpperCase()], [month],
      [`LORI ID: ${lorryId}`], [], ['DAY', 'IN', 'OUT', 'REST', 'TOTAL'],
    ];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const entry = lorryEntries.find((item) => String(item.date) === date);
      if (!entry && options.includeEmptyDays !== false) rows.push([day, '-', '-', '0.0', '0.0']);
      else if (entry) {
        const [timeIn, timeOut] = entry.timeRange.split('-');
        rows.push([day, timeIn, timeOut, entry.rest.toFixed(1), entry.hours.toFixed(1)]);
      }
    }
    const hours = lorryEntries.reduce((sum, entry) => sum + entry.hours, 0);
    const fee = lorryEntries.reduce((sum, entry) => sum + entry.total, 0);
    rows.push([], ['TOTAL HOURS', '', '', '', hours.toFixed(1)], ['TOTAL FEE', '', '', '', `RM ${fee.toFixed(2)}`]);
    return { lorryId, rows, hours, fee };
  });

  const summaryRows = [
    [companyName], [site.name.toUpperCase()], [month], [],
    ['LORI ID', 'TOTAL HOURS', 'TOTAL FEE (RM)'],
    ...sections.map(({ lorryId, hours, fee }) => [lorryId, Number(hours.toFixed(1)), Number(fee.toFixed(2))]),
    [],
    ['GRAND TOTAL',
      Number(sections.reduce((sum, section) => sum + section.hours, 0).toFixed(1)),
      Number(sections.reduce((sum, section) => sum + section.fee, 0).toFixed(2))],
  ];

  if (options.exportLayout === 'combined') {
    const rows = options.includeSummary ? [...summaryRows, [], []] : [];
    sections.forEach(({ rows: sectionRows }, index) => {
      if (index > 0) rows.push([], []);
      rows.push(...sectionRows);
    });
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'All Lorries');
  } else {
    if (options.includeSummary) {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary');
      usedNames.add('summary');
    }
    sections.forEach(({ lorryId, rows }) => {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), worksheetName(lorryId, usedNames));
    });
  }
  return workbook;
}

export function monthlyExportFileName(siteName, month) {
  const safeName = Array.from(siteName, (character) => character.charCodeAt(0) < 32 ? '-' : character).join('').replace(/[<>:"/\\|?*]/g, '-').trim();
  return `${safeName || 'PunchCard'}_${month}.xlsx`;
}
