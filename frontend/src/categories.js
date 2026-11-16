// Shared vocabulary of the interface: categories, statuses, reference numbers, dates and the
// small building blocks (status chip, route line, photo pair) that every page uses.
// The category list must match CATEGORIES in backend/utils/validation.js.
import React from 'react';
import { CircleDashed, Lightbulb, Trash2, Waves, MapPin } from 'lucide-react';

export const CATEGORIES = ['Pothole', 'Broken Streetlight', 'Garbage Dump', 'Open Drain', 'Other'];

const ICONS = {
  'Pothole': CircleDashed,
  'Broken Streetlight': Lightbulb,
  'Garbage Dump': Trash2,
  'Open Drain': Waves,
  'Other': MapPin,
};

export function CategoryIcon({ category, size = 16, ...rest }) {
  const Icon = ICONS[category] || MapPin;
  return <Icon size={size} strokeWidth={1.75} aria-hidden="true" {...rest} />;
}

// Signal colours (also used for map markers, which cannot read CSS variables)
export const STATUS = {
  open: { label: 'Open', color: '#e0452b' },
  in_progress: { label: 'In progress', color: '#e8a10a' },
  resolved: { label: 'Fixed', color: '#1d7a4a' },
};

export function StatusChip({ status, large = false }) {
  const s = STATUS[status] || { label: status };
  return (
    <span className={`chip chip-${status}${large ? ' chip-lg' : ''}`}>
      <i aria-hidden="true" />{s.label}
    </span>
  );
}

// Reference number used everywhere a report is named: CH-0042
export const refNo = (id) => `CH-${String(id ?? '').padStart(4, '0')}`;

export function formatDate(value, withTime = false) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const opts = { day: '2-digit', month: 'short', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('en-IN', opts);
}

export function timeAgo(value) {
  const t = new Date(value).getTime();
  if (isNaN(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export const coords = (c) => {
  const lat = Number(c?.latitude);
  const lng = Number(c?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : '';
};

// The life of a report drawn as a transit line: Reported -> Assigned -> Fixed -> Confirmed.
// A citizen reopening sends it back: the "Fixed" station is marked as a return trip.
export function RouteLine({ complaint: c, compact = false }) {
  const reopened = c.citizen_confirmation_status === 'reopened' && c.status !== 'resolved';
  const confirmed = c.status === 'resolved' && c.citizen_confirmation_status === 'confirmed';
  const legacy = c.status === 'resolved' && (!c.citizen_confirmation_status || c.citizen_confirmation_status === 'not_required');
  // A confirmed report has completed the whole line, so every station is passed
  const reached = confirmed ? 4 : c.status === 'resolved' ? 2 : c.status === 'in_progress' ? 1 : 0;

  const stations = [
    { name: 'Reported', note: formatDate(c.created_at) },
    { name: 'Assigned', note: c.worker_name || (c.status === 'open' ? 'Awaiting officer' : 'Ward team') },
    reopened
      ? { name: 'Reopened', note: 'Sent back by citizen', flag: true }
      : { name: 'Fixed', note: c.status === 'resolved' ? formatDate(c.resolved_at) || 'Photo filed' : 'Pending' },
    {
      name: 'Confirmed',
      note: confirmed ? 'By the citizen' : legacy ? 'Not required' : c.status === 'resolved' ? 'Awaiting citizen' : '',
    },
  ];

  return (
    <ol className={`route${compact ? ' route-compact' : ''}${confirmed ? ' route-complete' : ''}`} aria-label="Progress of this report">
      {stations.map((s, i) => {
        const state = i < reached ? 'done' : i === reached ? 'current' : 'next';
        return (
          <li key={s.name} className={`stop stop-${state}${s.flag ? ' stop-flag' : ''}`}
            aria-current={state === 'current' ? 'step' : undefined}>
            <span className="stop-dot" aria-hidden="true" />
            <span className="stop-name">{s.name}</span>
            {!compact && s.note && <span className="stop-note">{s.note}</span>}
          </li>
        );
      })}
    </ol>
  );
}

// Before / after photographs, side by side, each opening the full image
export function PhotoPair({ before, after, getUrl }) {
  if (!before && !after) return null;
  return (
    <div className="photo-pair">
      {before && (
        <a className="photo" href={getUrl(before)} target="_blank" rel="noopener noreferrer">
          <img src={getUrl(before)} alt="Photo of the problem when it was reported" loading="lazy" />
          <span className="photo-tag">Before</span>
        </a>
      )}
      {after && (
        <a className="photo photo-after" href={getUrl(after)} target="_blank" rel="noopener noreferrer">
          <img src={getUrl(after)} alt="Photo of the completed repair" loading="lazy" />
          <span className="photo-tag">After</span>
        </a>
      )}
    </div>
  );
}

// Reads the logged-in user without crashing on a missing or corrupted localStorage value
export function getStoredUser() {
  try {
    const parsed = JSON.parse(localStorage.getItem('user') || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
