// Centralized API and environment configuration for CivicHelp

const envApiUrl = process.env.REACT_APP_API_URL;
const envSocketUrl = process.env.REACT_APP_SOCKET_URL;

// API URL resolution:
// 1. If explicit REACT_APP_API_URL is provided, use it.
// 2. If running locally on port 3000 (React dev server), default to 'http://localhost:5001/api'.
// 3. Otherwise (e.g. production/Docker on port 80), default to '/api' (Nginx reverse proxy).
export const API_URL = (envApiUrl && envApiUrl.trim() !== '')
  ? envApiUrl.trim()
  : (typeof window !== 'undefined' && window.location.port === '3000'
      ? 'http://localhost:5001/api'
      : '/api');

// Socket URL resolution:
// 1. If explicit REACT_APP_SOCKET_URL is provided, use it.
// 2. If running locally on port 3000, default to 'http://localhost:5001'.
// 3. Otherwise, default to '/' or current origin so socket.io connects via Nginx on port 80.
export const SOCKET_URL = (envSocketUrl && envSocketUrl.trim() !== '')
  ? envSocketUrl.trim()
  : (typeof window !== 'undefined' && window.location.port === '3000'
      ? 'http://localhost:5001'
      : (typeof window !== 'undefined' && window.location.origin ? window.location.origin : ''));

// Construct safe image URLs without 'undefined' errors
export const getImageUrl = (imagePath) => {
  if (!imagePath) return '';
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    return imagePath;
  }
  const cleanPath = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
  // If API_URL is absolute (e.g. http://localhost:5001/api), strip /api and prepend host
  if (API_URL.startsWith('http://') || API_URL.startsWith('https://')) {
    const base = API_URL.replace(/\/api\/?$/, '');
    return `${base}${cleanPath}`;
  }
  // Relative path (e.g. when behind Nginx reverse proxy)
  return cleanPath;
};
