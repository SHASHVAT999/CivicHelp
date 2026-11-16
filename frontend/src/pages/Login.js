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
        setInfo('Account created. You can log in now.');
      } else {
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        // Citizens land on the home page; staff go straight to their dashboard
        navigate(res.data.user.role === 'citizen' ? '/' : '/dashboard');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    }
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-box">
        <h1 className="page-title">{isRegister ? 'Create an account' : 'Log in'}</h1>
        <p className="muted page-sub">
          {isRegister
            ? 'Citizen accounts can report issues and follow them. Staff accounts are created by the administrator.'
            : 'Citizens, ward officers and field workers all log in here.'}
        </p>

        <div className="card">
          {info && <div className="success">{info}</div>}
          {error && <div className="error" role="alert">{error}</div>}
          <form onSubmit={handleSubmit}>
            {isRegister && (
              <>
                <label htmlFor="name">Full name</label>
                <input id="name" type="text" required autoComplete="name"
                  value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </>
            )}
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email"
              value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" required
              placeholder={isRegister ? 'At least 6 characters' : ''}
              minLength={isRegister ? 6 : undefined}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
              {loading ? 'Please wait...' : isRegister ? 'Create account' : 'Log in'}
            </button>
          </form>

          <p className="auth-switch muted">
            {isRegister ? 'Already have an account?' : 'New to CivicHelp?'}
            <button type="button" className="link-button"
              onClick={() => { setIsRegister(!isRegister); setError(''); setInfo(''); }}>
              {isRegister ? 'Log in' : 'Create a citizen account'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
