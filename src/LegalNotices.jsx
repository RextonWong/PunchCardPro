import React, { useState } from 'react';

const documents = {
  privacy: 'Privacy Notice',
  terms: 'Terms of Use',
  licenses: 'Third-Party Notices',
};

function PrivacyNotice() {
  return (
    <div className="space-y-6 text-sm leading-6 text-slate-700">
      <p className="text-xs text-slate-500">Last updated: 23 September 2026</p>
      <section>
        <p className="mt-2">PunchCard Pro processes information entered into the service to provide punch-card scanning, time and fee calculations, worksite ledgers, analytics, and exports.</p>
        <p className="mt-2"><strong>Information:</strong> account email and authentication data; worksite names and rates; lorry identifiers; dates, work/rest times, rain indicators, calculated hours and fees; and images of punch cards that you choose to upload. Punch cards may contain workers’ personal information.</p>
        <p className="mt-2"><strong>How it is processed:</strong> account and ledger data are stored in Supabase. When you request OCR, the selected image is sent through a Supabase Edge Function to Google Gemini; if that request fails or is unavailable, the function can send it to Google Cloud Vision as a fallback. The OCR result is returned to your browser for review. You should correct and approve extracted values before posting them.</p>
        <p className="mt-2"><strong>Purpose and sharing:</strong> data is used to operate the features above, secure the service, and troubleshoot errors. Supabase provides authentication/database hosting, and Google provides OCR processing. Upload only information you are authorised to process. Your information is not used for advertising.</p>
        <p className="mt-2"><strong>Retention and choices:</strong> ledger data remains in the service until you delete it or request account/data deletion. Uploaded images are processed for OCR; this app does not provide a user-facing image archive or a configured retention schedule for provider-side operational logs. Avoid uploading unnecessary personal details. Contact the operator to request access, correction, or deletion, subject to applicable law and records the operator must retain.</p>
        <p className="mt-2"><strong>Security and transfers:</strong> data may be processed outside Malaysia depending on provider infrastructure and configuration.</p>
        <p className="mt-2"><strong>Contact:</strong> Wong Lap Heng, <a href="mailto:rextonwonglapheng@gmail.com" className="text-blue-700 underline">rextonwonglapheng@gmail.com</a>, <a href="tel:+60179498208" className="text-blue-700 underline">017-949 8208</a>.</p>
      </section>
    </div>
  );
}

function TermsOfUse() {
  return (
    <div className="space-y-6 text-sm leading-6 text-slate-700">
      <section>
        <p className="mt-2">By accessing PunchCard Pro, you agree to use it lawfully and only for work you are authorised to manage. You are responsible for account security, the accuracy of information you enter, and having permission to upload punch cards and process information about workers.</p>
        <p className="mt-2">OCR is an assistance feature. It can misread handwriting, dates, lorry IDs, or times. Calculations depend on the values and site rules entered by the user. Review every scanned row and calculation before approving, exporting, or using it for payroll, invoices, payment, or employment decisions. The service is not a payroll, legal, or accounting authority.</p>
        <p className="mt-2">Do not misuse the service, attempt unauthorised access, or upload unlawful, malicious, or unrelated content. The operator may suspend access when reasonably necessary to protect the service or its users.</p>
        <p className="mt-2">PunchCard Pro’s original software, interface, branding, and documentation are protected by applicable intellectual-property laws. Rights in third-party software and marks remain with their respective owners. Use of the service does not transfer ownership of either party’s materials.</p>
        <p className="mt-2">The service may change or be unavailable. To the extent permitted by law, the operator disclaims implied warranties and is not liable for indirect loss arising from use of the service. Nothing in these terms excludes liability that cannot lawfully be excluded or limits your statutory rights.</p>
        <p className="mt-2">These terms are governed by the laws of Malaysia, subject to applicable consumer protections and the jurisdiction of Malaysian courts. For questions or complaints, contact Wong Lap Heng at <a href="mailto:rextonwonglapheng@gmail.com" className="text-blue-700 underline">rextonwonglapheng@gmail.com</a> or <a href="tel:+60179498208" className="text-blue-700 underline">017-949 8208</a>.</p>
      </section>
    </div>
  );
}

const licenses = [
  ['React / React DOM', 'MIT', 'https://github.com/facebook/react/blob/main/LICENSE'],
  ['Vite / @vitejs/plugin-react', 'MIT', 'https://github.com/vitejs/vite/blob/main/LICENSE'],
  ['Tailwind CSS', 'MIT', 'https://github.com/tailwindlabs/tailwindcss/blob/main/LICENSE'],
  ['Supabase JavaScript client', 'MIT', 'https://github.com/supabase/supabase-js/blob/master/LICENSE'],
  ['Recharts', 'MIT', 'https://github.com/recharts/recharts/blob/main/LICENSE'],
  ['SheetJS Community Edition (xlsx)', 'Apache-2.0', 'https://git.sheetjs.com/SheetJS/sheetjs/src/branch/master/LICENSE'],
  ['FileSaver.js', 'MIT', 'https://github.com/eligrey/FileSaver.js/blob/master/LICENSE.md'],
  ['Tesseract.js (installed; not currently used by the app)', 'Apache-2.0', 'https://github.com/naptha/tesseract.js/blob/master/LICENSE.md'],
];

function ThirdPartyNotices() {
  return (
    <div className="space-y-4 text-sm leading-6 text-slate-700">
      <p>PunchCard Pro includes or is distributed with the following direct application dependencies. Each remains subject to its own license; follow the linked license text and include required notices with redistributed builds. This list is not a complete inventory of transitive dependencies.</p>
      <ul className="divide-y border-y">
        {licenses.map(([name, license, url]) => (
          <li key={name} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span><strong>{name}</strong> — {license}</span>
            <a className="text-blue-700 underline" href={url} target="_blank" rel="noreferrer">License text</a>
          </li>
        ))}
      </ul>
      <p>Third-party names and marks belong to their respective owners. Their appearance here does not imply endorsement.</p>
    </div>
  );
}

export function LegalLinks() {
  const [open, setOpen] = useState('');
  const content = open === 'privacy' ? <PrivacyNotice /> : open === 'terms' ? <TermsOfUse /> : <ThirdPartyNotices />;

  return (
    <>
      <footer className="fixed inset-x-0 bottom-0 z-40 mx-auto flex w-full max-w-[1800px] flex-wrap items-center justify-center gap-x-5 gap-y-2 bg-slate-100 px-4 py-4 text-xs text-slate-500">
        <span>© 2026 PunchCard Pro. All rights reserved.</span>
        {Object.entries(documents).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setOpen(id)} className="underline underline-offset-2 hover:text-blue-700">{label}</button>
        ))}
      </footer>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-3 sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(''); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="legal-title" className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded bg-white shadow-2xl">
            <header className="flex items-center justify-between gap-4 border-b p-5 sm:px-7">
              <h2 id="legal-title" className="text-base font-black text-slate-900">{documents[open]}</h2>
              <button type="button" aria-label="Close" onClick={() => setOpen('')} className="flex h-9 w-9 items-center justify-center border border-slate-200 bg-white text-2xl leading-none text-slate-600 hover:bg-slate-50">&times;</button>
            </header>
            <div className="overflow-y-auto p-5 sm:p-7">{content}</div>
          </section>
        </div>
      )}
    </>
  );
}
