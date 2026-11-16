# 🏛️ CivicHelp — Smart Civic Issue Reporting Platform

CivicHelp is a full-stack civic issue reporting and municipal management platform. Citizens report local problems (potholes, broken streetlights, garbage dumps, open drains) with a map location and a photo. Ward officers assign field workers, workers upload photographic proof of the fix, and the citizen confirms the resolution or asks for it to be reopened. Every change appears live on the public map and dashboards.

📘 **Starting, stopping, Jenkins and the presentation: [`docs/START_STOP_AND_PRESENTATION_GUIDE.md`](docs/START_STOP_AND_PRESENTATION_GUIDE.md)**

---

## 🌟 Key Features

- 📝 **Citizen reporting**: category, description, a map pin (click on the map, address search via OpenStreetMap Nominatim, or browser GPS) and an optional photo.
- 🗺️ **Live public map**: OpenStreetMap/Leaflet map with colour-coded status markers, status and category filters, grouping of overlapping reports, and a detail panel.
- 👮 **Ward officer dashboard**: every complaint with reporter, assignment to field workers, status tracking, before/after photos and citizen feedback.
- 👷 **Field worker dashboard**: assigned tasks only; a task can be resolved only by uploading an "after" photo (plus optional notes).
- ✅ **Citizen verification**: the reporter confirms the fix, or requests reopening with a reason, which sends the task back to *In Progress*.
- ⚡ **Real-time updates**: Socket.IO pushes new complaints and status changes to the map and to all dashboards (a **Live** badge shows the connection).
- 🔔 **Email notification (optional)**: Nodemailer emails the citizen when a complaint is resolved, if Gmail SMTP credentials are configured.
- 🔐 **Security**: bcrypt password hashing, JWT authentication, server-side role checks, upload validation by file signature, and no personal data in public map broadcasts.

---

## 🛠️ Architecture & Technology Stack

```
                  [ Citizen / Officer / Worker browser ]
                                  │  HTTP :80 + WebSocket
                                  ▼
                 ┌──────────────────────────────────┐
                 │  Nginx (container: civichelp-frontend)
                 │  • serves the React build (SPA)  │
                 │  • proxies /api, /socket.io, /uploads
                 └────────────────┬─────────────────┘
                                  │ internal Docker network
                                  ▼
                 ┌──────────────────────────────────┐
                 │  Express 5 + Socket.IO API       │──► volume: uploads-data (photos)
                 │  (container: civichelp-backend)  │
                 └────────────────┬─────────────────┘
                                  ▼
                 ┌──────────────────────────────────┐
                 │  MySQL 8.0 (container: civichelp-db) ──► volume: mysql-data
                 └──────────────────────────────────┘
```

| Layer | Technology |
| :--- | :--- |
| Frontend | React 19, React Router 7, Leaflet / React-Leaflet, Axios, Socket.IO client, Lucide icons |
| Backend | Node.js 24, Express 5, Socket.IO 4, Multer, Nodemailer, bcryptjs, jsonwebtoken, mysql2 |
| Database | MySQL 8.0, schema in [`init.sql`](init.sql) |
| Containers | Docker, Docker Compose, Nginx (Alpine) |
| Infrastructure | Terraform (AWS EC2 + security group + key pair) |
| Configuration | Ansible (Docker install, swap, clone, `.env`, Compose up, health check) |
| CI/CD | Jenkins declarative pipeline ([`Jenkinsfile`](Jenkinsfile)) |

### Complaint lifecycle

```
 Citizen reports ──► OPEN ──(officer assigns worker / starts task)──► IN PROGRESS
                                                                        │
                       worker/officer uploads "after" photo (required)  ▼
                                                                    RESOLVED (confirmation: pending)
                                                                        │
                    citizen confirms ──► RESOLVED (confirmed) ◄─────────┤
                    citizen reopens with a reason ──► IN PROGRESS (reopened) ──► resolve again
```

### Roles

| Role | How the account is created | Can do |
| :--- | :--- | :--- |
| Citizen | Self-registration on the Login page | Report issues, track own reports, confirm or reopen resolved ones |
| Ward officer | `create-staff.js` script (below) | See all complaints, assign or reassign workers, start tasks, resolve with proof |
| Field worker | `create-staff.js` script (below) | See and resolve only the complaints assigned to them |

Public registration always creates a citizen, even if a different role is sent in the request.

---

## 🚀 Running Locally with Docker Compose (recommended)

### 1. Configure the environment

```bash
cp .env.example .env
```

Set at least `DB_PASSWORD` and `JWT_SECRET` (use long random values). `EMAIL_USER` / `EMAIL_PASS` are optional (Gmail address plus a 16-character App Password). Without them the app runs normally and only skips the email.

### 2. Build and start

```bash
docker compose up -d --build
```

Open **http://localhost**. MySQL runs `init.sql` automatically the first time the `mysql-data` volume is created.

> **Windows note:** recent Docker Compose versions build through *buildx bake*. In a non-interactive shell (scripts, Jenkins) a build can stop with `additional privileges requested: pass "--allow=fs.read=..."`. Setting `BUILDX_BAKE_ENTITLEMENTS_FS=0` for that command fixes it:
> PowerShell: `$env:BUILDX_BAKE_ENTITLEMENTS_FS="0"; docker compose up -d --build`
> Git Bash: `BUILDX_BAKE_ENTITLEMENTS_FS=0 docker compose up -d --build`

### 3. Create staff accounts

```bash
docker compose exec backend node scripts/create-staff.js officer "Ward Officer" officer@civichelp.local <password>
docker compose exec backend node scripts/create-staff.js worker  "Field Worker" worker@civichelp.local  <password>
```

Add `--reset-password` to change the password of an existing account.

### Useful commands

```bash
docker compose ps                  # container status (db must show "healthy")
docker compose logs -f backend     # API and Socket.IO logs
docker compose down                # stop; data is kept in the named volumes
```

Never run `docker compose down -v` unless you want to **delete** the database and uploaded photos.

### Ports and data

- `80` (Nginx) is the only public port. The backend (`5001`) and MySQL (`3306`) are bound to `127.0.0.1` for local tools only.
- `mysql-data` stores the database; `uploads-data` stores the photos. Both survive container rebuilds.
- Existing databases created before resolution verification was added: apply [`migrations/001_add_resolution_verification.sql`](migrations/001_add_resolution_verification.sql).

### Running without Docker (development)

1. Load `init.sql` into a local MySQL server and set `DB_HOST=127.0.0.1` in `.env`.
2. `cd backend && npm install && npm run dev`: API on http://localhost:5001
3. `cd frontend && npm install && npm start`: React dev server on http://localhost:3000 (automatically talks to port 5001)

---

## 🎬 Demonstration Script (about 8 minutes)

Use **three browser windows** (for example a normal window, a private window, and a second browser), because each role needs its own login session. Keep the **Live Map** open in a fourth tab to show real-time updates.

| # | Window | Action | What to point out |
|---|---|---|---|
| 1 | Guest | Open http://localhost and scroll through the Impact section | Live statistics computed from the database |
| 2 | Citizen | Register *Priya Sharma* (`priya@example.com`), then log in | Registration validation; the role is always *citizen* |
| 3 | Citizen | **Report Issue** → *Pothole*, description "Deep pothole outside Andheri station, two-wheelers swerving into traffic", search "Andheri station Mumbai", attach a photo, submit | Location is required; photo checked by type and size; success message |
| 4 | Map tab | Without refreshing, the new red marker appears | Socket.IO broadcast through Nginx |
| 5 | Officer | Log in as the officer → Dashboard shows the new complaint with photo and reporter | **Live** badge; role-specific dashboard |
| 6 | Officer | **Assign** → choose the field worker → Save | Status becomes *In Progress*; the map marker turns amber live |
| 7 | Worker | Log in as the worker → the task is listed → **Submit Resolution Proof**, upload an "after" photo, notes "Filled with cold-mix asphalt and compacted" | Cannot resolve without a photo; only assigned tasks are visible |
| 8 | Citizen | **My Issues** now shows Before / After photos and the verification prompt | Evidence-based closure |
| 9 | Citizen | **Request Reopening** → reason "Patch already sinking after rain" | Task goes back to *In Progress*; the officer sees a red *Citizen Reopened* banner |
| 10 | Worker → Citizen | Worker resolves again with a new photo; citizen clicks **Confirm Fixed** | Final state *Verified Fixed*; the map shows green |
| 11 | Terminal | `docker compose ps` and `docker compose restart`, then reload | Data and photos persist (named volumes) |

Tip: prepare two photos in advance (a "before" and an "after" image, JPEG/PNG/WebP under 5 MB).

---

## ☁️ AWS Deployment (AWS Academy Learner Lab)

Single, economical node: no RDS, load balancer or NAT gateway.

```
Internet ──► Security group civichelp-sg
             • 80/tcp from 0.0.0.0/0      (Nginx)
             • 22/tcp from admin_cidr/32  (SSH, your IP only)
                     │
                     ▼
        EC2 t3.micro · Ubuntu 22.04 · 20 GB gp3 · us-east-1a
        └── Docker Compose: frontend (Nginx :80) → backend (:5001, internal) → MySQL (internal)
```

> **Day-to-day use needs only the PowerShell scripts in [`scripts/`](scripts).** The full, step-by-step guide for starting, stopping, Jenkins, the demo and troubleshooting is [`docs/START_STOP_AND_PRESENTATION_GUIDE.md`](docs/START_STOP_AND_PRESENTATION_GUIDE.md). The manual Terraform and Ansible steps below are what the scripts and Jenkins run for you.

| Script | Purpose |
| :--- | :--- |
| `scripts\update-aws-credentials.ps1` | Test and save fresh AWS Academy credentials |
| `scripts\start-civichelp.ps1` / `stop-civichelp.ps1` / `status-civichelp.ps1` | Start, stop (nothing is deleted) and inspect the **existing** EC2 instance |
| `scripts\update-ssh-access.ps1` | Allow SSH from your current IP (guarded Terraform plan) |
| `scripts\create-demo-accounts.ps1` | Create citizen / officer / worker demo logins (local or AWS) |
| `scripts\start-jenkins.ps1` / `stop-jenkins.ps1` / `status-jenkins.ps1` | Run and inspect the existing Jenkins |

### Prerequisites

1. Start the Learner Lab and copy the **AWS CLI credentials** (access key, secret key, **session token**) with `scripts\update-aws-credentials.ps1`. They expire when the lab session ends.
2. Terraform ≥ 1.0 and the AWS CLI. Ansible runs inside **WSL Ubuntu** on Windows.
3. An SSH key pair (`ssh-keygen -t ed25519 -f civichelp-key -N ""`); its public key goes in `terraform.tfvars`.

### 1. Terraform

`terraform/terraform.tfvars` (git-ignored):

```hcl
aws_region    = "us-east-1"
instance_type = "t3.micro"
key_name      = "civichelp-key"
public_key    = "ssh-ed25519 AAAA... "    # contents of civichelp-key.pub
admin_cidr    = "YOUR_CURRENT_PUBLIC_IP/32"
```

```bash
cd terraform
terraform init
terraform plan      # always read the plan first
terraform apply
```

- **Your public IP changes** on most home and mobile connections. When SSH times out, update `admin_cidr` (`curl https://checkip.amazonaws.com`) and apply again. This is an in-place security-group change.
- Stopping and starting the instance (including the Learner Lab auto-stop) **changes its public IP**. Run `terraform refresh` and then `terraform output ec2_public_ip`.
- The instance ignores newer AMI releases (`lifecycle.ignore_changes = [ami]`), so a plan never replaces the server just because Ubuntu published a new image.
- Keep **one** Terraform state (`terraform/terraform.tfstate`). Running Terraform from another directory without it would try to create duplicate resources.

### 2. Ansible (from WSL Ubuntu)

The EC2 instance clones the app from GitHub, so **push your changes first**.

```bash
# inside WSL (secrets via environment variables, never on the command line)
cd /mnt/d/CivicHelp
set -a; . /mnt/d/AWSConfig/civichelp-deploy.env; set +a     # defines DB_PASSWORD and JWT_SECRET
EC2_IP=<EC2_IP> SSH_KEY=/mnt/d/AWSConfig/civichelp-key bash ansible/run-deploy.sh
```

`ansible/run-deploy.sh` builds the inventory the playbook needs (it targets the group `civichelp`; an inline `-i "IP,"` inventory matches no host), waits for SSH and runs `ansible/deploy.yml`. Jenkins uses the same script.

Use the **same** `DB_PASSWORD` for every redeploy: MySQL fixes its root password when the data volume is first created, so changing it later makes the backend unable to connect.

The playbook adds 2 GB of swap (the React build needs it on a 1 GB t3.micro), installs Docker from Docker's signed apt repository, clones the repo, writes `.env` with mode `0600` (`no_log`), runs `docker compose up --build -d` (volumes preserved) and waits for `/api/health`. To create staff logins in the same run, add for example `-e '{"staff_accounts":[{"role":"officer","name":"Ward Officer","email":"officer@civichelp.local","password":"..."}]}'`.

### 3. Jenkins pipeline

Two **separate** pipelines, so a normal build can never change AWS:

| Jenkins job | Pipeline file | Stages | Touches AWS |
| :--- | :--- | :--- | :--- |
| `CivicHelp-CI` | [`Jenkinsfile`](Jenkinsfile) | Checkout → Tool Check → Validate Compose → Validate Terraform → Validate Ansible → Build Docker Images → Test Images | No |
| `CivicHelp-Deploy-AWS` | [`jenkins/Jenkinsfile.deploy`](jenkins/Jenkinsfile.deploy) | Checkout → AWS Preflight → Terraform Plan (guarded) → Terraform Apply → Ansible Deploy → Smoke Test | Yes |

- The CI job validates `docker-compose.yml`, Terraform formatting and the Ansible syntax, builds both Docker images and tests them (backend syntax check, `nginx -t`). It costs nothing on AWS.
- The deploy job re-uses the existing Terraform state (`TF_DIR`, default `D:/CivicHelp/terraform`), refuses to continue if the plan would add, replace or destroy anything, runs Ansible (natively on Linux, or through WSL on a Windows Jenkins) and checks `http://<ip>/api/health`.
- `scripts\start-jenkins.ps1` starts the existing Jenkins and (re)creates both jobs and the Secret-text credentials `CIVICHELP_DB_PASSWORD` / `CIVICHELP_JWT_SECRET` through [`jenkins/init/civichelp-setup.groovy`](jenkins/init/civichelp-setup.groovy). Secrets reach Ansible only as environment variables and are masked in the console log.
- Windows agent requirements: Git for Windows `sh` in the `PATH` of the Jenkins process, Docker Desktop, `terraform`, `aws`, and a WSL distribution with Ansible. `start-jenkins.ps1` sets this up.

---

## 🔒 Security Summary

- Passwords hashed with bcrypt; JWT (7-day expiry); the UI logs out automatically when a session expires.
- Authorization enforced on the server: officer-only management endpoints, workers limited to their own assignments, only the reporter can verify, and assignment accepts only real field-worker accounts.
- Uploads: JPEG/PNG/WebP only, 5 MB limit (Nginx `client_max_body_size 6M`), content checked by file signature (magic bytes), invalid or orphaned files deleted.
- Public map API and Socket.IO broadcasts contain no names, emails or user IDs.
- Secrets live only in `.env` / Jenkins credentials (git-ignored); MySQL and the API are not exposed publicly; SSH is limited to one admin IP.

## ⚠️ Known Limitations / Future Work

- HTTP only: no domain or TLS certificate yet (Let's Encrypt plus a domain would be the next step).
- Email notification is sent only on resolution, and only when SMTP credentials are configured.
- Staff accounts are created with a CLI script; there is no admin UI.
- No pagination: suitable for demo-scale data, not thousands of complaints.
- Single EC2 instance with a local MySQL container: no high availability; backups would need snapshots or `mysqldump`.
- Address search depends on the public Nominatim service (rate-limited) and is restricted to India.
