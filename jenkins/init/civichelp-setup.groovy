/*
 * CivicHelp - Jenkins startup setup (idempotent).
 *
 * Installed by scripts/start-jenkins.ps1 into JENKINS_HOME/init.groovy.d/ and run by Jenkins
 * itself on every start-up, so no admin password is needed. It:
 *   1. creates/updates the Secret-text credentials CIVICHELP_DB_PASSWORD and CIVICHELP_JWT_SECRET
 *      from the secrets file named by the CIVICHELP_SECRETS_FILE environment variable
 *      (values are stored encrypted by Jenkins and are never logged),
 *   2. creates the unified CI/CD job CivicHelp-Pipeline if it does not exist
 *      (existing jobs - including your older course jobs - are never modified),
 *   3. retires the two older CivicHelp jobs (CivicHelp-CI, CivicHelp-Deploy-AWS) by DISABLING them,
 *      but only after CivicHelp-Pipeline has a successful build that deployed to AWS.
 *      Their build history is kept; nothing is deleted.
 *   4. optionally starts one build (scripts/start-jenkins.ps1 -RunBuild Pipeline|PipelineCIOnly).
 */
import jenkins.model.Jenkins
import com.cloudbees.plugins.credentials.CredentialsScope
import com.cloudbees.plugins.credentials.SystemCredentialsProvider
import com.cloudbees.plugins.credentials.domains.Domain
import org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl
import hudson.model.BooleanParameterValue
import hudson.model.ParametersAction
import hudson.model.ParametersDefinitionProperty
import hudson.util.Secret
import java.util.logging.Logger

def log = Logger.getLogger('civichelp-setup')
def jenkins = Jenkins.get()
def PIPELINE = 'CivicHelp-Pipeline'
def RETIRED = ['CivicHelp-CI', 'CivicHelp-Deploy-AWS']

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

// ---------------------------------------------------------------- 2. the unified pipeline job
try {
    def repo = System.getenv('CIVICHELP_REPO_URL') ?: 'https://github.com/SHASHVAT999/CivicHelp.git'
    def branch = System.getenv('CIVICHELP_BRANCH') ?: 'main'

    // Same parameters as the parameters{} block in the Jenkinsfile, so even build #1 knows the defaults
    def params = [
        [type: 'bool',   name: 'DEPLOY_TO_AWS', value: 'true', desc: 'Run the CD stages (Terraform + Ansible deploy to the existing EC2 instance). Untick to run CI only.'],
        [type: 'string', name: 'TF_DIR', value: 'D:/CivicHelp/terraform', desc: 'Folder holding the EXISTING terraform.tfstate and terraform.tfvars'],
        [type: 'string', name: 'SSH_PRIVATE_KEY_PATH', value: 'D:/AWSConfig/civichelp-key', desc: 'Private key of the EC2 key pair'],
        [type: 'string', name: 'ADMIN_CIDR', value: '', desc: 'Leave EMPTY to auto-detect this PC public IP (or enter x.x.x.x/32)']
    ]
    def desc = 'CivicHelp unified CI/CD pipeline: checkout, validate, build, unit and integration tests, ' +
               'then Terraform and Ansible deployment to the EXISTING AWS EC2 instance and post-deployment verification. ' +
               'Untick DEPLOY_TO_AWS to run CI only.'

    if (jenkins.getItem(PIPELINE) != null) {
        log.info("CivicHelp setup: job ${PIPELINE} already exists - left unchanged")
    } else {
        def paramXml = '<hudson.model.ParametersDefinitionProperty><parameterDefinitions>' + params.collect { p ->
            p.type == 'bool'
                ? "<hudson.model.BooleanParameterDefinition><name>${esc(p.name)}</name><defaultValue>${esc(p.value)}</defaultValue>" +
                  "<description>${esc(p.desc)}</description></hudson.model.BooleanParameterDefinition>"
                : "<hudson.model.StringParameterDefinition><name>${esc(p.name)}</name><defaultValue>${esc(p.value)}</defaultValue>" +
                  "<description>${esc(p.desc)}</description><trim>true</trim></hudson.model.StringParameterDefinition>"
        }.join('') + '</parameterDefinitions></hudson.model.ParametersDefinitionProperty>'

        def xml = """<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <description>${esc(desc)}</description>
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
    <scriptPath>Jenkinsfile</scriptPath>
    <lightweight>true</lightweight>
  </definition>
  <triggers/>
  <disabled>false</disabled>
</flow-definition>"""
        jenkins.createProjectFromXML(PIPELINE, new ByteArrayInputStream(xml.getBytes('UTF-8')))
        log.info("CivicHelp setup: created job ${PIPELINE}")
    }
} catch (Throwable t) {
    log.severe("CivicHelp setup: job step failed: ${t}")
}

// ---------------------------------------------------------------- 3. retire the old two-job setup
// Only after the unified pipeline has proven itself with a successful build that also deployed.
try {
    def pipeline = jenkins.getItem(PIPELINE)
    def proven = pipeline?.getBuilds()?.find { b ->
        b.getResult() == hudson.model.Result.SUCCESS &&
            b.getAction(ParametersAction)?.getParameter('DEPLOY_TO_AWS')?.getValue() == true
    }
    if (proven) {
        RETIRED.each { name ->
            def old = jenkins.getItem(name)
            if (old != null && !old.isDisabled()) {
                old.setDescription("RETIRED - replaced by the single CI/CD job ${PIPELINE} " +
                        "(verified by its build #${proven.getNumber()}). Kept disabled for its build history.")
                old.makeDisabled(true)
                log.info("CivicHelp setup: disabled retired job ${name}")
            }
        }
    } else {
        log.info("CivicHelp setup: ${PIPELINE} has no successful deploying build yet - old jobs left as they are")
    }
} catch (Throwable t) {
    log.severe("CivicHelp setup: retire step failed: ${t}")
}

// ---------------------------------------------------------------- 4. optional one-off build
// scripts/start-jenkins.ps1 -RunBuild Pipeline|PipelineCIOnly sets CIVICHELP_RUN_BUILD so one build
// starts after boot (the login-free way to start a build from a script).
try {
    def wanted = System.getenv('CIVICHELP_RUN_BUILD')
    log.info("CivicHelp setup: CIVICHELP_RUN_BUILD='${wanted}'")
    if (wanted in ['Pipeline', 'PipelineCIOnly']) {
        def deploy = (wanted == 'Pipeline')
        def t = new Thread({
            // A new thread runs as "anonymous"; with security enabled it could not even see the job.
            // This is Jenkins' own start-up code, so run the scheduling step with system privileges.
            def ctx = null
            try {
                Thread.sleep(25000)   // let Jenkins finish starting (executors, plugins) first
                ctx = hudson.security.ACL.as2(hudson.security.ACL.SYSTEM2)
                def job = Jenkins.get().getItem(PIPELINE)
                if (job) {
                    // Every parameter at its default value, except DEPLOY_TO_AWS
                    def values = job.getProperty(ParametersDefinitionProperty).getParameterDefinitions().collect { d ->
                        d.getName() == 'DEPLOY_TO_AWS' ? new BooleanParameterValue('DEPLOY_TO_AWS', deploy) : d.getDefaultParameterValue()
                    }.findAll { it != null }
                    def cause = new hudson.model.CauseAction(new hudson.model.Cause.RemoteCause('localhost',
                            "started by scripts/start-jenkins.ps1 -RunBuild ${wanted}"))
                    def future = job.scheduleBuild2(0, cause, new ParametersAction(values))
                    log.info("CivicHelp setup: scheduled ${PIPELINE} (DEPLOY_TO_AWS=${deploy}): ${future != null}")
                } else {
                    log.warning("CivicHelp setup: job ${PIPELINE} not found, no build scheduled")
                }
            } catch (Throwable e) {
                log.severe("CivicHelp setup: scheduling the build failed: ${e}")
            } finally {
                if (ctx != null) { ctx.close() }
            }
        } as Runnable, 'civichelp-run-build')
        t.setDaemon(true)
        t.start()
    }
} catch (Throwable t) {
    log.severe("CivicHelp setup: build step failed: ${t}")
}
