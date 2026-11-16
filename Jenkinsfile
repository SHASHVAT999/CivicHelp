/**
 * ==============================================================================
 * CivicHelp - CI pipeline  (Jenkins job: CivicHelp-CI)
 * ==============================================================================
 * Continuous integration only: it NEVER touches AWS and costs nothing.
 *
 *   Checkout -> Tool Check -> Validate Compose -> Validate Terraform
 *            -> Validate Ansible -> Build Docker Images -> Test Images
 *
 * Deployment to AWS is a separate job with its own pipeline:
 *   jenkins/Jenkinsfile.deploy   (Jenkins job: CivicHelp-Deploy-AWS)
 *
 * Agent requirements (Windows Jenkins started with scripts\start-jenkins.ps1):
 *   Git-for-Windows 'sh' in PATH, Docker Desktop, terraform; Ansible runs in WSL.
 * ==============================================================================
 */

pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
        timeout(time: 30, unit: 'MINUTES')
    }

    environment {
        // Stop Git-for-Windows sh from rewriting arguments such as /api into Windows paths
        MSYS_NO_PATHCONV = '1'
        // Docker Compose (buildx bake) otherwise asks interactively for filesystem entitlements
        BUILDX_BAKE_ENTITLEMENTS_FS = '0'
        WSL_DISTRO = 'Ubuntu'
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
                sh 'echo "Building commit:" && git log -1 --format="%h  %s  (%an)"'
            }
        }

        stage('Tool Check') {
            steps {
                sh '''
                echo "--- Docker";    docker --version
                echo "--- Terraform"; terraform version | head -1
                echo "--- Git";       git --version
                '''
            }
        }

        stage('Validate Compose') {
            steps {
                // Dummy values only satisfy variable interpolation during validation
                sh '''
                DB_PASSWORD=validate JWT_SECRET=validate docker compose config -q
                echo "docker-compose.yml is valid (frontend, backend, db)"
                '''
            }
        }

        stage('Validate Terraform') {
            steps {
                sh '''
                terraform -chdir=terraform fmt -check main.tf variables.tf outputs.tf
                echo "Terraform files are correctly formatted"
                '''
            }
        }

        stage('Validate Ansible') {
            steps {
                script {
                    if (isUnix()) {
                        sh 'ansible-playbook --syntax-check -i localhost, ansible/deploy.yml'
                    } else {
                        // Ansible cannot run natively on Windows - use the WSL Ubuntu distribution
                        sh '''
                        wsl.exe -d "$WSL_DISTRO" --cd "$(pwd -W)" -- ansible-playbook --syntax-check -i localhost, ansible/deploy.yml
                        '''
                    }
                }
            }
        }

        stage('Build Docker Images') {
            steps {
                sh '''
                docker build -t civichelp-backend:ci -t civichelp-backend:build-$BUILD_NUMBER -f Dockerfile .
                docker build -t civichelp-frontend:ci -t civichelp-frontend:build-$BUILD_NUMBER \
                    --build-arg REACT_APP_API_URL=/api \
                    --build-arg REACT_APP_SOCKET_URL=/ \
                    frontend
                echo "--- Images built:"
                docker image ls --filter "reference=civichelp-*:ci"
                '''
            }
        }

        stage('Test Images') {
            steps {
                sh '''
                echo "--- Backend: JavaScript syntax check inside the built image"
                docker run --rm civichelp-backend:ci node --check server.js
                docker run --rm civichelp-backend:ci node --check routes/complaints.js
                docker run --rm civichelp-backend:ci node --check routes/auth.js
                echo "--- Frontend: Nginx configuration test inside the built image"
                docker run --rm --add-host backend:127.0.0.1 civichelp-frontend:ci nginx -t
                echo "--- Frontend: React build output is present"
                docker run --rm civichelp-frontend:ci sh -c "test -f /usr/share/nginx/html/index.html && echo index.html found"
                '''
            }
        }
    }

    post {
        success { echo 'CI passed: configuration is valid and both Docker images build and pass their checks.' }
        failure { echo 'CI FAILED - read the first red error above in the console output.' }
    }
}
