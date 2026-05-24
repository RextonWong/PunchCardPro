import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

// ── Formatting helpers ────────────────────────────────────────
// "2026-05" → "May '26"
const fmtMonth = (m) => {
  const [y, mo] = m.split('-');
  return new Date(+y, +mo - 1, 1).toLocaleDateString('en-MY', { month: 'short', year: '2-digit' });
};

const fmtRM = (v) =>
  'RM ' + Number(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Brand colours matching the existing app palette
const C_BLUE  = '#2563eb';
const C_GREEN = '#15803d';
const C_AMBER = '#d97706';
const C_SLATE = '#64748b';

// ── Reusable KPI card ─────────────────────────────────────────
function KpiCard({ label, value, sub }) {
  return (
    <div className="bg-white border p-8 shadow-sm">
      <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest mb-2">{label}</p>
      <p className="text-3xl font-black text-slate-800">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-2">{sub}</p>}
    </div>
  );
}

// ── Custom tooltip so numbers are formatted as RM ─────────────
function RMTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border shadow-lg p-3 text-xs">
      <p className="font-bold text-slate-700 mb-1">{fmtMonth(label)}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.fill }}>
          {p.name}: {fmtRM(p.value)}
        </p>
      ))}
    </div>
  );
}

function HoursTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border shadow-lg p-3 text-xs">
      <p className="font-bold text-slate-700 mb-1">{fmtMonth(label)}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.fill }}>
          {p.name}: {Number(p.value).toFixed(1)}h
        </p>
      ))}
    </div>
  );
}

// ── Main Analytics page ───────────────────────────────────────
function Analytics({ workplaces, onBack }) {
  // Default date range: last 6 months
  const today = new Date();
  const defaultTo   = today.toISOString().substring(0, 7);
  const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 5, 1)
    .toISOString().substring(0, 7);

  const [filterSite, setFilterSite] = useState('all');
  const [filterFrom, setFilterFrom] = useState(defaultFrom);
  const [filterTo,   setFilterTo]   = useState(defaultTo);

  // ── Filtered entries ────────────────────────────────────────
  // Flatten all entries across sites, applying site + date filters.
  // Each entry gets a `siteName` tag so charts can group by site.
  const filteredEntries = useMemo(() => {
    return workplaces
      .filter((wp) => filterSite === 'all' || wp.id === filterSite)
      .flatMap((wp) =>
        wp.entries
          .filter((e) => {
            const m = String(e.date).substring(0, 7);
            return m >= filterFrom && m <= filterTo;
          })
          .map((e) => ({ ...e, siteName: wp.name }))
      );
  }, [workplaces, filterSite, filterFrom, filterTo]);

  // ── KPI values ──────────────────────────────────────────────
  const totalRevenue  = filteredEntries.reduce((s, e) => s + e.total, 0);
  const totalHours    = filteredEntries.reduce((s, e) => s + e.hours, 0);
  const totalRainDays = filteredEntries.filter((e) => e.isRain).length;
  const activeLorries = new Set(filteredEntries.map((e) => e.loriId)).size;

  // ── Monthly trend data ──────────────────────────────────────
  // One object per month: { month, revenue, hours, rainDays }
  const monthlyData = useMemo(() => {
    const map = {};
    filteredEntries.forEach((e) => {
      const m = String(e.date).substring(0, 7);
      if (!map[m]) map[m] = { month: m, revenue: 0, hours: 0, rainDays: 0 };
      map[m].revenue  += e.total;
      map[m].hours    += e.hours;
      if (e.isRain) map[m].rainDays++;
    });
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
  }, [filteredEntries]);

  // ── Site comparison ─────────────────────────────────────────
  // Always spans all sites (ignores the site filter) so the chart
  // is still useful even when a single site is selected.
  const siteData = useMemo(() => {
    return workplaces
      .map((wp) => {
        const entries = wp.entries.filter((e) => {
          const m = String(e.date).substring(0, 7);
          return m >= filterFrom && m <= filterTo;
        });
        return {
          name: wp.name,
          revenue: entries.reduce((s, e) => s + e.total, 0),
          hours:   entries.reduce((s, e) => s + e.hours, 0),
        };
      })
      .filter((s) => s.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);
  }, [workplaces, filterFrom, filterTo]);

  // ── Lorry leaderboard ───────────────────────────────────────
  // Aggregate per lori_id: total hours, fees, days worked, rain days
  const lorryData = useMemo(() => {
    const map = {};
    filteredEntries.forEach((e) => {
      if (!map[e.loriId])
        map[e.loriId] = { id: e.loriId, hours: 0, revenue: 0, days: 0, rainDays: 0 };
      map[e.loriId].hours    += e.hours;
      map[e.loriId].revenue  += e.total;
      map[e.loriId].days     += 1;
      if (e.isRain) map[e.loriId].rainDays++;
    });
    return Object.values(map).sort((a, b) => b.hours - a.hours);
  }, [filteredEntries]);

  const noData = filteredEntries.length === 0;

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-10 font-sans text-slate-700">
      <div className="max-w-7xl mx-auto space-y-8">

        {/* Page header */}
        <div className="flex justify-between items-center border-b pb-4">
          <button onClick={onBack} className="text-blue-600 font-bold uppercase tracking-widest text-xs">
            ← Dashboard
          </button>
          <h2 className="text-xl font-black uppercase tracking-tighter text-slate-800">Analytics</h2>
          {/* spacer keeps heading centred */}
          <div className="w-24" />
        </div>

        {/* Filters */}
        <div className="bg-white border p-6 flex flex-wrap gap-6 items-end shadow-sm">
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Site</label>
            <select
              value={filterSite}
              onChange={(e) => setFilterSite(e.target.value)}
              className="border px-4 py-2 text-xs font-bold outline-none bg-white cursor-pointer"
            >
              <option value="all">All Sites</option>
              {workplaces.map((wp) => (
                <option key={wp.id} value={wp.id}>{wp.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">From</label>
            <input
              type="month"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="border px-4 py-2 text-xs font-bold outline-none cursor-pointer"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">To</label>
            <input
              type="month"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="border px-4 py-2 text-xs font-bold outline-none cursor-pointer"
            />
          </div>
          {noData && (
            <p className="text-xs text-amber-600 font-bold uppercase self-end pb-2">
              No entries found for this period.
            </p>
          )}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="Total Revenue"
            value={fmtRM(totalRevenue)}
            sub={`${filterFrom} — ${filterTo}`}
          />
          <KpiCard
            label="Billable Hours"
            value={totalHours.toFixed(1) + 'h'}
          />
          <KpiCard
            label="Active Lorries"
            value={activeLorries}
          />
          <KpiCard
            label="Rain Days"
            value={totalRainDays}
            sub="entries flagged as rain"
          />
        </div>

        {!noData && (
          <>
            {/* Monthly Revenue Trend */}
            <div className="bg-white border p-8 shadow-sm">
              <h3 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-6">
                Monthly Revenue (RM)
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={monthlyData} margin={{ top: 4, right: 16, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="month"
                    tickFormatter={fmtMonth}
                    tick={{ fontSize: 11, fill: C_SLATE }}
                  />
                  <YAxis
                    tickFormatter={(v) => 'RM ' + v.toLocaleString()}
                    tick={{ fontSize: 11, fill: C_SLATE }}
                    width={90}
                  />
                  <Tooltip content={<RMTooltip />} />
                  <Bar dataKey="revenue" fill={C_BLUE} radius={[2, 2, 0, 0]} name="Revenue" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Monthly Hours + Rain Days side-by-side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white border p-8 shadow-sm">
                <h3 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-6">
                  Monthly Billable Hours
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthlyData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis
                      dataKey="month"
                      tickFormatter={fmtMonth}
                      tick={{ fontSize: 11, fill: C_SLATE }}
                    />
                    <YAxis tick={{ fontSize: 11, fill: C_SLATE }} />
                    <Tooltip content={<HoursTooltip />} />
                    <Bar dataKey="hours" fill={C_GREEN} radius={[2, 2, 0, 0]} name="Hours" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white border p-8 shadow-sm">
                <h3 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-6">
                  Rain Days per Month
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthlyData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis
                      dataKey="month"
                      tickFormatter={fmtMonth}
                      tick={{ fontSize: 11, fill: C_SLATE }}
                    />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C_SLATE }} />
                    <Tooltip
                      formatter={(v) => [v + ' days', 'Rain Days']}
                      labelFormatter={fmtMonth}
                    />
                    <Bar dataKey="rainDays" fill={C_AMBER} radius={[2, 2, 0, 0]} name="Rain Days" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Site Comparison — only visible when all sites selected and more than one has data */}
            {filterSite === 'all' && siteData.length > 1 && (
              <div className="bg-white border p-8 shadow-sm">
                <h3 className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-6">
                  Site Comparison — Revenue (RM)
                </h3>
                <ResponsiveContainer width="100%" height={Math.max(180, siteData.length * 52)}>
                  <BarChart
                    data={siteData}
                    layout="vertical"
                    margin={{ top: 4, right: 60, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis
                      type="number"
                      tickFormatter={(v) => 'RM ' + v.toLocaleString()}
                      tick={{ fontSize: 11, fill: C_SLATE }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 11, fill: C_SLATE }}
                      width={130}
                    />
                    <Tooltip formatter={(v) => fmtRM(v)} />
                    <Bar dataKey="revenue" fill={C_BLUE} radius={[0, 2, 2, 0]} name="Revenue" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Lorry Leaderboard */}
            <div className="bg-white border shadow-sm">
              <div className="p-6 border-b">
                <h3 className="text-[10px] font-black uppercase text-slate-500 tracking-widest">
                  Lorry Leaderboard
                </h3>
              </div>
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  <tr>
                    <th className="p-4">#</th>
                    <th className="p-4">Lorry ID</th>
                    <th className="p-4">Days Worked</th>
                    <th className="p-4">Rain Days</th>
                    <th className="p-4 text-right">Total Hours</th>
                    <th className="p-4 text-right">Total Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {lorryData.map((l, i) => (
                    <tr key={l.id} className="border-b hover:bg-slate-50 transition-colors">
                      {/* Rank number — fades out for lower positions */}
                      <td className="p-4 font-black text-lg" style={{ color: i < 3 ? C_BLUE : '#cbd5e1' }}>
                        {i + 1}
                      </td>
                      <td className="p-4 font-black text-slate-800 text-base">{l.id}</td>
                      <td className="p-4 text-slate-500">{l.days}</td>
                      <td className="p-4">
                        {l.rainDays > 0
                          ? <span className="font-bold" style={{ color: C_AMBER }}>{l.rainDays}</span>
                          : <span className="text-slate-300">—</span>
                        }
                      </td>
                      <td className="p-4 text-right font-black text-slate-800">{l.hours.toFixed(1)}h</td>
                      <td className="p-4 text-right font-black text-green-700">{fmtRM(l.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
                {/* Summary footer */}
                <tfoot className="bg-blue-50 border-t-2 border-blue-200">
                  <tr>
                    <td colSpan="4" className="p-4 font-black text-right uppercase text-xs text-blue-800">
                      Total ({lorryData.length} lorries):
                    </td>
                    <td className="p-4 text-right font-black text-blue-700">{totalHours.toFixed(1)}h</td>
                    <td className="p-4 text-right font-black text-green-700">{fmtRM(totalRevenue)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

          </>
        )}
      </div>
    </div>
  );
}

export default Analytics;
