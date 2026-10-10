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

export function buildMonthlyWorkbook(site, month) {
  const entries = site.entries.filter((entry) => String(entry.date).startsWith(`${month}-`));
  if (!entries.length) throw new Error('There are no saved entries to export for this month.');
  const workbook = XLSX.utils.book_new();
  const usedNames = new Set();
  const [year, monthNumber] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();

  [...new Set(entries.map((entry) => entry.loriId))].sort().forEach((lorryId) => {
    const lorryEntries = entries.filter((entry) => entry.loriId === lorryId);
    const rows = [
      ['LAND VISION TRADING'], [site.name.toUpperCase()], [month],
      [`LORI ID: ${lorryId}`], [], ['DAY', 'IN', 'OUT', 'REST', 'TOTAL'],
    ];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const entry = lorryEntries.find((item) => String(item.date) === date);
      if (!entry) rows.push([day, '-', '-', '0.0', '0.0']);
      else {
        const [timeIn, timeOut] = entry.timeRange.split('-');
        rows.push([day, timeIn, timeOut, entry.rest.toFixed(1), entry.hours.toFixed(1)]);
      }
    }
    const hours = lorryEntries.reduce((sum, entry) => sum + entry.hours, 0);
    const fee = lorryEntries.reduce((sum, entry) => sum + entry.total, 0);
    rows.push([], ['TOTAL HOURS', '', '', '', hours.toFixed(1)], ['TOTAL FEE', '', '', '', `RM ${fee.toFixed(2)}`]);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), worksheetName(lorryId, usedNames));
  });
  return workbook;
}

export function monthlyExportFileName(siteName, month) {
  const safeName = Array.from(siteName, (character) => character.charCodeAt(0) < 32 ? '-' : character).join('').replace(/[<>:"/\\|?*]/g, '-').trim();
  return `${safeName || 'PunchCard'}_${month}.xlsx`;
}
