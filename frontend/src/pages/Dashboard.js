import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import io from 'socket.io-client';
import { API_URL, SOCKET_URL, getImageUrl } from '../config';
import { getStoredUser } from '../categories';
import {
  ShieldAlert, HardHat, AlertTriangle, Trash2, Waves, MapPin,
  List, AlertOctagon, Wrench, CheckSquare, RefreshCw, XCircle,
  Play, CheckCircle, Clock, Inbox, PartyPopper, User, CalendarDays,
  UserPlus, Plus, Check, AlertCircle, FileText
} from 'lucide-react';

const statusConfig = {
  open: { color: '#c2410c', label: 'Open', bg: '#fff4ed', border: '#f8d3bf' },
  in_progress: { color: '#a16207', label: 'In Progress', bg: '#fefbe8', border: '#f3e3a3' },
  resolved: { color: '#15803d', label: 'Resolved', bg: '#f0fdf4', border: '#bbf7d0' },
};

const getCategoryIcon = (category) => {
  switch (category) {
    case 'Pothole': return <AlertTriangle size={20} strokeWidth={2.5} color="#4d4d48" />;
    case 'Broken Streetlight': return <AlertOctagon size={20} strokeWidth={2.5} color="#4d4d48" />;
    case 'Garbage Dump': return <Trash2 size={20} strokeWidth={2.5} color="#4d4d48" />;
    case 'Open Drain': return <Waves size={20} strokeWidth={2.5} color="#4d4d48" />;
    default: return <MapPin size={20} strokeWidth={2.5} color="#4d4d48" />;
  }
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

function Dashboard() {
  const [complaints, setComplaints] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [filter, setFilter] = useState('all');
  const [assigningId, setAssigningId] = useState(null);
  const [selectedWorker, setSelectedWorker] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [live, setLive] = useState(false);
  const [notice, setNotice] = useState(null);

  // Resolution modal state for staff (officer & worker)
  const [resolvingComplaint, setResolvingComplaint] = useState(null);
  const [resolutionFile, setResolutionFile] = useState(null);
  const [resolutionFilePreview, setResolutionFilePreview] = useState(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [submittingResolution, setSubmittingResolution] = useState(false);
  const [resolutionError, setResolutionError] = useState(null);

  // Citizen verification state
  const [reopeningId, setReopeningId] = useState(null);
  const [reopeningFeedback, setReopeningFeedback] = useState('');
  const [submittingVerification, setSubmittingVerification] = useState(false);

  const token = localStorage.getItem('token');
  const user = getStoredUser();

  useEffect(() => {
    fetchComplaints();
    if (user.role === 'officer') fetchWorkers();

    // Live updates: refresh this role's list whenever any complaint changes
    const socket = io(SOCKET_URL);
    let refreshTimer = null;
    const scheduleRefresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => fetchComplaints('silent'), 300);
    };
    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));
    socket.on('newComplaint', scheduleRefresh);
    socket.on('statusUpdated', scheduleRefresh);
    return () => {
      clearTimeout(refreshTimer);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // mode: undefined (initial load), 'manual' (Refresh button) or 'silent' (live update)
  const fetchComplaints = async (mode) => {
    if (mode === 'manual' || mode === true) {
      setRefreshing(true);
    } else if (mode !== 'silent') {
      setLoading(true);
    }
    if (mode !== 'silent') setError(null);

    try {
      const endpoint = user.role === 'worker'
        ? `${API_URL}/complaints/assigned`
        : user.role === 'officer'
          ? `${API_URL}/complaints/officer`
          : `${API_URL}/complaints/my`;

      const res = await axios.get(endpoint, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setComplaints(res.data);
      setError(null);
    } catch (err) {
      console.error('[Dashboard Error] Failed to fetch complaints:', err);
      if (mode !== 'silent') {
        setError(err.response?.data?.error || 'Failed to load complaints. Please check your connection and try again.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchWorkers = async () => {
    try {
      const res = await axios.get(`${API_URL}/complaints/workers`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setWorkers(res.data);
    } catch (err) {
      console.error('[Dashboard Error] Failed to fetch workers:', err);
    }
  };

  const showNotice = (type, text) => {
    setNotice({ type, text });
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(() => setNotice(null), 5000);
  };

  const assignWorker = async (complaintId) => {
    if (!selectedWorker[complaintId]) return showNotice('error', 'Please select a field worker first.');
    try {
      const res = await axios.patch(
        `${API_URL}/complaints/${complaintId}/assign`,
        { worker_id: selectedWorker[complaintId] },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setAssigningId(null);
      setComplaints(prev => prev.map(c => c.id === complaintId ? res.data : c));
      showNotice('success', `Complaint #${complaintId} assigned to ${res.data.worker_name || 'the selected worker'}.`);
    } catch (err) {
      showNotice('error', err.response?.data?.error || 'Failed to assign the complaint.');
    }
  };

  const updateStatus = async (id, status) => {
    try {
      await axios.patch(
        `${API_URL}/complaints/${id}/status`,
        { status },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setComplaints(prev =>
        prev.map(c =>
          c.id === id
            ? { ...c, status, resolved_at: status === 'resolved' ? new Date().toISOString() : c.resolved_at }
            : c
        )
      );
      showNotice('success', `Complaint #${id} moved to ${statusConfig[status]?.label || status}.`);
    } catch (err) {
      showNotice('error', err.response?.data?.error || 'Failed to update status.');
    }
  };

  // Resolution workflow handlers (staff)
  const handleResolutionFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setResolutionError('Resolution photograph must be smaller than 5 MB.');
      return;
    }
    setResolutionError(null);
    setResolutionFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setResolutionFilePreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const submitResolution = async (e) => {
    if (e) e.preventDefault();
    if (!resolvingComplaint) return;
    if (!resolutionFile) {
      setResolutionError('A resolution photograph is required to mark this issue resolved.');
      return;
    }

    setSubmittingResolution(true);
    setResolutionError(null);

    const formData = new FormData();
    formData.append('resolution_image', resolutionFile);
    if (resolutionNotes.trim()) {
      formData.append('resolution_notes', resolutionNotes.trim());
    }

    try {
      const res = await axios.post(
        `${API_URL}/complaints/${resolvingComplaint.id}/resolve`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data',
          },
        }
      );
      setComplaints(prev => prev.map(c => c.id === resolvingComplaint.id ? res.data : c));
      showNotice('success', `Complaint #${resolvingComplaint.id} resolved. The citizen has been asked to verify the fix.`);
      closeResolutionModal();
    } catch (err) {
      setResolutionError(err.response?.data?.error || 'Failed to submit resolution. Please try again.');
    } finally {
      setSubmittingResolution(false);
    }
  };

  const closeResolutionModal = () => {
    setResolvingComplaint(null);
    setResolutionFile(null);
    setResolutionFilePreview(null);
    setResolutionNotes('');
    setResolutionError(null);
    setSubmittingResolution(false);
  };

  // Citizen verification handler
  const handleVerify = async (complaintId, action, feedback = '') => {
    setSubmittingVerification(true);
    try {
      const res = await axios.post(
        `${API_URL}/complaints/${complaintId}/verify`,
        { action, feedback },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setComplaints(prev => prev.map(c => c.id === complaintId ? res.data : c));
      setReopeningId(null);
      setReopeningFeedback('');
      showNotice('success', action === 'confirm'
        ? 'Thank you! You confirmed this issue is fixed.'
        : 'Reopen request sent. The ward team has been notified.');
    } catch (err) {
      showNotice('error', err.response?.data?.error || 'Failed to submit verification.');
    } finally {
      setSubmittingVerification(false);
    }
  };

  const filtered = filter === 'all' ? complaints : complaints.filter(c => c.status === filter);
  const stats = {
    total: complaints.length,
    open: complaints.filter(c => c.status === 'open').length,
    in_progress: complaints.filter(c => c.status === 'in_progress').length,
    resolved: complaints.filter(c => c.status === 'resolved').length,
  };

  const roleMeta = {
    citizen: {
      badgeIcon: <FileText size={16} />,
      badgeLabel: 'Citizen Portal',
      title: 'My Reported Complaints',
      subtitle: 'Track resolution progress, verify staff repairs, and monitor your civic reports in real-time.'
    },
    officer: {
      badgeIcon: <ShieldAlert size={16} />,
      badgeLabel: 'Ward Officer Dashboard',
      title: 'Complaint Management',
      subtitle: 'Overview of civic issues, assignments, staff resolution proof, and citizen confirmations.'
    },
    worker: {
      badgeIcon: <HardHat size={16} />,
      badgeLabel: 'Field Worker Dashboard',
      title: 'My Assigned Tasks',
      subtitle: 'Review assignments, submit photographic resolution proof, and address reopened complaints.'
    }
  }[user.role] || {
    badgeIcon: <FileText size={16} />,
    badgeLabel: 'Citizen Portal',
    title: 'My Reported Complaints',
    subtitle: 'Track your reported civic issues.'
  };

  return (
    <div style={{ minHeight: 'calc(100vh - 64px)', background: '#f7f7f4', padding: '32px 16px' }}>
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>

        {/* Action feedback toast */}
        {notice && (
          <div role="status" style={{
            position: 'fixed', top: '80px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 2500, maxWidth: 'calc(100vw - 32px)',
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '12px 18px', borderRadius: '8px', fontSize: '14px', fontWeight: '600',
            background: notice.type === 'success' ? '#f0fdf4' : '#fff4ed',
            color: notice.type === 'success' ? '#15803d' : '#b91c1c',
            border: `1px solid ${notice.type === 'success' ? '#bbf7d0' : '#f8d3bf'}`,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
          }}>
            {notice.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss" style={{
              background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex'
            }}><XCircle size={16} /></button>
          </div>
        )}

        {/* Header Section */}
        <div style={{
          marginBottom: '32px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '16px'
        }}>
          <div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              color: '#66665f', fontSize: '13px', fontWeight: '600',
              marginBottom: '10px'
            }}>
              {roleMeta.badgeIcon}
              {roleMeta.badgeLabel}
              <span title={live ? 'Receiving real-time updates' : 'Real-time connection unavailable'} style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px', marginLeft: '8px',
                padding: '2px 8px', borderRadius: '100px', fontSize: '11px', fontWeight: '700',
                background: live ? '#f0fdf4' : '#f1f1ee', color: live ? '#15803d' : '#8f8e86',
                border: `1px solid ${live ? '#bbf7d0' : '#e3e2dc'}`
              }}>
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  background: live ? '#15803d' : '#8f8e86',
                  animation: live ? 'pulse 2s infinite' : 'none'
                }} />
                {live ? 'Live' : 'Offline'}
              </span>
            </div>
            <h2 style={{ fontSize: '28px', fontWeight: '700', color: '#1c1c1a', letterSpacing: '-0.5px', margin: 0 }}>
              {roleMeta.title}
            </h2>
            <p style={{ color: '#555', fontSize: '14px', marginTop: '6px', maxWidth: '580px' }}>
              {roleMeta.subtitle}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={() => fetchComplaints(true)}
              disabled={refreshing}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                padding: '9px 16px', background: 'white', border: '1px solid #d4d3cc',
                borderRadius: '100px', fontSize: '13px', fontWeight: '600', color: '#3a3a36',
                cursor: refreshing ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
              }}
            >
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>

            {user.role === 'citizen' && (
              <Link to="/report" style={{ textDecoration: 'none' }}>
                <button style={{
                  display: 'inline-flex', alignItems: 'center', gap: '8px',
                  padding: '9px 18px', background: '#2451b7', color: 'white',
                  border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600',
                  cursor: 'pointer'
                }}>
                  <Plus size={16} /> Report an issue
                </button>
              </Link>
            )}
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div style={{
            background: '#fff4ed', border: '1px solid #f8d3bf', borderRadius: '8px',
            padding: '16px 20px', marginBottom: '24px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
            flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <AlertCircle size={20} color="#c2410c" />
              <span style={{ color: '#991b1b', fontSize: '14px', fontWeight: '500' }}>{error}</span>
            </div>
            <button
              onClick={() => fetchComplaints()}
              style={{
                background: '#c2410c', color: 'white', border: 'none',
                borderRadius: '6px', padding: '6px 14px', fontSize: '13px',
                fontWeight: '600', cursor: 'pointer'
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Pastel Stats Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '16px',
          marginBottom: '32px'
        }}>
          {[
            { label: 'Total Reports', count: stats.total, icon: <List size={18} color="#66665f" />, bg: '#ffffff' },
            { label: 'Open Issues', count: stats.open, icon: <AlertOctagon size={18} color="#66665f" />, bg: '#ffffff' },
            { label: 'In Progress', count: stats.in_progress, icon: <Wrench size={18} color="#66665f" />, bg: '#ffffff' },
            { label: 'Resolved', count: stats.resolved, icon: <CheckSquare size={18} color="#66665f" />, bg: '#ffffff' },
          ].map(s => (
            <div key={s.label} style={{
              background: s.bg,
              border: '1px solid #e3e2dc',
              borderRadius: '8px', padding: '20px',
              display: 'flex', flexDirection: 'column', gap: '12px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', fontWeight: '500', color: '#66665f' }}>{s.label}</span>
                {s.icon}
              </div>
              <div style={{ fontSize: '30px', fontWeight: '700', color: '#1c1c1a', lineHeight: 1 }}>
                {s.count}
              </div>
            </div>
          ))}
        </div>

        {/* Filter Tabs */}
        <div style={{
          borderBottom: '1px solid #e3e2dc', marginBottom: '24px',
          display: 'flex', gap: '20px', overflowX: 'auto'
        }}>
          {[
            { key: 'all', label: 'All Complaints', count: stats.total },
            { key: 'open', label: 'Open', count: stats.open },
            { key: 'in_progress', label: 'In Progress', count: stats.in_progress },
            { key: 'resolved', label: 'Resolved', count: stats.resolved },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              style={{
                background: 'none', border: 'none',
                padding: '12px 4px',
                borderBottom: filter === tab.key ? '2px solid #1c1c1a' : '2px solid transparent',
                color: filter === tab.key ? '#1c1c1a' : '#66665f',
                cursor: 'pointer', fontSize: '14px', fontWeight: '600', transition: 'all 0.2s',
                marginBottom: '-1px', display: 'flex', alignItems: 'center', gap: '8px',
                whiteSpace: 'nowrap'
              }}
            >
              <span>{tab.label}</span>
              <span style={{
                fontSize: '11px',
                padding: '2px 7px',
                borderRadius: '10px',
                background: filter === tab.key ? '#1c1c1a' : '#f1f1ee',
                color: filter === tab.key ? 'white' : '#66665f'
              }}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Loading Spinner State */}
        {loading && complaints.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '64px 20px',
            background: 'white', border: '1px solid #e3e2dc', borderRadius: '8px'
          }}>
            <RefreshCw size={32} color="#66665f" className="spin" style={{ margin: '0 auto 16px' }} />
            <h3 style={{ fontSize: '16px', color: '#1c1c1a', fontWeight: '600', marginBottom: '4px' }}>
              Loading complaints...
            </h3>
            <p style={{ fontSize: '13px', color: '#66665f' }}>
              Please wait while we retrieve the latest information.
            </p>
          </div>
        ) : (
          /* Complaints List View */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {filtered.map(c => {
              const sc = statusConfig[c.status] || { color: '#66665f', label: c.status, bg: '#f1f1ee', border: '#e3e2dc' };

              return (
                <div key={c.id} className="dash-card" style={{
                  background: 'white',
                  border: '1px solid #e3e2dc',
                  borderRadius: '8px', padding: '24px',
                  display: 'flex', gap: '20px', alignItems: 'flex-start',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                  transition: 'all 0.2s'
                }}>
                  {/* Category Icon */}
                  <div className="dash-cat-icon" style={{
                    background: '#f1f1ee', width: '44px', height: '44px',
                    borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    {getCategoryIcon(c.category)}
                  </div>

                  {/* Main Content Area */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      alignItems: 'flex-start', marginBottom: '8px', flexWrap: 'wrap', gap: '8px'
                    }}>
                      <div>
                        <h3 style={{ fontSize: '17px', fontWeight: '700', color: '#1c1c1a', margin: 0 }}>
                          {c.category}
                        </h3>

                        {/* Metadata Row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '6px', flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: '#66665f' }}>
                            <CalendarDays size={14} />
                            {formatDate(c.created_at)}
                          </div>
                          {c.address && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: '#66665f' }}>
                              <MapPin size={14} />
                              {c.address}
                            </div>
                          )}
                          {c.citizen_name && user.role !== 'citizen' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: '#66665f' }}>
                              <User size={14} />
                              Reported by {c.citizen_name}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Status Badges Header Row */}
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {/* Confirmation Badge for Resolved issues (only when resolution proof exists and not_required is not set) */}
                        {c.status === 'resolved' && c.citizen_confirmation_status && c.citizen_confirmation_status !== 'not_required' && c.resolution_image_url && (
                          <div style={{
                            display: 'inline-flex', alignItems: 'center', gap: '5px',
                            padding: '4px 10px', borderRadius: '100px', fontSize: '11px', fontWeight: '700',
                            background: c.citizen_confirmation_status === 'confirmed' ? '#f0fdf4' : c.citizen_confirmation_status === 'reopened' ? '#fff4ed' : '#fefbe8',
                            color: c.citizen_confirmation_status === 'confirmed' ? '#15803d' : c.citizen_confirmation_status === 'reopened' ? '#dc2626' : '#d97706',
                            border: `1px solid ${c.citizen_confirmation_status === 'confirmed' ? '#bbf7d0' : c.citizen_confirmation_status === 'reopened' ? '#f8d3bf' : '#f3e3a3'}`
                          }}>
                            {c.citizen_confirmation_status === 'confirmed' ? <CheckCircle size={12} /> : c.citizen_confirmation_status === 'reopened' ? <AlertTriangle size={12} /> : <Clock size={12} />}
                            {c.citizen_confirmation_status === 'confirmed' ? 'Citizen Confirmed' : c.citizen_confirmation_status === 'reopened' ? 'Citizen Reopened' : 'Confirmation Pending'}
                          </div>
                        )}

                        {/* Status Badge Pill */}
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', gap: '6px',
                          padding: '4px 12px', borderRadius: '100px',
                          background: sc.bg, border: `1px solid ${sc.border}`
                        }}>
                          <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: sc.color }} />
                          <span style={{ fontSize: '12px', fontWeight: '700', color: sc.color }}>
                            {sc.label}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Complaint Description */}
                    <p style={{ color: '#4d4d48', fontSize: '14px', lineHeight: 1.5, margin: '12px 0' }}>
                      {c.description}
                    </p>

                    {/* Citizen Reopening Attention Banner (for staff) */}
                    {c.citizen_confirmation_status === 'reopened' && user.role !== 'citizen' && (
                      <div style={{
                        background: '#fff4ed',
                        border: '1px solid #f8d3bf',
                        borderRadius: '10px',
                        padding: '12px 14px',
                        margin: '12px 0',
                        display: 'flex',
                        gap: '10px',
                        alignItems: 'flex-start'
                      }}>
                        <AlertTriangle size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: '2px' }} />
                        <div style={{ fontSize: '13px' }}>
                          <span style={{ fontWeight: '700', color: '#991b1b' }}>Citizen Reopened This Task: </span>
                          <span style={{ color: '#7f1d1d' }}>{c.citizen_feedback || 'Citizen indicated the resolution was incomplete.'}</span>
                          {c.citizen_feedback_at && (
                            <span style={{ color: '#991b1b', fontSize: '11px', display: 'block', marginTop: '3px' }}>
                              Reopened on {formatDate(c.citizen_feedback_at)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Photographs: Before & After Evidence Display */}
                    {(c.image_url || c.resolution_image_url) && (
                      <div style={{
                        display: 'flex',
                        gap: '16px',
                        margin: '16px 0',
                        flexWrap: 'wrap'
                      }}>
                        {c.image_url && (
                          <div style={{ flex: '1 1 180px', maxWidth: '240px' }}>
                            <div style={{ fontSize: '12px', fontWeight: '700', color: '#66665f', marginBottom: '6px' }}>
                              Original Evidence (Before)
                            </div>
                            <a href={getImageUrl(c.image_url)} target="_blank" rel="noopener noreferrer">
                              <img
                                src={getImageUrl(c.image_url)}
                                alt="Original complaint evidence"
                                style={{
                                  width: '100%', height: '110px', objectFit: 'cover',
                                  borderRadius: '8px', border: '1px solid #e3e2dc'
                                }}
                              />
                            </a>
                          </div>
                        )}

                        {c.resolution_image_url && (
                          <div style={{ flex: '1 1 180px', maxWidth: '240px' }}>
                            <div style={{ fontSize: '12px', fontWeight: '700', color: '#15803d', marginBottom: '6px' }}>
                              Resolution Proof (After)
                            </div>
                            <a href={getImageUrl(c.resolution_image_url)} target="_blank" rel="noopener noreferrer">
                              <img
                                src={getImageUrl(c.resolution_image_url)}
                                alt="Resolution evidence proof"
                                style={{
                                  width: '100%', height: '110px', objectFit: 'cover',
                                  borderRadius: '8px', border: '2px solid #bbf7d0'
                                }}
                              />
                            </a>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Resolution Notes Display */}
                    {c.resolution_notes && (
                      <div style={{
                        background: '#f8f8f6',
                        border: '1px solid #e3e2dc',
                        borderRadius: '8px',
                        padding: '10px 14px',
                        margin: '12px 0',
                        fontSize: '13px',
                        color: '#3a3a36'
                      }}>
                        <span style={{ fontWeight: '700', color: '#1c1c1a' }}>Staff Resolution Notes: </span>
                        {c.resolution_notes}
                      </div>
                    )}

                    {/* Citizen Verification Block (only for resolved complaints with resolution proof and pending confirmation) */}
                    {user.role === 'citizen' && c.status === 'resolved' && (
                      c.citizen_confirmation_status === 'confirmed' ? (
                        <div style={{
                          marginTop: '16px',
                          padding: '14px 16px',
                          borderRadius: '10px',
                          background: '#f0fdf4',
                          border: '1px solid #bbf7d0'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#15803d', fontSize: '13px', fontWeight: '600' }}>
                            <CheckCircle size={16} />
                            You confirmed this issue was resolved successfully. Thank you for helping improve our community!
                          </div>
                        </div>
                      ) : c.citizen_confirmation_status === 'reopened' ? (
                        <div style={{
                          marginTop: '16px',
                          padding: '14px 16px',
                          borderRadius: '10px',
                          background: '#fff4ed',
                          border: '1px solid #f8d3bf'
                        }}>
                          <div style={{ fontSize: '13px', color: '#991b1b' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '700' }}>
                              <AlertCircle size={16} color="#dc2626" />
                              You requested this complaint be reopened for further work.
                            </div>
                            {c.citizen_feedback && (
                              <p style={{ margin: '6px 0 0', color: '#7f1d1d', fontSize: '12px' }}>
                                Reason: "{c.citizen_feedback}"
                              </p>
                            )}
                          </div>
                        </div>
                      ) : (c.resolution_image_url && c.citizen_confirmation_status === 'pending') ? (
                        <div style={{
                          marginTop: '16px',
                          padding: '14px 16px',
                          borderRadius: '10px',
                          background: '#eff6ff',
                          border: '1px solid #bfdbfe'
                        }}>
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e40af', marginBottom: '8px' }}>
                              Please verify this resolution: Did the civic authority fix this issue to your satisfaction?
                            </div>

                            {reopeningId === c.id ? (
                              <div style={{ marginTop: '10px' }}>
                                <textarea
                                  value={reopeningFeedback}
                                  onChange={(e) => setReopeningFeedback(e.target.value)}
                                  placeholder="Please explain what remains incomplete (e.g. pothole patch has caved in, debris left on street)..."
                                  rows={3}
                                  style={{
                                    width: '100%',
                                    padding: '10px',
                                    borderRadius: '8px',
                                    border: '1px solid #d4d3cc',
                                    fontSize: '13px',
                                    marginBottom: '10px',
                                    fontFamily: 'inherit',
                                    boxSizing: 'border-box'
                                  }}
                                />
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                  <button
                                    onClick={() => handleVerify(c.id, 'reopen', reopeningFeedback)}
                                    disabled={submittingVerification || !reopeningFeedback.trim()}
                                    style={{
                                      padding: '8px 16px',
                                      background: '#dc2626',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '6px',
                                      fontSize: '13px',
                                      fontWeight: '600',
                                      cursor: submittingVerification || !reopeningFeedback.trim() ? 'not-allowed' : 'pointer'
                                    }}
                                  >
                                    {submittingVerification ? 'Submitting...' : 'Submit Reopening Request'}
                                  </button>
                                  <button
                                    onClick={() => { setReopeningId(null); setReopeningFeedback(''); }}
                                    style={{
                                      padding: '8px 16px',
                                      background: 'transparent',
                                      color: '#66665f',
                                      border: '1px solid #d4d3cc',
                                      borderRadius: '6px',
                                      fontSize: '13px',
                                      cursor: 'pointer'
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                <button
                                  onClick={() => handleVerify(c.id, 'confirm')}
                                  disabled={submittingVerification}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '8px 16px',
                                    background: '#15803d',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    fontSize: '13px',
                                    fontWeight: '600',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <CheckCircle size={15} /> Confirm Fixed
                                </button>
                                <button
                                  onClick={() => setReopeningId(c.id)}
                                  disabled={submittingVerification}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '8px 16px',
                                    background: 'white',
                                    color: '#dc2626',
                                    border: '1px solid #f8d3bf',
                                    borderRadius: '6px',
                                    fontSize: '13px',
                                    fontWeight: '600',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <RefreshCw size={14} /> Request Reopening
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null
                    )}

                    {/* Visual Progress Tracker (Read-Only) */}
                    <div style={{
                      marginTop: '16px',
                      padding: '16px',
                      background: '#f8f8f6',
                      borderRadius: '8px',
                      border: '1px solid #e3e2dc'
                    }}>
                      <div style={{
                        fontSize: '11px',
                        fontWeight: '700',
                        color: '#66665f',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        marginBottom: '14px'
                      }}>
                        Resolution Progress
                      </div>

                      <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        position: 'relative'
                      }}>
                        {/* Step 1: Reported */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, textAlign: 'center', zIndex: 1 }}>
                          <div style={{
                            width: '28px', height: '28px', borderRadius: '50%',
                            background: '#15803d', color: 'white',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            marginBottom: '6px'
                          }}>
                            <Check size={16} strokeWidth={3} />
                          </div>
                          <span style={{ fontSize: '13px', fontWeight: '600', color: '#1c1c1a' }}>Reported</span>
                          <span style={{ fontSize: '11px', color: '#66665f', marginTop: '2px' }}>
                            {formatDate(c.created_at) || 'Submitted'}
                          </span>
                        </div>

                        {/* Progress Bar 1 */}
                        <div style={{
                          flex: 1, height: '3px',
                          background: c.status === 'in_progress' || c.status === 'resolved' ? '#15803d' : '#d4d3cc',
                          marginTop: '13px', marginInline: '-6px', zIndex: 0
                        }} />

                        {/* Step 2: In Progress */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, textAlign: 'center', zIndex: 1 }}>
                          <div style={{
                            width: '28px', height: '28px', borderRadius: '50%',
                            background: c.status === 'resolved'
                              ? '#15803d'
                              : c.status === 'in_progress'
                                ? '#a16207'
                                : '#e3e2dc',
                            color: c.status === 'resolved' || c.status === 'in_progress' ? 'white' : '#8f8e86',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            marginBottom: '6px'
                          }}>
                            {c.status === 'resolved' ? <Check size={16} strokeWidth={3} /> : <Wrench size={14} />}
                          </div>
                          <span style={{
                            fontSize: '13px',
                            fontWeight: '600',
                            color: c.status === 'in_progress' ? '#b45309' : c.status === 'resolved' ? '#1c1c1a' : '#66665f'
                          }}>
                            In Progress
                          </span>
                          <span style={{ fontSize: '11px', color: '#66665f', marginTop: '2px' }}>
                            {c.worker_name ? `Worker: ${c.worker_name}` : (c.status === 'open' ? 'Awaiting assignment' : 'Under work')}
                          </span>
                        </div>

                        {/* Progress Bar 2 */}
                        <div style={{
                          flex: 1, height: '3px',
                          background: c.status === 'resolved' ? '#15803d' : '#d4d3cc',
                          marginTop: '13px', marginInline: '-6px', zIndex: 0
                        }} />

                        {/* Step 3: Resolved */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, textAlign: 'center', zIndex: 1 }}>
                          <div style={{
                            width: '28px', height: '28px', borderRadius: '50%',
                            background: c.status === 'resolved' ? '#15803d' : '#e3e2dc',
                            color: c.status === 'resolved' ? 'white' : '#8f8e86',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            marginBottom: '6px'
                          }}>
                            {c.status === 'resolved' ? <Check size={16} strokeWidth={3} /> : <CheckCircle size={14} />}
                          </div>
                          <span style={{
                            fontSize: '13px',
                            fontWeight: '600',
                            color: c.status === 'resolved' ? '#15803d' : '#66665f'
                          }}>
                            {c.status === 'resolved' && c.citizen_confirmation_status === 'confirmed' ? 'Verified Fixed' : 'Resolved'}
                          </span>
                          <span style={{ fontSize: '11px', color: '#66665f', marginTop: '2px' }}>
                            {c.status === 'resolved'
                              ? (c.resolved_at ? formatDate(c.resolved_at) : 'Completed')
                              : 'Pending completion'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action & Assignment Management Row */}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      paddingTop: '16px', borderTop: '1px solid #f1f1ee', marginTop: '16px',
                      flexWrap: 'wrap', gap: '10px'
                    }}>
                      {/* Left: Assignment Information */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {c.worker_name ? (
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            fontSize: '13px', color: '#3a3a36', background: '#f8f8f6',
                            padding: '4px 10px', borderRadius: '6px', border: '1px solid #e3e2dc'
                          }}>
                            <HardHat size={14} color="#66665f" />
                            Assigned to <span style={{ fontWeight: '600' }}>{c.worker_name}</span>
                          </div>
                        ) : (
                          c.status !== 'resolved' ? (
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: '6px',
                              fontSize: '13px', color: user.role === 'officer' ? '#c2410c' : '#66665f'
                            }}>
                              <AlertTriangle size={14} color={user.role === 'officer' ? '#c2410c' : '#66665f'} />
                              {user.role === 'officer' ? 'Unassigned' : 'Awaiting worker assignment'}
                            </div>
                          ) : null
                        )}
                      </div>

                      {/* Right: Actions (Strictly role-restricted) */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {/* Officer Assignment Dropdown */}
                        {user.role === 'officer' && c.status !== 'resolved' && (
                          assigningId === c.id ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <select
                                value={selectedWorker[c.id] || ''}
                                onChange={e => setSelectedWorker({ ...selectedWorker, [c.id]: e.target.value })}
                                style={{
                                  padding: '6px 12px', borderRadius: '6px', border: '1px solid #d4d3cc',
                                  fontSize: '13px', outline: 'none', background: 'white', margin: 0, width: '160px'
                                }}
                              >
                                <option value="">Select worker...</option>
                                {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                              </select>
                              <button onClick={() => assignWorker(c.id)} style={{
                                padding: '7px 12px', background: '#1c1c1a', color: 'white',
                                border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600'
                              }}>Save</button>
                              <button onClick={() => setAssigningId(null)} style={{
                                padding: '7px', background: 'transparent', color: '#66665f',
                                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center'
                              }}><XCircle size={18} /></button>
                            </div>
                          ) : (
                            <button onClick={() => setAssigningId(c.id)} style={{
                              display: 'flex', alignItems: 'center', gap: '6px',
                              padding: '6px 12px', background: 'transparent',
                              color: '#1c1c1a', border: '1px solid #d4d3cc',
                              borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600'
                            }}>
                              {c.assigned_to ? <RefreshCw size={14} /> : <UserPlus size={14} />}
                              {c.assigned_to ? 'Reassign' : 'Assign'}
                            </button>
                          )
                        )}

                        {/* Officer: Start Task */}
                        {user.role === 'officer' && c.status === 'open' && (
                          <button onClick={() => updateStatus(c.id, 'in_progress')} style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '6px 12px', background: '#1c1c1a', color: 'white', border: 'none',
                            borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600'
                          }}>
                            <Play size={14} /> Start Task
                          </button>
                        )}

                        {/* Officer or Assigned Worker: Mark Resolved with Proof (Opens Resolution Modal) */}
                        {(user.role === 'officer' || user.role === 'worker') && c.status === 'in_progress' && (
                          <button
                            onClick={() => {
                              setResolvingComplaint(c);
                              setResolutionFile(null);
                              setResolutionFilePreview(null);
                              setResolutionNotes('');
                              setResolutionError(null);
                            }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '6px',
                              padding: '7px 14px', background: '#15803d', color: 'white', border: 'none',
                              borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600'
                            }}
                          >
                            <CheckCircle size={14} /> Submit Resolution Proof
                          </button>
                        )}

                        {/* Worker: Open Task Notice */}
                        {user.role === 'worker' && c.status === 'open' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#66665f', fontSize: '13px' }}>
                            <Clock size={14} /> Pending Assignment
                          </div>
                        )}

                        {/* Citizen: Read-Only Status Indicator */}
                        {user.role === 'citizen' && (
                          c.status === 'resolved' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#15803d', fontSize: '13px', fontWeight: '600' }}>
                              <CheckCircle size={15} /> Issue Resolved
                            </div>
                          ) : c.status === 'in_progress' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#d97706', fontSize: '13px', fontWeight: '600' }}>
                              <Wrench size={15} /> In Progress
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#66665f', fontSize: '13px', fontWeight: '500' }}>
                              <Clock size={15} /> Awaiting Review
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Empty States */}
            {filtered.length === 0 && (
              user.role === 'citizen' ? (
                filter === 'all' ? (
                  <div style={{
                    textAlign: 'center', padding: '64px 20px',
                    background: 'white', border: '1px dashed #d4d3cc', borderRadius: '8px'
                  }}>
                    <div style={{
                      width: '64px', height: '64px', borderRadius: '50%',
                      background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      margin: '0 auto 16px'
                    }}>
                      <Inbox size={32} color="#2f5fc4" />
                    </div>
                    <h3 style={{ fontSize: '18px', color: '#1c1c1a', fontWeight: '700', marginBottom: '8px' }}>
                      You haven't reported any issues yet
                    </h3>
                    <p style={{ fontSize: '14px', color: '#66665f', maxWidth: '400px', margin: '0 auto 20px', lineHeight: 1.5 }}>
                      Notice a pothole, broken streetlight, or garbage dump in your area? Submit a complaint to alert your local civic authorities.
                    </p>
                    <Link to="/report" style={{ textDecoration: 'none' }}>
                      <button style={{
                        display: 'inline-flex', alignItems: 'center', gap: '8px',
                        padding: '10px 22px', background: '#c2410c', color: 'white',
                        border: 'none', borderRadius: '100px', fontSize: '14px', fontWeight: '600',
                        cursor: 'pointer', boxShadow: '0 2px 6px rgba(239,68,68,0.25)'
                      }}>
                        <Plus size={16} /> Report an Issue
                      </button>
                    </Link>
                  </div>
                ) : (
                  <div style={{
                    textAlign: 'center', padding: '64px 20px',
                    background: 'white', border: '1px dashed #d4d3cc', borderRadius: '8px'
                  }}>
                    <div style={{
                      width: '64px', height: '64px', borderRadius: '50%',
                      background: '#f8f8f6', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      margin: '0 auto 16px'
                    }}>
                      <Inbox size={32} color="#8f8e86" />
                    </div>
                    <h3 style={{ fontSize: '18px', color: '#1c1c1a', fontWeight: '700', marginBottom: '8px' }}>
                      No {statusConfig[filter]?.label || filter} complaints
                    </h3>
                    <p style={{ fontSize: '14px', color: '#66665f', maxWidth: '380px', margin: '0 auto 16px' }}>
                      You don't have any reports currently matching this status filter.
                    </p>
                    <button
                      onClick={() => setFilter('all')}
                      style={{
                        padding: '8px 18px', background: '#1c1c1a', color: 'white',
                        border: 'none', borderRadius: '100px', fontSize: '13px', fontWeight: '600', cursor: 'pointer'
                      }}
                    >
                      View All Complaints
                    </button>
                  </div>
                )
              ) : (
                <div style={{
                  textAlign: 'center', padding: '80px 20px',
                  background: 'white', border: '1px dashed #d4d3cc', borderRadius: '8px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                    {user.role === 'worker'
                      ? <PartyPopper size={48} color="#8f8e86" strokeWidth={1.5} />
                      : <Inbox size={48} color="#8f8e86" strokeWidth={1.5} />
                    }
                  </div>
                  <h3 style={{ fontSize: '18px', color: '#1c1c1a', fontWeight: '600', marginBottom: '6px' }}>
                    {user.role === 'worker' ? "You're all caught up!" : 'Inbox Zero'}
                  </h3>
                  <p style={{ fontSize: '14px', color: '#66665f', maxWidth: '300px', margin: '0 auto' }}>
                    {user.role === 'worker'
                      ? 'No tasks assigned to you right now. Take a breather.'
                      : 'There are no complaints matching this filter.'}
                  </p>
                </div>
              )
            )}
          </div>
        )}

        {/* Resolution Evidence Submission Modal (for Officers & Assigned Workers) */}
        {resolvingComplaint && (
          <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            padding: '20px'
          }}>
            <div style={{
              background: 'white',
              borderRadius: '8px',
              maxWidth: '520px',
              width: '100%',
              padding: '28px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              maxHeight: '90vh',
              overflowY: 'auto'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#1c1c1a', margin: 0 }}>
                    Submit Resolution Evidence
                  </h3>
                  <p style={{ fontSize: '13px', color: '#66665f', margin: '4px 0 0' }}>
                    Complaint #{resolvingComplaint.id}: {resolvingComplaint.category}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeResolutionModal}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8f8e86' }}
                >
                  <XCircle size={22} />
                </button>
              </div>

              {resolutionError && (
                <div style={{
                  background: '#fff4ed',
                  border: '1px solid #f8d3bf',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  color: '#dc2626',
                  fontSize: '13px',
                  marginBottom: '16px'
                }}>
                  {resolutionError}
                </div>
              )}

              <form onSubmit={submitResolution}>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#3a3a36', marginBottom: '6px' }}>
                    Resolution Photograph <span style={{ color: '#c2410c' }}>* (Required)</span>
                  </label>
                  <p style={{ fontSize: '12px', color: '#66665f', margin: '0 0 8px' }}>
                    Upload an after-completion photograph (JPEG, PNG, WebP up to 5 MB).
                  </p>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleResolutionFileChange}
                    required
                    style={{
                      display: 'block',
                      width: '100%',
                      fontSize: '13px',
                      padding: '8px 12px',
                      border: '1px solid #d4d3cc',
                      borderRadius: '8px',
                      boxSizing: 'border-box'
                    }}
                  />
                  {resolutionFilePreview && (
                    <div style={{ marginTop: '10px' }}>
                      <img
                        src={resolutionFilePreview}
                        alt="Resolution preview"
                        style={{ height: '120px', width: 'auto', borderRadius: '8px', border: '1px solid #e3e2dc', objectFit: 'cover' }}
                      />
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#3a3a36', marginBottom: '6px' }}>
                    Resolution Notes <span style={{ color: '#8f8e86', fontWeight: '400' }}>(Optional)</span>
                  </label>
                  <textarea
                    value={resolutionNotes}
                    onChange={(e) => setResolutionNotes(e.target.value)}
                    placeholder="Describe the actions taken to resolve this civic complaint..."
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid #d4d3cc',
                      fontSize: '13px',
                      boxSizing: 'border-box',
                      fontFamily: 'inherit'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={closeResolutionModal}
                    style={{
                      padding: '9px 18px',
                      background: 'transparent',
                      border: '1px solid #d4d3cc',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: '600',
                      color: '#66665f',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingResolution || !resolutionFile}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '9px 20px',
                      background: '#15803d',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: '600',
                      color: 'white',
                      cursor: submittingResolution || !resolutionFile ? 'not-allowed' : 'pointer',
                      opacity: submittingResolution || !resolutionFile ? 0.7 : 1
                    }}
                  >
                    {submittingResolution ? (
                      <>
                        <RefreshCw size={14} className="spin" /> Submitting...
                      </>
                    ) : (
                      <>
                        <CheckCircle size={15} /> Confirm Resolution
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
