import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from './supabaseClient';
import Analytics from './Analytics';
import Login from './Login';

// PostgreSQL TIME columns return "HH:MM:SS" — trim to "HH:MM" for <input type="time">
const pgTime = (t) => (t ? t.slice(0, 5) : '');

// Map a Supabase workplaces row (snake_case) to the app's camelCase shape
const mapWorkplace = (row) => ({
  id: row.id,
  name: row.name,
  rate: Number(row.rate),
  rainMin: Number(row.rain_min),
  lStart: pgTime(row.l_start),
  lEnd: pgTime(row.l_end),
  lTh: pgTime(row.l_threshold),
  fStart: pgTime(row.f_start),
  fEnd: pgTime(row.f_end),
  fTh: pgTime(row.f_threshold),
  entries: [],
});

// Map a Supabase entries row (snake_case) to the app's camelCase shape
const mapEntry = (row) => ({
  id: row.id,
  date: row.date,
  loriId: row.lori_id,
  timeRange: row.time_range,
  hours: Number(row.hours),
  rest: Number(row.rest),
  total: Number(row.total),
  isRain: row.is_rain,
});

function App() {
  // --- 1. DATA CORE ---
  const [view, setView] = useState('home');
  const [activeSiteId, setActiveSiteId] = useState(null);
  const [showNewSiteForm, setShowNewSiteForm] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const fileInputRef = useRef(null);

  const [workplaces, setWorkplaces] = useState([]);

  // session is null while checking auth, false when confirmed logged-out,
  // or a Supabase session object when logged in
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    // Restore existing session on page load
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null);
    });
    // Keep session in sync whenever the user signs in or out
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load data only once a valid session exists
  useEffect(() => {
    if (session) loadData();
  }, [session]);

  // Fetch all workplaces and their entries from Supabase.
  // Called on session start and after every mutation so local state
  // always reflects the database exactly.
  const loadData = async () => {
    setIsLoading(true);

    const [{ data: wpRows, error: wpErr }, { data: entRows, error: entErr }] =
      await Promise.all([
        supabase.from('workplaces').select('*').order('created_at'),
        supabase.from('entries').select('*').order('date', { ascending: false }),
      ]);

    if (wpErr || entErr) {
      console.error('Supabase load error', wpErr || entErr);
      setIsLoading(false);
      return;
    }

    // Nest each entry inside its parent workplace so the rest of the
    // app can keep using activeSite.entries without any changes.
    const mapped = wpRows.map((wp) => ({
      ...mapWorkplace(wp),
      entries: entRows.filter((e) => e.workplace_id === wp.id).map(mapEntry),
    }));

    setWorkplaces(mapped);
    setIsLoading(false);
  };


  // --- 2. INPUT & UI STATE ---
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [loriInput, setLoriInput] = useState('');
  const [previewBatch, setPreviewBatch] = useState([]);
  const [isManualMode, setIsManualMode] = useState(false);

  const [selMonth, setSelMonth] = useState(() => new Date().toISOString().substring(0, 7));
  const [activeTab, setActiveTab] = useState(null);

  const [newSite, setNewSite] = useState({
    name: '', rate: 80, rainMin: 4.0,
    lStart: '13:00', lEnd: '14:00', lTh: '14:30',
    fStart: '12:00', fEnd: '13:30', fTh: '15:30',
  });

  // Which ledger row is currently being edited inline (null = none)
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [editingValues, setEditingValues] = useState({ date: '', in: '', out: '', isRain: false });

  // Site settings edit modal
  const [showEditSiteForm, setShowEditSiteForm] = useState(false);
  const [editSiteValues, setEditSiteValues] = useState(null);

  // After saving site settings, ask whether to recalculate previous entries
  const [showApplyChoiceModal, setShowApplyChoiceModal] = useState(false);
  const [pendingEditSiteValues, setPendingEditSiteValues] = useState(null);

  const activeSite = workplaces.find((s) => s.id === activeSiteId) || null;
  const siteEntries = activeSite?.entries || [];
  const availableMonths = [...new Set(siteEntries.map((e) => String(e.date).substring(0, 7)))].sort().reverse();

  useEffect(() => {
    if (view === 'workplace' && activeSiteId) {
      setSelMonth(availableMonths[0] || new Date().toISOString().substring(0, 7));
    }
  }, [activeSiteId, view]);

  const lorisInMonth = [...new Set(
    siteEntries.filter((e) => String(e.date).startsWith(selMonth)).map((e) => e.loriId)
  )].sort();

  useEffect(() => {
    setEditingEntryId(null);
    if (lorisInMonth.length > 0) {
      if (!activeTab || !lorisInMonth.includes(activeTab)) setActiveTab(lorisInMonth[0]);
    } else {
      setActiveTab(null);
    }
  }, [selMonth, lorisInMonth.join(','), activeTab]);

  // --- 3. MATH ENGINE ---
  const getMins = (t) => {
    const clean = String(t || '').replace(/[:.]/g, '');
    if (clean.length < 3) return 0;
    return parseInt(clean.slice(0, -2)) * 60 + parseInt(clean.slice(-2));
  };

  // Optional `site` param lets callers pass a different config — used when
  // recalculating historical entries after a site settings change.
  const calculateDailyHours = (dateStr, timeIn, timeOut, isRainDay, site = activeSite) => {
    if (!site) return { hours: 0, rest: 0, total: 0 };
    // Rain day with no clock times: bill the guaranteed minimum hours with no rest deduction
    if ((!timeIn || !timeOut) && isRainDay) {
      const minH = parseFloat(site.rainMin);
      return { hours: minH, rest: 0, total: minH * site.rate };
    }
    if (!timeIn || !timeOut) return { hours: 0, rest: 0, total: 0 };

    let cH = 0, restH = 0;
    // Day-of-week check: getDay() === 5 means Friday (Jumaat prayer rules apply)
    const isF = new Date(dateStr).getDay() === 5;

    const sM = getMins(timeIn), eM = getMins(timeOut);
    cH = (Math.round(eM / 30) * 30 - Math.round(sM / 30) * 30) / 60;

    // Only deduct rest if clock-out is on or after the configured threshold
    const cT = getMins(isF ? site.fTh : site.lTh);
    if (getMins(timeOut) >= cT) {
      restH = Math.abs(
        getMins(isF ? site.fEnd : site.lEnd) -
        getMins(isF ? site.fStart : site.lStart)
      ) / 60;
      cH -= restH;
    }

    // Rain day guarantee: hours cannot fall below site's configured minimum
    const finalH = isRainDay ? Math.max(cH, parseFloat(site.rainMin)) : Math.max(0, cH);
    return { hours: finalH, rest: restH, total: finalH * site.rate };
  };

  // --- 4. AI SCANNER ENGINE ---
  const parseOCRText = (text) => {
    if (!text) return;

    const lMatch = text.match(/(?:LOR[IY]|LORRY|#)\s*([A-Z0-9]+)/i);
    const bracketMatch = text.match(/\((.*?)\)/);
    if (lMatch && lMatch[1]) setLoriInput(lMatch[1].toUpperCase());
    else if (bracketMatch && bracketMatch[1]) setLoriInput(bracketMatch[1].toUpperCase());

    const lines = text.toLowerCase().split('\n');
    const newBatch = [];

    const convertTo24H = (hour, modifier) => {
      let h = parseInt(hour, 10);
      if (modifier === 'pm' && h < 12) h += 12;
      if (modifier === 'am' && h === 12) h = 0;
      return `${h.toString().padStart(2, '0')}00`;
    };

    lines.forEach((line) => {
      const dayMatch   = line.match(/^([1-3][0-9]|[1-9])\b/);
      const timeMatches = [...line.matchAll(/(\d{1,2})\s*(am|pm)/g)];
      // Detect "rain" or "hujan" (Malay) anywhere on the line, case-insensitive
      const isRainLine = /\b(rain|hujan)\b/i.test(line);

      if (!dayMatch) return;

      const dayNumber = dayMatch[1].padStart(2, '0');
      const fullDate  = `${selMonth}-${dayNumber}`;

      if (timeMatches.length >= 2) {
        // Normal day with clock times — mark rain if keyword present on the line
        const firstTime = timeMatches[0];
        const lastTime  = timeMatches[timeMatches.length - 1];
        newBatch.push({
          id: Date.now() + Math.random(),
          date: fullDate,
          in:   convertTo24H(firstTime[1], firstTime[2]),
          out:  convertTo24H(lastTime[1],  lastTime[2]),
          isRain: isRainLine,
        });
      } else if (isRainLine) {
        // Rain day with no clock times — no in/out, rain minimum will apply on approval
        newBatch.push({
          id: Date.now() + Math.random(),
          date: fullDate,
          in:   '',
          out:  '',
          isRain: true,
        });
      }
    });

    if (newBatch.length > 0) setPreviewBatch(newBatch);
  };

  const processImage = async (file) => {
    if (!file || !file.type || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setIsScanning(true);
        const base64Image = reader.result.split(',')[1];
        const response = await fetch(
          'https://lpfxlrqrllpvlkmarham.supabase.co/functions/v1/ocr-scanner',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization':
                'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwZnhscnFybGxwdmxrbWFyaGFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NjgwNjcsImV4cCI6MjA5MjI0NDA2N30.0s2c8_4TdjY6Lw7vhdA36coDUNkyUbOGlDAZ8sha2bo',
            },
            body: JSON.stringify({ image: base64Image }),
          }
        );
        const result = await response.json();
        if (result.text) parseOCRText(result.text);
      } catch (err) {
        console.error('Cloud Error', err);
      } finally {
        setIsScanning(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) processImage(e.target.files[0]);
    e.target.value = null;
  };

  // --- 5. BATCH SUBMISSION LOGIC ---
  const toggleRainDay = (id) => {
    setPreviewBatch((prev) =>
      prev.map((item) => (item.id === id ? { ...item, isRain: !item.isRain } : item))
    );
  };

  const updateBatchTime = (id, field, newValue) => {
    setPreviewBatch((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: newValue } : item))
    );
  };

  const initializeManualBatch = () => {
    setIsManualMode(true);
    const emptyBatch = [];
    for (let i = 1; i <= 31; i++) {
      const dayStr = String(i).padStart(2, '0');
      emptyBatch.push({ id: `manual-${i}`, date: `${selMonth}-${dayStr}`, in: '', out: '', isRain: false });
    }
    setPreviewBatch(emptyBatch);
  };

  const approveBatch = async () => {
    if (!activeSite || !loriInput.trim()) {
      alert('Please type a Lorry ID before approving the batch!');
      return;
    }

    const fId = loriInput.toUpperCase().trim();

    // Build database rows from the preview batch.
    // Include rain days even with no times — rain minimum hours still apply.
    const rowsToInsert = previewBatch
      .filter((day) => day.in.trim() !== '' || day.out.trim() !== '' || day.isRain)
      .map((day) => {
        const math = calculateDailyHours(day.date, day.in, day.out, day.isRain);
        return {
          workplace_id: activeSiteId,
          lori_id: fId,
          date: day.date,
          time_range: `${day.in}-${day.out}`,
          hours: math.hours,
          rest: math.rest,
          total: math.total,
          is_rain: day.isRain,
        };
      });

    // ignoreDuplicates silently skips any row that conflicts with the
    // UNIQUE(workplace_id, lori_id, date) constraint instead of erroring
    const { error } = await supabase.from('entries').upsert(rowsToInsert, {
      onConflict: 'workplace_id,lori_id,date',
      ignoreDuplicates: true,
    });

    if (error) {
      console.error('Batch insert error', error);
      alert('Error saving entries: ' + error.message);
      return;
    }

    await loadData();
    setPreviewBatch([]);
    setLoriInput('');
  };

  // --- 6. DELETION LOGIC ---
  const deleteSite = async (e, siteId) => {
    e.stopPropagation();
    if (window.confirm('CRITICAL WARNING: Are you sure you want to delete this entire site and ALL of its records? This cannot be undone.')) {
      // ON DELETE CASCADE in the schema handles entries automatically
      const { error } = await supabase.from('workplaces').delete().eq('id', siteId);
      if (error) { console.error('Delete site error', error); return; }
      if (activeSiteId === siteId) setView('home');
      await loadData();
    }
  };

  const deleteEntry = async (entryId) => {
    if (window.confirm('Remove this entry from the ledger?')) {
      const { error } = await supabase.from('entries').delete().eq('id', entryId);
      if (error) { console.error('Delete entry error', error); return; }
      await loadData();
    }
  };

  // Save an edited ledger row: recalculate hours/rest/total, then update Supabase
  const saveEntryEdit = async (entryId) => {
    const math = calculateDailyHours(editingValues.date, editingValues.in, editingValues.out, editingValues.isRain);
    const { error } = await supabase.from('entries').update({
      date: editingValues.date,
      time_range: `${editingValues.in}-${editingValues.out}`,
      hours: math.hours,
      rest: math.rest,
      total: math.total,
      is_rain: editingValues.isRain,
    }).eq('id', entryId);
    if (error) { console.error('Entry update error', error); return; }
    setEditingEntryId(null);
    await loadData();
  };

  // Open the site edit modal pre-filled with the current site's values
  const openEditSite = () => {
    if (!activeSite) return;
    setEditSiteValues({ ...activeSite });
    setShowEditSiteForm(true);
  };

  // Called on edit-site form submit. Shows the recalculate choice modal only
  // when billing/rest fields actually changed and entries already exist.
  const handleEditSiteSave = (e) => {
    e.preventDefault();
    const recalcFields = ['rate', 'rainMin', 'lStart', 'lEnd', 'lTh', 'fStart', 'fEnd', 'fTh'];
    const needsRecalc = recalcFields.some((f) => String(editSiteValues[f]) !== String(activeSite[f]));
    setPendingEditSiteValues(editSiteValues);
    setShowEditSiteForm(false);
    if (needsRecalc && activeSite.entries.length > 0) {
      setShowApplyChoiceModal(true);
    } else {
      saveEditSite('future');
    }
  };

  // Persists site settings. If choice === 'all', recalculates every existing entry.
  const saveEditSite = async (choice) => {
    setShowApplyChoiceModal(false);
    const vals = pendingEditSiteValues;
    if (!vals) return;

    const { error: siteErr } = await supabase.from('workplaces').update({
      name: vals.name,
      rate: vals.rate,
      rain_min: vals.rainMin,
      l_start: vals.lStart,
      l_end: vals.lEnd,
      l_threshold: vals.lTh,
      f_start: vals.fStart,
      f_end: vals.fEnd,
      f_threshold: vals.fTh,
    }).eq('id', activeSiteId);
    if (siteErr) { console.error('Site update error', siteErr); return; }

    if (choice === 'all' && activeSite.entries.length > 0) {
      // Upsert requires all non-nullable columns — include the full row so
      // PostgreSQL can match on the primary key and update only the calc fields
      const updates = activeSite.entries.map((entry) => {
        const [tIn, tOut] = entry.timeRange.split('-');
        const math = calculateDailyHours(entry.date, tIn, tOut, entry.isRain, vals);
        return {
          id: entry.id,
          workplace_id: activeSiteId,
          lori_id: entry.loriId,
          date: entry.date,
          time_range: entry.timeRange,
          is_rain: entry.isRain,
          hours: math.hours,
          rest: math.rest,
          total: math.total,
        };
      });
      const { error: batchErr } = await supabase.from('entries').upsert(updates);
      if (batchErr) { console.error('Batch recalc error', batchErr); }
    }

    setPendingEditSiteValues(null);
    await loadData();
  };

  const exportExcel = () => {
    if (!activeSite) return;
    const wb = XLSX.utils.book_new();
    lorisInMonth.forEach((id) => {
      const rows = [
        ['LAND VISION TRADING'],
        [activeSite.name.toUpperCase()],
        [selMonth],
        [`LORI ID: ${id}`],
        [''],
        ['DAY', 'IN', 'OUT', 'REST', 'TOTAL'],
      ];
      let total = 0;
      for (let d = 1; d <= 31; d++) {
        const dStr = `${selMonth}-${String(d).padStart(2, '0')}`;
        const entry = siteEntries.find((i) => String(i.date) === dStr && i.loriId === id);
        if (entry) {
          const t = entry.timeRange.split('-');
          rows.push([d, t[0], t[1], entry.rest.toFixed(1), entry.hours.toFixed(1)]);
          total += entry.hours;
        } else {
          rows.push([d, '-', '-', '0.0', '0.0']);
        }
      }
      rows.push(
        [''],
        ['TOTAL HOURS', '', '', '', total.toFixed(1)],
        ['TOTAL FEE', '', '', '', 'RM ' + (total * activeSite.rate).toFixed(2)]
      );
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), id);
    });
    XLSX.writeFile(wb, `${activeSite.name}_${selMonth}.xlsx`);
  };

  // --- PREPARE LEDGER TOTALS ---
  const displayedEntries = siteEntries.filter(
    (e) => e.loriId === activeTab && String(e.date).startsWith(selMonth)
  );
  const totalMonthlyHours = displayedEntries.reduce((sum, e) => sum + e.hours, 0);
  const totalMonthlyFees = displayedEntries.reduce((sum, e) => sum + e.total, 0);

  // --- 7. RENDER ---
  // Still waiting for Supabase to confirm session status
  if (session === undefined) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="font-bold uppercase text-slate-400 tracking-widest animate-pulse">Loading...</p>
      </div>
    );
  }

  // No session — show the login wall
  if (!session) return <Login />;

  // Analytics page renders outside the main container so it controls its own layout
  if (view === 'analytics') {
    return <Analytics workplaces={workplaces} onBack={() => setView('home')} />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="font-bold uppercase text-slate-400 tracking-widest animate-pulse">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-10 font-sans text-slate-700">
      <div className="max-w-7xl mx-auto">

        {/* MODAL: New Site */}
        {showNewSiteForm && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-4xl p-10 shadow-2xl rounded-sm border">
              <div className="flex justify-between items-center mb-8 border-b pb-4">
                <h3 className="font-bold text-xs uppercase text-blue-600">Site Configuration</h3>
                <button onClick={() => setShowNewSiteForm(false)} className="text-2xl">&times;</button>
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const { error } = await supabase.from('workplaces').insert({
                    name: newSite.name,
                    rate: newSite.rate,
                    rain_min: newSite.rainMin,
                    l_start: newSite.lStart,
                    l_end: newSite.lEnd,
                    l_threshold: newSite.lTh,
                    f_start: newSite.fStart,
                    f_end: newSite.fEnd,
                    f_threshold: newSite.fTh,
                  });
                  if (error) { console.error('Insert site error', error); return; }
                  setShowNewSiteForm(false);
                  setNewSite({ name: '', rate: 80, rainMin: 4.0, lStart: '13:00', lEnd: '14:00', lTh: '14:30', fStart: '12:00', fEnd: '13:30', fTh: '15:30' });
                  await loadData();
                }}
                className="space-y-10"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400">Site Name</label>
                    <input required value={newSite.name} onChange={(e) => setNewSite({ ...newSite, name: e.target.value })} className="w-full border p-3 mt-1 outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400">Rate (RM/h)</label>
                    <input type="number" value={newSite.rate} onChange={(e) => setNewSite({ ...newSite, rate: parseFloat(e.target.value) })} className="w-full border p-3 mt-1 outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400">Rain Min (h)</label>
                    <input type="number" step="0.5" value={newSite.rainMin} onChange={(e) => setNewSite({ ...newSite, rainMin: parseFloat(e.target.value) })} className="w-full border p-3 mt-1 outline-none" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-12">
                  <div className="space-y-4 bg-slate-50 p-6 border">
                    <p className="text-[10px] font-black uppercase text-slate-500 border-b pb-2">Mon-Thu Lunch Logic</p>
                    <div className="grid grid-cols-2 gap-4">
                      <input type="time" value={newSite.lStart} onChange={(e) => setNewSite({ ...newSite, lStart: e.target.value })} className="border p-2" />
                      <input type="time" value={newSite.lEnd} onChange={(e) => setNewSite({ ...newSite, lEnd: e.target.value })} className="border p-2" />
                    </div>
                    <label className="text-[10px] font-bold uppercase text-blue-600">Deduct rest if Clock-Out after:</label>
                    <input type="time" value={newSite.lTh} onChange={(e) => setNewSite({ ...newSite, lTh: e.target.value })} className="w-full border p-2" />
                  </div>
                  <div className="bg-yellow-50/20 p-6 border border-yellow-100 space-y-4">
                    <p className="text-[10px] font-black uppercase text-yellow-600 border-b pb-2">Friday Prayer Protocol</p>
                    <div className="grid grid-cols-2 gap-4">
                      <input type="time" value={newSite.fStart} onChange={(e) => setNewSite({ ...newSite, fStart: e.target.value })} className="border p-2" />
                      <input type="time" value={newSite.fEnd} onChange={(e) => setNewSite({ ...newSite, fEnd: e.target.value })} className="border p-2" />
                    </div>
                    <label className="text-[10px] font-bold uppercase text-yellow-700">Deduct rest if Clock-Out after:</label>
                    <input type="time" value={newSite.fTh} onChange={(e) => setNewSite({ ...newSite, fTh: e.target.value })} className="w-full border p-2" />
                  </div>
                </div>
                <button type="submit" className="w-full bg-blue-600 text-white py-4 font-bold uppercase text-xs tracking-widest shadow-lg">Save Site Logic</button>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: Edit Site Settings */}
        {showEditSiteForm && editSiteValues && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-4xl p-10 shadow-2xl rounded-sm border">
              <div className="flex justify-between items-center mb-8 border-b pb-4">
                <h3 className="font-bold text-xs uppercase text-blue-600">Edit Site Configuration</h3>
                <button onClick={() => setShowEditSiteForm(false)} className="text-2xl">&times;</button>
              </div>
              <form onSubmit={handleEditSiteSave} className="space-y-10">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400">Site Name</label>
                    <input required value={editSiteValues.name} onChange={(e) => setEditSiteValues({ ...editSiteValues, name: e.target.value })} className="w-full border p-3 mt-1 outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400">Rate (RM/h)</label>
                    <input type="number" value={editSiteValues.rate} onChange={(e) => setEditSiteValues({ ...editSiteValues, rate: parseFloat(e.target.value) })} className="w-full border p-3 mt-1 outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase text-slate-400">Rain Min (h)</label>
                    <input type="number" step="0.5" value={editSiteValues.rainMin} onChange={(e) => setEditSiteValues({ ...editSiteValues, rainMin: parseFloat(e.target.value) })} className="w-full border p-3 mt-1 outline-none" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-12">
                  <div className="space-y-4 bg-slate-50 p-6 border">
                    <p className="text-[10px] font-black uppercase text-slate-500 border-b pb-2">Mon-Thu Lunch Logic</p>
                    <div className="grid grid-cols-2 gap-4">
                      <input type="time" value={editSiteValues.lStart} onChange={(e) => setEditSiteValues({ ...editSiteValues, lStart: e.target.value })} className="border p-2" />
                      <input type="time" value={editSiteValues.lEnd} onChange={(e) => setEditSiteValues({ ...editSiteValues, lEnd: e.target.value })} className="border p-2" />
                    </div>
                    <label className="text-[10px] font-bold uppercase text-blue-600">Deduct rest if Clock-Out after:</label>
                    <input type="time" value={editSiteValues.lTh} onChange={(e) => setEditSiteValues({ ...editSiteValues, lTh: e.target.value })} className="w-full border p-2" />
                  </div>
                  <div className="bg-yellow-50/20 p-6 border border-yellow-100 space-y-4">
                    <p className="text-[10px] font-black uppercase text-yellow-600 border-b pb-2">Friday Prayer Protocol</p>
                    <div className="grid grid-cols-2 gap-4">
                      <input type="time" value={editSiteValues.fStart} onChange={(e) => setEditSiteValues({ ...editSiteValues, fStart: e.target.value })} className="border p-2" />
                      <input type="time" value={editSiteValues.fEnd} onChange={(e) => setEditSiteValues({ ...editSiteValues, fEnd: e.target.value })} className="border p-2" />
                    </div>
                    <label className="text-[10px] font-bold uppercase text-yellow-700">Deduct rest if Clock-Out after:</label>
                    <input type="time" value={editSiteValues.fTh} onChange={(e) => setEditSiteValues({ ...editSiteValues, fTh: e.target.value })} className="w-full border p-2" />
                  </div>
                </div>
                <button type="submit" className="w-full bg-blue-600 text-white py-4 font-bold uppercase text-xs tracking-widest shadow-lg">Save Changes</button>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: Apply changes to previous entries? */}
        {showApplyChoiceModal && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md p-10 shadow-2xl rounded-sm border">
              <h3 className="font-bold text-sm uppercase text-slate-800 mb-3">Apply Changes to Previous Entries?</h3>
              <p className="text-xs text-slate-500 mb-8 leading-relaxed">
                You changed the rate or rest rules. Do you want to recalculate all existing entries for this site using the new settings?
              </p>
              <div className="space-y-3">
                <button onClick={() => saveEditSite('all')} className="w-full bg-blue-600 text-white py-4 font-bold text-xs uppercase tracking-widest shadow">
                  Yes — Recalculate All Previous Entries
                </button>
                <button onClick={() => saveEditSite('future')} className="w-full border-2 border-slate-300 py-4 font-bold text-xs uppercase tracking-widest text-slate-600 hover:border-slate-500 transition-colors">
                  No — Apply to New Entries Only
                </button>
                <button onClick={() => { setShowApplyChoiceModal(false); setPendingEditSiteValues(null); }} className="w-full text-red-400 py-2 font-bold text-xs uppercase hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: Home Dashboard */}
        {view === 'home' ? (
          <div>
            <div className="flex justify-between items-center mb-10 border-b pb-6">
              <h2 className="text-3xl font-bold tracking-tighter uppercase">Project Portfolio</h2>
              <div className="flex gap-3 items-center">
                <button onClick={() => setView('analytics')} className="border-2 border-slate-300 text-slate-600 px-8 py-2 font-bold uppercase text-xs hover:border-blue-600 hover:text-blue-600 transition-colors">Analytics</button>
                <button onClick={() => setShowNewSiteForm(true)} className="bg-blue-600 text-white px-8 py-2 font-bold uppercase text-xs shadow-md">+ New Site</button>
                <button onClick={() => supabase.auth.signOut()} className="text-slate-400 hover:text-red-500 font-bold uppercase text-xs tracking-widest transition-colors">Sign Out</button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              {workplaces.map((s) => (
                <div
                  key={s.id}
                  onClick={() => {
                    setActiveSiteId(s.id);
                    setView('workplace');
                    setPreviewBatch([]);
                    setLoriInput('');
                    setIsManualMode(false);
                    setEditingEntryId(null);
                  }}
                  className="bg-white p-10 border-2 hover:border-blue-600 cursor-pointer shadow-sm relative group transition-all"
                >
                  <button
                    onClick={(e) => deleteSite(e, s.id)}
                    className="absolute top-4 right-4 text-slate-300 hover:text-red-500 hidden group-hover:block font-black text-lg p-2"
                    title="Delete Site"
                  >
                    ✕
                  </button>
                  <h3 className="font-bold text-3xl text-slate-800">{s.name}</h3>
                  <div className="mt-12 text-right border-t pt-6">
                    <span className="text-3xl font-light text-green-700">
                      RM {(s.entries || []).reduce((a, b) => a + b.total, 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (

          /* VIEW: Workplace Ledger */
          <div className="space-y-6">
            <div className="flex justify-between items-center border-b pb-4">
              <button onClick={() => {
                setView('home');
                setPreviewBatch([]);
                setLoriInput('');
                setIsManualMode(false);
                setEditingEntryId(null);
              }} className="text-blue-600 font-bold uppercase tracking-widest text-xs">← Dashboard</button>
              <div className="flex gap-4">
                <input type="month" value={selMonth} onChange={(e) => setSelMonth(e.target.value)} className="bg-white border px-4 py-2 font-bold outline-none text-xs uppercase cursor-pointer" />
                <button onClick={exportExcel} className="bg-green-700 text-white px-8 py-2 font-black text-xs uppercase shadow-sm">Excel Export</button>
              </div>
            </div>

            <header className="bg-blue-600 p-12 text-white shadow-xl border-b-8 border-blue-800 relative">
              <h1 className="text-7xl font-light uppercase tracking-tighter mb-4">{activeSite?.name}</h1>
              <p className="font-bold text-xs opacity-60">RM {activeSite?.rate}/H | {activeSite?.rainMin}H MIN</p>
              <button onClick={openEditSite} className="absolute top-6 right-6 border border-white/40 text-white/70 hover:text-white hover:border-white px-4 py-2 font-bold text-xs uppercase tracking-widest transition-colors">
                Edit Site
              </button>
            </header>

            <div className="grid grid-cols-12 gap-8">

              {/* LEFT COLUMN: Scanner & Preview */}
              <div className="lg:col-span-4 space-y-4">

                {previewBatch.length === 0 && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-900 p-8 text-white relative shadow-xl col-span-2 md:col-span-1 border border-slate-900">
                      {isScanning && (
                        <div className="absolute inset-0 bg-blue-600 flex items-center justify-center font-bold text-sm uppercase tracking-widest animate-pulse">
                          Vision AI Active...
                        </div>
                      )}
                      <button
                        onClick={() => { setIsManualMode(false); fileInputRef.current.click(); }}
                        className="w-full bg-transparent text-white font-bold py-6 text-sm uppercase tracking-widest border-2 border-white hover:bg-white hover:text-slate-900 transition-colors"
                      >
                        Scan Document
                      </button>
                      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
                    </div>
                    <div
                      className="bg-white border-2 border-slate-200 p-8 shadow-sm col-span-2 md:col-span-1 flex items-center justify-center hover:border-blue-600 cursor-pointer transition-colors"
                      onClick={initializeManualBatch}
                    >
                      <span className="font-bold text-sm uppercase tracking-widest text-slate-600">Manual Entry</span>
                    </div>
                  </div>
                )}

                {previewBatch.length > 0 && (
                  <div className="bg-white border shadow-sm flex flex-col max-h-[800px]">

                    <div className="p-6 border-b space-y-4 bg-slate-50">
                      <div className="flex justify-between items-center">
                        <h3 className="font-bold text-sm uppercase text-blue-600">
                          {isManualMode ? 'Manual Grid' : `AI Scanned (${previewBatch.length} Days)`}
                        </h3>
                        <button onClick={() => { setPreviewBatch([]); setIsManualMode(false); }} className="text-red-500 font-bold text-[10px] hover:underline uppercase">Cancel</button>
                      </div>
                      <input
                        placeholder="LORRY ID (e.g. LD)"
                        value={loriInput}
                        onChange={(e) => setLoriInput(e.target.value)}
                        className="w-full border p-3 font-bold text-sm shadow-inner"
                      />
                    </div>

                    <div className="overflow-y-auto flex-grow p-4">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-white shadow-sm text-[10px] text-slate-400 uppercase tracking-widest">
                          <tr>
                            <th className="py-3 px-2">Date</th>
                            <th className="py-3 px-2 text-center">Time In</th>
                            <th className="py-3 px-2 text-center">Time Out</th>
                            <th className="py-3 px-2 text-center">Rain</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previewBatch.map((day) => (
                            <tr key={day.id} className="hover:bg-blue-50/50 transition-colors">
                              <td className="py-2 px-2 w-1/4">
                                <input
                                  type="date"
                                  value={day.date}
                                  onChange={(e) => updateBatchTime(day.id, 'date', e.target.value)}
                                  className="w-full border p-1.5 text-xs font-mono outline-none focus:border-blue-500 bg-white shadow-inner cursor-pointer"
                                />
                              </td>
                              <td className="py-2 px-2 w-1/4">
                                <input
                                  value={day.in}
                                  onChange={(e) => updateBatchTime(day.id, 'in', e.target.value)}
                                  placeholder="0800"
                                  className="w-full border text-center font-mono p-2 outline-none focus:border-blue-500 bg-white"
                                  maxLength="4"
                                />
                              </td>
                              <td className="py-2 px-2 w-1/4">
                                <input
                                  value={day.out}
                                  onChange={(e) => updateBatchTime(day.id, 'out', e.target.value)}
                                  placeholder="1900"
                                  className="w-full border text-center font-mono p-2 outline-none focus:border-blue-500 bg-white"
                                  maxLength="4"
                                />
                              </td>
                              <td className="py-2 px-2 w-1/4 text-center">
                                <input
                                  type="checkbox"
                                  checked={day.isRain}
                                  onChange={() => toggleRainDay(day.id)}
                                  className="w-5 h-5 accent-blue-600 cursor-pointer"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="p-4 border-t bg-slate-50">
                      <button
                        onClick={approveBatch}
                        className="w-full bg-green-600 text-white font-bold py-4 text-xs shadow-lg hover:bg-green-700 uppercase tracking-widest"
                      >
                        Approve & Post to Ledger
                      </button>
                    </div>

                  </div>
                )}
              </div>

              {/* RIGHT COLUMN: Ledger Table */}
              <div className="lg:col-span-8 bg-white border shadow-sm min-h-[500px]">
                {lorisInMonth.length === 0 ? (
                  <div className="p-40 text-center text-slate-300 italic uppercase font-light">Empty Ledger</div>
                ) : (
                  <>
                    <div className="flex bg-slate-100 p-1 gap-1">
                      {lorisInMonth.map((id) => (
                        <button
                          key={id}
                          onClick={() => setActiveTab(id)}
                          className={`px-10 py-3 text-xs font-bold uppercase ${activeTab === id ? 'bg-white text-blue-600 shadow-sm border-t-4 border-blue-600' : 'text-slate-400'}`}
                        >
                          Lorry {id}
                        </button>
                      ))}
                    </div>
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b text-xs font-bold text-slate-500 uppercase tracking-widest">
                        <tr>
                          <th className="p-6">Date</th>
                          <th className="p-6">Time</th>
                          <th className="p-6">Rest (H)</th>
                          <th className="p-6">Billable</th>
                          <th className="p-6 text-right">Fee</th>
                          <th className="p-6 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedEntries.map((e) => {
                          const isEditing = editingEntryId === e.id;
                          return (
                            <tr key={e.id} className={`border-b transition-colors ${isEditing ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                              {isEditing ? (
                                <>
                                  <td className="p-3">
                                    <input
                                      type="date"
                                      value={editingValues.date}
                                      onChange={(ev) => setEditingValues({ ...editingValues, date: ev.target.value })}
                                      className="border p-2 text-xs font-mono outline-none focus:border-blue-500 w-full"
                                    />
                                  </td>
                                  <td className="p-3" colSpan="2">
                                    <div className="flex gap-2">
                                      <input
                                        value={editingValues.in}
                                        onChange={(ev) => setEditingValues({ ...editingValues, in: ev.target.value })}
                                        placeholder="0800"
                                        maxLength="4"
                                        className="border text-center font-mono p-2 text-xs outline-none focus:border-blue-500 w-full"
                                      />
                                      <input
                                        value={editingValues.out}
                                        onChange={(ev) => setEditingValues({ ...editingValues, out: ev.target.value })}
                                        placeholder="1900"
                                        maxLength="4"
                                        className="border text-center font-mono p-2 text-xs outline-none focus:border-blue-500 w-full"
                                      />
                                    </div>
                                  </td>
                                  <td className="p-3 text-center">
                                    <input
                                      type="checkbox"
                                      checked={editingValues.isRain}
                                      onChange={(ev) => setEditingValues({ ...editingValues, isRain: ev.target.checked })}
                                      className="w-5 h-5 accent-blue-600 cursor-pointer"
                                      title="Rain day"
                                    />
                                  </td>
                                  <td className="p-3 text-right text-[10px] text-slate-400 italic">recalculated on save</td>
                                  <td className="p-3 text-center">
                                    <div className="flex gap-2 justify-center">
                                      <button onClick={() => saveEntryEdit(e.id)} className="bg-blue-600 text-white px-3 py-1 font-bold text-xs uppercase">Save</button>
                                      <button onClick={() => setEditingEntryId(null)} className="text-slate-400 hover:text-slate-600 font-bold text-xs uppercase">Cancel</button>
                                    </div>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="p-6 font-bold text-base text-slate-700">
                                    {e.date}
                                    {e.isRain && <span className="ml-2 text-[9px] bg-blue-100 text-blue-600 font-black uppercase px-1.5 py-0.5 rounded tracking-wide">Rain</span>}
                                  </td>
                                  <td className="p-6 text-slate-500 font-mono text-sm">{e.timeRange}</td>
                                  <td className="p-6 font-bold text-red-400 text-base">{e.rest.toFixed(1)}h</td>
                                  <td className="p-6 font-black text-slate-800 text-base">{e.hours.toFixed(1)}h</td>
                                  <td className="p-6 text-right font-black text-green-700 text-base">RM {e.total.toFixed(2)}</td>
                                  <td className="p-6 text-center">
                                    <div className="flex gap-3 justify-center">
                                      <button
                                        onClick={() => {
                                          const [tIn, tOut] = e.timeRange.split('-');
                                          setEditingEntryId(e.id);
                                          setEditingValues({ date: e.date, in: tIn, out: tOut, isRain: e.isRain });
                                        }}
                                        className="text-blue-400 hover:text-blue-600 font-bold text-xs tracking-widest uppercase transition-colors"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={() => deleteEntry(e.id)}
                                        className="text-red-400 hover:text-red-600 font-bold text-xs tracking-widest uppercase transition-colors"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-blue-50 border-t-2 border-blue-200">
                        <tr>
                          <td colSpan="3" className="p-6 font-black text-right uppercase text-sm text-blue-800">Monthly Total:</td>
                          <td className="p-6 font-black text-blue-700 text-lg">{totalMonthlyHours.toFixed(1)}h</td>
                          <td className="p-6 text-right font-black text-green-700 text-xl">RM {totalMonthlyFees.toFixed(2)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
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
