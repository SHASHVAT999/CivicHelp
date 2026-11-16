# CivicHelp frontend

React 19 single-page app (Create React App), served in production by Nginx (see `nginx.conf` and `Dockerfile`).

| Path | Contents |
|---|---|
| `src/App.js` | Routes and the axios interceptor that logs out on an expired session |
| `src/config.js` | API and Socket.IO URLs (`/api` behind Nginx, `http://localhost:5001` with `npm start`) |
| `src/categories.js` | Shared categories, icons, status colours, safe access to the stored user |
| `src/App.css` | Design tokens (colours, radius, fonts) and all shared styles |
| `src/components/Navbar.js` | Top navigation |
| `src/pages/` | `Home`, `MapPage`, `Login`, `ReportComplaint`, `Dashboard` (citizen, officer and worker views) |

Development: `npm install`, then `npm start` (port 3000, talks to the API on port 5001). For production, build the
Docker image: `docker build -t civichelp-frontend --build-arg REACT_APP_API_URL=/api --build-arg REACT_APP_SOCKET_URL=/ .`
