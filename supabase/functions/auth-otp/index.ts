import { createClient } from 'npm:@supabase/supabase-js@2.106.1';
import nodemailer from 'npm:nodemailer@7.0.12';
import { createOtpHandler, localSandbox } from './handler.mjs';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const isSandbox = localSandbox(url);
const origins = (Deno.env.get('AUTH_ALLOWED_ORIGINS') || 'https://punch-card-pro.vercel.app,http://localhost:5173,http://127.0.0.1:5173').split(',').map((value) => value.trim());
const smtpPort = Number(Deno.env.get('AUTH_SMTP_PORT') || '587');
const transporter = isSandbox ? null : nodemailer.createTransport({
  host: Deno.env.get('AUTH_SMTP_HOST'), port: smtpPort, secure: smtpPort === 465,
  requireTLS: smtpPort !== 465,
  auth: { user: Deno.env.get('AUTH_SMTP_USER'), pass: Deno.env.get('AUTH_SMTP_PASS') },
  connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
});

type IssueArguments = { emailKey: string; ipKey: string; purpose: string; challengeId: string; codeHash: string };
type VerifyArguments = Omit<IssueArguments, 'ipKey'>;
type EmailArguments = { email: string; code: string; purpose: string };

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw error;
  return data;
}

Deno.serve(createOtpHandler({
  secret: serviceKey,
  isSandbox,
  allowedOrigins: origins,
  store: {
    issue: ({ emailKey, ipKey, purpose, challengeId, codeHash }: IssueArguments) => rpc('auth_otp_issue', { p_email_key: emailKey, p_ip_key: ipKey, p_purpose: purpose, p_challenge_id: challengeId, p_code_hash: codeHash }),
    verify: ({ emailKey, purpose, challengeId, codeHash }: VerifyArguments) => rpc('auth_otp_verify', { p_email_key: emailKey, p_purpose: purpose, p_challenge_id: challengeId, p_code_hash: codeHash }),
  },
  auth: {
    findUser: (email: string) => rpc('auth_otp_find_user', { p_email: email }),
    createUser: async (email: string, password: string) => {
      const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
    },
    resetPassword: async (userId: string, email: string, password: string) => {
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) throw error;
      // A temporary session lets the admin API revoke every refresh session for this user.
      // It is never returned to the browser or written to storage.
      const isolated = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error: signInError } = await isolated.auth.signInWithPassword({ email, password });
      if (signInError || !data.session) {
        const failure = new Error('Reset session unavailable');
        failure.name = 'PasswordResetSessionsError';
        throw failure;
      }
      const { error: signOutError } = await admin.auth.admin.signOut(data.session.access_token, 'global');
      if (signOutError) {
        const failure = new Error('Session revocation failed');
        failure.name = 'PasswordResetSessionsError';
        throw failure;
      }
    },
  },
  sendEmail: async ({ email, code, purpose }: EmailArguments) => {
    if (isSandbox) return; // Local Supabase only; the documented code is always 123321.
    const from = Deno.env.get('AUTH_SMTP_FROM');
    if (!from || !Deno.env.get('AUTH_SMTP_HOST') || !Deno.env.get('AUTH_SMTP_USER') || !Deno.env.get('AUTH_SMTP_PASS')) throw new Error('SMTP configuration missing');
    await transporter!.sendMail({
      from, to: email,
      subject: purpose === 'signup' ? 'Verify your PunchCard Pro email' : 'Reset your PunchCard Pro password',
      text: `Your PunchCard Pro verification code is ${code}. It expires in 5 minutes and can be tried 3 times. If you did not request this code, ignore this email. Never share it with anyone.`,
    });
  },
}));
