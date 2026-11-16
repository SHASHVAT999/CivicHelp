# CivicHelp: Presentation Guide

## 1. Problem statement (30 seconds)

Civic problems such as potholes, broken streetlights, garbage dumps and open drains are reported through phone calls or office visits. Citizens get no visibility into progress, there is no proof that the work was done, and a complaint can be closed without the problem being fixed.

**CivicHelp** makes the process transparent:
- a public live map of every report;
- a clear owner (ward officer → field worker);
- photo evidence before and after the fix;
- the citizen, not the department, has the final say on whether it is fixed.

## 2. Architecture (1 minute)

- **Three containers** orchestrated by Docker Compose:
  - `civichelp-frontend`: Nginx serves the React build and reverse-proxies `/api`, `/socket.io` (with WebSocket upgrade) and `/uploads`.
  - `civichelp-backend`: Express 5 REST API plus Socket.IO, Multer for uploads, Nodemailer for email.
  - `civichelp-db`: MySQL 8 with a health check; the backend waits until it is healthy.
- **Two named volumes**: `mysql-data` (database) and `uploads-data` (photos). Data survives rebuilds.
- **Only port 80 is public.** The API and MySQL are reachable only on the internal Docker network (and localhost).

Why these choices:
- **React + Leaflet:** free OpenStreetMap tiles with no API key.
- **Socket.IO:** push updates instead of polling.
- **MySQL:** the data is relational (users ↔ complaints ↔ assignments).
- **Nginx in front:** one origin, so no CORS issues in production and WebSockets go through the same port.

## 3. Roles and workflow (1 minute)

`OPEN → (assign) → IN PROGRESS → (photo proof) → RESOLVED / pending → citizen confirms ✅ or reopens 🔁 → IN PROGRESS`

| Role | Responsibility |
|---|---|
| Citizen | Reports with a pin and photo, tracks progress, verifies the fix |
| Ward officer | Triages every complaint, assigns field workers, monitors reopened items |
| Field worker | Sees only assigned tasks, must upload an "after" photo to resolve |

## 4. Security points evaluators usually ask about

1. **Passwords:** bcrypt hashes, never stored in plain text.
2. **Authentication:** JWT in the `Authorization` header; an expired session redirects to login.
3. **Authorization on the server, not just the UI:** a citizen calling officer APIs gets `403`; a worker cannot resolve a task that isn't theirs; only the reporter can confirm or reopen; assignment only accepts real worker accounts.
4. **Privilege escalation blocked:** registration ignores any `role` field, so every signup is a citizen. Staff accounts are created by an administrator (`scripts/create-staff.js`).
5. **Uploads:** type allow-list, 5 MB limit, and real content check by file signature (a `.png`-named text file is rejected).
6. **Privacy:** the public map and live broadcasts carry no names, emails or user IDs.
7. **Secrets:** `.env` and Jenkins credentials only, all git-ignored. Ansible writes `.env` with `0600` and `no_log`.
8. **Network:** the security group opens 80 to the world and 22 only to the admin's `/32`.

## 5. DevOps story (1–2 minutes)

- **Docker Compose:** one command brings up the whole stack with health-gated startup and persistent volumes.
- **Terraform:** declares the EC2 `t3.micro` (Ubuntu 22.04, 20 GB gp3), security group and key pair. The AWS provider version is pinned; a lifecycle rule stops new AMI releases from replacing the server.
- **Ansible:** an idempotent playbook that adds swap (needed to build React on 1 GB RAM), installs Docker from the signed apt repository, clones the repo, writes `.env`, runs Compose and waits for `/api/health`.
- **Jenkins:**
  - a default run validates Compose, Terraform and Ansible and builds both images (no cloud cost);
  - with `DEPLOY_TO_AWS` it checks that the Learner Lab credentials are valid, applies a saved Terraform plan, deploys with Ansible (through WSL on Windows) and smoke-tests the live URL;
  - secrets come from Jenkins credentials.
- **Cost control for the Learner Lab:** single instance, no RDS, load balancer or NAT gateway; MySQL runs as a container.

## 6. What was tested (be precise)

An automated end-to-end script exercised the full workflow through Nginx on port 80. All 43 checks passed:
- registration, login and invalid-token rejection;
- complaint with photo and photo served back; fake image rejected;
- authorization matrix (citizen, worker and officer permissions);
- assignment, resolution with and without proof;
- reopen with and without a reason, re-resolve, confirm, repeat-verification blocked;
- Socket.IO events received over a pure WebSocket connection through Nginx.

The UI was checked at desktop (1366 px) and phone (390 px) widths for every role, with no console errors and no horizontal scrolling.

**Not verified:**
- **Email delivery:** SMTP credentials are not configured, so the email step is skipped and logged.
- **AWS deployment:** see section 8.

## 7. Known limitations and future work

- HTTPS with a domain (Let's Encrypt).
- More email events (assignment, reopen), not just resolution.
- Admin UI for staff management; ward or area-based assignment.
- Pagination and search for large datasets; automated database backups.
- Push notifications and a PWA or mobile app.

## 8. AWS deployment status (state it honestly)

Update this section after deploying.

- **Provisioned by Terraform:** EC2 instance `civichelp-server` (t3.micro, us-east-1a), security group `civichelp-sg`, key pair `civichelp-key`.
- **Earlier SSH failures:** caused by the security group allowing SSH only from an old public IP of the admin machine. The fix is to update `admin_cidr` and run `terraform apply` (an in-place change).
- **Application on EC2:** pending until the latest code is pushed to GitHub and the Ansible playbook is run.
