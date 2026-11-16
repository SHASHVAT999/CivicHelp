# CivicHelp: Presentation Walkthrough

A 10-12 minute talk. The commands and the click-by-click demo are in
[START_STOP_AND_PRESENTATION_GUIDE.md](START_STOP_AND_PRESENTATION_GUIDE.md). The pipeline details are in
[CI_CD_PIPELINE.md](CI_CD_PIPELINE.md).

## 1. Problem (30 seconds)

Potholes, broken streetlights, garbage dumps and open drains are reported by phone or at an office. The citizen sees no
progress, there is no proof of the repair, and a complaint can be closed without the problem being fixed.

CivicHelp makes the process transparent:
- a public map of every report;
- a clear owner for each report (ward officer, then field worker);
- photos before and after the repair;
- **the citizen decides whether the issue is really fixed.**

## 2. Live demo (4 minutes)

Follow section 6 of the guide. The short version:
1. The citizen reports a pothole with a photo, and the marker appears on the open map tab without a refresh (Socket.IO).
2. The officer assigns a worker, and the marker changes colour live.
3. The worker resolves the report. The photo is required.
4. The citizen sees the before and after photos and reopens the report with a reason.
5. The worker fixes it again, and the citizen confirms.

## 3. Architecture (1 minute)

- **Three containers** (Docker Compose):
  - Nginx serves the React build and proxies `/api`, `/socket.io` and `/uploads` to the backend.
  - Express 5 + Socket.IO is the backend.
  - MySQL 8 is the database.
- **Two named volumes**, `mysql-data` and `uploads-data`, keep the database and the photos across rebuilds and restarts.
- **Only port 80 is public.** The API and the database are reachable only inside the Docker network.
- On AWS: one EC2 t3.micro created by **Terraform** and configured by **Ansible**. No RDS, load balancer or NAT, to stay within the Learner Lab budget.

Why these choices:
- **OpenStreetMap/Leaflet:** free, with no API key.
- **Socket.IO:** pushes updates instead of polling.
- **MySQL:** users, complaints and assignments are relational data.
- **Nginx in front:** one origin, so there are no CORS problems and WebSockets use the same port.

## 4. The CI/CD pipeline (3 minutes) - the core of the DevOps part

Show **CivicHelp-Pipeline** in Jenkins (Pipeline Overview), then the `Jenkinsfile` in GitHub.

```
CI:  Checkout > Tool Check > Validate (Compose | Terraform | Ansible) > Build Images > Unit Tests > Integration Test
CD:  AWS Preflight > Terraform Plan (guarded) > Terraform Apply > Ansible Deploy > Verify Deployment
```

Points to make:
1. **One pipeline, strict order:** if a test fails, nothing is deployed.
2. **Real tests:**
   - 12 unit tests run inside the built image;
   - a 49-check integration test runs the complete workflow, including real-time events, on a throwaway copy of the app with an in-memory database.
3. **Safe infrastructure changes:** Terraform plans against the existing state. The pipeline **refuses** any plan that would add, replace or destroy a resource, then applies exactly that saved plan.
4. **The tested commit is what gets deployed:** Ansible checks out the commit id from stage 1. After the deployment, `/api/health` must report that same version.
5. **Data is proven safe:**
   - the pipeline records the existing complaints and photos before deploying;
   - it checks they are all still there afterwards;
   - volumes are never removed.
6. **Secrets:** Jenkins credentials are masked in the log. They are passed to Ansible only as environment variables, and stored on the server in `.env` with mode 0600. Nothing secret is in Git.

## 5. Security (1 minute)

- bcrypt password hashes, JWT authentication, and roles checked **on the server**:
  - a citizen calling officer endpoints gets 403;
  - workers act only on their own tasks;
  - only the reporter can verify.
- Registration ignores any `role` field. Staff accounts are created by an administrator script.
- Input is validated against the database limits, and internal errors are never shown to clients.
- Uploads: type allow-list, 5 MB limit, and the content is checked by its file signature.
- The public map and live broadcasts contain no names, e-mails or ids. Nginx sends security headers.
- The security group allows port 80 from anywhere and SSH only from the administrator's IP.

## 6. What was tested (be precise)

- The pipeline ran in the real Jenkins against the real EC2 instance and finished with SUCCESS: CI stages, deployment and verification.
- An independent fingerprint (database rows and SHA-256 of uploaded files) taken before and after deployment matched.
- The UI was checked at desktop (1366 px) and phone (390 px) widths for every role, with no console errors and no horizontal scrolling.
- **Not verified:** e-mail delivery (no SMTP credentials are configured, so the app skips the e-mail and logs it).

## 7. Limitations and next steps (30 seconds)

- HTTPS with a domain (Let's Encrypt).
- A container registry, so the server pulls the exact tested image instead of rebuilding the same commit.
- A GitHub webhook to trigger the pipeline (Jenkins is currently reachable only on localhost).
- Automated MySQL backups to S3, an admin UI for staff accounts, and pagination for large datasets.
