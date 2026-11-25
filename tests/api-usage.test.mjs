import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrackedFetch } from '../supabase/functions/ocr-scanner/usage.mjs';
test('Gemini tokens include thoughts and fallback has a separate attempt', async () => {
  const events = [];
  const db = { rpc: async (_name, args) => { events.push(args); return {}; } };
  const tracked = createTrackedFetch(db,'user','request',async url => new Response(JSON.stringify(url==='gemini' ? { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30 } } : { responses: [{}] })));
  await tracked('gemini','model','gemini',{});
  await tracked('vision','DOCUMENT_TEXT_DETECTION','vision',{});
  assert.equal(events.length,2);
  assert.equal(events[0].p_input,100); assert.equal(events[0].p_output,50);
  assert.equal(events[1].p_units,1); assert.equal(events[1].p_request,events[0].p_request);
});
test('network failures are recorded with unknown usage and still throw', async () => {
  let event;
  const tracked = createTrackedFetch({ rpc: async (_n,args) => { event=args; return {}; } },'user','request',async () => { throw new Error('network'); });
  await assert.rejects(tracked('gemini','model','url',{}),/network/);
  assert.equal(event.p_outcome,'error'); assert.equal(event.p_input,null);
});
test('recording outage preserves a successful provider response', async () => {
  const tracked = createTrackedFetch({ rpc: async () => { throw new Error('database down'); } },'user','request',async () => new Response(JSON.stringify({ result: 'usable' })));
  assert.deepEqual(await tracked('gemini','model','url',{}),{ result: 'usable' });
});
