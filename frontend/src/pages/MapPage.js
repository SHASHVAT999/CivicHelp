import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import io from 'socket.io-client';
import { API_URL, SOCKET_URL, getImageUrl } from '../config';
import { ArrowLeft, Crosshair, RefreshCw, RotateCcw } from 'lucide-react';
import { CATEGORIES, CategoryIcon, STATUS, StatusChip, refNo, formatDate, timeAgo } from '../categories';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const INK = '#141413';
const SIGNAL = '#ffcc00';

// Strict coordinate validation: rejects null, undefined, empty strings, non-numeric strings ("12abc"), and out-of-range coordinates
function isValidCoordinate(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return false;
  if (typeof lat === 'boolean' || typeof lng === 'boolean') return false;
  if (typeof lat === 'string' && lat.trim() === '') return false;
  if (typeof lng === 'string' && lng.trim() === '') return false;

  const numLat = Number(lat);
  const numLng = Number(lng);

  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) return false;
  if (numLat < -90 || numLat > 90) return false;
  if (numLng < -180 || numLng > 180) return false;

  return true;
}

function parseStrictCoordinates(lat, lng) {
  if (!isValidCoordinate(lat, lng)) return null;
  return [Number(lat), Number(lng)];
}

// Signal dot with an ink ring; the selected report gets a road-marking yellow halo
function getIcon(status, isSelected = false) {
  const color = (STATUS[status] || STATUS.open).color;
  const size = isSelected ? 24 : 16;
  const halo = isSelected ? `box-shadow: 0 0 0 5px ${SIGNAL}, 0 0 0 7px ${INK};` : '';
  return L.divIcon({
    className: 'civic-marker',
    html: `<div style="background:${color};width:${size}px;height:${size}px;border-radius:50%;border:3px solid ${INK};${halo}cursor:pointer;"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 4]
  });
}

// Controller component to smoothly pan/zoom map programmatically
function ChangeView({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (Array.isArray(center) && center.length === 2 && isValidCoordinate(center[0], center[1])) {
      map.setView([Number(center[0]), Number(center[1])], zoom || map.getZoom(), { animate: true });
    }
  }, [center, zoom, map]);
  return null;
}

// Generate normalized coordinate key for grouping overlapping complaints (~11cm precision)
function getCoordinateKey(lat, lng) {
  return `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
}

const SPIDER_LEG_OPTIONS = { color: INK, weight: 2, dashArray: '4, 4', opacity: 0.8 };

// Several reports at the same spot: an ink square with the count; expanded it becomes a close (x) control
function getClusterIcon(count, isExpanded = false) {
  const size = isExpanded ? 28 : 34;
  const label = isExpanded ? '&times;' : count;
  const title = isExpanded ? `Click to collapse (${count} reports)` : `${count} reports at this location. Click to expand.`;
  return L.divIcon({
    className: 'civic-cluster',
    html: `<div title="${title}" style="width:${size}px;height:${size}px;background:${INK};color:${SIGNAL};border:2px solid ${SIGNAL};display:flex;align-items:center;justify-content:center;font:700 16px Bahnschrift,'Arial Narrow',sans-serif;cursor:pointer;">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 4]
  });
}

// Compute radial screen pixel offset for expanded markers around a cluster origin
function getRadialOffset(centerLat, centerLng, index, total, map) {
  if (!map) return [centerLat, centerLng];
  try {
    const centerPoint = map.latLngToLayerPoint([centerLat, centerLng]);
    const radius = Math.min(80, Math.max(42, 30 + total * 4));
    const angle = (2 * Math.PI * index) / total - Math.PI / 2;
    const offsetX = Math.round(centerPoint.x + radius * Math.cos(angle));
    const offsetY = Math.round(centerPoint.y + radius * Math.sin(angle));
    const offsetLatLng = map.layerPointToLatLng(L.point(offsetX, offsetY));
    return [offsetLatLng.lat, offsetLatLng.lng];
  } catch (err) {
    console.warn('[Map Warning] Failed to calculate radial offset:', err);
    return [centerLat, centerLng];
  }
}

// Individual complaint marker with a short popup; selecting it opens the detail in the side panel
function ComplaintMarker({ complaint: c, position, isSelected, onSelect }) {
  return (
    <Marker position={position} icon={getIcon(c.status, isSelected)} eventHandlers={{ click: onSelect }}>
      <Popup>
        <div className="pop-ref">{refNo(c.id)} · {timeAgo(c.created_at)}</div>
        <div className="pop-title">{c.category}</div>
        <div style={{ margin: '4px 0 8px' }}><StatusChip status={c.status} /></div>
        <button type="button" className="btn btn-sm btn-ink btn-block" onClick={onSelect}>Open report</button>
      </Popup>
    </Marker>
  );
}

// Markers layer managing standalone markers, unexpanded clusters, and expanded radial spiders
function MarkersLayer({ groups, expandedClusters, onToggleCluster, selectedComplaint, onSelectComplaint }) {
  const map = useMap();
  const [, setZoomTick] = useState(0);

  useEffect(() => {
    const handleZoom = () => setZoomTick((t) => t + 1);
    map.on('zoomend', handleZoom);
    return () => { map.off('zoomend', handleZoom); };
  }, [map]);

  return (
    <>
      {groups.map((group) => {
        // Case 1: Standalone single complaint
        if (group.complaints.length === 1) {
          const c = group.complaints[0];
          return (
            <ComplaintMarker key={c.id} complaint={c} position={[group.latitude, group.longitude]}
              isSelected={selectedComplaint && selectedComplaint.id === c.id}
              onSelect={() => onSelectComplaint(c)} />
          );
        }

        // Case 2: Overlapping cluster
        const isExpanded = expandedClusters.has(group.key);
        if (!isExpanded) {
          return (
            <Marker key={`cluster-${group.key}`} position={[group.latitude, group.longitude]}
              icon={getClusterIcon(group.complaints.length, false)}
              eventHandlers={{ click: () => onToggleCluster(group.key) }} />
          );
        }

        // Expanded cluster state
        return (
          <React.Fragment key={`cluster-group-${group.key}`}>
            <Marker key={`cluster-center-${group.key}`} position={[group.latitude, group.longitude]}
              icon={getClusterIcon(group.complaints.length, true)}
              eventHandlers={{ click: () => onToggleCluster(group.key) }} />
            {group.complaints.map((c, idx) => {
              const expandedCoords = getRadialOffset(group.latitude, group.longitude, idx, group.complaints.length, map);
              return (
                <React.Fragment key={c.id}>
                  <Polyline positions={[[group.latitude, group.longitude], expandedCoords]} pathOptions={SPIDER_LEG_OPTIONS} />
                  <ComplaintMarker complaint={c} position={expandedCoords}
                    isSelected={selectedComplaint && selectedComplaint.id === c.id}
                    onSelect={() => onSelectComplaint(c)} />
                </React.Fragment>
              );
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}

function MapPage() {
  const [complaints, setComplaints] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [expandedClusters, setExpandedClusters] = useState(new Set());
  const [mapCenter, setMapCenter] = useState([20.5937, 78.9629]);
  const [mapZoom, setMapZoom] = useState(5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [live, setLive] = useState(false);

  const fetchComplaints = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_URL}/complaints`);
      setComplaints(res.data);
    } catch (err) {
      console.error('[Map Error] Failed to fetch complaints:', err);
      setError('Unable to load reports. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComplaints();

    const socket = io(SOCKET_URL);
    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));
    socket.on('newComplaint', (c) => {
      if (!c || !c.id) return;
      setComplaints((prev) => {
        if (prev.some((item) => item.id === c.id)) {
          return prev.map((item) => (item.id === c.id ? { ...item, ...c } : item));
        }
        return [c, ...prev];
      });
    });
    socket.on('statusUpdated', (updated) => {
      if (!updated || !updated.id) return;
      setComplaints((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
      setSelectedComplaint((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
    });

    return () => {
      socket.off('newComplaint');
      socket.off('statusUpdated');
      socket.disconnect();
    };
  }, []);

  const filtered = complaints.filter((c) => {
    if (!isValidCoordinate(c.latitude, c.longitude)) return false;
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (categoryFilter !== 'All' && c.category !== categoryFilter) return false;
    return true;
  });

  // Group filtered complaints with identical coordinates
  const coordinateGroups = useMemo(() => {
    const map = new Map();
    filtered.forEach((c) => {
      const key = getCoordinateKey(c.latitude, c.longitude);
      if (!map.has(key)) {
        map.set(key, { key, latitude: Number(c.latitude), longitude: Number(c.longitude), complaints: [] });
      }
      map.get(key).complaints.push(c);
    });
    return Array.from(map.values());
  }, [filtered]);

  // Clean up expanded clusters that no longer exist or have <= 1 complaint
  useEffect(() => {
    setExpandedClusters((prev) => {
      if (prev.size === 0) return prev;
      const validKeys = new Set(coordinateGroups.filter((g) => g.complaints.length > 1).map((g) => g.key));
      let hasStale = false;
      for (const key of prev) {
        if (!validKeys.has(key)) { hasStale = true; break; }
      }
      if (!hasStale) return prev;
      const next = new Set();
      for (const key of prev) {
        if (validKeys.has(key)) next.add(key);
      }
      return next;
    });
  }, [coordinateGroups]);

  // Auto-expand cluster if a selected complaint belongs to one
  useEffect(() => {
    if (selectedComplaint && isValidCoordinate(selectedComplaint.latitude, selectedComplaint.longitude)) {
      const key = getCoordinateKey(selectedComplaint.latitude, selectedComplaint.longitude);
      setExpandedClusters((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    }
  }, [selectedComplaint]);

  const handleToggleCluster = useCallback((key) => {
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const stats = {
    total: complaints.length,
    open: complaints.filter((c) => c.status === 'open').length,
    in_progress: complaints.filter((c) => c.status === 'in_progress').length,
    resolved: complaints.filter((c) => c.status === 'resolved').length,
  };

  const isFilterActive = statusFilter !== 'all' || categoryFilter !== 'All';

  const resetFilters = () => {
    setStatusFilter('all');
    setCategoryFilter('All');
    setExpandedClusters(new Set());
  };

  const handleSelectComplaint = useCallback((c) => {
    setSelectedComplaint(c);
    const coords = parseStrictCoordinates(c.latitude, c.longitude);
    if (coords) {
      setMapCenter(coords);
      setMapZoom(14);
    }
  }, []);

  const s = selectedComplaint;

  return (
    <main className="mapdesk">
      <aside className="mapdesk-side" aria-label="Reports">
        {s ? (
          <>
            <div className="mapdesk-head">
              <button type="button" className="btn btn-sm" onClick={() => setSelectedComplaint(null)}>
                <ArrowLeft size={15} aria-hidden="true" /> All reports
              </button>
            </div>
            <div className="mapdesk-list">
              <article className="spot">
                <p className="kicker">{refNo(s.id)} · filed {formatDate(s.created_at)}</p>
                <h2 style={{ margin: '6px 0 10px' }}>{s.category}</h2>
                <div style={{ marginBottom: 16 }}><StatusChip status={s.status} large /></div>
                {s.image_url ? (
                  <a className="spot-photo" href={getImageUrl(s.image_url)} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }}>
                    <img src={getImageUrl(s.image_url)} alt="Photo attached to this report" />
                  </a>
                ) : (
                  <div className="spot-nophoto">No photo was attached to this report.</div>
                )}
                <p className="section-label">Description</p>
                <p style={{ marginBottom: 16 }}>{s.description || 'No description provided.'}</p>
                <p className="section-label">Location</p>
                <p>{s.address || 'Pinned on the map'}</p>
                {isValidCoordinate(s.latitude, s.longitude) && (
                  <p className="mono muted" style={{ marginBottom: 16 }}>{Number(s.latitude).toFixed(5)}, {Number(s.longitude).toFixed(5)}</p>
                )}
                {s.status === 'resolved' && s.resolved_at && (
                  <p className="flag flag-ok" style={{ marginBottom: 16 }}>Fixed on {formatDate(s.resolved_at)}</p>
                )}
                <button type="button" className="btn btn-ink btn-block" onClick={() => {
                  const coords = parseStrictCoordinates(s.latitude, s.longitude);
                  if (coords) { setMapCenter(coords); setMapZoom(16); }
                }}>
                  <Crosshair size={16} aria-hidden="true" /> Zoom to street level
                </button>
              </article>
            </div>
          </>
        ) : (
          <>
            <div className="mapdesk-head">
              <p className="kicker" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Public record</span>
                <span className={`live${live ? ' live-on' : ''}`}><i aria-hidden="true" />{live ? 'Live' : 'Offline'}</span>
              </p>
              <h1>Live map</h1>
              <p className="small muted">Showing {filtered.length} of {complaints.length} reports. New reports and status changes appear without reloading.</p>
            </div>
            <div className="mapdesk-tools">
              <div className="filters" role="group" aria-label="Status">
                {[
                  { id: 'all', label: 'All', count: stats.total },
                  { id: 'open', label: 'Open', count: stats.open },
                  { id: 'in_progress', label: 'Active', count: stats.in_progress },
                  { id: 'resolved', label: 'Fixed', count: stats.resolved },
                ].map((tab) => (
                  <button key={tab.id} type="button" className="filter" aria-pressed={statusFilter === tab.id}
                    onClick={() => setStatusFilter(tab.id)}>
                    {tab.label}<span className="count">{tab.count}</span>
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <select aria-label="Category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                  <option value="All">All categories</option>
                  {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                {isFilterActive && (
                  <button type="button" className="btn btn-sm" onClick={resetFilters} title="Reset filters">
                    <RotateCcw size={14} aria-hidden="true" /> Reset
                  </button>
                )}
                <button type="button" className="btn btn-sm" onClick={fetchComplaints} disabled={loading} title="Reload reports" aria-label="Reload reports">
                  <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="mapdesk-list">
              {filtered.length === 0 && !loading ? (
                <div className="spot">
                  <p className="kicker">No matching reports</p>
                  <p className="small muted" style={{ margin: '8px 0 14px' }}>Nothing matches these filters.</p>
                  {isFilterActive && <button type="button" className="btn btn-sm" onClick={resetFilters}>Reset filters</button>}
                </div>
              ) : filtered.map((c) => (
                <button key={c.id} type="button" className="row-btn" onClick={() => handleSelectComplaint(c)}>
                  <span>
                    <span className="row-top"><span>{refNo(c.id)}</span><span>{timeAgo(c.created_at)}</span></span>
                    <span className="row-title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <CategoryIcon category={c.category} size={16} />{c.category}
                    </span>
                  </span>
                  <span className="row-side"><StatusChip status={c.status} /></span>
                  <span className="row-addr clamp-1">{c.address || 'Pinned on the map'}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="mapdesk-foot" aria-label="Legend">
          <span className="legend-dot"><i style={{ background: STATUS.open.color }} />Open</span>
          <span className="legend-dot"><i style={{ background: STATUS.in_progress.color }} />In progress</span>
          <span className="legend-dot"><i style={{ background: STATUS.resolved.color }} />Fixed</span>
          <span className="legend-dot"><i className="sq" />Same spot</span>
        </div>
      </aside>

      <div className="mapdesk-map">
        {(error || (loading && complaints.length === 0)) && (
          <div className="map-overlay" role="status">
            {error ? (
              <div>
                <span>{error}</span>
                <button type="button" className="btn btn-sm btn-ink" onClick={fetchComplaints}>Retry</button>
              </div>
            ) : (
              <div><RefreshCw size={15} className="spin" aria-hidden="true" /> Loading reports…</div>
            )}
          </div>
        )}
        <MapContainer center={mapCenter} zoom={mapZoom} style={{ height: '100%', width: '100%' }}>
          <ChangeView center={mapCenter} zoom={mapZoom} />
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors' />
          <MarkersLayer groups={coordinateGroups} expandedClusters={expandedClusters}
            onToggleCluster={handleToggleCluster} selectedComplaint={selectedComplaint}
            onSelectComplaint={handleSelectComplaint} />
        </MapContainer>
      </div>
    </main>
  );
}

export default MapPage;
