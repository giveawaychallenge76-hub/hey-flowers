/* ═══════════════════════════════════════════════════════════════════
   heyflowers — accounts & email collection (Supabase)

   The landing page is ALWAYS visible. Signing in is only required to
   actually create / send a gift — visitors can browse first, then the
   sign-in card slides up as a modal (like javii.tools).

   ── SET UP ──────────────────────────────────────────────────────────
   1. Project Settings → API: paste the Project URL + anon public key below.
   2. Authentication → Providers:
        · Email   — turn OFF "Confirm email" for instant sign-in
        · Google  — paste your Google OAuth client id + secret, enable
        · Apple   — paste your Apple service id + key, enable
      (Google/Apple stay greyed-out until you enable them in the dashboard.)
   3. Authentication → URL Configuration: add your deployed URL to the
      "Redirect URLs" list so Google/Apple can bounce users back.

   Every sign-up lands under Authentication → Users. To ALSO see them in a
   normal table (and power the admin dashboard) run supabase/schema.sql.
   ═══════════════════════════════════════════════════════════════════ */
const SUPABASE_URL      = 'https://qzobweooybjemvsjmmet.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6b2J3ZW9veWJqZW12c2ptbWV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MzU0NzUsImV4cCI6MjEwMDUxMTQ3NX0.0ZRwKt29i3V8k22TjMFNRzelnY9LCTo1PejHIfE0k88';

/* The client wants the BARE project URL — trim anything pasted after it
   (e.g. the "/rest/v1/" shown on the API settings page).                */
const HF_URL = String(SUPABASE_URL).trim().replace(/\/(rest|auth|storage)\/v\d.*$/i, '').replace(/\/+$/, '');
const HF_OK  = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(HF_URL) && /^ey[\w-]+\./.test(String(SUPABASE_ANON_KEY).trim());
const HF_SB  = (window.supabase && HF_OK)
  ? window.supabase.createClient(HF_URL, String(SUPABASE_ANON_KEY).trim())
  : null;
window.HF_SB = HF_SB;   // app.js uses the same client for drafts / uploads

(function(){
  const $ = id => document.getElementById(id);
  let mode = 'login';                       // 'login' | 'signup'
  let currentUser = null;

  /* ── modal open / close ─────────────────────────────────────────── */
  function openModal(m){
    if (!HF_SB){ return; }                  // nothing to sign into yet
    if (m) setMode(m);
    document.body.classList.add('auth-open');
    const el = $('authEmail'); if (el) setTimeout(() => el.focus(), 60);
  }
  function closeModal(){ document.body.classList.remove('auth-open'); msg(''); }

  /* logged in → reveal the app chrome (profile, editing) + close modal */
  function setAuthed(user){
    const was = currentUser && currentUser.id;
    currentUser = user || null;
    document.body.classList.toggle('authed', !!user);
    const e = $('userEmail'); if (e) e.textContent = user ? (user.email || 'you') : '@you';
    if (user){
      closeModal();
      // tell the app so it can resume the template they picked before signing in
      if (was !== user.id) document.dispatchEvent(new CustomEvent('hf:signedin'));
    }
  }

  function msg(text, ok){
    const m = $('authMsg'); if (!m) return;
    m.textContent = text || '';
    m.className = 'auth-msg' + (ok ? ' ok' : (text ? ' err' : ''));
  }
  function setMode(m){
    mode = m;
    $('tabLogin').classList.toggle('on',  m === 'login');
    $('tabSignup').classList.toggle('on', m === 'signup');
    $('authSubmit').textContent = m === 'login' ? 'Log in' : 'Create account';
    $('authPass').setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    $('authSwitch').innerHTML = m === 'login'
      ? "New here? <button type='button' id='goSignup'>Sign up</button>"
      : "Already have an account? <button type='button' id='goLogin'>Log in</button>";
    const gs = $('goSignup'); if (gs) gs.onclick = () => setMode('signup');
    const gl = $('goLogin');  if (gl) gl.onclick = () => setMode('login');
    msg('');
  }

  async function onSubmit(e){
    e.preventDefault();
    if (!HF_SB){ msg('Add your Supabase keys in auth.js to enable accounts.'); return; }
    const email = $('authEmail').value.trim();
    const password = $('authPass').value;
    if (!email || password.length < 6){ msg('Use a valid email and a password of 6+ characters.'); return; }
    const btn = $('authSubmit'); btn.disabled = true; msg('one sec…');
    try {
      if (mode === 'signup'){
        const { data, error } = await HF_SB.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) setAuthed(data.session.user);                 // confirmation OFF → straight in
        else msg('Check your email to confirm your account ✓', true);   // confirmation ON
      } else {
        const { data, error } = await HF_SB.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setAuthed(data.user);
      }
    } catch (err){ msg(err && err.message ? err.message : 'Something went wrong'); }
    finally { btn.disabled = false; }
  }

  async function logout(){ try { if (HF_SB) await HF_SB.auth.signOut(); } catch {} setAuthed(null); }

  /* one tap with Google / Apple — Supabase sends them to the provider and
     back to this same page, already signed in */
  async function oauth(provider){
    if (!HF_SB){ msg('Add your Supabase keys in auth.js to enable accounts.'); return; }
    msg('taking you to ' + provider + '…', true);
    const { error } = await HF_SB.auth.signInWithOAuth({
      provider,
      options: { redirectTo: location.origin + location.pathname }
    });
    if (error){
      msg(/provider is not enabled/i.test(error.message || '')
        ? `Turn on ${provider} in Supabase → Authentication → Providers first.`
        : error.message);
    }
  }

  /* app.js asks: is someone signed in? (when Supabase is unconfigured we
     don't gate at all, so the site stays usable) */
  window.HFAuth = {
    isIn:  () => !HF_SB || !!currentUser,
    open:  openModal,
    close: closeModal,
    user:  () => currentUser
  };

  function boot(){
    $('tabLogin').onclick  = () => setMode('login');
    $('tabSignup').onclick = () => setMode('signup');
    $('authForm').onsubmit = onSubmit;
    const lo = $('logoutBtn'); if (lo) lo.onclick = logout;

    /* open / close the modal */
    document.querySelectorAll('[data-auth-open]').forEach(b =>
      b.onclick = () => openModal(b.dataset.authOpen || 'login'));
    const x = $('authClose'); if (x) x.onclick = closeModal;
    const bk = $('authBackdrop'); if (bk) bk.onclick = closeModal;
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.body.classList.contains('auth-open')) closeModal();
    });

    /* Google / Apple */
    document.querySelectorAll('[data-oauth]').forEach(b =>
      b.onclick = () => oauth(b.dataset.oauth));

    setMode('login');

    if (!HF_SB){
      // not configured — let everything through, hide sign-in affordances
      document.body.classList.add('authed', 'auth-off');
      if (lo) lo.style.display = 'none';
      const n = $('authNote');
      if (n) n.textContent = 'Accounts are off until you add your Supabase keys in auth.js.';
      console.warn('[heyflowers] Supabase not configured — sign-in disabled. Add keys in auth.js.');
      return;
    }
    HF_SB.auth.getSession().then(({ data }) => setAuthed(data.session ? data.session.user : null));
    HF_SB.auth.onAuthStateChange((_e, session) => setAuthed(session ? session.user : null));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
