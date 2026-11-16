import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { API_URL } from '../config';
import { CATEGORIES as categories, CategoryIcon } from '../categories';
import { LocateFixed, Camera, Check } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const INDIA_CENTER = { latitude: 20.5937, longitude: 78.9629 };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MIN_DESCRIPTION = 10;
const emptyForm = { category: 'Pothole', description: '', address: '', ...INDIA_CENTER };

// Map click sets the pin (declared at module level so it is not remounted on every render)
function LocationPicker({ position, onPick }) {
  useMapEvents({
    click(e) { onPick(e.latlng.lat, e.latlng.lng); },
  });
  return position ? <Marker position={position} /> : null;
}

// Fly to a location only when an explicit "fly request" changes (search result / GPS)
function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 16);
  }, [target, map]);
  return null;
}

function ReportComplaint() {
  const [form, setForm] = useState(emptyForm);
  const [locationSet, setLocationSet] = useState(false);
  const [flyTarget, setFlyTarget] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const fileInputRef = useRef(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    const delayDebounce = setTimeout(async () => {
      if (form.address.length > 2 && showSuggestions) {
        try {
          const res = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(form.address)}&format=json&limit=5&countrycodes=in`);
          setSuggestions(res.data);
        } catch (err) {
          console.error('Error fetching suggestions:', err);
        }
      } else {
        setSuggestions([]);
      }
    }, 500);
    return () => clearTimeout(delayDebounce);
  }, [form.address, showSuggestions]);

  // Release object URLs for image previews
  useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview); }, [imagePreview]);

  const setPin = (lat, lng, fly = false) => {
    setForm(prev => ({ ...prev, latitude: lat, longitude: lng }));
    setLocationSet(true);
    if (fly) setFlyTarget({ lat, lng });
  };

  const handleSelectSuggestion = (suggestion) => {
    const lat = parseFloat(suggestion.lat);
    const lon = parseFloat(suggestion.lon);
    setForm(prev => ({ ...prev, address: suggestion.display_name }));
    setPin(lat, lon, true);
    setShowSuggestions(false);
  };

  const getLocation = () => {
    if (!navigator.geolocation) {
      setError('Location services are not available in this browser. Please click on the map instead.');
      return;
    }
    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPin(pos.coords.latitude, pos.coords.longitude, true);
        setLocating(false);
      },
      () => {
        setLocating(false);
        setError('Could not detect your location (permission denied or unavailable). Please click on the map to set the pin.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    setError('');
    if (!file) { setImageFile(null); setImagePreview(null); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Only JPEG, PNG or WebP images are allowed.');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Image must be smaller than 5 MB.');
      e.target.value = '';
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setMsg('');

    if (!locationSet) {
      setError('Please set the issue location: click on the map, search an address, or use your current location.');
      return;
    }
    if (form.description.trim().length < MIN_DESCRIPTION) {
      setError('Please describe the issue in at least 10 characters so the ward team can act on it.');
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('category', form.category);
      formData.append('description', form.description.trim());
      formData.append('address', form.address.trim());
      formData.append('latitude', form.latitude);
      formData.append('longitude', form.longitude);
      if (imageFile) {
        formData.append('image', imageFile);
      }

      const res = await axios.post(`${API_URL}/complaints`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMsg(`Report CH-${String(res.data.id).padStart(4, '0')} is filed and already visible on the live map.`);
      setForm(emptyForm);
      setLocationSet(false);
      setFlyTarget(null);
      setImageFile(null);
      setImagePreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit complaint. Please try again.');
    }
    setLoading(false);
  };

  const descLength = form.description.trim().length;
  const checks = [
    { label: 'Category chosen', ok: Boolean(form.category) },
    { label: `Description (${Math.min(descLength, MIN_DESCRIPTION)}/${MIN_DESCRIPTION} characters)`, ok: descLength >= MIN_DESCRIPTION },
    { label: 'Location pinned', ok: locationSet },
    { label: 'Photo (optional)', ok: Boolean(imageFile), optional: true },
  ];
  const ready = checks.filter((c) => !c.optional).every((c) => c.ok);

  return (
    <main className="desk">
      <div className="desk-main">
        <header className="page-head">
          <p className="kicker">Form CH-1 &middot; Citizen report</p>
          <h1>Report a problem</h1>
          <p>Four parts. Only the location and a short description are required, but a photo helps the ward office act faster.</p>
        </header>

        {msg && (
          <div className="notice notice-ok" role="status">
            <span>{msg} <Link to="/dashboard">Follow it in My reports</Link>.</span>
          </div>
        )}
        {error && <div className="notice notice-error" role="alert">{error}</div>}

        <form id="report-form" onSubmit={handleSubmit} noValidate>
          <div className="form-part">
            <div className="part-no part-ok">01</div>
            <div>
              <h2 className="part-title">What is the problem?</h2>
              <p className="part-sub">Pick the closest category.</p>
              <div className="cat-picker" role="group" aria-label="Category">
                {categories.map(cat => (
                  <button type="button" key={cat} className="cat-option"
                    aria-pressed={form.category === cat}
                    onClick={() => setForm({ ...form, category: cat })}>
                    <CategoryIcon category={cat} size={24} />
                    <span>{cat}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="form-part">
            <div className={`part-no${descLength >= MIN_DESCRIPTION ? ' part-ok' : ''}`}>02</div>
            <div>
              <h2 className="part-title">Describe it</h2>
              <p className="part-sub">What is wrong, and why it matters. For example: "Large pothole by the bus stop, two-wheelers swerve into traffic."</p>
              <label className="field">
                <span className="sr-only">Description</span>
                <textarea rows="4" value={form.description} maxLength={1000}
                  onChange={e => setForm({ ...form, description: e.target.value })} />
              </label>
            </div>
          </div>

          <div className="form-part">
            <div className={`part-no${locationSet ? ' part-ok' : ''}`}>03</div>
            <div>
              <h2 className="part-title">Where is it?</h2>
              <p className="part-sub">Search an address, use your current location, or click the map to drop the pin.</p>
              <div className="suggest">
                <label className="field" style={{ marginBottom: 10 }}>
                  <span className="field-label">Address or landmark</span>
                  <input type="text" placeholder="e.g. MG Road, Bengaluru" value={form.address} maxLength={255}
                    onChange={e => { setForm({ ...form, address: e.target.value }); setShowSuggestions(true); }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setShowSuggestions(false)} />
                </label>
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="suggest-list" role="listbox">
                    {suggestions.map((s, i) => (
                      <li key={i} role="option" aria-selected="false" onMouseDown={() => handleSelectSuggestion(s)}>{s.display_name}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="locate-row">
                <span className="kicker">or</span>
                <button type="button" onClick={getLocation} disabled={locating} className="btn btn-sm">
                  <LocateFixed size={15} aria-hidden="true" />
                  {locating ? 'Finding you…' : 'Use my location'}
                </button>
              </div>
              <div className={`map-frame${locationSet ? ' is-set' : ''}`}>
                <MapContainer center={[INDIA_CENTER.latitude, INDIA_CENTER.longitude]} zoom={5} style={{ height: '100%', width: '100%' }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors' />
                  <LocationPicker position={locationSet ? [form.latitude, form.longitude] : null}
                    onPick={(lat, lng) => setPin(lat, lng)} />
                  <FlyTo target={flyTarget} />
                </MapContainer>
              </div>
              <p className={`coords-line${locationSet ? ' ok' : ''}`}>
                {locationSet
                  ? `PIN ${Number(form.latitude).toFixed(5)}, ${Number(form.longitude).toFixed(5)} — click the map to adjust`
                  : 'NO PIN YET — click anywhere on the map'}
              </p>
            </div>
          </div>

          <div className="form-part">
            <div className={`part-no${imageFile ? ' part-ok' : ''}`}>04</div>
            <div>
              <h2 className="part-title">Add a photo <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></h2>
              <p className="part-sub">JPEG, PNG or WebP, up to 5 MB. The photo is checked on the server.</p>
              <label className="drop">
                {imagePreview
                  ? <img className="drop-thumb" src={imagePreview} alt="Selected photo preview" />
                  : <span className="drop-box"><Camera size={26} strokeWidth={1.5} aria-hidden="true" /></span>}
                <span>
                  <b>{imageFile ? 'Photo attached' : 'Choose a photo'}</b>
                  <span className="small muted">{imageFile ? `${imageFile.name} — click to replace` : 'Tap to take or select a picture'}</span>
                </span>
                <input ref={fileInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageChange} />
              </label>
            </div>
          </div>
        </form>
      </div>

      <aside className="ticket-col" aria-label="Report preview">
        <div className="ticket">
          <div className="ticket-head"><span>Report preview</span><span>Draft</span></div>
          <div className="ticket-body">
            {imagePreview && <img className="ticket-img" src={imagePreview} alt="" />}
            <div className="ticket-cat"><CategoryIcon category={form.category} size={26} />{form.category}</div>
            <p className="ticket-desc">{form.description.trim() || <span className="muted">Your description will appear here.</span>}</p>
            <p className="mono muted">{form.address.trim() || 'No address'}</p>
            <p className="mono muted">{locationSet ? `${Number(form.latitude).toFixed(5)}, ${Number(form.longitude).toFixed(5)}` : '—, —'}</p>
            <hr className="ticket-perf" style={{ marginTop: 14 }} />
            <ul className="checklist">
              {checks.map((c) => (
                <li key={c.label} className={c.ok ? 'ok' : ''}>
                  <span className="box">{c.ok && <Check size={13} strokeWidth={3} />}</span>{c.label}
                </li>
              ))}
            </ul>
          </div>
          <div className="ticket-foot">
            <button type="submit" form="report-form" disabled={loading} className={`btn btn-lg btn-block ${ready ? 'btn-signal' : ''}`}>
              {loading ? 'Filing report…' : 'File this report'}
            </button>
          </div>
        </div>
      </aside>
    </main>
  );
}

export default ReportComplaint;
