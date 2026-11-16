import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { API_URL } from '../config';
import { CATEGORIES as categories, CategoryIcon } from '../categories';
import { LocateFixed } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});


const INDIA_CENTER = { latitude: 20.5937, longitude: 78.9629 };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
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
    if (form.description.trim().length < 10) {
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
      setMsg(`Report #${res.data.id} submitted. It is now visible on the map.`);
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

  return (
    <div className="page">
      <div className="page-narrow">
        <h1 className="page-title">Report an issue</h1>
        <p className="muted page-sub">
          Choose a category, describe the problem and mark its location. A photo helps the ward office act faster.
        </p>

        <div className="card">
          {msg && (
            <div className="success">
              {msg}{' '}
              <Link to="/dashboard" style={{ color: 'inherit', fontWeight: 600 }}>Track it in My reports</Link>
            </div>
          )}
          {error && <div className="error">{error}</div>}

          <form onSubmit={handleSubmit} noValidate>
            {/* Category Grid */}
            <label>Issue Category</label>
            <div className="category-grid">
              {categories.map(cat => (
                <button type="button" key={cat} onClick={() => setForm({ ...form, category: cat })}
                  aria-pressed={form.category === cat}
                  className={`category-option${form.category === cat ? ' selected' : ''}`}>
                  <CategoryIcon category={cat} size={18} />
                  <span>{cat}</span>
                </button>
              ))}
            </div>

            <label>Description <span className="required">*</span></label>
            <textarea rows="3" placeholder="Describe the issue, e.g. 'Large pothole near the bus stop, causing two-wheeler accidents'"
              value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              maxLength={1000}
              style={{ resize: 'vertical' }} />

            <label>Address / Landmark</label>
            <div style={{ position: 'relative', marginBottom: '15px' }}>
              <input type="text" placeholder="Search, e.g. MG Road, Bengaluru"
                value={form.address}
                maxLength={255}
                onChange={e => {
                  setForm({ ...form, address: e.target.value });
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setShowSuggestions(false)}
              />
              {showSuggestions && suggestions.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0,
                  background: 'white', border: '1px solid #e8e8e8',
                  borderRadius: '8px', zIndex: 9999, marginTop: '-10px',
                  maxHeight: '200px', overflowY: 'auto',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
                }}>
                  {suggestions.map((s, i) => (
                    <div key={i} onMouseDown={() => handleSelectSuggestion(s)} style={{
                      padding: '10px 12px', fontSize: '13px', color: '#1c1c1a',
                      borderBottom: i < suggestions.length - 1 ? '1px solid #e8e8e8' : 'none',
                      cursor: 'pointer', transition: 'background 0.2s',
                      textAlign: 'left'
                    }}
                    onMouseEnter={e => e.target.style.background = '#f5f5f5'}
                    onMouseLeave={e => e.target.style.background = 'transparent'}
                    >
                      {s.display_name}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
              <label style={{ margin: 0 }}>Location on map <span className="required">*</span></label>
              <button type="button" onClick={getLocation} disabled={locating} className="btn btn-outline btn-small">
                <LocateFixed size={14} aria-hidden="true" />
                {locating ? 'Detecting location…' : 'Use my current location'}
              </button>
            </div>
            <div style={{ height: '260px', width: '100%', marginBottom: '8px', borderRadius: '6px', overflow: 'hidden', border: `1px solid ${locationSet ? '#15803d' : 'var(--line)'}` }}>
              <MapContainer center={[INDIA_CENTER.latitude, INDIA_CENTER.longitude]} zoom={5} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
                />
                <LocationPicker
                  position={locationSet ? [form.latitude, form.longitude] : null}
                  onPick={(lat, lng) => setPin(lat, lng)}
                />
                <FlyTo target={flyTarget} />
              </MapContainer>
            </div>
            <p style={{ fontSize: '12px', color: locationSet ? '#15803d' : '#888', marginBottom: '18px' }}>
              {locationSet
                ? `Pin set at ${Number(form.latitude).toFixed(5)}, ${Number(form.longitude).toFixed(5)}. Click the map to adjust.`
                : 'Click on the map to drop a pin, search an address above, or use your current location.'}
            </p>

            <label>Photo of the issue <span className="muted" style={{ fontWeight: 400 }}>(optional, JPEG/PNG/WebP, max 5 MB)</span></label>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageChange}
              style={{ marginBottom: imagePreview ? '10px' : '20px', borderStyle: 'dashed' }} />
            {imagePreview && (
              <img src={imagePreview} alt="Selected issue preview" style={{
                display: 'block', height: '120px', maxWidth: '100%', objectFit: 'cover',
                borderRadius: '6px', border: '1px solid var(--line)', marginBottom: '20px'
              }} />
            )}

            <button type="submit" disabled={loading} className="btn btn-primary btn-block">
              {loading ? 'Submitting...' : 'Submit report'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default ReportComplaint;
