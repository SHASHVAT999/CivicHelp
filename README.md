# 🏛️ CivicHelp — Smart Civic Issue Reporting Platform

CivicHelp is a full-stack, open-source civic issue-management platform that empowers citizens to report, track, and resolve local municipal problems (such as potholes, broken streetlights, garbage dumps, and water leaks) directly from their browser on an interactive live map.

---

## 🌟 Key Features

- 📝 **Citizen Reporting:** Submit geo-tagged civic complaints with category selection, automated reverse-geocoding, and photo evidence uploads.
- 🗺️ **Interactive Public Map:** Real-time OpenStreetMap visualization of municipal issues with status indicators (Open, In Progress, Resolved).
- 📸 **Robust Upload Pipeline:** Validates JPEG, PNG, and WebP photographs up to 5 MB with persistent Docker volume storage and automated orphan cleanup.
- 🔐 **Role-Based Access Control:** Secure JWT authentication with strict authorization separating Citizens, Ward Officers, and Field Workers.
- 📊 **Ward Officer Dashboard:** Authenticated management interface to review complaints, assign field workers, and oversee resolution metrics.
- 💬 **Live WebSocket Updates:** Instant cross-client synchronization via Socket.IO whenever complaints are submitted or statuses change.
- 🔔 **Optional Email Notifications:** Automated citizen alerts via Nodemailer upon issue resolution (runs smoothly with or without SMTP configuration).

---

## 🛠️ Architecture & Technology Stack

```
                                  [ Citizen / Staff Browser ]
                                               │
                                               │ HTTP: 80 / WebSocket
                                               ▼
                              ┌──────────────────────────────────┐
                              │       Nginx Reverse Proxy        │
                              │   (Container: civichelp-frontend)│
                              └────────────────┬─────────────────┘
                                               │
                       ┌───────────────────────┴───────────────────────┐
                       │ (Static Assets / SPA)                         │ (Proxy: /api, /socket.io, /uploads)
                       ▼                                               ▼
        ┌─────────────────────────────┐                 ┌─────────────────────────────┐
        │       React 19 Frontend     │                 │     Express / Node.js API   │
        │   Leaflet / React-Leaflet   │                 │ (Container: civichelp-backend│
        └─────────────────────────────┘                 └──────────────┬──────────────┘
                                                                       │
                                                                       ▼
                                                        ┌─────────────────────────────┐
                                                        │          MySQL 8.0          │
                                                        │  (Container: civichelp-db)  │
                                                        └─────────────────────────────┘
```

- **Frontend:** React 19, React Router 7, Leaflet & React-Leaflet, Axios, Socket.IO Client, Lucide React icons.
- **Backend:** Node.js, Express 5, Socket.IO 4, Multer, Nodemailer, bcryptjs, jsonwebtoken.
- **Database:** MySQL 8.0 (canonical schema defined in root [`init.sql`](init.sql)).
- **Containerization & Web Server:** Docker, Docker Compose, Nginx (Alpine).
- **Infrastructure as Code (IaC):** Terraform (modular AWS single-node provisioning).
- **Configuration Management:** Ansible (automated EC2 bootstrap, swap creation, and container orchestration).
- **CI/CD Automation:** Jenkins (automated pipeline from SCM checkout to deployment).

---

## 🚀 Local Development Guide

### 1. Environment Configuration

Copy the sample environment file to `.env`:
```bash
cp .env.example .env
```
Open `.env` and configure:
- `DB_PASSWORD`: Set a secure MySQL password.
- `JWT_SECRET`: Set a strong random secret key for JWT token signing.
- `CLIENT_URL`: Configured by default to `http://localhost:3000,http://localhost`.
- `DB_NAME`: Set to `civichelp`.
- *(Optional)* `EMAIL_USER` / `EMAIL_PASS`: Gmail App Password if resolution emails are needed.

---

### 2. Option A: Running with Docker Compose (Recommended)

Docker Compose builds and provisions the complete multi-container stack:
```bash
docker compose up --build
```

#### Multi-Container Architecture Details:
- **Automatic Database Initialization:** MySQL executes root [`init.sql`](init.sql) on initial boot via `/docker-entrypoint-initdb.d/init.sql`. *(Note: `backend/models/db.sql` does not exist).*
- **Internal Database Network:** The backend connects to MySQL internally via `DB_HOST=db` across `civichelp-network`.
- **Loopback Database Binding:** MySQL port 3306 is bound strictly to `127.0.0.1:3306` on the host, preventing public exposure while allowing local management tools (e.g. MySQL Workbench, DBeaver) to connect.
- **Persistent Data:** Photos persist in the `uploads-data` volume; database tables persist in `mysql-data`.
- **Access URL:** Open `http://localhost` in your browser.

---

### 3. Option B: Running Locally (Hybrid / Host Development)

#### Step 1: Initialize the Database
Ensure a local MySQL instance (or Docker MySQL container) is running:
```bash
mysql -u root -p < init.sql
```
In your root `.env`, configure:
```ini
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_db_password_here
DB_NAME=civichelp
```

#### Step 2: Start the Backend API
```bash
cd backend
npm install
npm run dev
```
The backend API starts on `http://localhost:5001`.

#### Step 3: Start the React Frontend
In a separate terminal:
```bash
cd frontend
npm install
npm start
```
The React development server opens at `http://localhost:3000` and automatically routes requests to the backend at `http://localhost:5001`.

---

## ☁️ AWS Deployment Guide (AWS Academy Learner Lab)

This deployment architecture is specifically optimized for **AWS Academy Learner Lab** accounts ($49 credit limit), utilizing an economical single-EC2 instance without costly managed services (no AWS RDS, no Application Load Balancer, and no NAT Gateways).

```
                      Internet
                         │
             ┌───────────┴───────────┐
             │ Port 80 (HTTP)        │ Port 22 (SSH)
             │ (Public to World)     │ (Restricted to Admin CIDR)
             ▼                       ▼
      ┌─────────────────────────────────────────────────────┐
      │         AWS EC2 Instance (t3.micro / Ubuntu 22.04)  │
      │                                                     │
      │   ┌──────────────────────────────────────────────┐  │
      │   │              Docker Compose                  │  │
      │   │                                              │  │
      │   │   civichelp-frontend   (Nginx :80)           │  │
      │   │          │                                   │  │
      │   │          ▼                                   │  │
      │   │   civichelp-backend    (Express :5001)       │  │
      │   │          │                                   │  │
      │   │          ▼                                   │  │
      │   │   civichelp-db         (MySQL 8.0 :3306)     │  │
      │   └──────────────────────────────────────────────┘  │
      └─────────────────────────────────────────────────────┘
```

### AWS Resources & Network Ingress Rules

| Resource | Identifier / Name | Description & Cost Strategy |
| :--- | :--- | :--- |
| **EC2 Instance** | `civichelp-server` | Ubuntu 22.04 LTS (`t3.micro`, 20GB gp3 storage) — Economical. |
| **Security Group** | `civichelp-sg` | Ingress: Port 80 (0.0.0.0/0), Port 22 (restricted to `var.admin_cidr`). |
| **SSH Key Pair** | `civichelp-key` | User-provided public SSH key (private key stays on local machine). |
| **Backend Port 5001** | *Internal Only* | **Not exposed to the public internet**; accessible only via Nginx reverse proxy. |
| **MySQL Port 3306** | *Internal Only* | **Not exposed to the public internet**; accessible only via Docker bridge network. |

---

### Step-by-Step AWS Provisioning

#### Prerequisites
1. **AWS CLI configured with AWS Academy credentials:**
   ```bash
   aws configure
   ```
   *(For AWS Academy Learner Lab, update `~/.aws/credentials` with `aws_access_key_id`, `aws_secret_access_key`, and `aws_session_token`).*
2. **Terraform CLI (v1.0+)** and **Ansible (`ansible-playbook`)** installed.
3. **Generate a local SSH key pair:**
   ```bash
   ssh-keygen -t rsa -b 4096 -f ~/.ssh/civichelp-key -N ""
   ```

#### 1. Provision Infrastructure with Terraform
Navigate to the `terraform/` directory:
```bash
cd terraform
terraform init
```

Create a `terraform.tfvars` file (automatically ignored by Git):
```hcl
aws_region  = "us-east-1"
instance_type = "t3.micro"
public_key  = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQ..." # Contents of ~/.ssh/civichelp-key.pub
admin_cidr  = "YOUR_PUBLIC_IP/32"                         # Restrict SSH to your IP
```

Apply the configuration:
```bash
terraform apply
```
Terraform will output the EC2 public IP address:
```bash
Apply complete! Resources: 3 added, 0 changed, 0 destroyed.
Outputs:
application_url = "http://54.xxx.xxx.xxx"
ec2_public_ip = "54.xxx.xxx.xxx"
```

---

#### 2. Deploy Application with Ansible
From the project root, export your deployment secrets safely in your shell session, then run the Ansible playbook:
```bash
# Set deployment secrets as environment variables (recommended):
export DB_PASSWORD="your_secure_db_password"
export JWT_SECRET="your_secure_jwt_secret"

ansible-playbook -i "54.xxx.xxx.xxx," ansible/deploy.yml \
  -u ubuntu \
  --private-key ~/.ssh/civichelp-key \
  -e "git_repo_url=https://github.com/<your-username>/CivicHelp.git" \
  -e "git_branch=main" \
  -e "ec2_ip=54.xxx.xxx.xxx"
```
*(Alternatively, pass them via extra-vars: `-e "db_password=your_secure_db_password" -e "jwt_secret=your_secure_jwt_secret"`).*

The playbook will:
1. Allocate a 2GB swap file to prevent out-of-memory errors during the frontend build.
2. Install Docker CE and the Docker Compose plugin.
3. Clone the CivicHelp repository.
4. Generate the secure runtime `.env` file (`no_log: true` prevents credential exposure in logs).
5. Build and launch all three containers (`docker compose up --build -d`).
6. Wait for HTTP port 80 to become responsive.

---

#### 3. Automated CI/CD with Jenkins
The included [`Jenkinsfile`](Jenkinsfile) automates the entire provisioning and deployment sequence:
- **Parameters:**
  - `GIT_REPO_URL`: URL to your CivicHelp repository.
  - `GIT_BRANCH`: Target branch (default `main`).
  - `SSH_PRIVATE_KEY_PATH`: Path to SSH key on Jenkins agent (default `~/.ssh/civichelp-key`).
  - `ADMIN_CIDR`: Allowed administrator CIDR for SSH access.
- **Pipeline Execution Sequence:**
  1. `Prerequisites Check`: Validates that `ADMIN_CIDR` is set (rejecting `0.0.0.0/0`) and confirms `terraform` and `ansible-playbook` exist in PATH.
  2. `Checkout`: Pulls the latest application source code.
  3. `Terraform`: Provisions EC2 and security groups, exporting `ec2_ip.txt`.
  4. `Ansible`: Generates dynamic inventory `[civichelp]` and deploys containers.
  5. `Done`: Outputs live application URL.

> [!NOTE]
> **Jenkins Agent Prerequisite (Windows / WSL):**
> The pipeline uses POSIX shell steps (`sh`) and runs `ansible-playbook`. Because Ansible requires a POSIX environment and does not execute natively in Windows `bat`/`cmd`, when hosting Jenkins on Windows, configure the pipeline to execute on a **Linux or WSL2-backed Jenkins agent** where Terraform and Ansible are installed.
