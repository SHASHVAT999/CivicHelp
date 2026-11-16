import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import { Camera, MapPin, ClipboardCheck, CircleCheck } from 'lucide-react';
import { API_URL } from '../config';
import { CategoryIcon, STATUS } from '../categories';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

function getIcon(status) {
  const color = (STATUS[status] || STATUS.open).color;
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.35)"></div>`,
    iconSize: [12, 12],
  });
}

const steps = [
  { icon: Camera, title: 'Report', desc: 'A citizen takes a photo of the problem and describes it.' },
  { icon: MapPin, title: 'Locate', desc: 'The location is set from GPS, an address search or a click on the map.' },
  { icon: ClipboardCheck, title: 'Assign and fix', desc: 'The ward officer assigns a field worker, who uploads a photo of the completed work.' },
  { icon: CircleCheck, title: 'Confirm', desc: 'The citizen compares the before and after photos and confirms the fix, or reopens it.' },
];

function formatRelative(dateStr) {
  const t = new Date(dateStr).getTime();
  if (isNaN(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function Home() {
  const [complaints, setComplaints] = useState([]);
  const [loadError, setLoadError] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (location.hash) {
      const element = document.getElementById(location.hash.substring(1));
      if (element) element.scrollIntoView({ behavior: 'smooth' });
    }
  }, [location]);

  useEffect(() => {
    axios.get(`${API_URL}/complaints`)
      .then((res) => setComplaints(res.data))
      .catch((err) => { console.error('[Home] Failed to load complaints:', err); setLoadError(true); });
  }, []);

  const count = (status) => complaints.filter((c) => c.status === status).length;
  const stats = { total: complaints.length, open: count('open'), in_progress: count('in_progress'), resolved: count('resolved') };
  const resolutionRate = stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0;
  const byCategory = Object.entries(
    complaints.reduce((acc, c) => { acc[c.category] = (acc[c.category] || 0) + 1; return acc; }, {})
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <section className="home-hero">
        <div className="home-hero-text">
          <p className="eyebrow">Civic issue reporting</p>
          <h1 className="home-hero-title">Report local problems. Follow them until they are fixed.</h1>
          <p className="lead">
            Citizens report potholes, broken streetlights and other issues on a shared map.
            Ward officers assign field workers, workers upload proof of the repair, and the
            citizen confirms the result. Every change appears on the map immediately.
          </p>
          <div className="button-row">
            <Link to="/report" className="btn btn-primary">Report an issue</Link>
            <Link to="/map" className="btn btn-outline">Open the map</Link>
          </div>
          <p className="muted small">
            {loadError ? 'Live data is unavailable right now.' : `${stats.total} reports so far, ${stats.resolved} resolved.`}
          </p>
        </div>

        <div className="home-hero-map">
          <MapContainer center={[20.5937, 78.9629]} zoom={5} style={{ height: '100%', width: '100%' }} zoomControl={false}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors' />
            {complaints.map((c) => (
              <Marker key={c.id} position={[c.latitude, c.longitude]} icon={getIcon(c.status)}>
                <Popup>
                  <strong>{c.category}</strong>
                  {c.address && <div className="muted small">{c.address}</div>}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </section>

      <section id="impact" className="home-section">
        <div className="section-head">
          <h2>Current status</h2>
          <p className="muted">Live figures from the CivicHelp database.</p>
        </div>

        <div className="stat-row">
          {[
            { label: 'Total reports', value: stats.total },
            { label: 'Open', value: stats.open, color: STATUS.open.color },
            { label: 'In progress', value: stats.in_progress, color: STATUS.in_progress.color },
            { label: 'Resolved', value: stats.resolved, color: STATUS.resolved.color },
          ].map((s) => (
            <div key={s.label} className="stat">
              <div className="stat-label">
                {s.color && <span className="badge-dot" style={{ background: s.color }} />}
                {s.label}
              </div>
              <div className="stat-value">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="home-grid-3">
          <div className="panel">
            <h3 className="panel-title">Resolution rate</h3>
            <div className="stat-value">{resolutionRate}%</div>
            <p className="muted small">{stats.resolved} of {stats.total} reports resolved</p>
            <div className="meter"><div style={{ width: `${resolutionRate}%` }} /></div>
          </div>

          <div className="panel">
            <h3 className="panel-title">Reports by category</h3>
            {byCategory.length === 0 && <p className="muted small">No reports yet.</p>}
            {byCategory.map(([cat, n]) => (
              <div key={cat} className="bar-row">
                <div className="bar-label">
                  <span><CategoryIcon category={cat} size={14} /> {cat}</span>
                  <span className="tabular">{n}</span>
                </div>
                <div className="meter"><div style={{ width: `${(n / stats.total) * 100}%` }} /></div>
              </div>
            ))}
          </div>

          <div className="panel">
            <h3 className="panel-title">Latest reports</h3>
            {complaints.length === 0 && <p className="muted small">No reports yet.</p>}
            <ul className="plain-list">
              {complaints.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <div className="list-title"><CategoryIcon category={c.category} size={14} /> {c.category}</div>
                  <div className="muted small clamp-1">{c.address || 'Location on map'} · {formatRelative(c.created_at)}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="how" className="home-section home-section-alt">
        <div className="section-head">
          <h2>How it works</h2>
          <p className="muted">Three roles, one shared record of every issue.</p>
        </div>
        <ol className="steps">
          {steps.map(({ icon: Icon, title, desc }, i) => (
            <li key={title} className="step">
              <div className="step-head">
                <span className="step-num">{i + 1}</span>
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              </div>
              <h3>{title}</h3>
              <p className="muted">{desc}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="home-footer">
        <span className="brand-mark small-mark">C</span>
        <span className="muted small">CivicHelp - a student project in civic technology and DevOps.</span>
        <nav className="footer-links">
          <Link to="/map">Map</Link>
          <Link to="/report">Report an issue</Link>
          <Link to="/login">Log in</Link>
        </nav>
      </footer>
    </div>
  );
}

export default Home;
