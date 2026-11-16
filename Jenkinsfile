/**
 * ==============================================================================
 * CivicHelp CI/CD Pipeline
 * ==============================================================================
 * EXECUTION ENVIRONMENT & PREREQUISITES:
 * - Operating System: Linux agent, Linux container, or Windows with WSL2.
 *   (Ansible requires a POSIX environment and cannot execute natively in Windows bat/cmd).
 * - If running Jenkins on Windows:
 *     1. Recommended: Run this pipeline on a Linux or WSL2-backed Jenkins agent.
 *     2. Or ensure 'sh', 'terraform', and 'ansible-playbook' are accessible in PATH.
 * - Required CLI tools in PATH:
 *     - terraform (>= 1.0)
 *     - ansible-playbook (>= 2.10)
 *     - git
 *     - POSIX shell (sh / bash)
 * ==============================================================================
 */

pipeline {
    agent any

    parameters {
        string(name: 'GIT_REPO_URL', defaultValue: '', description: 'CivicHelp Git repository URL (e.g. https://github.com/<org>/CivicHelp.git)')
        string(name: 'GIT_BRANCH', defaultValue: 'main', description: 'Git branch to deploy')
        string(name: 'SSH_PRIVATE_KEY_PATH', defaultValue: '~/.ssh/civichelp-key', description: 'Path to SSH private key on Jenkins agent')
        string(name: 'ADMIN_CIDR', defaultValue: '', description: 'Administrator IPv4 CIDR permitted for SSH access (e.g. 203.0.113.50/32). Required; 0.0.0.0/0 is rejected.')
    }

    environment {
        // Include common UNIX and local tool directories in PATH
        PATH = "${env.PATH}:/usr/local/bin:/usr/bin:/opt/homebrew/bin"
    }

    stages {

        stage('Prerequisites Check') {
            steps {
                echo 'Validating parameters, CLI tools (Terraform & Ansible), and execution environment...'
                script {
                    if (!params.ADMIN_CIDR?.trim() || params.ADMIN_CIDR.trim() == '0.0.0.0/0') {
                        error("❌ Security Violation: ADMIN_CIDR must be provided and cannot be '0.0.0.0/0'. Please supply your IP CIDR (e.g. 203.0.113.50/32).")
                    }
                }
                sh '''
                echo "Agent OS: $(uname -s 2>/dev/null || echo 'POSIX-compatible shell')"
                command -v terraform >/dev/null 2>&1 || {
                    echo >&2 "❌ Error: 'terraform' was not found in PATH."
                    echo >&2 "   Please ensure Terraform is installed on this agent."
                    exit 1
                }
                command -v ansible-playbook >/dev/null 2>&1 || {
                    echo >&2 "❌ Error: 'ansible-playbook' was not found in PATH."
                    echo >&2 "   Note: Ansible requires a POSIX environment (Linux or WSL on Windows)."
                    echo >&2 "   Ensure Jenkins executes on a Linux or WSL-configured agent."
                    exit 1
                }
                echo "✔ Terraform and Ansible CLI tools detected successfully."
                '''
            }
        }

        stage('Checkout') {
            steps {
                script {
                    if (params.GIT_REPO_URL?.trim()) {
                        echo "Cloning repository from ${params.GIT_REPO_URL} (${params.GIT_BRANCH})..."
                        git branch: params.GIT_BRANCH, url: params.GIT_REPO_URL.trim()
                    } else {
                        echo "GIT_REPO_URL not specified; using workspace repository context."
                    }
                }
            }
        }

        stage('Terraform') {
            steps {
                echo 'Running Terraform provisioning...'
                dir('terraform') {
                    sh """
                    terraform init
                    terraform apply -auto-approve -var="admin_cidr=${params.ADMIN_CIDR}"
                    terraform output -raw ec2_public_ip > ../ec2_ip.txt
                    """
                }
            }
        }

        stage('Ansible') {
            steps {
                echo 'Waiting for EC2 instance to initialize...'
                sleep 30
                echo 'Executing Ansible playbook...'
                withCredentials([
                    string(credentialsId: 'CIVICHELP_DB_PASSWORD', variable: 'DB_PASSWORD'),
                    string(credentialsId: 'CIVICHELP_JWT_SECRET', variable: 'JWT_SECRET')
                ]) {
                    sh """
                    EC2_IP=\$(cat ec2_ip.txt)

                    # Generate dynamic inventory
                    echo "[civichelp]" > ansible/inventory.ini
                    echo "\${EC2_IP} ansible_user=ubuntu ansible_ssh_private_key_file=${params.SSH_PRIVATE_KEY_PATH} ansible_ssh_common_args='-o StrictHostKeyChecking=no'" >> ansible/inventory.ini

                    ansible-playbook -i ansible/inventory.ini ansible/deploy.yml \\
                        -e "ec2_ip=\${EC2_IP}" \\
                        -e "git_repo_url=${params.GIT_REPO_URL}" \\
                        -e "git_branch=${params.GIT_BRANCH}"
                    """
                }
            }
        }

        stage('Done') {
            steps {
                sh 'echo "🎉 Deployment Completed! CivicHelp is live at http://$(cat ec2_ip.txt)"'
            }
        }
    }
}
