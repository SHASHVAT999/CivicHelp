import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';

const roleLabels = { citizen: 'Citizen', officer: 'Ward Officer', worker: 'Field Worker' };

function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = localStorage.getItem('token');
  let user = {};
  try { user = JSON.parse(localStorage.getItem('user') || '{}') || {}; } catch { user = {}; }
  const isStaff = user.role === 'officer' || user.role === 'worker';

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const links = [
    { path: '/', label: 'Home' },
    { path: '/map', label: 'Live Map' },
    { path: '/#impact', label: 'Impact', secondary: true },
    { path: '/#how', label: 'How it Works', secondary: true },
  ];
  if (token) links.push({ path: '/dashboard', label: user.role === 'citizen' ? 'My Issues' : 'Dashboard' });

  const pillButton = {
    padding: '8px 18px', background: 'transparent', color: 'white',
    border: '1px solid rgba(255,255,255,0.2)', borderRadius: '100px',
    cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: 'inherit'
  };

  return (
    <nav className="navbar">
      {/* Logo */}
      <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          width: '36px', height: '36px',
          background: 'white',
          borderRadius: '10px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '16px', fontWeight: '800', color: '#0f172a'
        }}>C</div>
        <span className="navbar-brand" style={{ fontSize: '18px', fontWeight: '700', color: 'white' }}>CivicHelp</span>
      </Link>

      {/* Center Links */}
      <div className="navbar-links">
        {links.map(link => {
          const active = location.pathname === link.path && !location.hash;
          return (
            <Link key={link.path} to={link.path}
              className={`navbar-link${link.secondary ? ' navbar-link-secondary' : ''}${link.path === '/' ? ' navbar-link-home' : ''}`}
              style={{
                color: active ? 'white' : '#94a3b8',
                background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
              }}>{link.label}</Link>
          );
        })}
      </div>

      {/* Right Buttons */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0 }}>
        {!isStaff && (
          <Link to="/report">
            <button style={{ ...pillButton, background: '#ef4444', border: 'none' }}>
              Report<span className="navbar-hide-mobile"> Issue</span>
            </button>
          </Link>
        )}
        {token ? (
          <>
            <span className="navbar-hide-mobile" style={{ fontSize: '13px', color: '#94a3b8', marginLeft: '4px', textAlign: 'right', lineHeight: 1.3 }}>
              Hi, {user.name}
              {user.role && <span style={{ display: 'block', fontSize: '11px', color: '#64748b' }}>{roleLabels[user.role] || user.role}</span>}
            </span>
            <button onClick={logout} style={pillButton}>Logout</button>
          </>
        ) : (
          <Link to="/login">
            <button style={pillButton}>Login</button>
          </Link>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
