import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Login from './pages/Login';
import MapPage from './pages/MapPage';
import ReportComplaint from './pages/ReportComplaint';
import Dashboard from './pages/Dashboard';
import axios from 'axios';
import './App.css';

// Expired or invalid session: clear credentials and send the user to login
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || '';
    if (status === 401 && localStorage.getItem('token') && !url.includes('/auth/')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.assign('/login?expired=1');
    }
    return Promise.reject(error);
  }
);

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" />;
};

// Unknown addresses get a real page instead of an empty screen
function NotFound() {
  return (
    <main className="section" style={{ minHeight: 'calc(100vh - var(--nav-h))', borderBottom: 'none' }}>
      <p className="kicker">Error 404 · road closed</p>
      <h1 style={{ fontSize: 'clamp(48px, 8vw, 110px)', margin: '12px 0 18px' }}>This street<br />isn&rsquo;t on the map.</h1>
      <p className="hero-lead">The page you asked for does not exist. It may have moved, or the link is mistyped.</p>
      <div className="hero-actions">
        <Link to="/" className="btn btn-ink btn-lg">Back to the overview</Link>
        <Link to="/map" className="link-arrow">Open the live map &rarr;</Link>
      </div>
    </main>
  );
}

function App() {
  return (
    <Router>
      <Navbar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/report" element={<ProtectedRoute><ReportComplaint /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
}

export default App;
