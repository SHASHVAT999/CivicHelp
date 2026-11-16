import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import axios from 'axios';
import io from 'socket.io-client';
import { API_URL, SOCKET_URL, getImageUrl } from '../config';
import {
  MapPin, AlertTriangle, AlertOctagon, Trash2, Waves,
  CalendarDays, CheckCircle, XCircle, RefreshCw,
  RotateCcw, Eye, Inbox, Navigation, ChevronRight
} from 'lucide-react';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const statusColors = {
  open: '#ef4444',
  in_progress: '#f59e0b',
  resolved: '#22c55e',
};

const statusConfig = {
  open: { color: '#ef4444', label: 'Open', bg: '#fef2f2', border: '#fecaca' },
  in_progress: { color: '#f59e0b', label: 'In Progress', bg: '#fffbeb', border: '#fde68a' },
  resolved: { color: '#22c55e', label: 'Resolved', bg: '#f0fdf4', border: '#bbf7d0' },
};

const categoryEmoji = {
  'Pothole': '🕳️',
  'Broken Streetlight': '💡',
  'Garbage Dump': '🗑️',
  'Open Drain': '🌊',
  'Other': '📍',
};

const categoryList = [
  'All',
  'Pothole',
  'Broken Streetlight',
  'Garbage Dump',
  'Open Drain',
  'Other'
];

function getCategoryIconComponent(category) {
  switch (category) {
    case 'Pothole': return <AlertTriangle size={16} color="#d97706" />;
    case 'Broken Streetlight': return <AlertOctagon size={16} color="#ea580c" />;
    case 'Garbage Dump': return <Trash2 size={16} color="#475569" />;
    case 'Open Drain': return <Waves size={16} color="#0284c7" />;
    case 'Other':
    default: return <MapPin size={16} color="#64748b" />;
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

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

function getIcon(status, isSelected = false) {
  const color = statusColors[status] || '#ef4444';
  const size = isSelected ? 22 : 16;
  const borderWidth = isSelected ? 3.5 : 2.5;
  const shadow = isSelected
    ? '0 0 0 5px rgba(59, 130, 246, 0.45), 0 3px 8px rgba(0,0,0,0.4)'
    : '0 2px 6px rgba(0,0,0,0.35)';

  return L.divIcon({
    className: 'custom-civic-marker',
    html: `<div style="
      background: ${color};
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      border: ${borderWidth}px solid white;
      box-shadow: ${shadow};
      transition: all 0.2s ease-in-out;
      cursor: pointer;
    "></div>`,
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

const SPIDER_LEG_OPTIONS = {
  color: '#64748b',
  weight: 2,
  dashArray: '4, 4',
  opacity: 0.8
};

function getClusterIcon(count, isExpanded = false) {
  const size = isExpanded ? 28 : 34;
  if (isExpanded) {
    return L.divIcon({
      className: 'custom-civic-cluster-expanded',
      html: `
        <div title="Click to collapse (${count} complaints)" style="
          background: #0f172a;
          color: white;
          width: ${size}px;
          height: ${size}px;
          border-radius: 50%;
          border: 2.5px solid white;
          box-shadow: 0 3px 10px rgba(0,0,0,0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
          transition: transform 0.15s ease;
        ">
          ✕
        </div>
      `,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2 - 4]
    });
  }

  return L.divIcon({
    className: 'custom-civic-cluster',
    html: `
      <div title="${count} complaints at this location. Click to expand." style="
        background: #2563eb;
        color: white;
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 3px 12px rgba(37, 99, 235, 0.4), 0 2px 6px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        font-size: 14px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: pointer;
        transition: transform 0.15s ease;
      ">
        ${count}
      </div>
    `,
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

// Individual complaint marker with full popup and selection support
function ComplaintMarker({ complaint: c, position, isSelected, onSelect }) {
  const sc = statusConfig[c.status] || { color: '#64748b', label: c.status, bg: '#f1f5f9', border: '#e2e8f0' };

  return (
    <Marker
      position={position}
      icon={getIcon(c.status, isSelected)}
      eventHandlers={{
        click: onSelect
      }}
    >
      <Popup>
        <div style={{ fontFamily: 'Inter, sans-serif', padding: '4px', minWidth: '220px', maxWidth: '260px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '16px' }}>{categoryEmoji[c.category] || '📍'}</span>
              <strong style={{ fontSize: '14px', color: '#0f172a' }}>{c.category}</strong>
            </div>
            <span style={{
              display: 'inline-block', padding: '2px 8px', borderRadius: '100px',
              fontSize: '10px', fontWeight: '700',
              background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`
            }}>
              {sc.label}
            </span>
          </div>

          {c.image_url && (
            <div style={{ marginBottom: '8px' }}>
              <img
                src={getImageUrl(c.image_url)}
                alt="Complaint evidence preview"
                style={{
                  width: '100%', height: '100px', objectFit: 'cover',
                  borderRadius: '8px', border: '1px solid #e2e8f0'
                }}
              />
            </div>
          )}

          <p style={{
            fontSize: '12px', color: '#475569', lineHeight: 1.4,
            marginBottom: '6px', maxHeight: '50px', overflow: 'hidden'
          }}>
            {c.description || 'No description provided.'}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>
            <MapPin size={12} color="#ef4444" style={{ flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {c.address || 'Address unavailable'}
            </span>
          </div>

          <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '10px' }}>
            Reported: {formatDate(c.created_at)}
          </div>

          <button
            onClick={onSelect}
            style={{
              width: '100%', padding: '6px 12px', background: '#0f172a',
              color: 'white', border: 'none', borderRadius: '6px',
              fontSize: '12px', fontWeight: '600', cursor: 'pointer',
              textAlign: 'center', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: '4px'
            }}
          >
            View Details <ChevronRight size={13} />
          </button>
        </div>
      </Popup>
    </Marker>
  );
}

// Markers layer managing standalone markers, unexpanded clusters, and expanded radial spiders
function MarkersLayer({
  groups,
  expandedClusters,
  onToggleCluster,
  selectedComplaint,
  onSelectComplaint,
}) {
  const map = useMap();
  const [, setZoomTick] = useState(0);

  useEffect(() => {
    const handleZoom = () => {
      setZoomTick((t) => t + 1);
    };
    map.on('zoomend', handleZoom);
    return () => {
      map.off('zoomend', handleZoom);
    };
  }, [map]);

  return (
    <>
      {groups.map((group) => {
        // Case 1: Standalone single complaint
        if (group.complaints.length === 1) {
          const c = group.complaints[0];
          const coords = [group.latitude, group.longitude];
          const isSelected = selectedComplaint && selectedComplaint.id === c.id;

          return (
            <ComplaintMarker
              key={c.id}
              complaint={c}
              position={coords}
              isSelected={isSelected}
              onSelect={() => onSelectComplaint(c)}
            />
          );
        }

        // Case 2: Overlapping cluster
        const isExpanded = expandedClusters.has(group.key);

        if (!isExpanded) {
          return (
            <Marker
              key={`cluster-${group.key}`}
              position={[group.latitude, group.longitude]}
              icon={getClusterIcon(group.complaints.length, false)}
              eventHandlers={{
                click: () => onToggleCluster(group.key)
              }}
            />
          );
        }

        // Expanded cluster state
        return (
          <React.Fragment key={`cluster-group-${group.key}`}>
            {/* Center collapse control marker */}
            <Marker
              key={`cluster-center-${group.key}`}
              position={[group.latitude, group.longitude]}
              icon={getClusterIcon(group.complaints.length, true)}
              eventHandlers={{
                click: () => onToggleCluster(group.key)
              }}
            />

            {/* Spider legs & expanded individual complaint markers */}
            {group.complaints.map((c, idx) => {
              const expandedCoords = getRadialOffset(
                group.latitude,
                group.longitude,
                idx,
                group.complaints.length,
                map
              );
              const isSelected = selectedComplaint && selectedComplaint.id === c.id;

              return (
                <React.Fragment key={c.id}>
                  <Polyline
                    key={`spider-leg-${c.id}`}
                    positions={[[group.latitude, group.longitude], expandedCoords]}
                    pathOptions={SPIDER_LEG_OPTIONS}
                  />
                  <ComplaintMarker
                    key={`spider-marker-${c.id}`}
                    complaint={c}
                    position={expandedCoords}
                    isSelected={isSelected}
                    onSelect={() => onSelectComplaint(c)}
                  />
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
  const [isLegendOpen, setIsLegendOpen] = useState(true);

  const fetchComplaints = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_URL}/complaints`);
      setComplaints(res.data);
    } catch (err) {
      console.error('[Map Error] Failed to fetch complaints:', err);
      setError('Unable to load civic complaints data. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComplaints();

    const socket = io(SOCKET_URL);
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
        map.set(key, {
          key,
          latitude: Number(c.latitude),
          longitude: Number(c.longitude),
          complaints: []
        });
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
        if (!validKeys.has(key)) {
          hasStale = true;
          break;
        }
      }
      if (!hasStale) return prev;
      const next = new Set();
      for (const key of prev) {
        if (validKeys.has(key)) {
          next.add(key);
        }
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
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
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

  return (
    <div style={{
      paddingTop: '64px',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: '#fafaf8',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Top Filter and Controls Bar */}
      <div style={{
        padding: '14px 24px',
        background: 'white',
        borderBottom: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        zIndex: 500,
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
      }}>
        {/* Left: Title & Count summary */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: '#22c55e', animation: 'pulse 2s infinite'
              }} />
              <h2 style={{ fontSize: '17px', fontWeight: '800', color: '#0f172a', margin: 0 }}>
                Live Complaints Map
              </h2>
            </div>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '2px 0 0' }}>
              Showing {filtered.length} of {complaints.length} civic reports
            </p>
          </div>
        </div>

        {/* Center: Status and Category Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Status Filter Pills */}
          <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '100px', gap: '2px' }}>
            {[
              { id: 'all', label: 'All', count: stats.total },
              { id: 'open', label: 'Open', count: stats.open },
              { id: 'in_progress', label: 'In Progress', count: stats.in_progress },
              { id: 'resolved', label: 'Resolved', count: stats.resolved },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '100px',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: statusFilter === tab.id ? '700' : '500',
                  background: statusFilter === tab.id ? 'white' : 'transparent',
                  color: statusFilter === tab.id ? '#0f172a' : '#64748b',
                  boxShadow: statusFilter === tab.id ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span>{tab.label}</span>
                <span style={{
                  fontSize: '10px',
                  padding: '1px 6px',
                  borderRadius: '10px',
                  background: statusFilter === tab.id ? '#0f172a' : '#e2e8f0',
                  color: statusFilter === tab.id ? 'white' : '#64748b'
                }}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Category Dropdown Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                fontWeight: '600',
                color: '#334155',
                background: 'white',
                outline: 'none',
                cursor: 'pointer',
                margin: 0,
                width: 'auto'
              }}
            >
              {categoryList.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'All' ? 'All Categories' : cat}
                </option>
              ))}
            </select>
          </div>

          {/* Reset Filters Button */}
          {isFilterActive && (
            <button
              onClick={resetFilters}
              title="Reset all filters"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: 'white',
                color: '#64748b',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <RotateCcw size={12} /> Reset
            </button>
          )}
        </div>

        {/* Right: Refresh Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={fetchComplaints}
            disabled={loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: 'white',
              color: '#334155',
              fontSize: '12px',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Main Map Viewport */}
      <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%' }}>
        {/* Error Banner Overlay */}
        {error && (
          <div style={{
            position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 1000, background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: '10px', padding: '10px 18px', display: 'flex', alignItems: 'center',
            gap: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
          }}>
            <AlertTriangle size={18} color="#ef4444" />
            <span style={{ fontSize: '13px', color: '#991b1b', fontWeight: '500' }}>{error}</span>
            <button
              onClick={fetchComplaints}
              style={{
                background: '#ef4444', color: 'white', border: 'none',
                borderRadius: '6px', padding: '4px 10px', fontSize: '12px',
                fontWeight: '600', cursor: 'pointer'
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty State Overlay */}
        {!loading && filtered.length === 0 && (
          <div style={{
            position: 'absolute', top: '24px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 1000, background: 'rgba(255, 255, 255, 0.96)',
            backdropFilter: 'blur(8px)', border: '1px solid #e2e8f0',
            borderRadius: '16px', padding: '24px 32px', textAlign: 'center',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxWidth: '380px'
          }}>
            <Inbox size={36} color="#94a3b8" style={{ margin: '0 auto 10px' }} />
            <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', margin: '0 0 6px' }}>
              No Complaints Found
            </h3>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 14px' }}>
              There are no civic reports matching your selected status and category filters.
            </p>
            <button
              onClick={resetFilters}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '7px 16px', background: '#0f172a', color: 'white',
                border: 'none', borderRadius: '100px', fontSize: '12px',
                fontWeight: '600', cursor: 'pointer'
              }}
            >
              <RotateCcw size={12} /> Reset All Filters
            </button>
          </div>
        )}

        {/* Loading Indicator Pill */}
        {loading && complaints.length === 0 && (
          <div style={{
            position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 1000, background: 'white', border: '1px solid #cbd5e1',
            borderRadius: '100px', padding: '8px 20px', display: 'flex', alignItems: 'center',
            gap: '10px', boxShadow: '0 4px 14px rgba(0,0,0,0.1)'
          }}>
            <RefreshCw size={15} color="#3b82f6" className="spin" />
            <span style={{ fontSize: '13px', color: '#334155', fontWeight: '600' }}>
              Loading civic map markers...
            </span>
          </div>
        )}

        {/* Floating Map Legend Card */}
        <div style={{
          position: 'absolute', bottom: '20px', left: '20px', zIndex: 1000,
          background: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(0,0,0,0.08)', borderRadius: '12px',
          padding: '12px 16px', boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
          maxWidth: '220px'
        }}>
          <div
            onClick={() => setIsLegendOpen(!isLegendOpen)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              cursor: 'pointer', userSelect: 'none'
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: '700', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Status Legend
            </span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              {isLegendOpen ? 'Hide' : 'Show'}
            </span>
          </div>

          {isLegendOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ef4444', border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                <span style={{ fontSize: '12px', color: '#334155' }}>Open Issue</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#f59e0b', border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                <span style={{ fontSize: '12px', color: '#334155' }}>Work in Progress</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#22c55e', border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                <span style={{ fontSize: '12px', color: '#334155' }}>Resolved / Fixed</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '14px', height: '14px', borderRadius: '50%', background: '#2563eb',
                  border: '1.5px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', fontSize: '9px', fontWeight: '800'
                }}>
                  +
                </div>
                <span style={{ fontSize: '12px', color: '#334155' }}>Overlapping Group</span>
              </div>
            </div>
          )}
        </div>

        {/* Selected Complaint Detail Panel (Floating Sidebar) */}
        {selectedComplaint && (
          <div style={{
            position: 'absolute', top: '16px', right: '16px', bottom: '16px',
            width: '360px', maxWidth: 'calc(100vw - 32px)',
            background: 'white', borderRadius: '16px',
            border: '1px solid #e2e8f0', boxShadow: '0 12px 28px rgba(0,0,0,0.15)',
            zIndex: 1000, display: 'flex', flexDirection: 'column', overflow: 'hidden'
          }}>
            {/* Panel Header */}
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid #f1f5f9',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: '#fafaf8'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  background: '#f1f5f9', width: '32px', height: '32px',
                  borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  {getCategoryIconComponent(selectedComplaint.category)}
                </div>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>
                    {selectedComplaint.category}
                  </h3>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>
                    Complaint #{selectedComplaint.id}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  padding: '3px 10px', borderRadius: '100px', fontSize: '11px', fontWeight: '700',
                  background: statusConfig[selectedComplaint.status]?.bg || '#f1f5f9',
                  color: statusConfig[selectedComplaint.status]?.color || '#64748b',
                  border: `1px solid ${statusConfig[selectedComplaint.status]?.border || '#e2e8f0'}`
                }}>
                  {statusConfig[selectedComplaint.status]?.label || selectedComplaint.status}
                </span>

                <button
                  onClick={() => setSelectedComplaint(null)}
                  title="Close details"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#94a3b8', padding: '2px', display: 'flex', alignItems: 'center'
                  }}
                >
                  <XCircle size={20} />
                </button>
              </div>
            </div>

            {/* Panel Scrollable Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
              {/* Evidence Photograph */}
              {selectedComplaint.image_url ? (
                <div style={{ marginBottom: '18px' }}>
                  <a
                    href={getImageUrl(selectedComplaint.image_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration: 'none', display: 'block' }}
                  >
                    <img
                      src={getImageUrl(selectedComplaint.image_url)}
                      alt="Complaint evidence"
                      style={{
                        width: '100%', height: '170px', objectFit: 'cover',
                        borderRadius: '10px', border: '1px solid #e2e8f0', display: 'block'
                      }}
                    />
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      fontSize: '11px', color: '#3b82f6', marginTop: '6px', fontWeight: '600'
                    }}>
                      <Eye size={12} /> View original photo in full size
                    </div>
                  </a>
                </div>
              ) : (
                <div style={{
                  background: '#f8fafc', border: '1px dashed #cbd5e1',
                  borderRadius: '10px', padding: '16px', textAlign: 'center',
                  color: '#94a3b8', fontSize: '12px', marginBottom: '18px'
                }}>
                  No photograph attached to this report.
                </div>
              )}

              {/* Description Section */}
              <div style={{ marginBottom: '18px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                  Description
                </div>
                <p style={{ fontSize: '13px', color: '#334155', lineHeight: 1.5, margin: 0 }}>
                  {selectedComplaint.description || 'No description provided.'}
                </p>
              </div>

              {/* Location Section */}
              <div style={{ marginBottom: '18px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                  Location
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '13px', color: '#334155', lineHeight: 1.4 }}>
                  <MapPin size={15} color="#ef4444" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    {selectedComplaint.address || 'Address not available'}
                    {isValidCoordinate(selectedComplaint.latitude, selectedComplaint.longitude) && (
                      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                        Coordinates: {Number(selectedComplaint.latitude).toFixed(5)}, {Number(selectedComplaint.longitude).toFixed(5)}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Timeline Section */}
              <div style={{
                background: '#f8fafc', border: '1px solid #e2e8f0',
                borderRadius: '10px', padding: '12px 14px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748b', marginBottom: '6px' }}>
                  <CalendarDays size={14} />
                  <span>Reported on {formatDate(selectedComplaint.created_at)}</span>
                </div>
                {selectedComplaint.status === 'resolved' && selectedComplaint.resolved_at && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#16a34a', fontWeight: '600' }}>
                    <CheckCircle size={14} />
                    <span>Resolved on {formatDate(selectedComplaint.resolved_at)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Panel Footer */}
            <div style={{
              padding: '12px 20px', borderTop: '1px solid #f1f5f9',
              background: '#fafaf8', display: 'flex', gap: '8px'
            }}>
              <button
                onClick={() => {
                  const coords = parseStrictCoordinates(selectedComplaint.latitude, selectedComplaint.longitude);
                  if (coords) {
                    setMapCenter(coords);
                    setMapZoom(16);
                  }
                }}
                style={{
                  flex: 1, padding: '8px 14px', background: '#0f172a',
                  color: 'white', border: 'none', borderRadius: '8px',
                  fontSize: '12px', fontWeight: '600', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                }}
              >
                <Navigation size={13} /> Zoom to Location
              </button>
              <button
                onClick={() => setSelectedComplaint(null)}
                style={{
                  padding: '8px 14px', background: 'white',
                  color: '#64748b', border: '1px solid #cbd5e1',
                  borderRadius: '8px', fontSize: '12px', fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Leaflet MapContainer */}
        <MapContainer
          center={mapCenter}
          zoom={mapZoom}
          style={{ height: '100%', width: '100%' }}
        >
          <ChangeView center={mapCenter} zoom={mapZoom} />
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a> contributors'
          />

          <MarkersLayer
            groups={coordinateGroups}
            expandedClusters={expandedClusters}
            onToggleCluster={handleToggleCluster}
            selectedComplaint={selectedComplaint}
            onSelectComplaint={handleSelectComplaint}
          />
        </MapContainer>
      </div>
    </div>
  );
}

export default MapPage;
