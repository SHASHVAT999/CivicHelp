/*
 * CivicHelp - Jenkins startup setup (idempotent).
 *
 * Installed by scripts\start-jenkins.ps1 into $JENKINS_HOME\init.groovy.d\ and run by Jenkins
 * itself on every start-up, so no admin password is needed. It:
 *   1. creates/updates the Secret-text credentials CIVICHELP_DB_PASSWORD and CIVICHELP_JWT_SECRET
 *      from the secrets file named by the CIVICHELP_SECRETS_FILE environment variable
 *      (values are stored encrypted by Jenkins and are never logged),
 *   2. creates the pipeline jobs CivicHelp-CI and CivicHelp-Deploy-AWS if they do not exist
 *      (existing jobs - including your older course jobs - are never modified).
 */
import jenkins.model.Jenkins
import com.cloudbees.plugins.credentials.CredentialsScope
import com.cloudbees.plugins.credentials.SystemCredentialsProvider
import com.cloudbees.plugins.credentials.domains.Domain
import org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl
import hudson.util.Secret
import java.util.logging.Logger

def log = Logger.getLogger('civichelp-setup')
def jenkins = Jenkins.get()

def esc = { String s -> s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;') }

// ---------------------------------------------------------------- 1. credentials
try {
    def secretsPath = System.getenv('CIVICHELP_SECRETS_FILE')
    if (secretsPath && new File(secretsPath).isFile()) {
        def values = [:]
        new File(secretsPath).eachLine { line ->
            def m = (line =~ /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
            if (m) { values[m[0][1]] = m[0][2] }
        }
        def provider = SystemCredentialsProvider.getInstance()
        def store = provider.getStore()
        def wanted = [CIVICHELP_DB_PASSWORD: values['DB_PASSWORD'], CIVICHELP_JWT_SECRET: values['JWT_SECRET']]
        wanted.each { id, value ->
            if (!value) { log.warning("CivicHelp setup: no value for ${id} in the secrets file"); return }
            def current = provider.getDomainCredentialsMap().get(Domain.global()) ?: []
            def existing = current.find { it.id == id }
            def cred = new StringCredentialsImpl(CredentialsScope.GLOBAL, id,
                    'CivicHelp deployment secret (managed by scripts/start-jenkins.ps1)', Secret.fromString(value))
            if (existing) { store.updateCredentials(Domain.global(), existing, cred) }
            else { store.addCredentials(Domain.global(), cred) }
            log.info("CivicHelp setup: credential ${id} is in place")
        }
    } else {
        log.warning('CivicHelp setup: CIVICHELP_SECRETS_FILE is not set or missing - credentials were not created')
    }
} catch (Throwable t) {
    log.severe("CivicHelp setup: credentials step failed: ${t}")
}

// ---------------------------------------------------------------- 2. pipeline jobs
try {
    def repo = System.getenv('CIVICHELP_REPO_URL') ?: 'https://github.com/SHASHVAT999/CivicHelp.git'
    def branch = System.getenv('CIVICHELP_BRANCH') ?: 'main'
    def token = System.getenv('CIVICHELP_TRIGGER_TOKEN')

    def deployParams = [
        [name: 'GIT_REPO_URL', value: repo, desc: 'Repository the EC2 instance clones'],
        [name: 'GIT_BRANCH', value: branch, desc: 'Branch to deploy'],
        [name: 'TF_DIR', value: 'D:/CivicHelp/terraform', desc: 'Folder holding the EXISTING terraform.tfstate and terraform.tfvars'],
        [name: 'SSH_PRIVATE_KEY_PATH', value: 'D:/AWSConfig/civichelp-key', desc: 'Private key of the EC2 key pair'],
        [name: 'ADMIN_CIDR', value: '', desc: 'Leave EMPTY to auto-detect this PC public IP (or enter x.x.x.x/32)'],
        [name: 'WSL_DISTRO', value: 'Ubuntu', desc: 'WSL distribution that runs Ansible']
    ]

    def jobs = [
        [name: 'CivicHelp-CI', script: 'Jenkinsfile', params: [], token: token,
         desc: 'CI: validates Docker Compose, Terraform and Ansible and builds + tests the Docker images. Never touches AWS.'],
        [name: 'CivicHelp-Deploy-AWS', script: 'jenkins/Jenkinsfile.deploy', params: deployParams, token: null,
         desc: 'DEPLOYMENT: updates the EXISTING AWS EC2 instance with Terraform and Ansible. Run only when the Learner Lab is started and the instance is running (scripts\\start-civichelp.ps1).']
    ]

    jobs.each { j ->
        if (jenkins.getItem(j.name) != null) { log.info("CivicHelp setup: job ${j.name} already exists - left unchanged"); return }
        def paramXml = ''
        if (j.params) {
            paramXml = '<hudson.model.ParametersDefinitionProperty><parameterDefinitions>' +
                j.params.collect { p ->
                    "<hudson.model.StringParameterDefinition><name>${esc(p.name)}</name><defaultValue>${esc(p.value)}</defaultValue>" +
                    "<description>${esc(p.desc)}</description><trim>true</trim></hudson.model.StringParameterDefinition>"
                }.join('') + '</parameterDefinitions></hudson.model.ParametersDefinitionProperty>'
        }
        def tokenXml = j.token ? "<authToken>${esc(j.token)}</authToken>" : ''
        def xml = """<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <description>${esc(j.desc)}</description>
  <keepDependencies>false</keepDependencies>
  <properties>${paramXml}</properties>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps">
    <scm class="hudson.plugins.git.GitSCM" plugin="git">
      <configVersion>2</configVersion>
      <userRemoteConfigs><hudson.plugins.git.UserRemoteConfig><url>${esc(repo)}</url></hudson.plugins.git.UserRemoteConfig></userRemoteConfigs>
      <branches><hudson.plugins.git.BranchSpec><name>*/${esc(branch)}</name></hudson.plugins.git.BranchSpec></branches>
      <doGenerateSubmoduleConfigurations>false</doGenerateSubmoduleConfigurations>
      <submoduleCfg class="empty-list"/>
      <extensions/>
    </scm>
    <scriptPath>${esc(j.script)}</scriptPath>
    <lightweight>true</lightweight>
  </definition>
  <triggers/>
  <disabled>false</disabled>
  ${tokenXml}
</flow-definition>"""
        jenkins.createProjectFromXML(j.name, new ByteArrayInputStream(xml.getBytes('UTF-8')))
        log.info("CivicHelp setup: created job ${j.name}")
    }
} catch (Throwable t) {
    log.severe("CivicHelp setup: job step failed: ${t}")
}
