#!/usr/bin/env bash
# Runs the CivicHelp Ansible deployment against ONE existing EC2 instance.
# Works on Linux, macOS and inside WSL. Run it from the project root.
#
# Required environment variables (never put secrets on the command line):
#   DB_PASSWORD, JWT_SECRET   application secrets (reuse the SAME DB_PASSWORD on every deploy)
#   EC2_IP                    public IP of the instance
#   SSH_KEY                   path to the private key (a /mnt/... path is fine inside WSL)
# Optional:
#   GIT_REPO_URL (default: GitHub repo of this project)   GIT_BRANCH (default: main)
set -euo pipefail

: "${DB_PASSWORD:?DB_PASSWORD is not set}"
: "${JWT_SECRET:?JWT_SECRET is not set}"
: "${EC2_IP:?EC2_IP is not set}"
: "${SSH_KEY:?SSH_KEY is not set}"
GIT_REPO_URL="${GIT_REPO_URL:-https://github.com/SHASHVAT999/CivicHelp.git}"
GIT_BRANCH="${GIT_BRANCH:-main}"

# ssh refuses keys that other users can read; keys on /mnt/<drive> cannot be chmod'ed, so use a private copy.
KEY="$HOME/.ssh/civichelp-key"
mkdir -p "$HOME/.ssh"
if [ "$SSH_KEY" != "$KEY" ]; then cp "$SSH_KEY" "$KEY"; fi
chmod 600 "$KEY"

INVENTORY="$(mktemp)"
trap 'rm -f "$INVENTORY"' EXIT
# The playbook targets the inventory group "civichelp" (an inline "IP," inventory would match nothing).
printf '[civichelp]\n%s ansible_user=ubuntu ansible_ssh_private_key_file=%s\n' "$EC2_IP" "$KEY" > "$INVENTORY"
export ANSIBLE_HOST_KEY_CHECKING=False

echo "Waiting for SSH on $EC2_IP ..."
for i in 1 2 3 4 5 6 7 8; do
  if ansible -i "$INVENTORY" civichelp -m ping >/dev/null 2>&1; then echo "SSH is ready."; break; fi
  if [ "$i" = 8 ]; then echo "SSH is not reachable. Your IP may have changed: run scripts/update-ssh-access.ps1" >&2; exit 1; fi
  sleep 15
done

ansible-playbook -i "$INVENTORY" ansible/deploy.yml \
  -e "ec2_ip=$EC2_IP" \
  -e "git_repo_url=$GIT_REPO_URL" \
  -e "git_branch=$GIT_BRANCH"
