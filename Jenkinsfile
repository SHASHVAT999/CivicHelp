/**
 * ==============================================================================
 * CivicHelp CI/CD Pipeline
 * ==============================================================================
 * Default run (DEPLOY_TO_AWS = false) - safe, no AWS cost:
 *   Checkout -> Validate (Compose, Terraform format, Ansible syntax) -> Build Docker images
 *
 * Deployment run (DEPLOY_TO_AWS = true):
 *   ... -> AWS credential check -> Terraform plan/apply -> Ansible deploy -> Smoke test
 *
 * Agent requirements:
 *   - Linux agent: sh, docker, terraform, aws, ansible-playbook in PATH.
 *   - Windows agent (e.g. `java -jar jenkins.war`): Git for Windows 'sh' in PATH,
 *     Docker Desktop, terraform and aws CLI in PATH. Ansible runs inside WSL
 *     (distribution set by WSL_DISTRO) because it cannot run natively on Windows.
 *
 * Jenkins credentials (Secret text): CIVICHELP_DB_PASSWORD, CIVICHELP_JWT_SECRET
 * ==============================================================================
 */

pipeline {
    agent any

    options {
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    parameters {
        booleanParam(name: 'DEPLOY_TO_AWS', defaultValue: false,
            description: 'Run Terraform + Ansible against AWS. Leave unchecked for a validate-and-build run with no AWS cost.')
        string(name: 'GIT_REPO_URL', defaultValue: 'https://github.com/SHASHVAT999/CivicHelp.git',
            description: 'Repository cloned by this pipeline and by the EC2 instance')
        string(name: 'GIT_BRANCH', defaultValue: 'main', description: 'Git branch to build and deploy')
        string(name: 'TF_DIR', defaultValue: 'D:/CivicHelp/terraform',
            description: 'Terraform directory holding the EXISTING state and terraform.tfvars. Reusing it prevents duplicate AWS resources. Leave empty only for a first-ever deployment.')
        string(name: 'SSH_PRIVATE_KEY_PATH', defaultValue: 'D:/AWSConfig/civichelp-key',
            description: 'Private key matching the EC2 key pair (path on the Jenkins machine)')
        string(name: 'ADMIN_CIDR', defaultValue: '',
            description: 'Your current public IPv4 as CIDR for SSH, e.g. 203.0.113.50/32 (required when deploying; 0.0.0.0/0 is rejected)')
        string(name: 'WSL_DISTRO', defaultValue: 'Ubuntu',
            description: 'WSL distribution used for Ansible when the agent is Windows')
    }

    environment {
        // Stop Git-for-Windows sh from rewriting arguments such as /api into Windows paths
        MSYS_NO_PATHCONV = '1'
        // Compose (buildx bake) otherwise asks interactively for filesystem entitlements
        BUILDX_BAKE_ENTITLEMENTS_FS = '0'
    }

    stages {

        stage('Checkout') {
            steps {
                script {
                    if (params.GIT_REPO_URL?.trim()) {
                        git branch: params.GIT_BRANCH, url: params.GIT_REPO_URL.trim()
                    } else {
                        echo 'GIT_REPO_URL not specified; using the workspace checkout.'
                    }
                }
            }
        }

        stage('Validate') {
            steps {
                sh '''
                echo "Agent: $(uname -s 2>/dev/null)"
                docker --version
                # Dummy values only satisfy variable interpolation during validation
                DB_PASSWORD=validate JWT_SECRET=validate docker compose config -q
                echo "docker-compose.yml is valid"

                if command -v terraform >/dev/null 2>&1; then
                    terraform -chdir=terraform fmt -check main.tf variables.tf outputs.tf
                    echo "Terraform formatting OK"
                else
                    echo "terraform not in PATH - skipping format check"
                fi
                '''
                script {
                    if (isUnix()) {
                        sh 'if command -v ansible-playbook >/dev/null 2>&1; then ansible-playbook --syntax-check -i localhost, ansible/deploy.yml; fi'
                    } else {
                        sh '''
                        WS_WSL=$(wsl.exe -d "$WSL_DISTRO" -- wslpath -a "$(pwd -W)" | tr -d '\\r')
                        wsl.exe -d "$WSL_DISTRO" -- bash -c "cd '$WS_WSL' && ansible-playbook --syntax-check -i localhost, ansible/deploy.yml"
                        '''
                    }
                }
            }
        }

        stage('Build Images') {
            steps {
                sh '''
                docker build -t civichelp-backend:ci -f Dockerfile .
                docker build -t civichelp-frontend:ci \
                    --build-arg REACT_APP_API_URL=/api \
                    --build-arg REACT_APP_SOCKET_URL=/ \
                    frontend
                docker image ls civichelp-backend:ci
                docker image ls civichelp-frontend:ci
                '''
            }
        }

        stage('AWS Preflight') {
            when { expression { params.DEPLOY_TO_AWS } }
            steps {
                script {
                    def cidr = params.ADMIN_CIDR?.trim()
                    if (!cidr || cidr == '0.0.0.0/0') {
                        error('ADMIN_CIDR must be your own IP as /32 (e.g. 203.0.113.50/32); 0.0.0.0/0 is rejected.')
                    }
                }
                // AWS Academy session credentials expire every few hours
                sh '''
                aws sts get-caller-identity --query Arn --output text || {
                    echo >&2 "AWS credentials are missing or expired. Start the Learner Lab and refresh ~/.aws/credentials."
                    exit 1
                }
                '''
            }
        }

        stage('Terraform') {
            when { expression { params.DEPLOY_TO_AWS } }
            steps {
                script {
                    def tfDir = params.TF_DIR?.trim() ? params.TF_DIR.trim() : 'terraform'
                    dir(tfDir) {
                        // -var is required: terraform.tfvars would override a TF_VAR_ environment variable.
                        // Jenkins exposes build parameters (ADMIN_CIDR) as environment variables.
                        sh '''
                        OUT="$WORKSPACE"
                        command -v cygpath >/dev/null 2>&1 && OUT="$(cygpath -u "$WORKSPACE")"
                        terraform init -input=false
                        terraform plan -input=false -var="admin_cidr=$(echo "$ADMIN_CIDR" | tr -d ' ')" -out=civichelp.tfplan
                        terraform apply -input=false civichelp.tfplan
                        terraform output -raw ec2_public_ip > "$OUT/ec2_ip.txt"
                        '''
                    }
                }
            }
        }

        stage('Ansible Deploy') {
            when { expression { params.DEPLOY_TO_AWS } }
            steps {
                withCredentials([
                    string(credentialsId: 'CIVICHELP_DB_PASSWORD', variable: 'DB_PASSWORD'),
                    string(credentialsId: 'CIVICHELP_JWT_SECRET', variable: 'JWT_SECRET')
                ]) {
                    script {
                        // Secrets reach Ansible only through environment variables (never the command line)
                        withEnv(["SSH_KEY=${params.SSH_PRIVATE_KEY_PATH}", "REPO=${params.GIT_REPO_URL}", "BRANCH=${params.GIT_BRANCH}"]) {
                            if (isUnix()) {
                                sh '''
                                EC2_IP=$(cat ec2_ip.txt)
                                printf '[civichelp]\\n%s ansible_user=ubuntu ansible_ssh_private_key_file=%s ansible_ssh_common_args="-o StrictHostKeyChecking=no"\\n' "$EC2_IP" "$SSH_KEY" > ansible/inventory.ini
                                for i in 1 2 3 4 5 6; do ansible -i ansible/inventory.ini civichelp -m ping && break; echo "Waiting for SSH..."; sleep 15; done
                                ansible-playbook -i ansible/inventory.ini ansible/deploy.yml -e "ec2_ip=$EC2_IP" -e "git_repo_url=$REPO" -e "git_branch=$BRANCH"
                                '''
                            } else {
                                sh '''
                                export EC2_IP=$(cat ec2_ip.txt)
                                export WS_WSL=$(wsl.exe -d "$WSL_DISTRO" -- wslpath -a "$(pwd -W)" | tr -d '\\r')
                                export KEY_WSL=$(wsl.exe -d "$WSL_DISTRO" -- wslpath -a "$SSH_KEY" | tr -d '\\r')
                                # WSLENV forwards these variables into the WSL process
                                export WSLENV="DB_PASSWORD:JWT_SECRET:EC2_IP:WS_WSL:KEY_WSL:REPO:BRANCH"
                                wsl.exe -d "$WSL_DISTRO" -- bash -c '
                                    set -e
                                    mkdir -p ~/.ssh && cp "$KEY_WSL" ~/.ssh/civichelp-key && chmod 600 ~/.ssh/civichelp-key
                                    INV=$(mktemp)
                                    printf "[civichelp]\\n%s ansible_user=ubuntu ansible_ssh_private_key_file=~/.ssh/civichelp-key ansible_ssh_common_args=\\"-o StrictHostKeyChecking=no\\"\\n" "$EC2_IP" > "$INV"
                                    cd "$WS_WSL"
                                    for i in 1 2 3 4 5 6; do ansible -i "$INV" civichelp -m ping && break; echo "Waiting for SSH..."; sleep 15; done
                                    ansible-playbook -i "$INV" ansible/deploy.yml -e "ec2_ip=$EC2_IP" -e "git_repo_url=$REPO" -e "git_branch=$BRANCH"
                                    rm -f "$INV"
                                '
                                '''
                            }
                        }
                    }
                }
            }
        }

        stage('Smoke Test') {
            when { expression { params.DEPLOY_TO_AWS } }
            steps {
                sh '''
                EC2_IP=$(cat ec2_ip.txt)
                for i in 1 2 3 4 5 6 7 8 9 10; do
                    if curl -fsS "http://$EC2_IP/api/health"; then
                        echo ""
                        echo "CivicHelp is live at http://$EC2_IP"
                        exit 0
                    fi
                    sleep 10
                done
                echo >&2 "Health check failed at http://$EC2_IP/api/health"
                exit 1
                '''
            }
        }
    }

    post {
        always {
            // Never leave generated inventory (host/key path) in the workspace
            sh 'rm -f ansible/inventory.ini || true'
        }
    }
}
