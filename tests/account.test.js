import { afterEach, expect, it, vi } from 'vitest';
import { initAccount } from '../src/ui/account.js';

function setup({ session = null, hash = '', search = '', error = null } = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      value: '', dataset: {}, handlers: {},
      addEventListener(type, handler) { this.handlers[type] = handler; },
      setAttribute: vi.fn(), reportValidity: () => true,
    });
    return elements.get(id);
  };
  const panel = { querySelector: (selector) => element(selector.slice(9)) };
  vi.stubGlobal('document', { getElementById: () => panel });
  vi.stubGlobal('location', { hash, search, origin: 'https://game.example', pathname: '/' });
  let emit;
  const auth = {
    onAuthStateChange: (handler) => { emit = handler; },
    getSession: vi.fn().mockResolvedValue({ data: { session }, error }),
    signInWithPassword: vi.fn(), signUp: vi.fn(), resetPasswordForEmail: vi.fn(), updateUser: vi.fn(),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
  const onChange = vi.fn();
  const account = initAccount({ auth }, { onChange });
  const submit = async () => element('form').handlers.submit({ preventDefault() {} });
  return { account, auth, onChange, element, submit, emit: (...args) => emit(...args) };
}

afterEach(() => vi.unstubAllGlobals());

it('restores a session and keeps it when sign out fails', async () => {
  const user = { id: 'player-1' };
  const { account, auth, onChange } = setup({ session: { user } });
  await vi.waitFor(() => expect(account.user).toEqual(user));
  expect(onChange).toHaveBeenLastCalledWith(user);
  auth.signOut.mockResolvedValueOnce({ error: new Error('Network unavailable') });
  await expect(account.signOut()).rejects.toThrow('Network unavailable');
  expect(account.user).toEqual(user);
  await account.signOut();
  expect(account.user).toBeNull();
  expect(onChange).toHaveBeenLastCalledWith(null);
});

it('keeps password recovery gated through token refresh until update succeeds', async () => {
  const user = { id: 'player-2' };
  const { account, auth, onChange, element, submit, emit } = setup();
  await vi.waitFor(() => expect(element('submit').disabled).toBe(false));
  emit('PASSWORD_RECOVERY', { user });
  element('password').value = 'in-progress-password';
  emit('TOKEN_REFRESHED', { user });
  emit('SIGNED_IN', { user });
  expect(element('password').value).toBe('in-progress-password');
  expect(account.user).toBeNull();
  expect(onChange).toHaveBeenLastCalledWith(null);
  expect(element('submit').textContent).toBe('Save new password');
  auth.updateUser.mockResolvedValueOnce({ error: new Error('Password is too weak') });
  element('password').value = 'weak-password';
  await submit();
  expect(element('status').textContent).toBe('Password is too weak');
  expect(account.user).toBeNull();
  expect(element('password').value).toBe('');
  auth.updateUser.mockResolvedValueOnce({ data: { user }, error: null });
  element('password').value = 'better-password-123';
  await submit();
  expect(auth.updateUser).toHaveBeenLastCalledWith({ password: 'better-password-123' });
  expect(account.user).toEqual(user);
  expect(onChange).toHaveBeenLastCalledWith(user);
});

it('handles signup confirmation, login errors and reset email through the SDK', async () => {
  const { account, auth, element, submit } = setup();
  await vi.waitFor(() => expect(element('submit').disabled).toBe(false));
  await element('switch').handlers.click();
  element('email').value = ' player@example.com ';
  element('password').value = 'new-password-123';
  auth.signUp.mockResolvedValueOnce({ data: { user: { id: 'unconfirmed' }, session: null }, error: null });
  await submit();
  expect(auth.signUp).toHaveBeenCalledWith({ email: 'player@example.com', password: 'new-password-123', options: { emailRedirectTo: 'https://game.example/' } });
  expect(account.user).toBeNull();
  expect(element('status').textContent).toContain('confirmation link');
  auth.signInWithPassword.mockResolvedValueOnce({ error: new Error('Invalid login credentials') });
  element('password').value = 'wrong-password';
  await submit();
  expect(element('status').textContent).toContain('Email or password is incorrect');
  expect(element('password').value).toBe('');
  element('forgot').handlers.click();
  auth.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null });
  await submit();
  expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('player@example.com', { redirectTo: 'https://game.example/' });
  expect(element('status').textContent).toContain('reset link is on its way');
});

it('makes failed initial restoration recoverable', async () => {
  const { account, element, onChange } = setup({ error: new Error('Session expired') });
  await vi.waitFor(() => expect(element('submit').disabled).toBe(false));
  expect(account.user).toBeNull();
  expect(onChange).toHaveBeenLastCalledWith(null);
  expect(element('status').textContent).toBe('Session expired');
});

it.each([
  ['?room=abc234&ignore=anything', 'https://game.example/?room=ABC234'],
  ['?room=invalid-long-code', 'https://game.example/'],
])('preserves only valid normalized room invites in account email redirects (%s)', async (search, redirectTo) => {
  const { auth, element, submit } = setup({ search });
  await vi.waitFor(() => expect(element('submit').disabled).toBe(false));
  await element('switch').handlers.click();
  element('email').value = 'player@example.com';
  element('password').value = 'password-123';
  auth.signUp.mockResolvedValueOnce({ data: { session: null }, error: null });
  await submit();
  expect(auth.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(redirectTo);
  element('forgot').handlers.click();
  auth.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null });
  await submit();
  expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('player@example.com', { redirectTo });
});
