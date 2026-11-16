// Issue categories and statuses, shared by every page (one source of truth).
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

// Muted status colours (also used for the map markers)
export const STATUS = {
  open: { label: 'Open', color: '#c2410c', bg: '#fff4ed' },
  in_progress: { label: 'In progress', color: '#a16207', bg: '#fefbe8' },
  resolved: { label: 'Resolved', color: '#15803d', bg: '#effaf2' },
};

export function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, color: '#555', bg: '#f1f1ee' };
  return (
    <span className="badge" style={{ color: s.color, background: s.bg }}>
      <span className="badge-dot" style={{ background: s.color }} />
      {s.label}
    </span>
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
