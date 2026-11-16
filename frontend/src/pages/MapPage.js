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
import { CategoryIcon } from '../categories';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const statusColors = {
  open: '#c2410c',
  in_progress: '#a16207',
  resolved: '#15803d',
};

const statusConfig = {
  open: { color: '#c2410c', label: 'Open', bg: '#fff4ed', border: '#f8d3bf' },
  in_progress: { color: '#a16207', label: 'In Progress', bg: '#fefbe8', border: '#f3e3a3' },
  resolved: { color: '#15803d', label: 'Resolved', bg: '#f0fdf4', border: '#bbf7d0' },
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
    case 'Garbage Dump': return <Trash2 size={16} color="#4d4d48" />;
    case 'Open Drain': return <Waves size={16} color="#0284c7" />;
    case 'Other':
    default: return <MapPin size={16} color="#66665f" />;
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
  const color = statusColors[status] || '#c2410c';
  const size = isSelected ? 22 : 16;
  const borderWidth = isSelected ? 3.5 : 2.5;
  const shadow = isSelected
    ? '0 0 0 5px rgba(36,81,183, 0.45), 0 3px 8px rgba(0,0,0,0.4)'
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
  color: '#66665f',
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
          background: #1c1c1a;
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
        background: #2451b7;
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
  const sc = statusConfig[c.status] || { color: '#66665f', label: c.status, bg: '#f1f1ee', border: '#e3e2dc' };

  return (
    <Marker
      position={position}
      icon={getIcon(c.status, isSelected)}
      eventHandlers={{
        click: onSelect
      }}
    >
      <Popup>
        <div style={{ padding: '4px', minWidth: '220px', maxWidth: '260px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <CategoryIcon category={c.category} size={16} />
              <strong style={{ fontSize: '14px', color: '#1c1c1a' }}>{c.category}</strong>
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
                  borderRadius: '8px', border: '1px solid #e3e2dc'
                }}
              />
            </div>
          )}

          <p style={{
            fontSize: '12px', color: '#4d4d48', lineHeight: 1.4,
            marginBottom: '6px', maxHeight: '50px', overflow: 'hidden'
          }}>
            {c.description || 'No description provided.'}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#66665f', marginBottom: '6px' }}>
            <MapPin size={12} color="#c2410c" style={{ flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {c.address || 'Address unavailable'}
            </span>
          </div>

          <div style={{ fontSize: '11px', color: '#8f8e86', marginBottom: '10px' }}>
            Reported: {formatDate(c.created_at)}
          </div>

          <button
            onClick={onSelect}
            style={{
              width: '100%', padding: '6px 12px', background: '#1c1c1a',
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
      height: 'calc(100vh - 64px)',
      display: 'flex',
      flexDirection: 'column',
      background: '#f7f7f4',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Top Filter and Controls Bar */}
      <div style={{
        padding: '14px 24px',
        background: 'white',
        borderBottom: '1px solid #e3e2dc',
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
                background: '#15803d', animation: 'pulse 2s infinite'
              }} />
              <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#1c1c1a', margin: 0 }}>
                Live Complaints Map
              </h2>
            </div>
            <p style={{ fontSize: '12px', color: '#66665f', margin: '2px 0 0' }}>
              Showing {filtered.length} of {complaints.length} civic reports
            </p>
          </div>
        </div>

        {/* Center: Status and Category Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Status Filter Pills */}
          <div style={{ display: 'flex', background: '#f1f1ee', padding: '3px', borderRadius: '100px', gap: '2px' }}>
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
                  color: statusFilter === tab.id ? '#1c1c1a' : '#66665f',
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
                  background: statusFilter === tab.id ? '#1c1c1a' : '#e3e2dc',
                  color: statusFilter === tab.id ? 'white' : '#66665f'
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
                border: '1px solid #d4d3cc',
                fontSize: '12px',
                fontWeight: '600',
                color: '#3a3a36',
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
                border: '1px solid #d4d3cc',
                background: 'white',
                color: '#66665f',
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
              border: '1px solid #d4d3cc',
              background: 'white',
              color: '#3a3a36',
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
      <div style={{ flex: 1, position: 'relative', width: '100%', minHeight: 0 }}>
        {/* Error Banner Overlay */}
        {error && (
          <div style={{
            position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 1000, background: '#fff4ed', border: '1px solid #f8d3bf',
            borderRadius: '10px', padding: '10px 18px', display: 'flex', alignItems: 'center',
            gap: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
          }}>
            <AlertTriangle size={18} color="#c2410c" />
            <span style={{ fontSize: '13px', color: '#991b1b', fontWeight: '500' }}>{error}</span>
            <button
              onClick={fetchComplaints}
              style={{
                background: '#c2410c', color: 'white', border: 'none',
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
            backdropFilter: 'blur(8px)', border: '1px solid #e3e2dc',
            borderRadius: '8px', padding: '24px 32px', textAlign: 'center',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxWidth: '380px'
          }}>
            <Inbox size={36} color="#8f8e86" style={{ margin: '0 auto 10px' }} />
            <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#1c1c1a', margin: '0 0 6px' }}>
              No Complaints Found
            </h3>
            <p style={{ fontSize: '13px', color: '#66665f', margin: '0 0 14px' }}>
              There are no civic reports matching your selected status and category filters.
            </p>
            <button
              onClick={resetFilters}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '7px 16px', background: '#1c1c1a', color: 'white',
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
            zIndex: 1000, background: 'white', border: '1px solid #d4d3cc',
            borderRadius: '100px', padding: '8px 20px', display: 'flex', alignItems: 'center',
            gap: '10px', boxShadow: '0 4px 14px rgba(0,0,0,0.1)'
          }}>
            <RefreshCw size={15} color="#2f5fc4" className="spin" />
            <span style={{ fontSize: '13px', color: '#3a3a36', fontWeight: '600' }}>
              Loading civic map markers...
            </span>
          </div>
        )}

        {/* Floating Map Legend Card */}
        <div style={{
          position: 'absolute', bottom: '20px', left: '20px', zIndex: 1000,
          background: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(0,0,0,0.08)', borderRadius: '8px',
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
            <span style={{ fontSize: '12px', fontWeight: '700', color: '#1c1c1a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Status Legend
            </span>
            <span style={{ fontSize: '11px', color: '#66665f' }}>
              {isLegendOpen ? 'Hide' : 'Show'}
            </span>
          </div>

          {isLegendOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#c2410c', border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                <span style={{ fontSize: '12px', color: '#3a3a36' }}>Open Issue</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#a16207', border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                <span style={{ fontSize: '12px', color: '#3a3a36' }}>Work in Progress</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#15803d', border: '2px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                <span style={{ fontSize: '12px', color: '#3a3a36' }}>Resolved / Fixed</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '14px', height: '14px', borderRadius: '50%', background: '#2451b7',
                  border: '1.5px solid white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', fontSize: '9px', fontWeight: '700'
                }}>
                  +
                </div>
                <span style={{ fontSize: '12px', color: '#3a3a36' }}>Overlapping Group</span>
              </div>
            </div>
          )}
        </div>

        {/* Selected Complaint Detail Panel (Floating Sidebar) */}
        {selectedComplaint && (
          <div style={{
            position: 'absolute', top: '16px', right: '16px', bottom: '16px',
            width: '360px', maxWidth: 'calc(100vw - 32px)',
            background: 'white', borderRadius: '8px',
            border: '1px solid #e3e2dc', boxShadow: '0 12px 28px rgba(0,0,0,0.15)',
            zIndex: 1000, display: 'flex', flexDirection: 'column', overflow: 'hidden'
          }}>
            {/* Panel Header */}
            <div style={{
              padding: '16px 20px', borderBottom: '1px solid #f1f1ee',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: '#f7f7f4'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  background: '#f1f1ee', width: '32px', height: '32px',
                  borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  {getCategoryIconComponent(selectedComplaint.category)}
                </div>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: '700', color: '#1c1c1a', margin: 0 }}>
                    {selectedComplaint.category}
                  </h3>
                  <span style={{ fontSize: '11px', color: '#66665f' }}>
                    Complaint #{selectedComplaint.id}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  padding: '3px 10px', borderRadius: '100px', fontSize: '11px', fontWeight: '700',
                  background: statusConfig[selectedComplaint.status]?.bg || '#f1f1ee',
                  color: statusConfig[selectedComplaint.status]?.color || '#66665f',
                  border: `1px solid ${statusConfig[selectedComplaint.status]?.border || '#e3e2dc'}`
                }}>
                  {statusConfig[selectedComplaint.status]?.label || selectedComplaint.status}
                </span>

                <button
                  onClick={() => setSelectedComplaint(null)}
                  title="Close details"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#8f8e86', padding: '2px', display: 'flex', alignItems: 'center'
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
                        borderRadius: '10px', border: '1px solid #e3e2dc', display: 'block'
                      }}
                    />
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      fontSize: '11px', color: '#2f5fc4', marginTop: '6px', fontWeight: '600'
                    }}>
                      <Eye size={12} /> View original photo in full size
                    </div>
                  </a>
                </div>
              ) : (
                <div style={{
                  background: '#f8f8f6', border: '1px dashed #d4d3cc',
                  borderRadius: '10px', padding: '16px', textAlign: 'center',
                  color: '#8f8e86', fontSize: '12px', marginBottom: '18px'
                }}>
                  No photograph attached to this report.
                </div>
              )}

              {/* Description Section */}
              <div style={{ marginBottom: '18px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#66665f', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                  Description
                </div>
                <p style={{ fontSize: '13px', color: '#3a3a36', lineHeight: 1.5, margin: 0 }}>
                  {selectedComplaint.description || 'No description provided.'}
                </p>
              </div>

              {/* Location Section */}
              <div style={{ marginBottom: '18px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#66665f', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                  Location
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '13px', color: '#3a3a36', lineHeight: 1.4 }}>
                  <MapPin size={15} color="#c2410c" style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    {selectedComplaint.address || 'Address not available'}
                    {isValidCoordinate(selectedComplaint.latitude, selectedComplaint.longitude) && (
                      <div style={{ fontSize: '11px', color: '#8f8e86', marginTop: '2px' }}>
                        Coordinates: {Number(selectedComplaint.latitude).toFixed(5)}, {Number(selectedComplaint.longitude).toFixed(5)}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Timeline Section */}
              <div style={{
                background: '#f8f8f6', border: '1px solid #e3e2dc',
                borderRadius: '10px', padding: '12px 14px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#66665f', marginBottom: '6px' }}>
                  <CalendarDays size={14} />
                  <span>Reported on {formatDate(selectedComplaint.created_at)}</span>
                </div>
                {selectedComplaint.status === 'resolved' && selectedComplaint.resolved_at && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#15803d', fontWeight: '600' }}>
                    <CheckCircle size={14} />
                    <span>Resolved on {formatDate(selectedComplaint.resolved_at)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Panel Footer */}
            <div style={{
              padding: '12px 20px', borderTop: '1px solid #f1f1ee',
              background: '#f7f7f4', display: 'flex', gap: '8px'
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
                  flex: 1, padding: '8px 14px', background: '#1c1c1a',
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
                  color: '#66665f', border: '1px solid #d4d3cc',
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
