# CivicHelp: Start, Stop and Presentation Guide

Written for you on presentation day, when you may have forgotten everything. Every command can be copied as is.
All commands are typed in **Windows PowerShell** inside the project folder:

```powershell
cd D:\CivicHelp
```

> If PowerShell says *"running scripts is disabled on this system"*, put `powershell -ExecutionPolicy Bypass -File` in front of the script, for example
> `powershell -ExecutionPolicy Bypass -File .\scripts\status-civichelp.ps1`

---

## 0. Cheat sheet

| I want to... | Command |
|---|---|
| Refresh the expired AWS credentials | `.\scripts\update-aws-credentials.ps1` |
| **Start CivicHelp on AWS** | `.\scripts\start-civichelp.ps1` |
| Check what is running | `.\scripts\status-civichelp.ps1` |
| **Stop CivicHelp on AWS** (saves money, deletes nothing) | `.\scripts\stop-civichelp.ps1` |
| Fix SSH access after my IP changed | `.\scripts\update-ssh-access.ps1` |
| Create the demo logins (local / AWS) | `.\scripts\create-demo-accounts.ps1 -Target Local` / `-Target Aws` |
| **Start Jenkins** | `.\scripts\start-jenkins.ps1 -OpenBrowser` |
| Run the CI/CD pipeline without logging in | `.\scripts\stop-jenkins.ps1` then `.\scripts\start-jenkins.ps1 -RunBuild Pipeline` |
| Show Jenkins build results in the terminal | `.\scripts\status-jenkins.ps1 -ShowLog CivicHelp-Pipeline` |
| **Stop Jenkins** | `.\scripts\stop-jenkins.ps1` |
| Run the app on my laptop only | `docker compose up -d`, then open http://localhost |

**Never run** `terraform destroy` or `docker compose down -v`. They delete the cloud server or the database.

**Where everything is:** project `D:\CivicHelp` | AWS credentials, SSH key and passwords `D:\AWSConfig` | Jenkins `D:\cloud-devops-assignment\vle-pbl3` | WSL (Ansible) `D:\WSL` | Docker data `D:\DockerData`. Nothing lives on C:.

---

## 1. One-time setup and required software

Everything is **already installed on this laptop**. Use this section only to check, or to rebuild on another PC.

| Software | Where | How to check |
|---|---|---|
| Docker Desktop | `C:\Program Files\Docker` (data on `D:\DockerData`) | `docker --version` |
| AWS CLI v2 | `D:\AWSCLI` | `aws --version` |
| Terraform | `D:\Terraform` | `terraform version` |
| Git | `D:\Git` | `git --version` |
| WSL 2 with Ubuntu + Ansible | `D:\WSL` | `wsl -d Ubuntu -- ansible --version` |
| Jenkins (war) + JDK 21 | `D:\cloud-devops-assignment\vle-pbl3\tools` | `.\scripts\start-jenkins.ps1` |
| Browser (Chrome or Edge) | normal install | |

Files that must exist (they are **not** in GitHub because they are secret):

| File | What it is |
|---|---|
| `D:\AWSConfig\credentials` | AWS Academy temporary credentials (changed by `update-aws-credentials.ps1`) |
| `D:\AWSConfig\civichelp-key` | SSH private key of the EC2 server |
| `D:\AWSConfig\civichelp-deploy.env` | Database password and JWT secret used by the cloud deployment and by Jenkins |
| `D:\AWSConfig\civichelp-demo-accounts.txt` | Passwords of the demo logins (created by `create-demo-accounts.ps1`) |
| `D:\CivicHelp\terraform\terraform.tfstate` and `terraform.tfvars` | Terraform's memory of the AWS resources. **Do not delete.** |

Environment variables (already set for your Windows user): `AWS_SHARED_CREDENTIALS_FILE=D:\AWSConfig\credentials` and `AWS_CONFIG_FILE=D:\AWSConfig\config`.

---

## 2. Refresh the AWS Academy credentials (every lab session)

AWS Academy credentials stop working when the lab session ends. Do this at the start of every session:

1. Open **AWS Academy** in your browser, then your course, then the **Learner Lab**.
2. Click **Start Lab**. Wait until the circle next to **AWS** turns **green**.
3. Click **AWS Details**.
4. Next to **AWS CLI:** click **Show**. A box with `[default]`, `aws_access_key_id`, `aws_secret_access_key` and `aws_session_token` appears.
5. Click the **copy** icon of that box (or select all of the text and press Ctrl+C).
6. In PowerShell:
   ```powershell
   cd D:\CivicHelp
   .\scripts\update-aws-credentials.ps1
   ```
7. You must see `[OK] AWS accepted the credentials (role: voclabs)` and `[OK] Saved credentials work`.

The script reads the credentials from the clipboard (nothing is typed on screen), tests them with AWS **before** saving anything, and clears the clipboard afterwards. If it cannot find them it asks you to copy again. If copying does not work, use `.\scripts\update-aws-credentials.ps1 -Manual` and paste the three values one by one (the input is hidden).

The credentials are valid until the lab session ends (the timer is at the top of the Learner Lab page). Refresh them again in the next session.

---

## 3. Start and stop CivicHelp on AWS

### Start
```powershell
cd D:\CivicHelp
.\scripts\start-civichelp.ps1
```
It checks the credentials (and offers to refresh them), starts the **existing** server, waits until the website, the API and MySQL answer (normally 1 to 3 minutes) and prints the address:

```
CivicHelp is LIVE:  http://35.172.235.54
```
**The address changes every time the server is stopped and started.** Always use the one the script prints.

### Check
```powershell
.\scripts\status-civichelp.ps1
```
Shows the server state, the IP, whether the website, the API and the database are healthy, and whether SSH is allowed from this laptop.

### Stop
```powershell
.\scripts\stop-civichelp.ps1
```
This is a clean shutdown, like turning off a computer. **Nothing is deleted**: the database, the photos, the Terraform state, the SSH key and the security group are kept. Start it again with `start-civichelp.ps1` and all data is still there (tested, see section 11).

### What can cost money while the server is stopped?

| Resource | Running | Stopped |
|---|---|---|
| EC2 `t3.micro` compute | about US$0.01 per hour | **no charge** |
| Public IPv4 address | about US$0.005 per hour | **no charge** (the IP is released) |
| 20 GB EBS disk (database, photos) | about US$1.60 per month | **still charged**, about US$0.05 per day |
| Security group, key pair, Terraform files | free | free |

The project does **not** use RDS, a load balancer, a NAT gateway or an Elastic IP, which are the usual surprise bills. Prices are approximate for `us-east-1`; check the *Billing* page of the Learner Lab for the real budget. Stop the server when you are not using it.

---

## 4. Run the app on the laptop only (no AWS)

This is also your **backup plan** if AWS or the internet fails during the presentation. Start Docker Desktop first and wait for "Engine running".

```powershell
cd D:\CivicHelp
docker compose up -d
docker compose ps
```
All three containers (`civichelp-frontend`, `civichelp-backend`, `civichelp-db`) must be `Up`, and the database `healthy`. Open **http://localhost**.

```powershell
docker compose stop          # stop, keeps all data
docker compose logs -f backend   # watch the API (Ctrl+C to leave)
```
Create the demo logins once: `.\scripts\create-demo-accounts.ps1 -Target Local`

After changing code, rebuild with: `$env:BUILDX_BAKE_ENTITLEMENTS_FS="0"; docker compose up -d --build`

The map and the address search need the internet (OpenStreetMap).

---

## 5. Jenkins: the CI/CD pipeline

Jenkins is your existing installation from the coursework; nothing new is installed. There is **one** job,
**CivicHelp-Pipeline**, which tests a commit and then deploys it to AWS. Every stage is explained in
[CI_CD_PIPELINE.md](CI_CD_PIPELINE.md). Read it before the presentation.

### Start
```powershell
cd D:\CivicHelp
.\scripts\start-jenkins.ps1 -OpenBrowser
```
It takes 1 to 2 minutes. Jenkins is then at **http://localhost:8080**. Log in with your existing admin account
(`devopsadmin`). On each start the script makes sure the job and the two encrypted credentials exist. Your other
course jobs are not touched. The old `CivicHelp-CI` and `CivicHelp-Deploy-AWS` jobs are shown **disabled**: they were
replaced by the single pipeline, and their history is kept.

### The stages

| # | Stage | In one sentence |
|---|---|---|
| 1 | Checkout | Gets the commit from GitHub and remembers its exact id |
| 2 | Tool Check | Docker, Compose, Terraform, Git, Ansible (WSL) and the AWS CLI are available |
| 3 | Validate | Compose files, Terraform (fmt + validate) and the Ansible playbook, in parallel |
| 4 | Build Images | Builds the backend and frontend Docker images, tagged with the build number |
| 5 | Unit Tests | 12 backend unit tests inside the new image; `nginx -t` in the frontend image |
| 6 | Integration Test | Throwaway copy of the app (in-memory database) runs the whole workflow: 49 checks |
| 7 | AWS Preflight | Lab credentials valid, server running, snapshot of the existing data |
| 8 | Terraform Plan | Plan against the existing state; **refused** if it would add, replace or destroy anything |
| 9 | Terraform Apply | Applies exactly that plan (normally no changes) |
| 10 | Ansible Deploy | Server checks out the **tested commit** and restarts the containers (data volumes kept) |
| 11 | Verify Deployment | Health + database, deployed version = tested commit, MySQL query, website, **old data and photos still there** |

### Show the pipeline to the professor
Preconditions for the full run: lab started, credentials refreshed (section 2), server **running** (section 3).
1. Open http://localhost:8080 and click **CivicHelp-Pipeline**.
2. Click **Build with Parameters**. Keep the defaults (`DEPLOY_TO_AWS` ticked, `ADMIN_CIDR` empty) and click **Build**.
   This takes about 7 minutes. Untick `DEPLOY_TO_AWS` for a 2-minute CI-only run; stages 7-11 are then shown as skipped.
3. Open the build and choose **Pipeline Overview** (the graph view). Point at the parallel *Validate* branches and the CI to CD order.
4. In **Console Output**, things worth pointing at:
   - `Obtained Jenkinsfile from git https://github.com/SHASHVAT999/CivicHelp.git`
   - `Commit under test: ...`
   - `# pass 12` (unit tests) and `Integration test: 49 passed, 0 failed`
   - `Plan is safe: nothing is added, replaced or destroyed.`
   - the deploy secrets shown only as `****`
   - `[2/5] Deployed version is ...` and `[5/5] Existing data preserved`
   - `Finished: SUCCESS`
5. Show the **Jenkinsfile** in GitHub, and **Manage Jenkins > Credentials** (`CIVICHELP_DB_PASSWORD`,
   `CIVICHELP_JWT_SECRET`, stored encrypted).

### Without logging in (from the terminal)
```powershell
.\scripts\stop-jenkins.ps1
.\scripts\start-jenkins.ps1 -RunBuild Pipeline          # or -RunBuild PipelineCIOnly (never touches AWS)
.\scripts\status-jenkins.ps1 -ShowLog CivicHelp-Pipeline -Tail 80   # a few minutes later
```
The build is started by Jenkins itself during start-up. Remote trigger URLs are deliberately not used, because they
would require weakening Jenkins security.

### Stop
```powershell
.\scripts\stop-jenkins.ps1
```
It refuses to stop while a build is running (add `-Force` to stop anyway). Jobs and build history are kept.

---

## 6. Demonstration script (about 8 minutes)

Use **three separate browser sessions**: a normal window (citizen), a private/incognito window (officer) and a second browser, for example Edge (worker). Open the **Map** in a fourth tab.

Passwords are in `D:\AWSConfig\civichelp-demo-accounts.txt`. Create the logins on the target first:
```powershell
.\scripts\create-demo-accounts.ps1 -Target Aws      # or -Target Local
```
Accounts: `citizen@civichelp.demo`, `officer@civichelp.demo`, `worker@civichelp.demo`. Prepare two photos in advance (a "before" and an "after" picture, JPEG/PNG/WebP, under 5 MB).

| # | Who | Do this | Say this |
|---|---|---|---|
| 1 | Anyone | Open the site, scroll through the home page | "The figures under *Current status* come straight from the database." |
| 2 | Citizen | **Log in** > *Create a citizen account*: name *Priya Sharma*, `priya@example.com`, a password of 6+ characters. Log in | "Anyone can register, but the role is always *citizen*." |
| 3 | Citizen | **Report an issue** > *Pothole*; description `Deep pothole outside Andheri station, two-wheelers swerving into traffic`; type `Andheri station Mumbai` in the address box and pick a result; attach the "before" photo; **Submit** | "Location and a description are required; the photo is checked by type and size." |
| 4 | Map tab | The new red marker appears **without refreshing** | "Socket.IO pushes the update through Nginx in real time." |
| 5 | Officer | Log in as the officer. **Dashboard** shows the complaint with its photo | "Role-based dashboard; the **Live** badge shows the real-time connection." |
| 6 | Officer | **Assign** > choose *Field Worker (Demo)* > **Save** | "Status changes to *In Progress*; the map marker turns amber live." |
| 7 | Worker | Log in as the worker. The task is listed. **Submit Resolution Proof**: attach the "after" photo, notes `Filled with cold-mix asphalt and compacted` | "A task cannot be resolved without a photo, and workers see only their own tasks." |
| 8 | Citizen | **My reports**: before and after photos and the verification prompt appear | "Closure is backed by evidence." |
| 9 | Citizen | **Request Reopening**, reason `Patch already sinking after rain` | "The citizen has the final say. The task returns to *In Progress*." |
| 10 | Officer | The red *Citizen Reopened* banner with the reason is visible | |
| 11 | Worker, then citizen | Worker resolves again with a new photo; citizen clicks **Confirm Fixed** | "Final state: *Verified Fixed*; the map marker is green." |
| 12 | Terminal | `.\scripts\stop-civichelp.ps1`, then `.\scripts\start-civichelp.ps1`, then reload and log in | "Data persists across a full server restart." (takes a few minutes, so mention it or do it before the talk) |

---

## 7. Technologies to show, and where

| Technology | What to open | What to say |
|---|---|---|
| **GitHub** | https://github.com/SHASHVAT999/CivicHelp : the commits, `Jenkinsfile`, `tests/`, `terraform/`, `ansible/`, `docker-compose.yml` | "Everything, including the infrastructure, is code in one repository. Secrets are not in it." |
| **Docker** | `docker compose ps`, `docker compose config`, `docker images` | "Three containers: Nginx and React, Express API, MySQL. Named volumes keep the data." |
| **Jenkins** | http://localhost:8080, **CivicHelp-Pipeline**, Pipeline Overview and Console Output | "One pipeline: it validates, builds and tests every commit, and only then deploys that exact commit to AWS and proves the data survived." |
| **Terraform** | `cd terraform` then `terraform state list` and `terraform plan` (it must say *No changes* or only refreshes) | "Declares the server, security group and key pair. Port 80 is public, SSH only from my IP." |
| **Ansible** | `ansible/deploy.yml` | "Installs Docker, swap, clones the repository, writes the secrets file, starts the containers and checks the health." |
| **AWS** | Console > EC2 > Instances > `civichelp-server`; the security group `civichelp-sg`; Volumes (20 GB gp3) | "One t3.micro, no RDS or load balancer, to stay inside the Learner Lab budget." |

A good order for the talk: problem, live demo (section 6), then architecture and tools (this table), then limitations.

---

## 8. Presentation-day checklist

**One hour before**
1. Start the AWS Academy lab, refresh the credentials (section 2).
2. `.\scripts\start-civichelp.ps1` and open the printed address.
3. `.\scripts\create-demo-accounts.ps1 -Target Aws` (safe to repeat; it only verifies if they exist).
4. `.\scripts\start-jenkins.ps1 -OpenBrowser`, log in, and run **CivicHelp-Pipeline** once (*Build with Parameters*, defaults) so a fresh green build is ready to show.
5. Open `http://localhost` too (`docker compose up -d`) as a backup.
6. Prepare the two photos and the three browser sessions.

**Afterwards**
1. `.\scripts\stop-civichelp.ps1` and `.\scripts\stop-jenkins.ps1`.

---

## 9. Common problems and fixes

| Problem | Fix |
|---|---|
| `running scripts is disabled on this system` | Use `powershell -ExecutionPolicy Bypass -File .\scripts\<name>.ps1` |
| `AWS credentials are missing or expired` | Section 2: start the lab, then `.\scripts\update-aws-credentials.ps1` |
| `AWS rejected these credentials` | You copied an old or partial block. Click **Start Lab** again, **Show** the CLI block again, copy **all** of it |
| The site does not open | Use the address printed by the last `start-civichelp.ps1` (it changes), with `http://` not `https://`. Run `.\scripts\status-civichelp.ps1` |
| Status says the app is not healthy right after start | The containers need 1 to 3 minutes after boot. Wait and run status again |
| `SSH port 22 is not reachable` | Your IP changed: `.\scripts\update-ssh-access.ps1` (the website itself is not affected) |
| `update-ssh-access.ps1` refuses ("not 0 add, 1 change, 0 destroy") | Do not force it. Run `cd terraform` then `terraform plan` and read the plan |
| Instance cannot be started | The lab is not started or the budget is used up: check the Learner Lab page |
| Jenkins: `Port 8080 is used by another program` | Close the other program (or an old Jenkins): `.\scripts\stop-jenkins.ps1` |
| Jenkins does not become ready | Read `D:\cloud-devops-assignment\vle-pbl3\shared\logs\civichelp-jenkins-err.log` |
| Pipeline fails in *Tool Check* or *Build Images* | Docker Desktop is not running: start it, wait for "Engine running", build again |
| Pipeline fails in *Unit Tests* or *Integration Test* | A real bug in the commit. The console shows the `FAIL` line and the container logs. Fix, push, build again. Nothing was deployed |
| Pipeline fails in *AWS Preflight* | Credentials expired or the server is stopped: section 2 and section 3. Or untick `DEPLOY_TO_AWS` for CI only |
| *Terraform Plan*: `differs from terraform/... in commit` | `D:\CivicHelp` is behind GitHub: `cd D:\CivicHelp; git pull`, then build again |
| *Terraform Plan*: `REFUSING` | The plan would add, replace or destroy something. Do not force it: `cd terraform; terraform plan` and read why |
| *Ansible Deploy*: `SSH is not reachable` | Your public IP changed. Leave `ADMIN_CIDR` empty (auto-detect) and build again, or run `.\scripts\update-ssh-access.ps1` |
| *Verify Deployment*: `different version` | The backend was not restarted with the new code. Read the Ansible output above it; running the pipeline again is safe |
| Cannot log in to Jenkins | Use the admin account from your coursework. It was not changed by these scripts |
| `docker compose` build says `additional privileges requested` | `$env:BUILDX_BAKE_ENTITLEMENTS_FS="0"` first, then repeat the command |
| Map is empty or grey | The laptop has no internet (map tiles come from OpenStreetMap) |
| Photo upload is rejected | Only JPEG, PNG or WebP up to 5 MB are accepted |
| Port 80 is already in use locally | Another program uses it (for example IIS or another container): stop it, then `docker compose up -d` |
| Unsure whether data is safe | `docker volume ls` must list `civichelp_mysql-data` and `civichelp_uploads-data`. Never run `docker compose down -v` |

---

## 10. How the pieces fit together

```
Your laptop (D:\CivicHelp)              GitHub (main)                  AWS (us-east-1)
  scripts\*.ps1  --- start/stop --->                                  EC2 t3.micro (existing)
  Jenkins :8080  CivicHelp-Pipeline  <-- checkout                      |- Nginx :80 (public)
    CI: validate, build, unit + integration tests (local Docker)        |- Express :5001 (internal)
    CD: Terraform plan/apply (guarded) ------------------------------>  |- MySQL (internal, volume)
        Ansible (WSL): git checkout <tested commit>, compose up ----->  |
        Verify: health, version, MySQL, website, data preserved ---->   |
```

---

## 11. What was tested (16 Nov 2026)

Everything below was actually run in the real Jenkins on this laptop and against the real EC2 instance.

**Unified pipeline (CivicHelp-Pipeline)**
- **CI only** (`DEPLOY_TO_AWS` unticked): SUCCESS. Every CI stage passed, and the five CD stages were shown as skipped.
- **Full CI/CD**: SUCCESS on the real EC2 instance.
  - CI: unit tests 12/12; integration test 49/49 on the throwaway stack.
  - Terraform: the plan was `0 to add, 0 to change, 0 to destroy`, and the apply changed nothing.
  - Ansible: `ok=18 failed=0`.
  - Verification [1/5] to [5/5] all passed. The server reported the tested commit as its version.
- The database password and JWT secret do not appear in the console log (searched for the actual values).
- The final commit was built and deployed by the pipeline as well (see the Jenkins build history).

**Data safety**
- Before the first deployment with the new pipeline, the server was fingerprinted directly: the user count, every
  complaint row, and the SHA-256 of every uploaded file. After the deployment the fingerprint was **identical**.
- To prove that photos survive a deployment, one labelled test report with a photo was added. The final pipeline run
  checked that photo after deploying (check [5/5]), and the test report was then removed again.
- The two named volumes `civichelp_mysql-data` and `civichelp_uploads-data` were present throughout. No volume was ever removed.

**Application**
- The integration test covers the whole workflow through Nginx, including real-time Socket.IO events (49 checks).
- The UI was checked for every role (guest, citizen, officer, worker) at desktop (1366 px) and phone (390 px) widths:
  no console errors and no horizontal scrolling.
- Earlier sessions: data and photos were identical after an EC2 stop/start; the start/stop/status/credential scripts were tested with real AWS.

**Not verified**
- Delivery of resolution e-mails: no SMTP credentials are configured, so the app logs that it skipped the e-mail.
- `update-aws-credentials.ps1` reading from the **clipboard** with real credentials (the same parsing was tested from a file).
- The Jenkins web pages (Build with Parameters, Pipeline Overview, Credentials) were not opened with your login. The
  builds were started with `-RunBuild` and verified from Jenkins' build records and console logs.
