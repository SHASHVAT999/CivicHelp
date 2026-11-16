import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config';

function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [info, setInfo] = useState(
    new URLSearchParams(window.location.search).get('expired')
      ? 'Your session has expired. Please log in again.'
      : ''
  );
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const switchMode = (register) => { setIsRegister(register); setError(''); setInfo(''); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (isRegister && form.name.trim().length < 2) {
      return setError('Please enter your full name.');
    }
    if (isRegister && form.password.length < 6) {
      return setError('Password must be at least 6 characters.');
    }
    setLoading(true);
    try {
      const url = `${API_URL}/auth/${isRegister ? 'register' : 'login'}`;
      const payload = isRegister
        ? { name: form.name.trim(), email: form.email.trim(), password: form.password }
        : { email: form.email.trim(), password: form.password };
      const res = await axios.post(url, payload);
      if (isRegister) {
        setIsRegister(false);
        setForm({ name: '', email: payload.email, password: '' });
        setInfo('Account created. Log in with your new password.');
      } else {
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        // Citizens land on the home page; staff go straight to their desk
        navigate(res.data.user.role === 'citizen' ? '/' : '/dashboard');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    }
    setLoading(false);
  };

  return (
    <main className="auth">
      <section className="auth-side" aria-hidden="true">
        <div>
          <p className="kicker" style={{ color: '#a9a69b' }}>One desk, three roles</p>
          <h1 style={{ marginTop: 14 }}>Report it.<br />Fix it.<br /><span>Prove it.</span></h1>
        </div>
        <ul className="auth-points">
          <li><b>01</b>Citizens file reports with a photo and a pin, then confirm the fix.</li>
          <li><b>02</b>Ward officers triage the queue and assign field workers.</li>
          <li><b>03</b>Field workers close work orders with a photo of the finished job.</li>
        </ul>
      </section>

      <section className="auth-main">
        <div className="auth-form">
          <div className="tabs" role="tablist" aria-label="Account">
            <button type="button" role="tab" className="tab" aria-selected={!isRegister} onClick={() => switchMode(false)}>Log in</button>
            <button type="button" role="tab" className="tab" aria-selected={isRegister} onClick={() => switchMode(true)}>New citizen</button>
          </div>

          {info && <div className="notice notice-ok" role="status">{info}</div>}
          {error && <div className="notice notice-error" role="alert">{error}</div>}

          <form onSubmit={handleSubmit}>
            {isRegister && (
              <label className="field">
                <span className="field-label"><b>A</b> Full name</span>
                <input type="text" required autoComplete="name"
                  value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </label>
            )}
            <label className="field">
              <span className="field-label"><b>{isRegister ? 'B' : 'A'}</b> Email</span>
              <input type="email" required autoComplete="email"
                value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">
                <b>{isRegister ? 'C' : 'B'}</b> Password
                {isRegister && <span className="field-hint">at least 6 characters</span>}
              </span>
              <input type="password" required
                minLength={isRegister ? 6 : undefined}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            </label>
            <button type="submit" className="btn btn-ink btn-lg btn-block" disabled={loading}>
              {loading ? 'Please wait...' : isRegister ? 'Create citizen account' : 'Log in'}
            </button>
          </form>

          <p className="auth-foot">
            {isRegister
              ? 'Registration always creates a citizen account. Ward officers and field workers receive their logins from the administrator.'
              : 'Staff accounts are issued by the administrator. Citizens can create their own account.'}
          </p>
        </div>
      </section>
    </main>
  );
}

export default Login;
