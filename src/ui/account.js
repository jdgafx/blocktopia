import { isRoomCode, normalizeRoomCode } from '../network/protocol.js';

/** Email/password access using the game's existing Supabase client. */
export function initAccount(client, { onChange, onError = () => {} }) {
  const panel = document.getElementById('account-panel');
  panel.innerHTML = `
    <section class="lobby-card" aria-labelledby="account-title">
      <p class="eyebrow">Your world is waiting</p>
      <h1 id="account-title">Blocktopia</h1>
      <p id="account-description" class="lede">Log in to play, build and invite friends.</p>
      <form id="account-form" class="room-actions">
        <label id="account-email-label" for="account-email">Email
          <input id="account-email" name="email" type="email" autocomplete="email" required maxlength="254" title="Use the email for your Blocktopia account." />
        </label>
        <label id="account-password-label" for="account-password">Password
          <input id="account-password" name="password" type="password" autocomplete="current-password" required title="Enter your account password." />
        </label>
        <button id="account-submit" type="submit" title="Log in and continue to the room lobby.">Log in</button>
      </form>
      <div class="account-links">
        <button id="account-switch" type="button" title="Register with an email and password.">Create account</button>
        <button id="account-forgot" type="button" title="Request an email link to reset your password.">Forgot password?</button>
      </div>
      <p id="account-status" role="status" aria-live="polite">Checking your account…</p>
    </section>`;
  const el = (id) => panel.querySelector(`#account-${id}`);
  const email = el('email');
  const password = el('password');
  const submit = el('submit');
  const switchButton = el('switch');
  const forgot = el('forgot');
  let user = null;
  let mode = 'login';
  let busy = true;
  let recovering = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
  const redirect = new URL(`${location.origin}${location.pathname}`);
  const invitedRoom = normalizeRoomCode(new URLSearchParams(location.search).get('room'));
  if (isRoomCode(invitedRoom)) redirect.searchParams.set('room', invitedRoom);
  const redirectTo = redirect.href;
  const callbackError = new URLSearchParams(location.hash.slice(1)).get('error_description');

  function status(message, error = false) {
    el('status').textContent = message;
    el('status').dataset.state = error ? 'error' : 'ready';
  }

  function report(error) {
    const message = !error?.message || error.message === 'Failed to fetch'
      ? 'Could not reach the account service. Check your connection and try again.' : error.message;
    status(message === 'Invalid login credentials' ? 'Email or password is incorrect. Try again or reset your password.' : message, true);
    onError(error);
  }

  function publish() {
    try {
      // Supabase invokes auth listeners under a lock; never await SDK work here.
      Promise.resolve(onChange(recovering ? null : user)).catch(report);
    } catch (error) { report(error); }
  }

  function setBusy(value) {
    busy = value;
    for (const control of [email, password, submit, switchButton, forgot]) control.disabled = value;
    el('form').setAttribute('aria-busy', String(value));
  }

  function show(nextMode) {
    mode = nextMode;
    password.value = '';
    email.required = mode !== 'reset';
    el('email-label').hidden = mode === 'reset';
    password.required = mode !== 'forgot';
    el('password-label').hidden = mode === 'forgot';
    password.minLength = mode === 'signup' || mode === 'reset' ? 8 : 1;
    password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    password.title = mode === 'login' ? 'Enter your account password.' : 'Choose a password with at least 8 characters.';
    submit.textContent = { login: 'Log in', signup: 'Create account', forgot: 'Send reset link', reset: 'Save new password' }[mode];
    submit.title = {
      login: 'Log in and continue to the room lobby.',
      signup: 'Register your account and check your email if confirmation is required.',
      forgot: 'Email a link that lets you choose a new password.',
      reset: 'Save your new password and continue to the room lobby.',
    }[mode];
    el('description').textContent = {
      login: 'Log in to play, build and invite friends.',
      signup: 'Create your account. Use a password with at least 8 characters.',
      forgot: 'Enter your email and we’ll send a password reset link.',
      reset: 'Choose a new password with at least 8 characters.',
    }[mode];
    switchButton.textContent = mode === 'login' ? 'Create account' : 'Back to log in';
    switchButton.title = mode === 'login' ? 'Register with an email and password.' : 'Return to the login form.';
    forgot.hidden = mode !== 'login';
    status('');
  }

  async function signOut() {
    const { error } = await client.auth.signOut();
    if (error) throw error;
    user = null;
    recovering = false;
    show('login');
    publish();
  }

  switchButton.addEventListener('click', async () => {
    if (busy) return;
    if (recovering) {
      setBusy(true);
      try { await signOut(); } catch (error) { report(error); }
      finally { setBusy(false); }
    } else show(mode === 'login' ? 'signup' : 'login');
  });
  forgot.addEventListener('click', () => { if (!busy) show('forgot'); });
  el('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !el('form').reportValidity()) return;
    setBusy(true);
    status('Please wait…');
    try {
      const credentials = { email: email.value.trim(), password: password.value };
      let result;
      if (mode === 'forgot') {
        result = await client.auth.resetPasswordForEmail(credentials.email, { redirectTo });
      } else if (mode === 'reset') {
        result = await client.auth.updateUser({ password: credentials.password });
      } else if (mode === 'signup') {
        result = await client.auth.signUp({ ...credentials, options: { emailRedirectTo: redirectTo } });
      } else {
        result = await client.auth.signInWithPassword(credentials);
      }
      if (result.error) throw result.error;
      if (mode === 'forgot') {
        status('If that email has an account, a reset link is on its way. Check your inbox and spam folder.');
      } else if (mode === 'reset') {
        user = result.data.user;
        recovering = false;
        show('login');
        status('Password updated. You’re ready to play.');
        publish();
      } else if (result.data.session) {
        user = result.data.session.user;
        status('You’re logged in.');
        publish();
      } else {
        show('login');
        status('Check your inbox for the confirmation link, then log in to play.');
      }
    } catch (error) { report(error); }
    finally {
      password.value = '';
      setBusy(false);
    }
  });

  setBusy(true);
  if (recovering) show('reset');
  if (!client) {
    status('Accounts are unavailable. The game’s account service needs to be configured.', true);
    queueMicrotask(publish);
  } else {
    client.auth.onAuthStateChange((event, session) => {
      user = session?.user ?? null;
      if (event === 'PASSWORD_RECOVERY') {
        recovering = true;
        show('reset');
      } else if (event === 'SIGNED_OUT') {
        recovering = false;
        show('login');
      }
      if (event === 'SIGNED_IN' && !recovering) password.value = '';
      publish();
    });
    client.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      user = data.session?.user ?? null;
      if (!user && recovering) {
        recovering = false;
        show('forgot');
        status('This reset link has expired. Request a new one.', true);
      } else if (callbackError) status(callbackError, true);
      else status('');
      publish();
    }).catch((error) => {
      user = null;
      publish();
      report(error);
    }).finally(() => setBusy(false));
  }

  return { get user() { return recovering ? null : user; }, signOut };
}
