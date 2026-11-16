import React from 'react';
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { getStoredUser } from '../categories';

const roleLabels = { citizen: 'Citizen', officer: 'Ward officer', worker: 'Field worker' };
// Long label on wide screens, short one on phones so the bar never overflows
const deskLabels = { citizen: ['My reports', 'Reports'], officer: ['Complaint desk', 'Desk'], worker: ['Work orders', 'Orders'] };
const Label = ({ long, short }) => <><span className="lbl-long">{long}</span><span className="lbl-short">{short}</span></>;

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

  const linkClass = ({ isActive }) => `nav-link${isActive ? ' active' : ''}`;

  return (
    <header className="nav">
      <Link to="/" className="nav-brand" aria-label="CivicHelp home">
        <span className="plate" aria-hidden="true">CH</span>
        <span className="nav-word">CivicHelp</span>
      </Link>

      <nav className="nav-links" aria-label="Main">
        <NavLink to="/" end className={linkClass}>Overview</NavLink>
        <NavLink to="/map" className={linkClass}><Label long="Live map" short="Map" /></NavLink>
        {token && (
          <NavLink to="/dashboard" className={linkClass}>
            <Label long={(deskLabels[user.role] || deskLabels.citizen)[0]} short={(deskLabels[user.role] || deskLabels.citizen)[1]} />
          </NavLink>
        )}
      </nav>

      <div className="nav-side">
        {token && (
          <div className="nav-user">
            <b>{user.name}</b>
            <span>{roleLabels[user.role] || user.role}</span>
          </div>
        )}
        {!isStaff && <Link to="/report" className="btn btn-signal btn-sm"><Label long="Report a problem" short="Report" /></Link>}
        {token
          ? <button type="button" onClick={logout} className="btn btn-sm">Log out</button>
          : <Link to="/login" className="btn btn-sm">Log in</Link>}
      </div>
    </header>
  );
}

export default Navbar;
