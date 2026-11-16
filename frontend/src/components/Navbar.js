import React from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { getStoredUser } from '../categories';

const roleLabels = { citizen: 'Citizen', officer: 'Ward officer', worker: 'Field worker' };

function Navbar() {
  const navigate = useNavigate();
  useLocation(); // re-render on every navigation so login/logout is reflected immediately
  const token = localStorage.getItem('token');
  const user = getStoredUser();
  const isStaff = user.role === 'officer' || user.role === 'worker';

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const linkClass = ({ isActive }) => `navbar-link${isActive ? ' active' : ''}`;

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-brand-link" aria-label="CivicHelp home">
        <span className="brand-mark">C</span>
        <span className="navbar-brand">CivicHelp</span>
      </Link>

      <div className="navbar-links">
        <NavLink to="/" end className={linkClass}>Home</NavLink>
        <NavLink to="/map" className={linkClass}>Map</NavLink>
        {token && (
          <NavLink to="/dashboard" className={linkClass}>
            {user.role === 'citizen' ? 'My reports' : 'Dashboard'}
          </NavLink>
        )}
      </div>

      <div className="navbar-actions">
        {!isStaff && (
          <Link to="/report" className="btn btn-primary btn-small">
            <span>Report<span className="navbar-hide-mobile"> an issue</span></span>
          </Link>
        )}
        {token ? (
          <>
            <span className="navbar-user navbar-hide-mobile">
              {user.name}
              {user.role && <span className="navbar-role">{roleLabels[user.role] || user.role}</span>}
            </span>
            <button type="button" onClick={logout} className="btn btn-outline btn-small">Log out</button>
          </>
        ) : (
          <Link to="/login" className="btn btn-outline btn-small">Log in</Link>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
