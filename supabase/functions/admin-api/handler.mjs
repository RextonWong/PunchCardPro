export async function handleAdmin(req, db) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Cache-Control': 'no-store' };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer /i, '');
    if (!token) return reply(401, { error: 'Sign in required' });
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return reply(401, { error: 'Sign in required' });
    const { data: role, error: roleError } = await db.from('app_admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
    if (roleError) throw roleError;
    if (!role) return reply(403, { error: 'Administrator access required' });
    const body = await req.json();
    if (body.action === 'users') {
      const page = Number(body.page || 1);
      const days = Number(body.days || 30);
      if (!Number.isInteger(page) || page < 1 || page > 10000 || ![7,30,90].includes(days)) return reply(400, { error: 'Invalid filters' });
      const result = await db.rpc('admin_users', { p_search: String(body.search || '').slice(0,200), p_page: page, p_since: new Date(Date.now()-days*86400000).toISOString() });
      if (result.error) throw result.error;
      return reply(200, result.data);
    }
    if (body.action === 'audit') {
      const result = await db.from('admin_audit').select('id,actor_id,target_id,action,created_at').order('created_at', { ascending: false }).limit(50);
      if (result.error) throw result.error;
      return reply(200, { events: result.data });
    }
    if (['suspend','restore'].includes(body.action)) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.userId || '')) return reply(400, { error: 'Invalid user' });
      if (data.user.id === body.userId) return reply(400, { error: 'You cannot suspend your own account' });
      const result = await db.rpc('admin_set_suspended', { p_actor: data.user.id, p_target: body.userId, p_suspended: body.action === 'suspend' });
      if (result.error) return reply(400, { error: 'Account change rejected. Administrator accounts cannot be suspended.' });
      return reply(200, { success: true });
    }
    return reply(400, { error: 'Unknown action' });
  } catch { return reply(500, { error: 'Admin service unavailable. Please try again.' }); }
}
