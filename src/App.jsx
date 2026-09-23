import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from './supabaseClient';
import Analytics from './Analytics';
import Login from './Login';
import { LegalLinks } from './LegalNotices';

// PostgreSQL TIME columns return "HH:MM:SS" — trim to "HH:MM" for <input type="time">
const pgTime = (t) => (t ? t.slice(0, 5) : '');

// Keep recorded rest punches without requiring a database schema change.
// Existing rows remain "0800-1900"; rows with card-recorded rest use
// "0800-1900|1300-1400".
const parseStoredTimeRange = (value = '') => {
  const [workRange = '', restRange = ''] = String(value).split('|');
  const [timeIn = '', timeOut = ''] = workRange.split('-');
  const [restOut = '', restIn = ''] = restRange.split('-');
  return { timeIn, timeOut, restOut, restIn };
};

const formatStoredTimeRange = (timeIn, timeOut, restOut = '', restIn = '') => {
  const workRange = `${timeIn || ''}-${timeOut || ''}`;
  return restOut || restIn ? `${workRange}|${restOut || ''}-${restIn || ''}` : workRange;
};

const normalizeScannedTime = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const digits = String(value).replace(/\D/g, '').padStart(4, '0');
  if (digits.length !== 4) return '';
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2));
  return hours <= 23 && minutes <= 59 ? digits : '';
};

const toTimeInputValue = (value) => {
  const normalized = normalizeScannedTime(value);
  return normalized ? `${normalized.slice(0, 2)}:${normalized.slice(2)}` : '';
};

const createMonthBatch = (month) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`;
    return { id: date, date, in: '', restOut: '', restIn: '', out: '', isRain: false };
  });
};

const hasDayInput = (day) =>
  Boolean(day.in || day.restOut || day.restIn || day.out || day.isRain);

const mergeScannedDays = (currentRows, scannedRows) => {
  const scannedByDate = new Map(scannedRows.map((day) => [day.date, day]));
  return currentRows.map((day) => {
    const scanned = scannedByDate.get(day.date);
    if (!scanned) return day;
    return {
      ...day,
      in: day.in || scanned.in,
      restOut: day.restOut || scanned.restOut,
      restIn: day.restIn || scanned.restIn,
      out: day.out || scanned.out,
      isRain: scanned.isRain || day.isRain,
    };
  });
};

const EditIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 20h4l11-11a2 2 0 0 0-4-4L4 16v4Z" />
    <path strokeLinecap="round" d="m13.5 6.5 4 4" />
  </svg>
);

const TrashIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v6m4-6v6" />
  </svg>
);

const withFridayFallback = (site) => ({
  ...site,
  fStart: site.fStart || site.lStart,
  fEnd: site.fEnd || site.lEnd,
  fTh: site.fTh || site.lTh,
});

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
const mapEntry = (row) => {
  const { timeIn, timeOut, restOut, restIn } = parseStoredTimeRange(row.time_range);
  return {
    id: row.id,
    date: row.date,
    loriId: row.lori_id,
    timeRange: `${timeIn}-${timeOut}`,
    restOut,
    restIn,
    hours: Number(row.hours),
    rest: Number(row.rest),
    total: Number(row.total),
    isRain: row.is_rain,
  };
};

function App() {
  // --- 1. DATA CORE ---
  const [view, setView] = useState('home');
  const [activeSiteId, setActiveSiteId] = useState(null);
  const [showNewSiteForm, setShowNewSiteForm] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanNotice, setScanNotice] = useState('');
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
  const [loriInput, setLoriInput] = useState('');
  const [selMonth, setSelMonth] = useState(() => new Date().toISOString().substring(0, 7));
  const [previewBatch, setPreviewBatch] = useState(() => createMonthBatch(new Date().toISOString().substring(0, 7)));
  const [activeTab, setActiveTab] = useState(null);
  const filledDays = previewBatch.filter(hasDayInput).length;
  const invalidDraftDays = previewBatch.filter((day) => hasDayInput(day) && (
    (!day.isRain && (!day.in || !day.out)) ||
    Boolean(day.restOut) !== Boolean(day.restIn) ||
    [day.in, day.restOut, day.restIn, day.out].some((time) => time && !normalizeScannedTime(time))
  ));

  const [newSite, setNewSite] = useState({
    name: '', rate: 80, rainMin: 4.0,
    lStart: '13:00', lEnd: '14:00', lTh: '14:30',
    fStart: '', fEnd: '', fTh: '',
  });

  // Which ledger row is currently being edited inline (null = none)
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [editingValues, setEditingValues] = useState({
    date: '', in: '', restOut: '', restIn: '', out: '', isRain: false,
  });

  // Site settings edit modal
  const [showEditSiteForm, setShowEditSiteForm] = useState(false);
  const [editSiteValues, setEditSiteValues] = useState(null);

  // After saving site settings, ask whether to recalculate previous entries
  const [showApplyChoiceModal, setShowApplyChoiceModal] = useState(false);
  const [pendingEditSiteValues, setPendingEditSiteValues] = useState(null);

  const activeSite = workplaces.find((s) => s.id === activeSiteId) || null;
  const siteEntries = activeSite?.entries || [];

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
  const calculateDailyHours = (
    dateStr,
    timeIn,
    timeOut,
    isRainDay,
    site = activeSite,
    recordedRestOut = '',
    recordedRestIn = ''
  ) => {
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

    // A complete rest pair written on the card takes priority. The shift's
    // existing 30-minute clock-in/out rounding above is intentionally unchanged.
    if (recordedRestOut && recordedRestIn) {
      restH = Math.abs(
        getMins(recordedRestIn) - getMins(recordedRestOut)
      ) / 60;
      cH -= restH;
    } else {
      // Friday values are optional; missing fields inherit the usual rest rule.
      const effectiveSite = withFridayFallback(site);
      const cT = getMins(isF ? effectiveSite.fTh : effectiveSite.lTh);
      if (getMins(timeOut) >= cT) {
        restH = Math.abs(
          getMins(isF ? effectiveSite.fEnd : effectiveSite.lEnd) -
          getMins(isF ? effectiveSite.fStart : effectiveSite.lStart)
        ) / 60;
        cH -= restH;
      }
    }

    // Rain day guarantee: hours cannot fall below site's configured minimum
    const finalH = isRainDay ? Math.max(cH, parseFloat(site.rainMin)) : Math.max(0, cH);
    return { hours: finalH, rest: restH, total: finalH * site.rate };
  };

  // --- 4. AI SCANNER ENGINE ---
  const parseOCRText = (text) => {
    if (!text) return false;

    const lMatch = text.match(/(?:LOR[IY]|LORRY|#)\s*([A-Z0-9]+)/i);
    const bracketMatch = text.match(/\((.*?)\)/);
    const scannedLoriId = (lMatch?.[1] || bracketMatch?.[1] || '').trim().toUpperCase();
    if (scannedLoriId && loriInput.trim() && loriInput.trim().toUpperCase() !== scannedLoriId && filledDays > 0) {
      setScanError(`This card is marked ${scannedLoriId}, but the current draft is for ${loriInput.trim().toUpperCase()}. Finish or clear that draft before scanning another lorry.`);
      return null;
    }

    const lines = text.toLowerCase().split('\n');
    const newBatch = [];

    // Fix common OCR confusions, but only when adjacent to a real digit so
    // normal words ("lori", "hujan", "in/out") stay untouched: o→0, l/i→1
    const fixDigitConfusions = (s) => {
      // Repeat until stable so runs like "o8oo" fully resolve to "0800"
      let prev;
      do {
        prev = s;
        s = s
          .replace(/(?<=\d)o|o(?=\d)/g, '0')
          .replace(/(?<=\d)[li]|[li](?=\d)/g, '1');
      } while (s !== prev);
      return s;
    };

    // Pull every clock time out of a line. Handwritten cards use many
    // formats: "7am", "7.30am", "7:30 pm", "0800", "19:00", "8.00"
    const extractTimes = (line) => {
      const found = [];
      const taken = [];
      const overlaps = (start, end) => taken.some(([s, e]) => start < e && end > s);

      // 12-hour with am/pm, optional minutes
      for (const m of line.matchAll(/(\d{1,2})(?:[:.]\s?([0-5]\d))?\s*(am|pm)/g)) {
        let h = parseInt(m[1], 10);
        if (h > 12) continue;
        if (m[3] === 'pm' && h < 12) h += 12;
        if (m[3] === 'am' && h === 12) h = 0;
        found.push({ i: m.index, t: `${String(h).padStart(2, '0')}${m[2] || '00'}` });
        taken.push([m.index, m.index + m[0].length]);
      }

      // 24-hour with separator ("19:00", "8.30") or compact 4-digit ("0800")
      for (const m of line.matchAll(/\b(\d{1,2})[:.]([0-5]\d)\b|\b([01]\d|2[0-3])([0-5]\d)\b/g)) {
        const end = m.index + m[0].length;
        if (overlaps(m.index, end)) continue;
        const h = parseInt(m[1] ?? m[3], 10);
        if (h > 23) continue;
        found.push({ i: m.index, t: `${String(h).padStart(2, '0')}${m[2] ?? m[4]}` });
        taken.push([m.index, end]);
      }

      return found.sort((a, b) => a.i - b.i).map((x) => x.t);
    };

    // Vision returns isolated text without table-column meaning. Make common
    // handwritten sequences such as 9:00, 1:00, 2:00, 6:00 chronological so
    // they become 0900, 1300, 1400, 1800 instead of early-morning times.
    const makeChronological = (times) => {
      let previous = -1;
      return times.map((time) => {
        let minutes = getMins(time);
        while (previous >= 0 && minutes <= previous && minutes + 12 * 60 < 24 * 60) {
          minutes += 12 * 60;
        }
        previous = minutes;
        return `${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}`;
      });
    };

    lines.forEach((rawLine) => {
      const line = fixDigitConfusions(rawLine);
      const dayMatch = line.match(/^\s*([1-3][0-9]|[1-9])\b/);
      // Detect "rain" or "hujan" (Malay) anywhere on the line, case-insensitive
      const isRainLine = /\b(rain|hujan)\b/i.test(line);

      if (!dayMatch) return;

      const dayNumber = dayMatch[1].padStart(2, '0');
      const fullDate  = `${selMonth}-${dayNumber}`;

      // Search for times only after the day number so "1" in "13" etc.
      // can never be mistaken for a clock time
      const times = makeChronological(extractTimes(line.slice(dayMatch[0].length)));

      if (times.length >= 2) {
        // Normal day with clock times — mark rain if keyword present on the line
        newBatch.push({
          id: Date.now() + Math.random(),
          date: fullDate,
          in:   times[0],
          out:  times[times.length - 1],
          restOut: times.length >= 4 ? times[1] : '',
          restIn: times.length >= 4 ? times[times.length - 2] : '',
          isRain: isRainLine,
        });
      } else if (isRainLine) {
        // Rain day with no clock times — no in/out, rain minimum will apply on approval
        newBatch.push({
          id: Date.now() + Math.random(),
          date: fullDate,
          in:   '',
          restOut: '',
          restIn: '',
          out:  '',
          isRain: true,
        });
      }
    });

    const validDates = new Set(createMonthBatch(selMonth).map((day) => day.date));
    const validBatch = newBatch.filter((day) => validDates.has(day.date));
    if (validBatch.length > 0) {
      if (scannedLoriId) setLoriInput(scannedLoriId);
      setPreviewBatch((current) => mergeScannedDays(current, validBatch));
      return true;
    }
    return false;
  };

  // Convert structured rows from the Gemini-powered scanner into the
  // preview batch. Illegible fields arrive as null and stay blank for
  // the admin to fill in — the model is told never to guess.
  const applyScannedEntries = ({ entries, lori_id }) => {
    const daysInMonth = createMonthBatch(selMonth).length;
    const batch = entries
      .map((r) => ({ ...r, day: parseInt(r.day, 10) }))
      .filter((r) => r.day >= 1 && r.day <= daysInMonth && (
        r.time_in || r.rest_out || r.rest_in || r.time_out || r.rain
      ))
      .map((r) => ({
        date: `${selMonth}-${String(r.day).padStart(2, '0')}`,
        in: normalizeScannedTime(r.time_in),
        restOut: normalizeScannedTime(r.rest_out),
        restIn: normalizeScannedTime(r.rest_in),
        out: normalizeScannedTime(r.time_out),
        isRain: !!r.rain,
      }));
    if (batch.length === 0) return 0;
    if (lori_id) {
      const scannedLoriId = String(lori_id).trim().toUpperCase();
      if (loriInput.trim() && loriInput.trim().toUpperCase() !== scannedLoriId && filledDays > 0) {
        setScanError(`This card is marked ${scannedLoriId}, but the current draft is for ${loriInput.trim().toUpperCase()}. Finish or clear that draft before scanning another lorry.`);
        return null;
      }
      setLoriInput(scannedLoriId);
    }
    setPreviewBatch((current) => mergeScannedDays(current, batch));
    return batch.length;
  };

  // Gemini keeps physical cards separate so conflicting lorry IDs cannot be
  // silently mixed. After confirmation, overlapping day rows are de-duplicated
  // by retaining the row with the most readable fields.
  const applyScannedCards = ({ cards, warnings = [] }) => {
    const readableCards = cards.filter((card) => Array.isArray(card.entries) && card.entries.length > 0);
    const loriIds = [...new Set(readableCards
      .map((card) => String(card.lori_id || '').trim().toUpperCase())
      .filter(Boolean))];

    if (loriIds.length > 1) {
      const confirmed = window.confirm(
        `Gemini found punch cards with different Lorry IDs: ${loriIds.join(', ')}.\n\nAre these cards for the same lorry?\n\nPress OK to combine them, or Cancel to stop and upload them separately.`
      );
      if (!confirmed) {
        setScanError('Scan cancelled because the punch cards have different Lorry IDs. Upload each lorry separately.');
        return null;
      }
      setScanNotice(`Combined cards marked ${loriIds.join(' and ')}. Please verify the Lorry ID before posting.`);
    } else if (readableCards.length > 1) {
      setScanNotice(`Read ${readableCards.length} punch cards from this image. Please review all rows before posting.`);
    }

    if (warnings.length > 0) {
      setScanNotice((current) => [current, ...warnings].filter(Boolean).join(' '));
    }

    const completeness = (entry) => ['time_in', 'rest_out', 'rest_in', 'time_out']
      .reduce((score, field) => score + (entry[field] ? 1 : 0), entry.rain ? 1 : 0);
    const entriesByDay = new Map();
    readableCards.flatMap((card) => card.entries).forEach((entry) => {
      const day = parseInt(entry.day, 10);
      const existing = entriesByDay.get(day);
      if (!existing || completeness(entry) > completeness(existing)) entriesByDay.set(day, entry);
    });

    const count = applyScannedEntries({
      entries: [...entriesByDay.values()].sort((a, b) => Number(a.day) - Number(b.day)),
      lori_id: loriIds[0] || null,
    });
    return count === null ? null : count > 0;
  };

  // Upscale + grayscale + contrast-stretch the image before OCR.
  // Google Vision reads handwriting far better on large, high-contrast
  // input than on small dim phone photos.
  const preprocessImage = (file) =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        // Upscale so the longest side is ~2000px (never downscale, cap at 3x)
        const scale = Math.min(3, Math.max(1, 2000 / Math.max(img.width, img.height)));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Grayscale, building a histogram for the contrast stretch
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = imgData.data;
        const hist = new Array(256).fill(0);
        for (let i = 0; i < px.length; i += 4) {
          const g = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
          px[i] = px[i + 1] = px[i + 2] = g;
          hist[g]++;
        }
        // Stretch between the 1st and 99th percentile so faded pencil
        // becomes dark and paper becomes white, ignoring outlier pixels
        const totalPx = px.length / 4;
        let lo = 0, hi = 255, acc = 0;
        for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= totalPx * 0.01) { lo = v; break; } }
        acc = 0;
        for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= totalPx * 0.01) { hi = v; break; } }
        const range = Math.max(1, hi - lo);
        for (let i = 0; i < px.length; i += 4) {
          const v = Math.max(0, Math.min(255, ((px[i] - lo) / range) * 255));
          px[i] = px[i + 1] = px[i + 2] = v;
        }
        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
      };
      img.onerror = reject;
      img.src = url;
    });

  const processImage = async (file) => {
    setScanError('');
    setScanNotice('');
    if (!file || !file.type || !file.type.startsWith('image/')) {
      setScanError('Please attach an image file containing one or more punch cards.');
      return;
    }
    try {
      setIsScanning(true);
      const base64Image = await preprocessImage(file);
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
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.error) {
        throw new Error(result.error || 'The image could not be read. Please try a clearer punch-card photo.');
      }

      let applied = false;
      if (Array.isArray(result.cards)) {
        applied = applyScannedCards(result);
      } else if (Array.isArray(result.entries)) {
        // Gemini engine: structured rows, no regex parsing needed
        const count = applyScannedEntries(result);
        applied = count === null ? null : count > 0;
      } else if (result.text) {
        // Vision fallback: raw text through the regex parser
        applied = parseOCRText(result.text);
      }
      if (applied === false) {
        setScanError('No readable punch-card rows were found. Make sure the full card is visible and upload a clearer, well-lit image.');
      }
    } catch (err) {
      console.error('Cloud Error', err);
      setScanError(err.message || 'The image could not be read. Please try a clearer punch-card photo.');
    } finally {
      setIsScanning(false);
    }
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

  const clearDraft = () => {
    if ((filledDays > 0 || loriInput.trim()) && !window.confirm('Clear all unsaved entries for this month?')) return;
    setPreviewBatch(createMonthBatch(selMonth));
    setLoriInput('');
    setScanError('');
    setScanNotice('');
  };

  const changeMonth = (month) => {
    if (!month || month === selMonth) return;
    if ((filledDays > 0 || loriInput.trim()) && !window.confirm('Switch months and discard unsaved entries?')) return;
    setSelMonth(month);
    setPreviewBatch(createMonthBatch(month));
    setLoriInput('');
    setScanError('');
    setScanNotice('');
  };

  const approveBatch = async () => {
    if (filledDays === 0) {
      setScanError('Enter or scan at least one day before posting to the ledger.');
      return;
    }
    if (invalidDraftDays.length > 0) return;
    if (!activeSite || !loriInput.trim()) {
      alert('Please type a Lorry ID before approving the batch!');
      return;
    }

    const fId = loriInput.toUpperCase().trim();

    // Build database rows from the preview batch.
    // Include rain days even with no times — rain minimum hours still apply.
    const rowsToInsert = previewBatch
      .filter((day) => (
        String(day.in || '').trim() !== '' || String(day.restOut || '').trim() !== '' ||
        String(day.restIn || '').trim() !== '' || String(day.out || '').trim() !== '' || day.isRain
      ))
      .map((day) => {
        const math = calculateDailyHours(
          day.date, day.in, day.out, day.isRain, activeSite, day.restOut, day.restIn
        );
        return {
          workplace_id: activeSiteId,
          lori_id: fId,
          date: day.date,
          time_range: formatStoredTimeRange(day.in, day.out, day.restOut, day.restIn),
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
    setPreviewBatch(createMonthBatch(selMonth));
    setLoriInput('');
    setScanError('');
    setScanNotice('');
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

  const deleteLorryEntries = async (e, loriId) => {
    e.stopPropagation();
    const entryIds = siteEntries
      .filter((entry) => entry.loriId === loriId && String(entry.date).startsWith(selMonth))
      .map((entry) => entry.id);
    if (entryIds.length === 0) return;

    const confirmed = window.confirm(
      `Delete Lorry ${loriId} from ${selMonth}?\n\nThis will permanently remove all ${entryIds.length} ledger ${entryIds.length === 1 ? 'entry' : 'entries'} for this lorry in the selected month.`
    );
    if (!confirmed) return;

    const { error } = await supabase.from('entries').delete().in('id', entryIds);
    if (error) {
      console.error('Delete lorry entries error', error);
      alert('Could not delete this lorry: ' + error.message);
      return;
    }
    if (activeTab === loriId) setActiveTab(null);
    await loadData();
  };

  // Save an edited ledger row: recalculate hours/rest/total, then update Supabase
  const saveEntryEdit = async (entryId) => {
    const normalizedTimes = {
      in: normalizeScannedTime(editingValues.in),
      out: normalizeScannedTime(editingValues.out),
      restOut: normalizeScannedTime(editingValues.restOut),
      restIn: normalizeScannedTime(editingValues.restIn),
    };
    const math = calculateDailyHours(
      editingValues.date,
      normalizedTimes.in,
      normalizedTimes.out,
      editingValues.isRain,
      activeSite,
      normalizedTimes.restOut,
      normalizedTimes.restIn
    );
    const { error } = await supabase.from('entries').update({
      date: editingValues.date,
      time_range: formatStoredTimeRange(
        normalizedTimes.in, normalizedTimes.out, normalizedTimes.restOut, normalizedTimes.restIn
      ),
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
      saveEditSite('future', editSiteValues);
    }
  };

  // Persists site settings. If choice === 'all', recalculates every existing entry.
  const saveEditSite = async (choice, valuesOverride = null) => {
    setShowApplyChoiceModal(false);
    const vals = valuesOverride || pendingEditSiteValues;
    if (!vals) return;

    const effectiveVals = withFridayFallback(vals);
    const { error: siteErr } = await supabase.from('workplaces').update({
      name: vals.name,
      rate: vals.rate,
      rain_min: vals.rainMin,
      l_start: vals.lStart,
      l_end: vals.lEnd,
      l_threshold: vals.lTh,
      f_start: effectiveVals.fStart,
      f_end: effectiveVals.fEnd,
      f_threshold: effectiveVals.fTh,
    }).eq('id', activeSiteId);
    if (siteErr) { console.error('Site update error', siteErr); return; }

    if (choice === 'all' && activeSite.entries.length > 0) {
      // Upsert requires all non-nullable columns — include the full row so
      // PostgreSQL can match on the primary key and update only the calc fields
      const updates = activeSite.entries.map((entry) => {
        const { timeIn, timeOut } = parseStoredTimeRange(entry.timeRange);
        const math = calculateDailyHours(
          entry.date,
          timeIn,
          timeOut,
          entry.isRain,
          vals,
          entry.restOut,
          entry.restIn
        );
        return {
          id: entry.id,
          workplace_id: activeSiteId,
          lori_id: entry.loriId,
          date: entry.date,
          time_range: formatStoredTimeRange(
            timeIn, timeOut, entry.restOut, entry.restIn
          ),
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
    const daysInSelectedMonth = createMonthBatch(selMonth).length;
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
      for (let d = 1; d <= daysInSelectedMonth; d++) {
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
  const displayedEntries = siteEntries
    .filter((e) => e.loriId === activeTab && String(e.date).startsWith(selMonth))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
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
    <div className="min-h-screen flex flex-col bg-slate-100 p-3 pb-28 md:p-6 md:pb-16 font-sans text-slate-700">
      <div className="w-full max-w-[1800px] flex-1 mx-auto">

        {/* MODAL: New Site */}
        {showNewSiteForm && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-4xl p-6 sm:p-10 shadow-2xl rounded-sm border max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-8 border-b pb-4">
                <h3 className="font-bold text-xs uppercase text-blue-600">Site Configuration</h3>
                <button onClick={() => setShowNewSiteForm(false)} className="text-2xl">&times;</button>
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const effectiveNewSite = withFridayFallback(newSite);
                  const { error } = await supabase.from('workplaces').insert({
                    name: newSite.name,
                    rate: newSite.rate,
                    rain_min: newSite.rainMin,
                    l_start: newSite.lStart,
                    l_end: newSite.lEnd,
                    l_threshold: newSite.lTh,
                    f_start: effectiveNewSite.fStart,
                    f_end: effectiveNewSite.fEnd,
                    f_threshold: effectiveNewSite.fTh,
                  });
                  if (error) { console.error('Insert site error', error); return; }
                  setShowNewSiteForm(false);
                  setNewSite({
                    name: '', rate: 80, rainMin: 4.0,
                    lStart: '13:00', lEnd: '14:00', lTh: '14:30',
                    fStart: '', fEnd: '', fTh: '',
                  });
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12">
                  <div className="space-y-4 bg-slate-50 p-6 border">
                    <p className="text-[10px] font-black uppercase text-slate-500 border-b pb-2">Mon-Thu Lunch Logic</p>
                    <div className="grid grid-cols-2 gap-4">
                      <input type="time" value={newSite.lStart} onChange={(e) => setNewSite({ ...newSite, lStart: e.target.value })} className="border p-2 w-full" />
                      <input type="time" value={newSite.lEnd} onChange={(e) => setNewSite({ ...newSite, lEnd: e.target.value })} className="border p-2 w-full" />
                    </div>
                    <label className="text-[10px] font-bold uppercase text-blue-600">Deduct rest if Clock-Out after:</label>
                    <input type="time" value={newSite.lTh} onChange={(e) => setNewSite({ ...newSite, lTh: e.target.value })} className="w-full border p-2" />
                  </div>
                  <div className="bg-yellow-50/20 p-6 border border-yellow-100 space-y-4">
                    <div className="border-b pb-2">
                      <p className="text-[10px] font-black uppercase text-yellow-600">Friday Prayer Protocol (Optional)</p>
                      <p className="text-[10px] text-slate-400 mt-1">Leave blank to use the usual rest hours.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <input type="time" value={newSite.fStart} onChange={(e) => setNewSite({ ...newSite, fStart: e.target.value })} className="border p-2 w-full" />
                      <input type="time" value={newSite.fEnd} onChange={(e) => setNewSite({ ...newSite, fEnd: e.target.value })} className="border p-2 w-full" />
                    </div>
                    <label className="text-[10px] font-bold uppercase text-yellow-700">Deduct rest if Clock-Out after:</label>
                    <input type="time" value={newSite.fTh} onChange={(e) => setNewSite({ ...newSite, fTh: e.target.value })} className="w-full border p-2" />
                  </div>
                </div>
                <button type="submit" className="w-full border border-blue-700 bg-blue-600 text-white py-4 font-bold uppercase text-xs tracking-widest hover:bg-blue-700">Save Site Logic</button>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: Edit Site Settings */}
        {showEditSiteForm && editSiteValues && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-4xl p-6 sm:p-10 shadow-2xl rounded-sm border max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-8 border-b pb-4">
                <h3 className="font-bold text-xs uppercase text-blue-600">Edit Site Configuration</h3>
                <button type="button" aria-label="Close site settings" onClick={() => setShowEditSiteForm(false)} className="flex h-9 w-9 items-center justify-center border border-slate-200 bg-white text-2xl text-slate-600 hover:bg-slate-50">&times;</button>
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12">
                  <div className="space-y-4 bg-slate-50 p-6 border">
                    <p className="text-[10px] font-black uppercase text-slate-500 border-b pb-2">Mon-Thu Lunch Logic</p>
                    <div className="grid grid-cols-2 gap-4">
                      <input type="time" value={editSiteValues.lStart} onChange={(e) => setEditSiteValues({ ...editSiteValues, lStart: e.target.value })} className="border p-2 w-full" />
                      <input type="time" value={editSiteValues.lEnd} onChange={(e) => setEditSiteValues({ ...editSiteValues, lEnd: e.target.value })} className="border p-2 w-full" />
                    </div>
                    <label className="text-[10px] font-bold uppercase text-blue-600">Deduct rest if Clock-Out after:</label>
                    <input type="time" value={editSiteValues.lTh} onChange={(e) => setEditSiteValues({ ...editSiteValues, lTh: e.target.value })} className="w-full border p-2" />
                  </div>
                  <div className="bg-yellow-50/20 p-6 border border-yellow-100 space-y-4">
                    <div className="border-b pb-2">
                      <p className="text-[10px] font-black uppercase text-yellow-600">Friday Prayer Protocol (Optional)</p>
                      <p className="text-[10px] text-slate-400 mt-1">Clear any field to inherit its usual rest value.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <input type="time" value={editSiteValues.fStart} onChange={(e) => setEditSiteValues({ ...editSiteValues, fStart: e.target.value })} className="border p-2 w-full" />
                      <input type="time" value={editSiteValues.fEnd} onChange={(e) => setEditSiteValues({ ...editSiteValues, fEnd: e.target.value })} className="border p-2 w-full" />
                    </div>
                    <label className="text-[10px] font-bold uppercase text-yellow-700">Deduct rest if Clock-Out after:</label>
                    <input type="time" value={editSiteValues.fTh} onChange={(e) => setEditSiteValues({ ...editSiteValues, fTh: e.target.value })} className="w-full border p-2" />
                    <button
                      type="button"
                      onClick={() => setEditSiteValues({
                        ...editSiteValues, fStart: '', fEnd: '', fTh: '',
                      })}
                      className="border border-amber-300 bg-white px-3 py-2 text-[10px] font-bold uppercase text-yellow-700 hover:bg-amber-50"
                    >
                      Use usual rest hours
                    </button>
                  </div>
                </div>
                <button type="submit" className="w-full border border-blue-700 bg-blue-600 text-white py-4 font-bold uppercase text-xs tracking-widest hover:bg-blue-700">Save Changes</button>
              </form>
            </div>
          </div>
        )}

        {/* MODAL: Apply changes to previous entries? */}
        {showApplyChoiceModal && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md p-6 sm:p-10 shadow-2xl rounded-sm border max-h-[90vh] overflow-y-auto">
              <h3 className="font-bold text-sm uppercase text-slate-800 mb-3">Apply Changes to Previous Entries?</h3>
              <p className="text-xs text-slate-500 mb-8 leading-relaxed">
                You changed the rate or rest rules. Do you want to recalculate all existing entries for this site using the new settings?
              </p>
              <div className="space-y-3">
                <button onClick={() => saveEditSite('all')} className="w-full border border-blue-700 bg-blue-600 text-white py-4 font-bold text-xs uppercase tracking-widest hover:bg-blue-700">
                  Yes — Recalculate All Previous Entries
                </button>
                <button onClick={() => saveEditSite('future')} className="w-full border-2 border-slate-300 py-4 font-bold text-xs uppercase tracking-widest text-slate-600 hover:border-slate-500 transition-colors">
                  No — Apply to New Entries Only
                </button>
                <button onClick={() => { setShowApplyChoiceModal(false); setPendingEditSiteValues(null); }} className="w-full border border-red-200 bg-white py-2 font-bold text-xs uppercase text-red-600 hover:bg-red-50">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: Home Dashboard */}
        {view === 'home' ? (
          <div>
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-10 border-b pb-6">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tighter uppercase">Project Portfolio</h2>
              <div className="flex flex-wrap gap-3 items-center">
                <button onClick={() => setView('analytics')} className="border-2 border-slate-300 text-slate-600 px-8 py-2 font-bold uppercase text-xs hover:border-blue-600 hover:text-blue-600 transition-colors">Analytics</button>
                <button onClick={() => setShowNewSiteForm(true)} className="border border-blue-700 bg-blue-600 text-white px-8 py-2 font-bold uppercase text-xs hover:bg-blue-700">+ New Site</button>
                <button onClick={() => supabase.auth.signOut()} className="border border-slate-300 bg-white px-4 py-2 text-slate-600 hover:border-red-300 hover:text-red-600 font-bold uppercase text-xs tracking-widest transition-colors">Sign Out</button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              {workplaces.map((s) => (
                <div
                  key={s.id}
                  onClick={() => {
                    const latestMonth = [...new Set((s.entries || []).map((entry) => String(entry.date).substring(0, 7)))].sort().at(-1);
                    const month = latestMonth || new Date().toISOString().substring(0, 7);
                    setActiveSiteId(s.id);
                    setSelMonth(month);
                    setPreviewBatch(createMonthBatch(month));
                    setView('workplace');
                    setLoriInput('');
                    setEditingEntryId(null);
                  }}
                  className="bg-white p-10 border-2 hover:border-blue-600 cursor-pointer shadow-sm relative group transition-all"
                >
                  <button
                    onClick={(e) => deleteSite(e, s.id)}
                    aria-label={`Delete site ${s.name}`}
                    className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center border border-red-200 bg-white text-red-500 hover:bg-red-50 font-black text-lg"
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
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 border-b pb-4">
              <button disabled={isScanning} onClick={() => {
                if ((filledDays > 0 || loriInput.trim()) && !window.confirm('Leave this site and discard unsaved entries?')) return;
                setView('home');
                setPreviewBatch(createMonthBatch(selMonth));
                setLoriInput('');
                setEditingEntryId(null);
              }} className="border border-blue-200 bg-white px-3 py-2 text-blue-700 font-bold uppercase tracking-wide text-xs hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50">← Dashboard</button>
              <div className="flex flex-wrap gap-3 sm:gap-4">
                <input type="month" value={selMonth} disabled={isScanning} onChange={(e) => changeMonth(e.target.value)} className="bg-white border px-4 py-2 font-bold outline-none text-xs uppercase cursor-pointer disabled:opacity-50" />
                <button onClick={exportExcel} className="border border-green-800 bg-green-700 text-white px-5 py-2 font-black text-xs uppercase hover:bg-green-800">Excel Export</button>
              </div>
            </div>

            <header className="bg-blue-600 p-6 sm:p-12 text-white shadow-xl border-b-8 border-blue-800 relative">
              <h1 className="text-3xl sm:text-5xl md:text-7xl font-light uppercase tracking-tighter mb-4 pr-28 sm:pr-32 break-words">{activeSite?.name}</h1>
              <p className="font-bold text-xs opacity-60">RM {activeSite?.rate}/H | {activeSite?.rainMin}H MIN</p>
              <button onClick={openEditSite} className="absolute top-4 right-4 sm:top-6 sm:right-6 border border-white/60 bg-white/10 text-white hover:bg-white/20 px-3 sm:px-4 py-2 font-bold text-[10px] sm:text-xs uppercase tracking-widest transition-colors">
                Edit Site
              </button>
            </header>

            <div className="grid grid-cols-1 2xl:grid-cols-12 gap-4 lg:gap-6">

              {/* LEFT COLUMN: Scanner & Preview */}
              <div className="2xl:col-span-5 space-y-4">

                {scanError && (
                  <div role="alert" className="border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                    {scanError}
                  </div>
                )}
                {scanNotice && (
                  <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                    {scanNotice}
                  </div>
                )}

                  <div className="bg-white border shadow-sm flex flex-col max-h-[800px]">

                    <div className="p-4 border-b space-y-3 bg-slate-50">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="font-bold text-sm uppercase text-blue-600">Monthly Entry</h3>
                          <p className="text-xs text-slate-500">{filledDays} of {previewBatch.length} days filled</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            disabled={isScanning}
                            onClick={() => { setScanError(''); setScanNotice(''); fileInputRef.current.click(); }}
                            className="border border-blue-700 bg-blue-600 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isScanning ? 'Scanning...' : 'Scan Document'}
                          </button>
                          <button type="button" disabled={isScanning} onClick={clearDraft} className="border border-red-200 bg-white px-3 py-2 text-xs font-bold uppercase text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">Clear</button>
                        </div>
                      </div>
                      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
                      <input
                        placeholder="LORRY ID (e.g. LD)"
                        value={loriInput}
                        onChange={(e) => setLoriInput(e.target.value)}
                        className="w-full border p-2.5 font-bold text-sm"
                      />
                    </div>

                    <div className="overflow-y-auto overflow-x-auto flex-grow p-4">
                      <table className="w-full text-left text-xs min-w-[620px]">
                        <thead className="sticky top-0 bg-white shadow-sm text-[10px] text-slate-400 uppercase tracking-widest">
                          <tr>
                            <th className="py-3 px-2">Date</th>
                            <th className="py-3 px-2 text-center">Time In</th>
                            <th className="py-3 px-2 text-center">Rest Out</th>
                            <th className="py-3 px-2 text-center">Rest In</th>
                            <th className="py-3 px-2 text-center">Time Out</th>
                            <th className="py-3 px-2 text-center">Rain</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previewBatch.map((day) => (
                            <tr key={day.id} className="hover:bg-blue-50/50 transition-colors">
                              <td className="py-2 px-2">
                                <span className="block whitespace-nowrap font-mono text-slate-600">{day.date.split('-').reverse().join('/')}</span>
                              </td>
                              <td className="py-2 px-2">
                                <input
                                  value={day.in}
                                  onChange={(e) => updateBatchTime(day.id, 'in', e.target.value)}
                                  placeholder="0800"
                                  className="w-full border text-center font-mono p-2 outline-none focus:border-blue-500 bg-white"
                                  maxLength="4"
                                />
                              </td>
                              <td className="py-2 px-2">
                                <input
                                  value={day.restOut}
                                  onChange={(e) => updateBatchTime(day.id, 'restOut', e.target.value)}
                                  placeholder="1300"
                                  className="w-full border text-center font-mono p-2 outline-none focus:border-amber-500 bg-amber-50/30"
                                  maxLength="4"
                                />
                              </td>
                              <td className="py-2 px-2">
                                <input
                                  value={day.restIn}
                                  onChange={(e) => updateBatchTime(day.id, 'restIn', e.target.value)}
                                  placeholder="1400"
                                  className="w-full border text-center font-mono p-2 outline-none focus:border-amber-500 bg-amber-50/30"
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
                              <td className="py-2 px-2 text-center">
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
                      {invalidDraftDays.length > 0 && (
                        <p className="mb-3 text-xs font-medium text-red-600" role="alert">
                          Complete Time In and Time Out, enter rest times as a pair, and use valid times for day {invalidDraftDays.slice(0, 5).map((day) => Number(day.date.slice(-2))).join(', ')}{invalidDraftDays.length > 5 ? ` and ${invalidDraftDays.length - 5} more` : ''}.
                        </p>
                      )}
                      <button
                        onClick={approveBatch}
                        disabled={filledDays === 0 || invalidDraftDays.length > 0 || isScanning}
                        className="w-full border border-green-700 bg-green-600 text-white font-bold py-4 text-xs shadow-sm hover:bg-green-700 uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Approve & Post to Ledger
                      </button>
                    </div>

                  </div>
              </div>

              {/* RIGHT COLUMN: Ledger Table */}
              <div className="2xl:col-span-7 bg-white border shadow-sm min-h-[500px]">
                {lorisInMonth.length === 0 ? (
                  <div className="p-16 sm:p-40 text-center text-slate-300 italic uppercase font-light">Empty Ledger</div>
                ) : (
                  <>
                    <div className="flex overflow-x-auto gap-2 border-b bg-slate-50 p-2">
                      {lorisInMonth.map((id) => (
                        <div key={id} className="group relative flex-shrink-0">
                          <button
                            onClick={() => setActiveTab(id)}
                            className={`border px-4 py-2 pr-10 text-xs font-bold uppercase whitespace-nowrap ${activeTab === id ? 'border-blue-300 bg-white text-blue-700' : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300'}`}
                          >
                            Lorry {id}
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete Lorry ${id} entries for ${selMonth}`}
                            title={`Delete Lorry ${id} from this month`}
                            onClick={(e) => deleteLorryEntries(e, id)}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center border border-red-200 bg-red-50 text-base font-bold leading-none text-red-600 hover:bg-red-100"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="overflow-x-auto">
                    <table className="w-full table-fixed text-left min-w-[760px]">
                      <colgroup>
                        <col className="w-[18%]" />
                        <col className="w-[17%]" />
                        <col className="w-[15%]" />
                        <col className="w-[14%]" />
                        <col className="w-[21%]" />
                        <col className="w-[15%]" />
                      </colgroup>
                      <thead className="border-b bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                        <tr>
                          <th className="px-4 py-4">Date</th>
                          <th className="px-3 py-4 text-center">Time</th>
                          <th className="px-3 py-4 text-center">Rest (H)</th>
                          <th className="px-3 py-4 text-center">Billable</th>
                          <th className="px-3 py-4 text-center">Fee</th>
                          <th className="px-3 py-4 text-center">Actions</th>
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
                                  <td className="p-3">
                                    <div className="grid grid-cols-1 gap-2">
                                      <label className="text-[9px] font-bold uppercase text-slate-400">
                                        Work In
                                        <input
                                          type="time"
                                          value={editingValues.in}
                                          onChange={(ev) => setEditingValues({ ...editingValues, in: ev.target.value })}
                                          className="mt-1 border text-center font-mono p-2 text-xs outline-none focus:border-blue-500 w-full"
                                        />
                                      </label>
                                      <label className="text-[9px] font-bold uppercase text-slate-400">
                                        Work Out
                                        <input
                                          type="time"
                                          value={editingValues.out}
                                          onChange={(ev) => setEditingValues({ ...editingValues, out: ev.target.value })}
                                          className="mt-1 border text-center font-mono p-2 text-xs outline-none focus:border-blue-500 w-full"
                                        />
                                      </label>
                                    </div>
                                  </td>
                                  <td className="p-3 bg-amber-50/30">
                                    <div className="grid grid-cols-1 gap-2">
                                      <label className="text-[9px] font-bold uppercase text-amber-700">
                                        Lunch Out
                                        <input
                                          type="time"
                                          value={editingValues.restOut}
                                          onChange={(ev) => setEditingValues({ ...editingValues, restOut: ev.target.value })}
                                          className="mt-1 border text-center font-mono p-2 text-xs outline-none focus:border-amber-500 w-full bg-white"
                                        />
                                      </label>
                                      <label className="text-[9px] font-bold uppercase text-amber-700">
                                        Lunch In
                                        <input
                                          type="time"
                                          value={editingValues.restIn}
                                          onChange={(ev) => setEditingValues({ ...editingValues, restIn: ev.target.value })}
                                          className="mt-1 border text-center font-mono p-2 text-xs outline-none focus:border-amber-500 w-full bg-white"
                                        />
                                      </label>
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
                                    <div className="flex flex-wrap gap-1.5 justify-center">
                                      <button onClick={() => saveEntryEdit(e.id)} className="border border-blue-700 bg-blue-600 px-2.5 py-1.5 text-xs font-bold uppercase text-white hover:bg-blue-700">Save</button>
                                      <button onClick={() => setEditingEntryId(null)} className="border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold uppercase text-slate-600 hover:bg-slate-50">Cancel</button>
                                    </div>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="px-4 py-4 font-bold text-sm whitespace-nowrap text-slate-700">
                                    {String(e.date).split('-').reverse().join('/')}
                                    {e.isRain && <span className="ml-2 text-[9px] bg-blue-100 text-blue-600 font-black uppercase px-1.5 py-0.5 rounded tracking-wide">Rain</span>}
                                  </td>
                                  <td className="px-3 py-4 text-center text-slate-500 font-mono text-sm whitespace-nowrap">{e.timeRange}</td>
                                  <td className="px-3 py-3 text-center font-bold text-red-500 text-sm">
                                    {e.rest.toFixed(1)}h
                                    {e.restOut && e.restIn && (
                                      <span className="block text-[10px] text-amber-600 font-mono mt-1">
                                        {e.restOut}-{e.restIn}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-4 text-center font-black text-slate-800 text-sm">{e.hours.toFixed(1)}h</td>
                                  <td className="px-3 py-4 text-center font-black text-green-700 text-sm whitespace-nowrap">RM {e.total.toFixed(2)}</td>
                                  <td className="px-3 py-4 text-center">
                                    <div className="flex items-center justify-center gap-2">
                                      <button
                                        type="button"
                                        aria-label={`Edit entry for ${e.date}`}
                                        title="Edit entry"
                                        onClick={() => {
                                          const [tIn, tOut] = e.timeRange.split('-');
                                          setEditingEntryId(e.id);
                                          setEditingValues({
                                            date: e.date,
                                            in: toTimeInputValue(tIn),
                                            restOut: toTimeInputValue(e.restOut),
                                            restIn: toTimeInputValue(e.restIn),
                                            out: toTimeInputValue(tOut),
                                            isRain: e.isRain,
                                          });
                                        }}
                                        className="inline-flex h-8 w-8 items-center justify-center border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                      >
                                        <EditIcon />
                                      </button>
                                      <button
                                        type="button"
                                        aria-label={`Remove entry for ${e.date}`}
                                        title="Remove entry"
                                        onClick={() => deleteEntry(e.id)}
                                        className="inline-flex h-8 w-8 items-center justify-center border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                                      >
                                        <TrashIcon />
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
                          <td colSpan="3" className="px-4 py-4 font-black text-right uppercase text-xs text-blue-800">Monthly Total:</td>
                          <td className="px-3 py-4 text-center font-black text-blue-700 text-base">{totalMonthlyHours.toFixed(1)}h</td>
                          <td className="px-3 py-4 text-center font-black text-green-700 text-base whitespace-nowrap">RM {totalMonthlyFees.toFixed(2)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      <LegalLinks />
    </div>
  );
}

export default App;
