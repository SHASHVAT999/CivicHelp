import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import axios from 'axios';
import { API_URL } from '../config';
import { CATEGORIES, CategoryIcon, STATUS, StatusChip, refNo, timeAgo } from '../categories';
import 'leaflet/dist/leaflet.css';

const journey = [
  { role: 'Citizen', title: 'Reported', text: 'A photo, a short description and a pin on the map. The report is public the moment it is filed.' },
  { role: 'Ward officer', title: 'Assigned', text: 'The ward officer reviews the queue and gives the report to a field worker.' },
  { role: 'Field worker', title: 'Fixed', text: 'The worker repairs it and files a photo of the finished work. No photo, no closure.' },
  { role: 'Citizen', title: 'Confirmed', text: 'The person who reported it compares before and after, then confirms the fix or sends it back.' },
];

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
  const rate = stats.total ? Math.round((stats.resolved / stats.total) * 100) : 0;
  const perCategory = CATEGORIES.map((cat) => ({ cat, n: complaints.filter((c) => c.category === cat).length }));
  const maxCat = Math.max(1, ...perCategory.map((p) => p.n));

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">CivicHelp / public works reporting</p>
          <h1 className="hero-title">Every broken street deserves a <mark className="hl">paper trail.</mark></h1>
          <p className="hero-lead">
            Report a pothole, a dead streetlight or an overflowing drain with one photo and a pin.
            The ward office assigns it, a field worker fixes it and files proof, and you decide
            whether it is really done. Every step is public and updates live.
          </p>
          <div className="hero-actions">
            <Link to="/report" className="btn btn-signal btn-lg">Report a problem</Link>
            <Link to="/map" className="link-arrow">Open the live map &rarr;</Link>
          </div>
        </div>

        <figure className="hero-figure">
          <div className="hero-map">
            <MapContainer center={[22.5, 79]} zoom={5} zoomControl={false} scrollWheelZoom={false}
              style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors' />
              {complaints.filter((c) => Number.isFinite(Number(c.latitude)) && Number.isFinite(Number(c.longitude))).map((c) => (
                <CircleMarker key={c.id} center={[Number(c.latitude), Number(c.longitude)]} radius={7}
                  pathOptions={{ color: '#141413', weight: 2, fillColor: (STATUS[c.status] || STATUS.open).color, fillOpacity: 1 }}>
                  <Popup>
                    <div className="pop-ref">{refNo(c.id)}</div>
                    <div className="pop-title">{c.category}</div>
                    {c.address && <div className="small muted">{c.address}</div>}
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
          <figcaption className="fig-caption">
            <span>Fig. 1 &mdash; every report, live</span>
            <span className="legend">
              <StatusChip status="open" /><StatusChip status="in_progress" /><StatusChip status="resolved" />
            </span>
          </figcaption>
        </figure>
      </section>

      <section className="board" id="impact" aria-labelledby="board-title">
        <div className="board-head">
          <div>
            <p className="kicker">The board &middot; straight from the database</p>
            <h2 id="board-title">Where things stand today</h2>
          </div>
          {loadError && <p className="kicker">Live data is unavailable right now</p>}
        </div>

        <div className="board-figures">
          {[
            { label: 'Reports filed', value: stats.total },
            { label: 'Open', value: stats.open, color: STATUS.open.color },
            { label: 'In progress', value: stats.in_progress, color: STATUS.in_progress.color },
            { label: 'Fixed', value: stats.resolved, color: STATUS.resolved.color },
            { label: 'Fix rate', value: `${rate}%` },
          ].map((f) => (
            <div className="figure-cell" key={f.label}>
              <div className="figure-num">{f.value}</div>
              <div className="figure-label">{f.color && <i style={{ background: f.color }} />}{f.label}</div>
            </div>
          ))}
        </div>

        <p className="kicker" style={{ marginBottom: 10 }}>Latest reports</p>
        {complaints.length === 0 ? (
          <p className="departures-empty">No reports yet. The first one will appear here the moment it is filed.</p>
        ) : (
          <table className="departures">
            <thead>
              <tr><th>Ref</th><th className="dep-time">Filed</th><th>Category</th><th>Location</th><th>Status</th></tr>
            </thead>
            <tbody>
              {complaints.slice(0, 6).map((c) => (
                <tr key={c.id}>
                  <td className="dep-ref">{refNo(c.id)}</td>
                  <td className="dep-time">{timeAgo(c.created_at)}</td>
                  <td className="dep-cat">{c.category}</td>
                  <td className="dep-loc clamp-1">{c.address || 'Pinned on the map'}</td>
                  <td><StatusChip status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section" id="how" aria-labelledby="how-title">
        <div className="section-head">
          <h2 id="how-title">How a report travels</h2>
          <p>
            Every report rides the same line, from the street to the ward office and back to the
            person who filed it. Each stop is recorded, and nothing is closed without a photograph.
          </p>
        </div>
        <ol className="journey">
          {journey.map((j) => (
            <li key={j.title}>
              <span className="journey-role">{j.role}</span>
              <h3>{j.title}</h3>
              <p>{j.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="section" aria-labelledby="cat-title">
        <div className="section-head">
          <h2 id="cat-title">What you can report</h2>
          <p>Five categories cover most of what goes wrong on a street. Counts are live.</p>
        </div>
        <div className="cat-table">
          {perCategory.map(({ cat, n }) => (
            <div className="cat-row" key={cat}>
              <span className="cat-icon"><CategoryIcon category={cat} size={22} /></span>
              <div>
                <h3>{cat}</h3>
                <div className="cat-bar"><i style={{ width: `${(n / maxCat) * 100}%` }} /></div>
              </div>
              <span className="cat-count">{n}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="footer">
        <div className="footer-word">Civic<span>Help</span></div>
        <div className="footer-bar">
          <span>A student project in civic technology and DevOps</span>
          <nav aria-label="Footer">
            <Link to="/map">Live map</Link>
            <Link to="/report">Report a problem</Link>
            <Link to="/login">Log in</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}

export default Home;
