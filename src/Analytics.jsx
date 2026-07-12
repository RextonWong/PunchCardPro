import React, { useState, useMemo } from 'react';
import {
  AreaChart, Area,
  BarChart, Bar,
  ComposedChart,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

// ── Formatting ────────────────────────────────────────────────
const fmtMonth = (m) => {
  const [y, mo] = m.split('-');
  return new Date(+y, +mo - 1, 1).toLocaleDateString('en-MY', { month: 'short', year: '2-digit' });
};
const fmtRM = (v) =>
  'RM ' + Number(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRMShort = (v) => {
  if (v >= 1000) return 'RM ' + (v / 1000).toFixed(1) + 'k';
  return 'RM ' + v.toFixed(0);
};

// ── Date helpers ──────────────────────────────────────────────
const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1 + n, 1).toISOString().substring(0, 7);
};
const monthSpan = (from, to) => {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
};

// ── Colour palette ────────────────────────────────────────────
const C_BLUE  = '#2563eb';
const C_GREEN = '#16a34a';
const C_AMBER = '#d97706';
const C_SLATE = '#64748b';
const PIE_COLORS = ['#2563eb','#0891b2','#0d9488','#16a34a','#84cc16','#f59e0b','#ef4444','#8b5cf6'];

// ── Shared tooltip wrapper ────────────────────────────────────
function ChartTip({ active, payload, label, fmt = (v) => v }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 shadow-xl rounded p-3 text-xs min-w-[140px]">
      <p className="font-bold text-slate-700 mb-2 border-b pb-1">{fmtMonth(label)}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4 mt-1">
          <span style={{ color: p.stroke || p.fill }}>{p.name}</span>
          <span className="font-bold text-slate-800">{fmt(p.value, p.name)}</span>
        </div>
      ))}
    </div>
  );
}

// ── KPI card with trend indicator ────────────────────────────
function KpiCard({ label, value, change, accent }) {
  const up = change >= 0;
  return (
    <div className="bg-white border shadow-sm overflow-hidden flex">
      {/* Coloured left accent bar */}
      <div className="w-1 flex-shrink-0" style={{ backgroundColor: accent }} />
      <div className="p-6 flex-1">
        <p className="text-[10px] font-bold uppercase text-slate-400 tracking-widest mb-2">{label}</p>
        <p className="text-2xl font-black text-slate-800 leading-none">{value}</p>
        {change !== null && change !== undefined && (
          <p className={`text-xs font-bold mt-2 ${up ? 'text-green-600' : 'text-red-500'}`}>
            {up ? '↑' : '↓'} {Math.abs(change).toFixed(1)}% vs prev period
          </p>
        )}
        {(change === null || change === undefined) && (
          <p className="text-xs text-slate-300 mt-2">no prior data</p>
        )}
      </div>
    </div>
  );
}

// ── Donut chart with centred label ────────────────────────────
function DonutChart({ data, centerValue, centerLabel, height = 220 }) {
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((_, i) => (
              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v, name) => [fmtRM(v), name]}
            contentStyle={{ fontSize: 11, border: '1px solid #e2e8f0', borderRadius: 4 }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* Centred overlay label */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none"
           style={{ paddingBottom: 36 }}>
        <div className="text-center">
          <p className="text-sm font-black text-slate-800 leading-none">{centerValue}</p>
          <p className="text-[9px] font-bold uppercase text-slate-400 tracking-widest mt-1">{centerLabel}</p>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
function Analytics({ workplaces, onBack }) {
  const today = new Date();
  const defaultTo   = today.toISOString().substring(0, 7);
  const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 5, 1).toISOString().substring(0, 7);

  const [filterSite, setFilterSite] = useState('all');
  const [filterFrom, setFilterFrom] = useState(defaultFrom);
  const [filterTo,   setFilterTo]   = useState(defaultTo);
  const [leaderSort, setLeaderSort] = useState('hours'); // 'hours' | 'revenue'

  // ── Current period entries ───────────────────────────────────
  const filteredEntries = useMemo(() => {
    return workplaces
      .filter((wp) => filterSite === 'all' || wp.id === filterSite)
      .flatMap((wp) =>
        wp.entries
          .filter((e) => { const m = String(e.date).substring(0, 7); return m >= filterFrom && m <= filterTo; })
          .map((e) => ({ ...e, siteName: wp.name }))
      );
  }, [workplaces, filterSite, filterFrom, filterTo]);

  // ── Previous period entries (same duration, shifted back) ────
  const prevTo   = addMonths(filterFrom, -1);
  const prevFrom = addMonths(filterFrom, -monthSpan(filterFrom, filterTo));

  const prevEntries = useMemo(() => {
    return workplaces
      .filter((wp) => filterSite === 'all' || wp.id === filterSite)
      .flatMap((wp) =>
        wp.entries
          .filter((e) => { const m = String(e.date).substring(0, 7); return m >= prevFrom && m <= prevTo; })
          .map((e) => ({ ...e }))
      );
  }, [workplaces, filterSite, prevFrom, prevTo]);

  // ── KPI values ───────────────────────────────────────────────
  const totalRevenue  = filteredEntries.reduce((s, e) => s + e.total, 0);
  const totalHours    = filteredEntries.reduce((s, e) => s + e.hours, 0);
  const totalRainDays = filteredEntries.filter((e) => e.isRain).length;
  const activeLorries = new Set(filteredEntries.map((e) => e.loriId)).size;

  const prevRevenue  = prevEntries.reduce((s, e) => s + e.total, 0);
  const prevHours    = prevEntries.reduce((s, e) => s + e.hours, 0);
  const prevRainDays = prevEntries.filter((e) => e.isRain).length;

  const pct = (curr, prev) => prev > 0 ? ((curr - prev) / prev) * 100 : null;

  // ── Monthly trend ────────────────────────────────────────────
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

  // ── Lorry data ───────────────────────────────────────────────
  const lorryData = useMemo(() => {
    const map = {};
    filteredEntries.forEach((e) => {
      if (!map[e.loriId]) map[e.loriId] = { id: e.loriId, hours: 0, revenue: 0, days: 0, rainDays: 0 };
      map[e.loriId].hours   += e.hours;
      map[e.loriId].revenue += e.total;
      map[e.loriId].days    += 1;
      if (e.isRain) map[e.loriId].rainDays++;
    });
    return Object.values(map).sort((a, b) => b[leaderSort] - a[leaderSort]);
  }, [filteredEntries, leaderSort]);

  const maxHours   = lorryData[0]?.hours   || 1;
  const maxRevenue = lorryData[0]?.revenue || 1;

  // ── Site data ────────────────────────────────────────────────
  const siteData = useMemo(() => {
    return workplaces
      .map((wp) => {
        const entries = wp.entries.filter((e) => {
          const m = String(e.date).substring(0, 7);
          return m >= filterFrom && m <= filterTo;
        });
        return { name: wp.name, value: entries.reduce((s, e) => s + e.total, 0) };
      })
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [workplaces, filterFrom, filterTo]);

  // ── Lorry donut data ─────────────────────────────────────────
  const lorryPieData = lorryData.map((l) => ({ name: l.id, value: l.revenue }));

  const noData = filteredEntries.length === 0;

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-700">

      {/* ── Dark header bar ────────────────────────────────── */}
      <div className="bg-slate-900 text-white px-6 md:px-10 py-5 flex items-center justify-between">
        <button onClick={onBack} className="text-slate-400 hover:text-white font-bold uppercase tracking-widest text-xs transition-colors">
          ← Dashboard
        </button>
        <div>
          <h2 className="text-xl font-black uppercase tracking-tighter text-center">Analytics</h2>
        </div>
        <div className="w-24" />
      </div>

      <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-6">

        {/* ── Filters ────────────────────────────────────────── */}
        <div className="bg-white border shadow-sm p-5 flex flex-wrap gap-5 items-end">
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Site</label>
            <select
              value={filterSite}
              onChange={(e) => setFilterSite(e.target.value)}
              className="border px-4 py-2 text-xs font-bold outline-none bg-white cursor-pointer focus:border-blue-600"
            >
              <option value="all">All Sites</option>
              {workplaces.map((wp) => <option key={wp.id} value={wp.id}>{wp.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">From</label>
            <input type="month" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="border px-4 py-2 text-xs font-bold outline-none focus:border-blue-600 cursor-pointer" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">To</label>
            <input type="month" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="border px-4 py-2 text-xs font-bold outline-none focus:border-blue-600 cursor-pointer" />
          </div>
          <p className="text-[10px] text-slate-400 uppercase font-bold self-end pb-2">
            Comparing to {fmtMonth(prevFrom)} – {fmtMonth(prevTo)}
          </p>
          {noData && <p className="text-xs text-amber-600 font-bold uppercase self-end pb-2">No entries found for this period.</p>}
        </div>

        {/* ── KPI Cards ──────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Total Revenue"   value={fmtRM(totalRevenue)}            change={pct(totalRevenue, prevRevenue)}   accent={C_BLUE}  />
          <KpiCard label="Billable Hours"  value={totalHours.toFixed(1) + 'h'}    change={pct(totalHours, prevHours)}       accent={C_GREEN} />
          <KpiCard label="Active Lorries"  value={activeLorries}                  change={null}                             accent={C_SLATE} />
          <KpiCard label="Rain Days"       value={totalRainDays}                  change={pct(totalRainDays, prevRainDays)} accent={C_AMBER} />
        </div>

        {!noData && (
          <>
            {/* ── Revenue trend (Area) ────────────────────────── */}
            <div className="bg-white border shadow-sm p-6">
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-5">Monthly Revenue Trend</p>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={monthlyData} margin={{ top: 8, right: 16, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C_BLUE} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={C_BLUE} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fontSize: 11, fill: C_SLATE }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtRMShort} tick={{ fontSize: 11, fill: C_SLATE }} axisLine={false} tickLine={false} width={70} />
                  <Tooltip content={(p) => <ChartTip {...p} fmt={(v) => fmtRM(v)} />} />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke={C_BLUE}
                    strokeWidth={2.5}
                    fill="url(#revGrad)"
                    dot={false}
                    activeDot={{ r: 5, fill: C_BLUE, stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* ── Hours + Rain side by side ───────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Hours area chart */}
              <div className="bg-white border shadow-sm p-6">
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-5">Monthly Billable Hours</p>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={monthlyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="hrsGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={C_GREEN} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={C_GREEN} stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fontSize: 11, fill: C_SLATE }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: C_SLATE }} axisLine={false} tickLine={false} width={35} />
                    <Tooltip content={(p) => <ChartTip {...p} fmt={(v) => Number(v).toFixed(1) + 'h'} />} />
                    <Area
                      type="monotone"
                      dataKey="hours"
                      name="Hours"
                      stroke={C_GREEN}
                      strokeWidth={2.5}
                      fill="url(#hrsGrad)"
                      dot={false}
                      activeDot={{ r: 5, fill: C_GREEN, stroke: '#fff', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Rain days bar chart */}
              <div className="bg-white border shadow-sm p-6">
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-5">Rain Days per Month</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthlyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="rainBarGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor={C_AMBER} stopOpacity={1} />
                        <stop offset="100%" stopColor="#fbbf24" stopOpacity={0.7} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fontSize: 11, fill: C_SLATE }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C_SLATE }} axisLine={false} tickLine={false} width={25} />
                    <Tooltip formatter={(v) => [v + ' days', 'Rain Days']} labelFormatter={fmtMonth} contentStyle={{ fontSize: 11 }} />
                    <Bar dataKey="rainDays" name="Rain Days" fill="url(#rainBarGrad)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ── Donut charts row ─────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Lorry revenue donut */}
              {lorryPieData.length > 0 && (
                <div className="bg-white border shadow-sm p-6">
                  <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">Revenue by Lorry</p>
                  <DonutChart
                    data={lorryPieData}
                    centerValue={fmtRMShort(totalRevenue)}
                    centerLabel="Total"
                    height={240}
                  />
                </div>
              )}

              {/* Site revenue donut — only when all sites and more than one */}
              {filterSite === 'all' && siteData.length > 1 ? (
                <div className="bg-white border shadow-sm p-6">
                  <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">Revenue by Site</p>
                  <DonutChart
                    data={siteData}
                    centerValue={siteData.length + ' sites'}
                    centerLabel="Active"
                    height={240}
                  />
                </div>
              ) : lorryPieData.length === 0 ? null : (
                /* Filler card when only one site so layout doesn't break */
                <div className="bg-white border shadow-sm p-6 flex items-center justify-center">
                  <p className="text-xs text-slate-300 uppercase font-bold">Add more sites to see site comparison</p>
                </div>
              )}
            </div>

            {/* ── Lorry Leaderboard ────────────────────────────── */}
            <div className="bg-white border shadow-sm">
              <div className="p-5 border-b flex items-center justify-between">
                <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Lorry Leaderboard</p>
                {/* Sort toggle */}
                <div className="flex gap-1 bg-slate-100 p-1 rounded">
                  <button
                    onClick={() => setLeaderSort('hours')}
                    className={`px-3 py-1 text-[10px] font-bold uppercase rounded transition-colors ${leaderSort === 'hours' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}
                  >
                    By Hours
                  </button>
                  <button
                    onClick={() => setLeaderSort('revenue')}
                    className={`px-3 py-1 text-[10px] font-bold uppercase rounded transition-colors ${leaderSort === 'revenue' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}
                  >
                    By Revenue
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[560px]">
                <thead className="bg-slate-50 border-b text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  <tr>
                    <th className="p-4 w-8">#</th>
                    <th className="p-4">Lorry</th>
                    <th className="p-4">Days</th>
                    <th className="p-4">Rain</th>
                    <th className="p-4">Hours</th>
                    <th className="p-4 text-right">Fee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lorryData.map((l, i) => (
                    <tr key={l.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-4 font-black text-lg" style={{ color: i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : '#e2e8f0' }}>
                        {i + 1}
                      </td>
                      <td className="p-4 font-black text-slate-800">{l.id}</td>
                      <td className="p-4 text-slate-500 text-sm">{l.days}</td>
                      <td className="p-4">
                        {l.rainDays > 0
                          ? <span className="text-xs font-bold px-2 py-0.5 bg-amber-50 text-amber-600 rounded">{l.rainDays}</span>
                          : <span className="text-slate-200">—</span>}
                      </td>
                      {/* Hours with inline progress bar */}
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <span className="font-black text-slate-800 text-sm w-14 flex-shrink-0">{l.hours.toFixed(1)}h</span>
                          <div className="flex-1 bg-slate-100 rounded-full h-1.5 min-w-[60px]">
                            <div
                              className="h-1.5 rounded-full"
                              style={{ width: `${(l.hours / maxHours) * 100}%`, backgroundColor: C_GREEN }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-right font-black text-green-700 text-sm">{fmtRM(l.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-blue-50 border-t-2 border-blue-100">
                  <tr>
                    <td colSpan="4" className="p-4 text-right text-xs font-black uppercase text-blue-700">
                      Total — {lorryData.length} lorries
                    </td>
                    <td className="p-4 font-black text-blue-700">{totalHours.toFixed(1)}h</td>
                    <td className="p-4 text-right font-black text-green-700">{fmtRM(totalRevenue)}</td>
                  </tr>
                </tfoot>
              </table>
              </div>
            </div>

          </>
        )}
      </div>
    </div>
  );
}

export default Analytics;
