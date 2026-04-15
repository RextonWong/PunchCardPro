import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

function App() {
  // --- 1. CORE DATA & PERSISTENCE ---
  const [view, setView] = useState('home'); 
  const [activeSiteId, setActiveSiteId] = useState(null);
  const [showNewSiteForm, setShowNewSiteForm] = useState(false);
  const [data, setData] = useState(() => {
    const saved = localStorage.getItem('lori-hantu-v33');
    try {
      return saved ? JSON.parse(saved) : { workplaces: [], fleet: [] };
    } catch (e) {
      return { workplaces: [], fleet: [] };
    }
  });

  const { workplaces, fleet } = data;
  const updateData = (updates) => setData(prev => ({ ...prev, ...updates }));

  useEffect(() => {
    localStorage.setItem('lori-hantu-v33', JSON.stringify(data));
  }, [data]);

  // --- 2. INPUT & UI STATE ---
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T'));
  const [loriInput, setLoriInput] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [rainCheck, setRainCheck] = useState(false);
  
  const [selMonth, setSelMonth] = useState(String(entryDate).substring(0, 7));
  const [activeTab, setActiveTab] = useState(null);

  // New Site Form State (Including Friday Protocol)
  const [newSite, setNewSite] = useState({
    name: "", rate: 80, rainMin: 4.0,
    lStart: "13:00", lEnd: "14:00", lTh: "14:30",
    fStart: "12:00", fEnd: "13:30", fTh: "15:30"
  });

  // --- 3. SITE CALCULATIONS ---
  const activeSite = workplaces.find(s => s.id === activeSiteId) || null;
  const siteEntries = activeSite?.entries || [];
  const availableMonths = [...new Set(siteEntries.map(e => String(e.date).substring(0, 7)))].sort().reverse();
  const todayMonthKey = String(entryDate).substring(0, 7);

  useEffect(() => {
    if (view === 'workplace' && activeSiteId) {
      setSelMonth(availableMonths || todayMonthKey);
    }
  }, [activeSiteId, view]);

  const lorisInMonth = [...new Set(siteEntries.filter(e => String(e.date).startsWith(selMonth)).map(e => e.loriId))].sort();

  useEffect(() => {
    if (lorisInMonth.length > 0) {
        if (!activeTab || !lorisInMonth.includes(String(activeTab))) {
            setActiveTab(String(lorisInMonth));
        }
    } else { setActiveTab(null); }
  }, [selMonth, lorisInMonth.join(','), activeTab]);

  // --- 4. FUNCTIONS ---
  const getMins = (t) => {
    if (!t || !t.includes(':')) return 0;
    const [h, m] = t.split(':').map(Number);
    return (h * 60 + m);
  };

  const saveNewSite = (e) => {
    e.preventDefault();
    if (!newSite.name) return alert("Site Name is required");
    const siteToAdd = { ...newSite, id: Date.now(), entries: [] };
    updateData({ workplaces: [...workplaces, siteToAdd] });
    setShowNewSiteForm(false);
    setNewSite({ name: "", rate: 80, rainMin: 4.0, lStart: "13:00", lEnd: "14:00", lTh: "14:30", fStart: "12:00", fEnd: "13:30", fTh: "15:30" });
  };

  const addEntry = (e) => {
    e.preventDefault();
    const fId = String(loriInput || "").toUpperCase().trim();
    if (!fId || !entryDate || !activeSite) return;

    let cH = 0; let tr = "No Time";
    const isF = new Date(entryDate).getDay() === 5;

    if (startTime && endTime) {
      const sM = getMins(startTime), eM = getMins(endTime);
      const rS = Math.round(sM/30)*30, rE = Math.round(eM/30)*30;
      cH = (rE - rS)/60;
      
      const cS = getMins(isF ? activeSite.fStart : activeSite.lStart);
      const cE = getMins(isF ? activeSite.fEnd : activeSite.lEnd);
      const cT = getMins(isF ? activeSite.fTh : activeSite.lTh);
      
      const lunchDur = Math.abs(cE - cS) / 60;
      // The "Mum Logic": Only deduct if rounded end-time reaches threshold
      if (rE >= cT) cH -= lunchDur;
      tr = `${startTime} - ${endTime}`;
    }

    const finalH = rainCheck ? Math.max(cH, parseFloat(activeSite.rainMin)) : Math.max(0, cH);
    const newE = { id: Date.now(), date: String(entryDate), loriId: fId, timeRange: tr, hours: finalH, total: finalH * activeSite.rate, isRain: rainCheck };
    
    updateData({ 
      workplaces: workplaces.map(s => s.id === activeSiteId ? { ...s, entries: [newE, ...s.entries] } : s), 
      fleet: (fleet || []).includes(fId) ? fleet : [...(fleet || []), fId].sort() 
    });
    setLoriInput(""); setStartTime(""); setEndTime(""); setRainCheck(false);
  };

  const exportExcel = () => {
    if (!activeSite || !selMonth) return;
    const wb = XLSX.utils.book_new();
    const mEntries = siteEntries.filter(e => String(e.date).startsWith(selMonth));
    const uniqueLoris = [...new Set(mEntries.map(e => e.loriId))].sort();

    uniqueLoris.forEach(id => {
      const lEntries = mEntries.filter(e => e.loriId === id);
      const rows = [
        ["LAND VISION TRADING"], [activeSite.name.toUpperCase()], [`MONTH: ${selMonth} | LORI: ${id}`], [""],
        ["DAY", "IN (A)", "OUT (B)", "REST (C)", "TOTAL (D)"]
      ];
      let total = 0;
      for (let d = 1; d <= 31; d++) {
        const dStr = `${selMonth}-${d.toString().padStart(2, '0')}`;
        const entry = lEntries.find(i => String(i.date) === dStr);
        if (entry && entry.timeRange !== "No Time") {
          const [sT, eT] = entry.timeRange.split(' - ');
          const dIn = getMins(sT)/60, dOut = getMins(eT)/60;
          rows.push([d, dIn.toFixed(1), dOut.toFixed(1), (dOut-dIn-entry.hours).toFixed(1), entry.hours.toFixed(1)]);
          total += entry.hours;
        } else if (entry?.isRain) { rows.push([d, "RAIN", "RAIN", "0.0", entry.hours.toFixed(1)]); total += entry.hours; }
        else rows.push([d, "-", "-", "-", "0.0"]);
      }
      rows.push([""], ["TOTAL HOURS", "", "", "", total.toFixed(1)], ["RATE", "", "", "", activeSite.rate.toFixed(2)], ["TOTAL FEE", "", "", "", "RM " + (total * activeSite.rate).toFixed(2)]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), id);
    });
    XLSX.writeFile(wb, `${activeSite.name}_${selMonth}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-[#f3f4f6] p-4 md:p-10 font-sans text-slate-700">
      <div className="max-w-7xl mx-auto">
        
        {/* --- MODAL: SETUP NEW SITE --- */}
        {showNewSiteForm && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-4xl border border-slate-300 shadow-2xl rounded-sm overflow-hidden">
              <div className="bg-[#0078d4] p-4 flex justify-between items-center text-white">
                <h3 className="font-bold uppercase text-xs tracking-[0.2em]">Project Environment Setup</h3>
                <button onClick={() => setShowNewSiteForm(false)} className="text-2xl font-light hover:opacity-50">&times;</button>
              </div>
              <form onSubmit={saveNewSite} className="p-10 space-y-10">
                {/* Section 1: Site Identity */}
                <div className="space-y-4">
                    <p className="text-[10px] font-black uppercase text-[#0078d4] tracking-widest border-b border-blue-50 pb-2">1. Site Identity & Billing</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="md:col-span-1"><label className="text-[10px] font-bold uppercase text-slate-400">Site Name</label>
                        <input autoFocus required value={newSite.name} onChange={e=>setNewSite({...newSite, name: e.target.value})} className="w-full border border-slate-300 p-3 text-sm mt-1 focus:border-[#0078d4] outline-none" /></div>
                        <div><label className="text-[10px] font-bold uppercase text-slate-400">Rate (RM/h)</label>
                        <input type="number" value={newSite.rate} onChange={e=>setNewSite({...newSite, rate: parseFloat(e.target.value)})} className="w-full border border-slate-300 p-3 text-sm mt-1 focus:border-[#0078d4] outline-none" /></div>
                        <div><label className="text-[10px] font-bold uppercase text-slate-400">Rain Min (h)</label>
                        <input type="number" step="0.5" value={newSite.rainMin} onChange={e=>setNewSite({...newSite, rainMin: parseFloat(e.target.value)})} className="w-full border border-slate-300 p-3 text-sm mt-1 focus:border-[#0078d4] outline-none" /></div>
                    </div>
                </div>

                {/* Section 2: Rule Protocols */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                    {/* Standard Protocol */}
                    <div className="space-y-4 bg-slate-50 p-6 border border-slate-100">
                        <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest border-b pb-2">2A. Standard Protocol (Mon-Thu)</p>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="text-[10px] font-bold uppercase text-slate-400">Rest Start</label>
                            <input type="time" value={newSite.lStart} onChange={e=>setNewSite({...newSite, lStart: e.target.value})} className="w-full border border-slate-300 p-2 text-sm mt-1" /></div>
                            <div><label className="text-[10px] font-bold uppercase text-slate-400">Rest End</label>
                            <input type="time" value={newSite.lEnd} onChange={e=>setNewSite({...newSite, lEnd: e.target.value})} className="w-full border border-slate-300 p-2 text-sm mt-1" /></div>
                        </div>
                        <div><label className="text-[10px] font-bold uppercase text-[#0078d4]">Deduct rest only if Clock-Out is AFTER:</label>
                        <input type="time" value={newSite.lTh} onChange={e=>setNewSite({...newSite, lTh: e.target.value})} className="w-full border border-slate-300 p-2 text-sm mt-1 bg-white" /></div>
                    </div>

                    {/* Friday Protocol */}
                    <div className="space-y-4 bg-yellow-50/30 p-6 border border-yellow-100">
                        <p className="text-[10px] font-black uppercase text-yellow-600 tracking-widest border-b border-yellow-100 pb-2">2B. Friday Protocol (Sembahyang)</p>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="text-[10px] font-bold uppercase text-slate-400">Rest Start</label>
                            <input type="time" value={newSite.fStart} onChange={e=>setNewSite({...newSite, fStart: e.target.value})} className="w-full border border-slate-300 p-2 text-sm mt-1" /></div>
                            <div><label className="text-[10px] font-bold uppercase text-slate-400">Rest End</label>
                            <input type="time" value={newSite.fEnd} onChange={e=>setNewSite({...newSite, fEnd: e.target.value})} className="w-full border border-slate-300 p-2 text-sm mt-1" /></div>
                        </div>
                        <div><label className="text-[10px] font-bold uppercase text-yellow-700">Deduct rest only if Clock-Out is AFTER:</label>
                        <input type="time" value={newSite.fTh} onChange={e=>setNewSite({...newSite, fTh: e.target.value})} className="w-full border border-slate-300 p-2 text-sm mt-1 bg-white" /></div>
                    </div>
                </div>

                <div className="pt-6 border-t border-slate-100 flex justify-end gap-4">
                  <button type="button" onClick={() => setShowNewSiteForm(false)} className="px-8 py-2 text-xs font-bold uppercase text-slate-400 hover:text-slate-600 tracking-widest">Abort</button>
                  <button type="submit" className="bg-[#107c10] text-white px-12 py-3 rounded-sm text-xs font-black hover:bg-[#0b5a0b] shadow-md tracking-[0.2em]">INITIALIZE SITE</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* --- MAIN VIEWS --- */}
        {view === 'home' ? (
          <div className="space-y-6">
            <div className="flex justify-between items-center border-b border-slate-300 pb-6">
              <h2 className="text-2xl font-light uppercase tracking-[0.1em] text-slate-900">PunchCard Pro</h2>
              <button onClick={() => setShowNewSiteForm(true)} className="bg-[#0078d4] text-white px-8 py-2 rounded-sm text-xs font-black hover:bg-[#106ebe] shadow-sm tracking-widest">ADD NEW SITE</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {workplaces.map(s => (
                <div key={s.id} onClick={()=>{setActiveSiteId(s.id); setView('workplace')}} className="bg-white p-8 border border-slate-200 cursor-pointer hover:border-[#0078d4] transition-all shadow-sm group">
                  <h3 className="font-bold text-xl text-slate-900 group-hover:text-[#0078d4]">{s.name}</h3>
                  <div className="mt-12 flex justify-between items-end border-t pt-6 border-slate-50">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Net Receivable</span>
                    <span className="text-2xl font-light text-green-700">RM {(s.entries || []).reduce((a,b)=>a+b.total,0).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex justify-between items-center gap-4 border-b border-slate-300 pb-6">
                <button onClick={() => setView('home')} className="text-[#0078d4] font-black text-xs hover:underline tracking-[0.2em]">← BACK TO PORTFOLIO</button>
                <div className="flex gap-3">
                    <select value={selMonth} onChange={(e) => {setSelMonth(e.target.value); setActiveTab(null);}} className="bg-white border border-slate-300 rounded-sm px-6 py-2 text-sm font-bold shadow-sm outline-none focus:border-[#0078d4]">
                        {!availableMonths.includes(todayMonthKey) && <option value={todayMonthKey}>{todayMonthKey}</option>}
                        {availableMonths.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <button onClick={exportExcel} className="bg-[#107c10] text-white px-8 py-2 rounded-sm text-xs font-black hover:bg-[#0b5a0b] shadow-sm tracking-widest">DOWNLOAD EXCEL</button>
                </div>
            </div>

            <header className="bg-[#0078d4] p-12 text-white shadow-md border-b-8 border-[#106ebe]">
              <h1 className="text-7xl font-light tracking-tighter mb-12 uppercase">{activeSite?.name}</h1>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
                <div className="border-l border-white/20 pl-8">
                  <p className="text-xs font-black uppercase opacity-60 mb-3 tracking-widest">Hourly Rate</p>
                  <p className="text-5xl font-light tracking-tighter text-white">RM {activeSite?.rate}</p>
                </div>
                <div className="border-l border-white/20 pl-8">
                  <p className="text-xs font-black uppercase opacity-60 mb-3 tracking-widest">Rain Min</p>
                  <p className="text-5xl font-light tracking-tighter text-white">{activeSite?.rainMin}h</p>
                </div>
                <div className="border-l border-white/20 pl-8">
                  <p className="text-xs font-black uppercase opacity-60 mb-3 tracking-widest">Lunch Rule</p>
                  <p className="text-5xl font-light tracking-tighter text-white">{activeSite?.lStart}-{activeSite?.lEnd}</p>
                </div>
                <div className="border-l-4 border-yellow-400 pl-8 bg-yellow-400/10 py-2">
                  <p className="text-xs font-black uppercase text-yellow-300 mb-3 tracking-widest">Friday Protocol</p>
                  <p className="text-5xl font-light tracking-tighter text-yellow-300">{activeSite?.fStart}-{activeSite?.fEnd}</p>
                </div>
              </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <form onSubmit={addEntry} className="lg:col-span-4 bg-white p-10 border border-slate-200 shadow-sm space-y-6">
                <h2 className="font-black text-[10px] uppercase text-slate-400 mb-8 tracking-[0.3em] border-b pb-4">New Entry Ledger</h2>
                <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Service Date</label>
                    <input type="date" value={entryDate} onChange={(e)=>setEntryDate(e.target.value)} className="w-full border border-slate-300 p-4 text-sm font-bold bg-slate-50 rounded-sm" />
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Lorry ID</label>
                    <input list="f" placeholder="Select Fleet Object..." value={loriInput} onChange={(e)=>setLoriInput(e.target.value)} className="w-full border border-slate-300 p-4 text-sm rounded-sm" />
                    <datalist id="f">{(fleet || []).map(f => <option key={f} value={f}/>)}</datalist>
                </div>
                <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Time In</label>
                        <input type="time" value={startTime} onChange={(e)=>setStartTime(e.target.value)} className="w-full border border-slate-300 p-4 text-sm rounded-sm" />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Time Out</label>
                        <input type="time" value={endTime} onChange={(e)=>setEndTime(e.target.value)} className="w-full border border-slate-300 p-4 text-sm rounded-sm" />
                    </div>
                </div>
                <div className="flex items-center gap-4 p-5 bg-slate-50 border border-slate-200 cursor-pointer hover:bg-[#ebf3fc] transition-colors" onClick={()=>setRainCheck(!rainCheck)}>
                    <input type="checkbox" checked={rainCheck} readOnly className="w-7 h-7 accent-[#0078d4]" />
                    <span className="text-xs font-black uppercase text-slate-600 tracking-tighter">Rain Guarantee Triggered</span>
                </div>
                <button className="w-full bg-[#0078d4] text-white font-black py-6 rounded-sm text-xs tracking-[0.3em] hover:bg-[#106ebe] transition-all shadow-md">POST TO LEDGER</button>
              </form>

              <div className="lg:col-span-8 bg-white border border-slate-200 shadow-sm flex flex-col min-h-[650px] overflow-hidden">
                {lorisInMonth.length === 0 ? (
                    <div className="p-40 text-center text-slate-400">
                        <p className="italic text-xl font-light uppercase tracking-[0.3em]">No Transactions: {selMonth}</p>
                    </div>
                ) : (
                  <>
                    <div className="flex bg-slate-100 border-b border-slate-200 p-1 gap-1">
                      {lorisInMonth.map(id => (
                        <button key={id} onClick={() => setActiveTab(String(id))} className={`px-12 py-4 text-xs font-black uppercase transition-all tracking-widest ${activeTab === String(id) ? 'bg-white border-t-4 border-[#0078d4] text-[#0078d4] shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>Lorry {id}</button>
                      ))}
                    </div>
                    <div className="flex-grow">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                            <tr><th className="p-6">Trans Date</th><th className="p-6">Clock Range</th><th className="p-6">Billable</th><th className="p-6">Total Fee</th><th className="p-6 text-right">Admin</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {siteEntries.filter(e => String(e.loriId) === activeTab && String(e.date).startsWith(selMonth)).map(e => (
                            <tr key={e.id} className="hover:bg-slate-50 transition-colors">
                              <td className="p-6 font-bold text-slate-900">{e.date}</td>
                              <td className="p-6 font-mono text-slate-400 text-xs">{e.timeRange}</td>
                              <td className="p-6 font-black text-slate-800">{e.hours.toFixed(1)}h {e.isRain && <span className="ml-2">🌧️</span>}</td>
                              <td className="p-6 font-black text-green-700">RM {e.total.toFixed(2)}</td>
                              <td className="p-6 text-right">
                                <button onClick={() => updateData({workplaces: workplaces.map(s => s.id === activeSiteId ? {...s, entries: s.entries.filter(i => i.id !== e.id)} : s)})} className="text-red-400 hover:text-red-600 text-[10px] font-black tracking-widest uppercase border border-red-500/10 px-4 py-2 hover:bg-red-50">Void</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="bg-[#201f1e] p-12 text-white flex justify-between items-center border-t-8 border-[#0078d4]">
                        <div className="border-l-8 border-[#0078d4] pl-10">
                          <p className="text-xs font-black uppercase opacity-40 tracking-[0.3em] mb-3">Enterprise Receivable Summary</p>
                          <p className="text-3xl font-light tracking-tighter">Fleet Object <span className="font-black text-[#0078d4]">{activeTab}</span> | {selMonth}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs font-black uppercase opacity-40 mb-3 tracking-[0.3em]">Monthly Balance</p>
                            <p className="text-6xl font-light text-[#71af12]">RM {siteEntries.filter(e => String(e.loriId) === activeTab && String(e.date).startsWith(selMonth)).reduce((s, e) => s + e.total, 0).toFixed(2)}</p>
                        </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;