import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import io from 'socket.io-client';
import { API_URL, SOCKET_URL, getImageUrl } from '../config';
import {
  getStoredUser, STATUS, StatusChip, RouteLine, PhotoPair, CategoryIcon,
  refNo, formatDate, timeAgo, coords,
} from '../categories';
import { RefreshCw, X, Camera, ArrowLeft, Check } from 'lucide-react';

const needsAttention = (c) =>
  (c.status === 'open' && !c.assigned_to) ||
  (c.citizen_confirmation_status === 'reopened' && c.status !== 'resolved');

const isReopened = (c) => c.citizen_confirmation_status === 'reopened' && c.status !== 'resolved';
const awaitingCitizen = (c) => c.status === 'resolved' && c.resolution_image_url && c.citizen_confirmation_status === 'pending';

// ============================================================ shared pieces

function Tally({ cells }) {
  return (
    <div className="tally">
      {cells.map((c) => (
        <div className="tally-cell" key={c.label}>
          <div className="tally-num">{c.value}</div>
          <div className="tally-label">
            {c.status ? <StatusChip status={c.status} /> : <span className="chip chip-plain">{c.label}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Filters({ value, onChange, options }) {
  return (
    <div className="filters" role="group" aria-label="Filter">
      {options.map((o) => (
        <button key={o.key} type="button" className={`filter${o.alarm ? ' filter-alarm' : ''}`}
          aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}<span className="count">{o.count}</span>
        </button>
      ))}
    </div>
  );
}

function Empty({ title, text, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}

function ReopenBox({ c }) {
  if (!isReopened(c)) return null;
  return (
    <div className="alarm-box" role="note">
      <b>Sent back by the citizen{c.citizen_feedback_at ? ` · ${formatDate(c.citizen_feedback_at)}` : ''}</b>
      “{c.citizen_feedback || 'The citizen said the repair is not complete.'}”
    </div>
  );
}

// ============================================================ citizen: case files

function CitizenView({ complaints, filter, setFilter, stats, onVerify, reopeningId, setReopeningId, reopeningFeedback, setReopeningFeedback, submittingVerification }) {
  const pending = complaints.filter(awaitingCitizen);
  const shown = (filter === 'all' ? complaints : complaints.filter((c) => c.status === filter))
    .slice()
    .sort((a, b) => Number(awaitingCitizen(b)) - Number(awaitingCitizen(a)));

  return (
    <>
      {pending.length > 0 && (
        <div className="notice notice-wait" role="status">
          <span><b>{pending.length} {pending.length === 1 ? 'repair is' : 'repairs are'} waiting for your confirmation.</b> Compare the photos and tell the ward office whether the problem is really fixed.</span>
        </div>
      )}
      <Filters value={filter} onChange={setFilter} options={[
        { key: 'all', label: 'All', count: stats.total },
        { key: 'open', label: 'Open', count: stats.open },
        { key: 'in_progress', label: 'In progress', count: stats.in_progress },
        { key: 'resolved', label: 'Fixed', count: stats.resolved },
      ]} />

      {shown.length === 0 ? (
        filter === 'all'
          ? <Empty title="No reports yet" text="Seen a pothole, a dead streetlight or an overflowing drain? File a report and follow it here until it is fixed.">
              <Link to="/report" className="btn btn-signal">Report a problem</Link>
            </Empty>
          : <Empty title={`Nothing ${STATUS[filter]?.label.toLowerCase() || filter}`} text="None of your reports has this status right now.">
              <button type="button" className="btn btn-sm" onClick={() => setFilter('all')}>Show all reports</button>
            </Empty>
      ) : shown.map((c) => (
        <article className="case" key={c.id}>
          <div className="case-meta">
            <span className="ref">{refNo(c.id)}</span>
            <span>Filed {formatDate(c.created_at)}</span><br />
            <span>{timeAgo(c.created_at)}</span>
          </div>
          <div>
            <div className="case-title">
              <h2>{c.category}</h2>
              <StatusChip status={c.status} large />
            </div>
            <p className="case-addr">{c.address || coords(c)}</p>
            {c.description && <p className="case-desc">{c.description}</p>}
            <RouteLine complaint={c} />

            {(c.image_url || c.resolution_image_url) && (
              <div className="case-block"><PhotoPair before={c.image_url} after={c.resolution_image_url} getUrl={getImageUrl} /></div>
            )}
            {c.resolution_notes && (
              <div className="case-block quote"><cite>Note from {c.worker_name || 'the field team'}</cite>{c.resolution_notes}</div>
            )}

            {c.status === 'resolved' && c.citizen_confirmation_status === 'confirmed' && (
              <div className="verify-done">You confirmed this repair. Thank you for closing the loop.</div>
            )}
            {isReopened(c) && (
              <div className="verify-done verify-back">
                You sent this back to the ward office{c.citizen_feedback ? <>: “{c.citizen_feedback}”</> : '.'} It is being worked on again.
              </div>
            )}
            {awaitingCitizen(c) && (
              <div className="verify">
                <h3>Is it really fixed?</h3>
                <p>The field team has filed a photo of the repair. Only you can close this report.</p>
                {reopeningId === c.id ? (
                  <>
                    <label className="field">
                      <span className="field-label">What is still wrong?</span>
                      <textarea rows={3} value={reopeningFeedback} onChange={(e) => setReopeningFeedback(e.target.value)}
                        placeholder="For example: the patch has already sunk after the rain." />
                    </label>
                    <div className="verify-actions">
                      <button type="button" className="btn btn-alarm" disabled={submittingVerification || !reopeningFeedback.trim()}
                        onClick={() => onVerify(c.id, 'reopen', reopeningFeedback)}>
                        {submittingVerification ? 'Sending…' : 'Send back for more work'}
                      </button>
                      <button type="button" className="btn" onClick={() => { setReopeningId(null); setReopeningFeedback(''); }}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <div className="verify-actions">
                    <button type="button" className="btn btn-done" disabled={submittingVerification} onClick={() => onVerify(c.id, 'confirm')}>
                      <Check size={16} aria-hidden="true" /> Yes, it is fixed
                    </button>
                    <button type="button" className="btn btn-alarm" disabled={submittingVerification} onClick={() => setReopeningId(c.id)}>
                      No, reopen it
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </article>
      ))}
    </>
  );
}

// ============================================================ officer: triage queue + case detail

function OfficerView({ complaints, workers, selectedWorker, setSelectedWorker, onAssign, onStart, onResolve }) {
  const [view, setView] = useState('all');
  const [selectedId, setSelectedId] = useState(null);

  const counts = {
    all: complaints.length,
    attention: complaints.filter(needsAttention).length,
    open: complaints.filter((c) => c.status === 'open').length,
    in_progress: complaints.filter((c) => c.status === 'in_progress').length,
    resolved: complaints.filter((c) => c.status === 'resolved').length,
  };
  const list = view === 'all' ? complaints
    : view === 'attention' ? complaints.filter(needsAttention)
      : complaints.filter((c) => c.status === view);
  const current = list.find((c) => c.id === selectedId) || list[0];

  const select = (id) => {
    setSelectedId(id);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  return (
    <>
      <Filters value={view} onChange={(v) => { setView(v); setSelectedId(null); }} options={[
        { key: 'attention', label: 'Needs attention', count: counts.attention, alarm: counts.attention > 0 },
        { key: 'all', label: 'All', count: counts.all },
        { key: 'open', label: 'Open', count: counts.open },
        { key: 'in_progress', label: 'In progress', count: counts.in_progress },
        { key: 'resolved', label: 'Fixed', count: counts.resolved },
      ]} />

      {list.length === 0 ? (
        <Empty title={view === 'attention' ? 'Nothing needs you' : 'Queue is empty'}
          text={view === 'attention' ? 'Every open report has a worker and nothing has been sent back.' : 'No reports match this view.'} />
      ) : (
        <div className={`triage${selectedId ? ' has-selection' : ''}`}>
          <nav className="queue" aria-label="Complaint queue">
            {list.map((c) => (
              <button key={c.id} type="button" className="row-btn" aria-current={current && current.id === c.id}
                onClick={() => select(c.id)}>
                <span>
                  <span className="row-top"><span>{refNo(c.id)}</span><span>{timeAgo(c.created_at)}</span></span>
                  <span className="row-title">{c.category}</span>
                </span>
                <span className="row-side"><StatusChip status={c.status} /></span>
                <span className="row-addr clamp-1">{c.address || coords(c)}</span>
                <span className="row-flags">
                  {isReopened(c) && <span className="flag flag-alarm">Reopened</span>}
                  {c.status === 'open' && !c.assigned_to && <span className="flag flag-open">Unassigned</span>}
                  {awaitingCitizen(c) && <span className="flag flag-wait">Awaiting citizen</span>}
                  {c.worker_name && <span className="flag">{c.worker_name}</span>}
                </span>
              </button>
            ))}
          </nav>

          {current && (
            <section className="detail" aria-label={`Report ${refNo(current.id)}`}>
              <button type="button" className="btn btn-sm back-link" onClick={() => setSelectedId(null)}>
                <ArrowLeft size={15} aria-hidden="true" /> Queue
              </button>
              <div className="detail-head">
                <div>
                  <span className="kicker">{refNo(current.id)} · filed {formatDate(current.created_at, true)}</span>
                  <h2>{current.category}</h2>
                </div>
                <StatusChip status={current.status} large />
              </div>

              <dl className="facts">
                <div className="fact"><dt>Reported by</dt><dd>{current.citizen_name || '—'}</dd></div>
                <div className="fact"><dt>Field worker</dt><dd>{current.worker_name || 'Not assigned'}</dd></div>
                <div className="fact"><dt>Location</dt><dd>{current.address || 'Pinned on the map'}<br /><span className="mono muted">{coords(current)}</span></dd></div>
              </dl>

              {isReopened(current) && <div className="detail-section"><ReopenBox c={current} /></div>}

              {current.description && (
                <div className="detail-section">
                  <p className="section-label">Citizen's description</p>
                  <p>{current.description}</p>
                </div>
              )}

              <div className="detail-section">
                <p className="section-label">Progress</p>
                <RouteLine complaint={current} />
              </div>

              {(current.image_url || current.resolution_image_url || current.resolution_notes) && (
                <div className="detail-section">
                  <p className="section-label">Evidence</p>
                  <PhotoPair before={current.image_url} after={current.resolution_image_url} getUrl={getImageUrl} />
                  {current.resolution_notes && (
                    <div className="quote" style={{ marginTop: 14 }}><cite>Resolution note</cite>{current.resolution_notes}</div>
                  )}
                </div>
              )}

              <div className="detail-section">
                <p className="section-label">Actions</p>
                {current.status === 'resolved' ? (
                  <p className="muted small">
                    Closed with photo proof. {current.citizen_confirmation_status === 'confirmed'
                      ? 'The citizen has confirmed the repair.'
                      : current.citizen_confirmation_status === 'pending' ? 'Waiting for the citizen to confirm.' : ''}
                  </p>
                ) : (
                  <div className="actions">
                    <div className="assign">
                      <label className="field" style={{ margin: 0 }}>
                        <span className="field-label">{current.assigned_to ? 'Reassign to' : 'Assign to'}</span>
                        <select value={selectedWorker[current.id] || ''}
                          onChange={(e) => setSelectedWorker({ ...selectedWorker, [current.id]: e.target.value })}>
                          <option value="">Choose a field worker…</option>
                          {workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      </label>
                      <button type="button" className="btn btn-ink" onClick={() => onAssign(current.id)}>
                        {current.assigned_to ? 'Reassign' : 'Assign'}
                      </button>
                    </div>
                    {current.status === 'open' && (
                      <button type="button" className="btn" onClick={() => onStart(current.id)}>Start without worker</button>
                    )}
                    {current.status === 'in_progress' && (
                      <button type="button" className="btn btn-signal" onClick={() => onResolve(current)}>
                        <Camera size={16} aria-hidden="true" /> Close with photo
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}

// ============================================================ worker: work orders

function WorkerView({ complaints, onResolve }) {
  const active = complaints.filter((c) => c.status !== 'resolved')
    .slice().sort((a, b) => Number(isReopened(b)) - Number(isReopened(a)));
  const done = complaints.filter((c) => c.status === 'resolved');

  return (
    <>
      {active.length === 0 ? (
        <Empty title="No open work orders" text="Nothing is assigned to you right now. New assignments appear here the moment the ward officer makes them." />
      ) : (
        <div className="orders">
          {active.map((c) => (
            <article key={c.id} className={`order${isReopened(c) ? ' order-reopened' : ''}`}>
              <div className="order-strip">
                <span>Work order {refNo(c.id)}</span>
                {isReopened(c) ? <span>Returned by citizen</span> : <StatusChip status={c.status} />}
              </div>
              <div className="order-body">
                {isReopened(c) && <div style={{ marginBottom: 14 }}><ReopenBox c={c} /></div>}
                <h2><CategoryIcon category={c.category} size={28} /> {c.category}</h2>
                <p className="order-addr">{c.address || 'Location pinned on the map'}</p>
                <p className="order-coords">
                  <span>{coords(c)}</span>
                  <a href={`https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=18/${c.latitude}/${c.longitude}`}
                    target="_blank" rel="noopener noreferrer">Open in map</a>
                </p>
                {c.image_url && (
                  <a className="order-photo" href={getImageUrl(c.image_url)} target="_blank" rel="noopener noreferrer">
                    <img src={getImageUrl(c.image_url)} alt="Photo of the problem when it was reported" loading="lazy" />
                    <span className="photo-tag">Before</span>
                  </a>
                )}
                {c.description && (
                  <div className="quote" style={{ margin: '14px 0' }}><cite>Reported by {c.citizen_name || 'a citizen'} · {formatDate(c.created_at)}</cite>{c.description}</div>
                )}
              </div>
              <div className="order-foot">
                {c.status === 'in_progress' ? (
                  <button type="button" className="btn btn-signal btn-lg btn-block" onClick={() => onResolve(c)}>
                    <Camera size={18} aria-hidden="true" /> Close with photo proof
                  </button>
                ) : (
                  <span className="flag flag-wait">Waiting for the ward officer to start it</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <>
          <div className="sub-head"><h2>Completed</h2><span className="kicker">{done.length} closed with proof</span></div>
          <div className="done-list">
            {done.map((c) => (
              <div className="done-row" key={c.id}>
                {c.resolution_image_url
                  ? <a href={getImageUrl(c.resolution_image_url)} target="_blank" rel="noopener noreferrer"><img src={getImageUrl(c.resolution_image_url)} alt="Your photo of the finished repair" loading="lazy" /></a>
                  : <span className="noimg" />}
                <div>
                  <span className="mono muted">{refNo(c.id)} · fixed {formatDate(c.resolved_at)}</span>
                  <div className="row-title">{c.category}</div>
                  <div className="small muted clamp-1">{c.address || coords(c)}</div>
                </div>
                <span>
                  {c.citizen_confirmation_status === 'confirmed' && <span className="flag flag-ok">Confirmed by citizen</span>}
                  {c.citizen_confirmation_status === 'pending' && <span className="flag flag-wait">Awaiting citizen</span>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ============================================================ resolution sheet (officer + worker)

function ResolutionSheet({ complaint: c, filePreview, file, notes, setNotes, error, submitting, onFile, onSubmit, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onSubmit={onSubmit}>
        <div className="sheet-head">
          <div>
            <p className="kicker">Close work order {refNo(c.id)}</p>
            <h2 id="sheet-title">{c.category}</h2>
            <p className="small" style={{ color: '#c9c6ba' }}>{c.address || coords(c)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="sheet-body">
          {error && <div className="notice notice-error" role="alert">{error}</div>}
          <p className="small" style={{ marginBottom: 16 }}>
            A photo of the finished work is required. The citizen will compare it with their original photo before the report is closed.
          </p>
          <label className="field">
            <span className="field-label"><b>A</b> Photo of the repair <span className="field-hint">required · JPEG, PNG or WebP, max 5 MB</span></span>
            <span className="drop">
              {filePreview
                ? <img className="drop-thumb" src={filePreview} alt="Selected repair photo" />
                : <span className="drop-box"><Camera size={26} strokeWidth={1.5} aria-hidden="true" /></span>}
              <span>
                <b>{file ? 'Photo attached' : 'Take or choose a photo'}</b>
                <span className="small muted">{file ? `${file.name} — click to replace` : 'The "after" picture'}</span>
              </span>
              <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} />
            </span>
          </label>
          <label className="field">
            <span className="field-label"><b>B</b> What was done <span className="field-hint">optional</span></span>
            <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="For example: filled with cold-mix asphalt and compacted." />
          </label>
          {c.image_url && (
            <>
              <p className="section-label">For comparison: the original report</p>
              <PhotoPair before={c.image_url} getUrl={getImageUrl} />
            </>
          )}
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-done" disabled={submitting || !file}>
            {submitting ? <><RefreshCw size={15} className="spin" aria-hidden="true" /> Filing…</> : <><Check size={16} aria-hidden="true" /> File proof and close</>}
          </button>
        </div>
      </form>
    </div>
  );
}

// ============================================================ page

function Dashboard() {
  const [complaints, setComplaints] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [filter, setFilter] = useState('all');
  const [selectedWorker, setSelectedWorker] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [live, setLive] = useState(false);
  const [notice, setNotice] = useState(null);

  // Resolution sheet state for staff (officer & worker)
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
    if (!selectedWorker[complaintId]) return showNotice('error', 'Choose a field worker first.');
    try {
      const res = await axios.patch(
        `${API_URL}/complaints/${complaintId}/assign`,
        { worker_id: selectedWorker[complaintId] },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setComplaints(prev => prev.map(c => c.id === complaintId ? res.data : c));
      showNotice('success', `${refNo(complaintId)} assigned to ${res.data.worker_name || 'the selected worker'}.`);
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
      showNotice('success', `${refNo(id)} moved to ${STATUS[status]?.label.toLowerCase() || status}.`);
    } catch (err) {
      showNotice('error', err.response?.data?.error || 'Failed to update status.');
    }
  };

  // Resolution workflow handlers (staff)
  const openResolution = (c) => {
    setResolvingComplaint(c);
    setResolutionFile(null);
    setResolutionFilePreview(null);
    setResolutionNotes('');
    setResolutionError(null);
  };

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
      showNotice('success', `${refNo(resolvingComplaint.id)} closed with proof. The citizen has been asked to confirm.`);
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
        ? 'Thank you. You confirmed the repair and the report is closed.'
        : 'Sent back. The ward office can see your reason.');
    } catch (err) {
      showNotice('error', err.response?.data?.error || 'Failed to submit verification.');
    } finally {
      setSubmittingVerification(false);
    }
  };

  const stats = {
    total: complaints.length,
    open: complaints.filter(c => c.status === 'open').length,
    in_progress: complaints.filter(c => c.status === 'in_progress').length,
    resolved: complaints.filter(c => c.status === 'resolved').length,
  };

  const role = ['officer', 'worker'].includes(user.role) ? user.role : 'citizen';
  const head = {
    citizen: { kicker: 'Citizen · case files', title: 'My reports' },
    officer: { kicker: 'Ward office · complaint desk', title: 'Complaint desk' },
    worker: { kicker: 'Field team · assigned to you', title: 'Work orders' },
  }[role];

  const tally = role === 'worker'
    ? [
      { label: 'Assigned to you', value: stats.total },
      { label: 'Active', value: stats.total - stats.resolved },
      { label: 'Reopened', value: complaints.filter(isReopened).length },
      { label: 'Completed', value: stats.resolved },
    ]
    : [
      { label: role === 'officer' ? 'All reports' : 'Reports filed', value: stats.total },
      { status: 'open', label: 'Open', value: stats.open },
      { status: 'in_progress', label: 'In progress', value: stats.in_progress },
      { status: 'resolved', label: 'Fixed', value: stats.resolved },
    ];

  return (
    <main className="desk-page">
      {notice && (
        <div className={`toast${notice.type === 'success' ? '' : ' toast-error'}`} role="status">
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={16} /></button>
        </div>
      )}

      <header className="desk-head">
        <div>
          <p className="kicker">{head.kicker}</p>
          <h1>{head.title}</h1>
        </div>
        <div className="desk-head-side">
          <span className={`live${live ? ' live-on' : ''}`} title={live ? 'Receiving real-time updates' : 'Real-time connection unavailable'}>
            <i aria-hidden="true" />{live ? 'Live' : 'Offline'}
          </span>
          <button type="button" className="btn btn-sm" onClick={() => fetchComplaints(true)} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} aria-hidden="true" />
            {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </header>

      <Tally cells={tally} />

      {error && (
        <div className="notice notice-error" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-sm" onClick={() => fetchComplaints()}>Retry</button>
        </div>
      )}

      {loading && complaints.length === 0 ? (
        <div aria-busy="true">
          <div className="loading-line" />
          <p className="kicker">Loading reports…</p>
        </div>
      ) : role === 'officer' ? (
        <OfficerView complaints={complaints} workers={workers}
          selectedWorker={selectedWorker} setSelectedWorker={setSelectedWorker}
          onAssign={assignWorker} onStart={(id) => updateStatus(id, 'in_progress')} onResolve={openResolution} />
      ) : role === 'worker' ? (
        <WorkerView complaints={complaints} onResolve={openResolution} />
      ) : (
        <CitizenView complaints={complaints} filter={filter} setFilter={setFilter} stats={stats}
          onVerify={handleVerify} reopeningId={reopeningId} setReopeningId={setReopeningId}
          reopeningFeedback={reopeningFeedback} setReopeningFeedback={setReopeningFeedback}
          submittingVerification={submittingVerification} />
      )}

      {resolvingComplaint && (
        <ResolutionSheet complaint={resolvingComplaint} file={resolutionFile} filePreview={resolutionFilePreview}
          notes={resolutionNotes} setNotes={setResolutionNotes} error={resolutionError} submitting={submittingResolution}
          onFile={handleResolutionFileChange} onSubmit={submitResolution} onClose={closeResolutionModal} />
      )}
    </main>
  );
}

export default Dashboard;
