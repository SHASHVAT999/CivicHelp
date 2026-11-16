/**
 * ==============================================================================
 * CivicHelp - unified CI/CD pipeline            (Jenkins job: CivicHelp-Pipeline)
 * ==============================================================================
 * ONE pipeline takes a commit from GitHub all the way to the running AWS server:
 *
 *  CI  1 Checkout          get the commit from GitHub, remember its exact SHA
 *      2 Tool Check        docker, compose, terraform, git, ansible (WSL), aws
 *      3 Validate          Compose files | Terraform fmt+validate | Ansible syntax   (parallel)
 *      4 Build Images      backend + frontend Docker images, tagged with the build number
 *      5 Unit Tests        backend unit tests run INSIDE the image just built; nginx -t
 *      6 Integration Test  throwaway stack from those images; full citizen->officer->worker workflow
 *  CD  7 AWS Preflight     credentials valid, instance running, snapshot of existing data
 *      8 Terraform Plan    plan against the EXISTING state; refuses to add/replace/destroy anything
 *      9 Terraform Apply   applies exactly the reviewed plan (normally "no changes")
 *     10 Ansible Deploy    server checks out the SAME commit, rebuilds and restarts the containers
 *     11 Verify Deployment API+DB health, deployed version, real MySQL query, website,
 *                          existing complaints and photos still present
 *
 * The CD stages run only when every CI stage has passed. Untick DEPLOY_TO_AWS to run
 * CI only (for example when the AWS Academy lab is not started) - same job, same pipeline.
 *
 * Agent: the Windows Jenkins started by scripts\start-jenkins.ps1 (Git-for-Windows sh,
 * Docker Desktop, Terraform, AWS CLI; Ansible runs inside WSL Ubuntu).
 * Secrets: CIVICHELP_DB_PASSWORD and CIVICHELP_JWT_SECRET are Jenkins credentials
 * (created by start-jenkins.ps1) and are masked in the log.
 * ==============================================================================
 */

pipeline {
    agent any

    options {
        timestamps()
        skipDefaultCheckout()              // the explicit Checkout stage below is the only checkout
        disableConcurrentBuilds()          // two deployments must never run at the same time
        buildDiscarder(logRotator(numToKeepStr: '20'))
        timeout(time: 45, unit: 'MINUTES')
    }

    parameters {
        booleanParam(name: 'DEPLOY_TO_AWS', defaultValue: true,
            description: 'Run the CD stages (Terraform + Ansible deploy to the existing EC2 instance). Untick to run CI only.')
        string(name: 'TF_DIR', defaultValue: 'D:/CivicHelp/terraform',
            description: 'Folder holding the EXISTING terraform.tfstate and terraform.tfvars (re-using it prevents duplicate AWS resources)')
        string(name: 'SSH_PRIVATE_KEY_PATH', defaultValue: 'D:/AWSConfig/civichelp-key',
            description: 'Private key of the EC2 key pair')
        string(name: 'ADMIN_CIDR', defaultValue: '',
            description: 'SSH source allowed by the security group. Leave EMPTY to auto-detect this PC\'s public IP (x.x.x.x/32). 0.0.0.0/0 is rejected.')
    }

    environment {
        MSYS_NO_PATHCONV = '1'               // Git-for-Windows sh must not turn "/api" into a Windows path
        BUILDX_BAKE_ENTITLEMENTS_FS = '0'    // Compose (buildx bake) must not stop to ask for permissions
        WSL_DISTRO = 'Ubuntu'                // Ansible runs inside this WSL distribution
        IMAGE_TAG = "build-${env.BUILD_NUMBER}"
        CI_PROJECT = 'civichelp-ci'          // compose project name of the throwaway test stack
        TF_PLUGIN_CACHE_DIR = 'D:/DevCaches/terraform-plugin-cache'
        GIT_REPO_URL = 'https://github.com/SHASHVAT999/CivicHelp.git'
    }

    stages {

        // ============================== CI ==============================

        stage('Checkout') {
            steps {
                checkout scm
                script {
                    // The exact commit under test. CD deploys THIS commit, not "whatever main is now".
                    env.DEPLOY_COMMIT = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
                    env.DEPLOY_SHORT = env.DEPLOY_COMMIT.take(7)
                    currentBuild.description = "commit ${env.DEPLOY_SHORT}" + (params.DEPLOY_TO_AWS ? ' -> AWS' : ' (CI only)')
                }
                sh 'git log -1 --format="Commit under test: %h  %s  (%an, %ad)" --date=short'
            }
        }

        stage('Tool Check') {
            steps {
                sh '''
                docker --version
                docker compose version
                terraform version | head -1
                git --version
                wsl.exe -d "$WSL_DISTRO" -- ansible-playbook --version | head -1
                if [ "$DEPLOY_TO_AWS" = "true" ]; then aws --version; fi
                '''
            }
        }

        stage('Validate') {
            parallel {
                stage('Compose') {
                    steps {
                        // Dummy values only satisfy ${VARIABLE} interpolation during validation
                        sh '''
                        DB_PASSWORD=validate JWT_SECRET=validate docker compose -f docker-compose.yml config -q
                        docker compose -f docker-compose.ci.yml config -q
                        echo "docker-compose.yml and docker-compose.ci.yml are valid"
                        '''
                    }
                }
                stage('Terraform') {
                    steps {
                        // -backend=false: validation only; the real state is never touched here
                        sh '''
                        mkdir -p "$TF_PLUGIN_CACHE_DIR"
                        terraform -chdir=terraform fmt -check -diff
                        terraform -chdir=terraform init -backend=false -input=false -no-color > /dev/null
                        terraform -chdir=terraform validate -no-color
                        '''
                    }
                }
                stage('Ansible') {
                    steps {
                        sh 'wsl.exe -d "$WSL_DISTRO" --cd "$(pwd -W)" -- ansible-playbook --syntax-check -i localhost, ansible/deploy.yml'
                        sh 'bash -n ansible/run-deploy.sh && echo "run-deploy.sh: shell syntax OK"'
                    }
                }
            }
        }

        stage('Build Images') {
            steps {
                sh '''
                docker build -t civichelp-backend:$IMAGE_TAG -t civichelp-backend:ci -f Dockerfile .
                docker build -t civichelp-frontend:$IMAGE_TAG -t civichelp-frontend:ci \
                    --build-arg REACT_APP_API_URL=/api \
                    --build-arg REACT_APP_SOCKET_URL=/ \
                    frontend
                docker image ls --filter "reference=civichelp-*:$IMAGE_TAG"
                '''
            }
        }

        stage('Unit Tests') {
            steps {
                sh '''
                echo "--- Backend unit tests (node:test) inside the image that was just built"
                docker run --rm civichelp-backend:$IMAGE_TAG node --test --test-reporter=tap "tests/*.test.js"
                echo "--- Frontend image: Nginx configuration test"
                docker run --rm --add-host backend:127.0.0.1 civichelp-frontend:$IMAGE_TAG nginx -t
                docker run --rm civichelp-frontend:$IMAGE_TAG test -f /usr/share/nginx/html/index.html
                echo "React production build is present in the image"
                '''
            }
        }

        stage('Integration Test') {
            steps {
                // Start the just-built images with an in-memory database, then run the full
                // workflow test through Nginx. Nothing here can reach the real data.
                sh '''
                export CI_TAG=$IMAGE_TAG
                docker compose -p "$CI_PROJECT" -f docker-compose.ci.yml down --remove-orphans > /dev/null 2>&1 || true
                docker compose -p "$CI_PROJECT" -f docker-compose.ci.yml up -d --wait --wait-timeout 240 db backend frontend
                docker compose -p "$CI_PROJECT" -f docker-compose.ci.yml --profile test run --rm tester
                '''
            }
            post {
                failure {
                    sh 'CI_TAG=$IMAGE_TAG docker compose -p "$CI_PROJECT" -f docker-compose.ci.yml logs --tail 60 backend frontend || true'
                }
                always {
                    // No named volumes exist in this project, so "down" removes everything it created
                    sh 'CI_TAG=$IMAGE_TAG docker compose -p "$CI_PROJECT" -f docker-compose.ci.yml --profile test down --remove-orphans || true'
                }
            }
        }

        // ============================== CD ==============================

        stage('AWS Preflight') {
            when { expression { params.DEPLOY_TO_AWS } }
            steps {
                script {
                    if (params.ADMIN_CIDR?.trim() == '0.0.0.0/0') {
                        error('ADMIN_CIDR 0.0.0.0/0 is rejected: SSH must be limited to one address.')
                    }
                }
                sh '''
                # AWS Academy session credentials expire when the lab session ends
                aws sts get-caller-identity --query Arn --output text > /dev/null 2>&1 || {
                    echo "AWS credentials are missing or expired." >&2
                    echo "Start the Learner Lab, then run: scripts/update-aws-credentials.ps1" >&2
                    exit 1
                }
                echo "AWS credentials are valid."
                INFO="$(aws ec2 describe-instances --region us-east-1 --filters Name=tag:Name,Values=civichelp-server Name=instance-state-name,Values=pending,running,stopping,stopped \
                        --query "Reservations[].Instances[].[State.Name,PublicIpAddress]" --output text | tr -d '\\r')"
                STATE="$(echo "$INFO" | awk '{print $1}')"
                IP="$(echo "$INFO" | awk '{print $2}')"
                echo "civichelp-server: $STATE ($IP)"
                [ "$STATE" = "running" ] || { echo "The EC2 instance is not running. Start it: scripts/start-civichelp.ps1" >&2; exit 1; }

                # Snapshot of the data that already exists, compared again after the deployment
                curl -fsS --max-time 15 -o data-before.json "http://$IP/api/complaints" || {
                    echo "The live site did not answer; cannot take a data snapshot." >&2; exit 1; }
                grep -o '"id":[0-9]*' data-before.json | sort > ids-before.txt || true
                grep -o '"image_url":"[^"]*"' data-before.json | cut -d'"' -f4 > photos-before.txt || true
                echo "Existing data before deployment: $(wc -l < ids-before.txt | tr -d ' ') complaints, $(wc -l < photos-before.txt | tr -d ' ') photos"
                '''
            }
        }

        stage('Terraform Plan') {
            when { expression { params.DEPLOY_TO_AWS } }
            steps {
                // The state lives in TF_DIR. Make sure its configuration is the configuration of the
                // commit under test, otherwise the plan would not describe what this commit wants.
                sh '''
                for f in main.tf variables.tf outputs.tf; do
                    diff --strip-trailing-cr -q "terraform/$f" "$TF_DIR/$f" > /dev/null || {
                        echo "REFUSING: $TF_DIR/$f differs from terraform/$f in commit $DEPLOY_SHORT." >&2
                        echo "Update the local copy first: cd D:/CivicHelp && git pull" >&2
                        exit 1
                    }
                done
                echo "Terraform configuration in $TF_DIR matches commit $DEPLOY_SHORT"
                '''
                dir(params.TF_DIR) {
                    sh '''
                    CIDR="$(echo "$ADMIN_CIDR" | tr -d ' ')"
                    if [ -z "$CIDR" ]; then CIDR="$(curl -fsS --max-time 10 https://checkip.amazonaws.com | tr -d '\\r\\n')/32"; fi
                    echo "SSH will be limited to: $CIDR"
                    terraform init -input=false -no-color > /dev/null
                    terraform plan -no-color -input=false -var="admin_cidr=$CIDR" -out=civichelp.tfplan > plan.txt || {
                        cat plan.txt; echo "terraform plan failed" >&2; exit 1; }
                    cat plan.txt

                    # Safety guard: a deployment may update in place, but never add, replace or destroy.
                    if grep -q "must be replaced" plan.txt; then echo "REFUSING: the plan would replace a resource." >&2; exit 1; fi
                    if grep -E "Plan: [0-9]+ to add" plan.txt | grep -v -q "Plan: 0 to add, [0-9]* to change, 0 to destroy"; then
                        echo "REFUSING: the plan adds or destroys resources." >&2; exit 1
                    fi
                    echo "Plan is safe: nothing is added, replaced or destroyed."
                    '''
                }
            }
        }

        stage('Terraform Apply') {
            when { expression { params.DEPLOY_TO_AWS } }
            steps {
                dir(params.TF_DIR) {
                    sh '''
                    terraform apply -no-color -input=false civichelp.tfplan
                    rm -f civichelp.tfplan plan.txt
                    '''
                    script {
                        env.EC2_IP = sh(script: 'terraform output -raw ec2_public_ip', returnStdout: true).trim()
                    }
                }
                echo "EC2 public IP: ${env.EC2_IP}"
            }
        }

        stage('Ansible Deploy') {
            when { expression { params.DEPLOY_TO_AWS } }
            steps {
                // Secrets reach Ansible only as environment variables - never on a command line or in the log.
                withCredentials([
                    string(credentialsId: 'CIVICHELP_DB_PASSWORD', variable: 'DB_PASSWORD'),
                    string(credentialsId: 'CIVICHELP_JWT_SECRET', variable: 'JWT_SECRET')
                ]) {
                    withEnv(["SSH_KEY_WIN=${params.SSH_PRIVATE_KEY_PATH}", "GIT_COMMIT=${env.DEPLOY_COMMIT}", 'GIT_BRANCH=main']) {
                        // Ansible does not run on Windows, so the same script runs inside WSL.
                        // WSLENV forwards the listed variables (including the secrets) into WSL.
                        sh '''
                        export SSH_KEY="$(wsl.exe -d "$WSL_DISTRO" -- wslpath -a "$SSH_KEY_WIN" | tr -d '\\r')"
                        export WSLENV="DB_PASSWORD:JWT_SECRET:EC2_IP:SSH_KEY:GIT_REPO_URL:GIT_BRANCH:GIT_COMMIT"
                        wsl.exe -d "$WSL_DISTRO" --cd "$(pwd -W)" -- bash ansible/run-deploy.sh
                        '''
                    }
                }
            }
        }

        stage('Verify Deployment') {
            when { expression { params.DEPLOY_TO_AWS } }
            steps {
                // Responses are written to files (curl -o): Windows curl cannot write to /dev/null,
                // and no pipe can hide a failing curl exit code.
                sh '''
                rm -f health.json complaints.json website.html
                URL="http://$EC2_IP"

                # 1/5 API + database (the health endpoint runs a real SELECT)
                for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
                    if curl -fsS --max-time 10 -o health.json "$URL/api/health" && grep -q '"database":"connected"' health.json; then break; fi
                    if [ "$i" = 12 ]; then echo "FAILED: API/database not healthy at $URL/api/health" >&2; cat health.json >&2 2>/dev/null; exit 1; fi
                    sleep 10
                done
                echo "[1/5] API is up and reports the database as connected"

                # 2/5 The server runs exactly the commit this pipeline tested
                grep -q "\\"version\\":\\"$DEPLOY_SHORT\\"" health.json || {
                    echo "FAILED: server reports a different version (expected $DEPLOY_SHORT):" >&2; cat health.json >&2; exit 1; }
                echo "[2/5] Deployed version is $DEPLOY_SHORT (the commit under test)"

                # 3/5 MySQL answers a real query through Nginx -> Express
                curl -fsS --max-time 15 -o complaints.json "$URL/api/complaints"
                [ "$(head -c 1 complaints.json)" = "[" ] || {
                    echo "FAILED: the API could not read from MySQL:" >&2; head -c 300 complaints.json >&2; exit 1; }
                echo "[3/5] MySQL answered a real query"

                # 4/5 Nginx serves the actual CivicHelp React application
                curl -fsS --max-time 15 -o website.html "$URL/"
                grep -q '<title>CivicHelp' website.html && grep -q 'id="root"' website.html || {
                    echo "FAILED: the website did not return the CivicHelp page" >&2; head -c 300 website.html >&2; exit 1; }
                echo "[4/5] Website serves the CivicHelp application"

                # 5/5 Every complaint and photo that existed before the deployment is still there
                grep -o '"id":[0-9]*' complaints.json | sort > ids-after.txt || true
                MISSING="$(comm -23 ids-before.txt ids-after.txt)"
                [ -z "$MISSING" ] || { echo "FAILED: complaints disappeared during deployment: $MISSING" >&2; exit 1; }
                while read -r photo; do
                    [ -n "$photo" ] || continue
                    curl -fsS --max-time 15 -o photo.bin "$URL$photo" || { echo "FAILED: photo missing after deployment: $photo" >&2; exit 1; }
                done < photos-before.txt
                echo "[5/5] Existing data preserved: $(wc -l < ids-before.txt | tr -d ' ') complaints before, $(wc -l < ids-after.txt | tr -d ' ') after; all $(wc -l < photos-before.txt | tr -d ' ') photos still load"

                rm -f health.json complaints.json website.html photo.bin
                echo "CivicHelp $DEPLOY_SHORT is live at $URL"
                '''
            }
        }
    }

    post {
        always {
            sh 'rm -f data-before.json ids-before.txt ids-after.txt photos-before.txt || true'
        }
        success {
            script {
                if (params.DEPLOY_TO_AWS) {
                    echo "SUCCESS: commit ${env.DEPLOY_SHORT} passed CI and is live at http://${env.EC2_IP}"
                } else {
                    echo "SUCCESS: commit ${env.DEPLOY_SHORT} passed CI (deployment was not requested)"
                }
            }
        }
        failure { echo 'FAILED - open the red stage and read its first error. Nothing after a failed stage was run.' }
    }
}
