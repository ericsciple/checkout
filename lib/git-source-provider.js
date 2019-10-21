"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const fs = __importStar(require("fs"));
const fsHelper = __importStar(require("./fs-helper"));
const gitCommandManager = __importStar(require("./git-command-manager"));
const io = __importStar(require("@actions/io"));
const path = __importStar(require("path"));
/*
using Pipelines = GitHub.DistributedTask.Pipelines;
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.IO;
using System.Text.RegularExpressions;
using System.Text;
using System.Diagnostics;
using GitHub.Runner.Sdk;
using System.Linq;
using GitHub.DistributedTask.WebApi;
using GitHub.Services.WebApi;

namespace GitHub.Runner.Plugins.Repository.v1_1
{
    public sealed class GitHubSourceProvider
    {
        // refs prefix
        private const string _refsPrefix = "refs/heads/";
        private const string _remoteRefsPrefix = "refs/remotes/origin/";
        private const string _pullRefsPrefix = "refs/pull/";
        private const string _remotePullRefsPrefix = "refs/remotes/pull/";
        private const string _tagRefsPrefix = "refs/tags/";

        // min git version that support add extra auth header.
        private Version _minGitVersionSupportAuthHeader = new Version(2, 9);

#if OS_WINDOWS
        // min git version that support override sslBackend setting.
        private Version _minGitVersionSupportSSLBackendOverride = new Version(2, 14, 2);
#endif

        // min git-lfs version that support add extra auth header.
        private Version _minGitLfsVersionSupportAuthHeader = new Version(2, 1);

        public static string ProblemMatcher => @"
{
    ""problemMatcher"": [
        {
            ""owner"": ""checkout-git"",
            ""pattern"": [
                {
                    ""regexp"": ""^(fatal|error): (.*)$"",
                    ""message"": 2
                }
            ]
        }
    ]
}";
*/
function getSource(runnerWorkspacePath, repositoryPath, repositoryOwner, repositoryName, sourceBranch, sourceVersion, clean, submodules, nestedSubmodules, fetchDepth, lfs, accessToken) {
    return __awaiter(this, void 0, void 0, function* () {
        core.info(`Syncing repository: ${repositoryOwner}/${repositoryName}`);
        let repositoryUrl = `https://github.com/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}`;
        let git = yield gitCommandManager.CreateCommandManager(runnerWorkspacePath, lfs);
        let exitCode;
        git.setWorkingDirectory(repositoryPath);
        // Repository exists
        if (fsHelper.existsSync(repositoryPath)) {
            let deleteRepository = false;
            // Fetch URL does not match
            if (!fsHelper.directoryExistsSync(path.join(repositoryPath, '.git')) ||
                repositoryUrl != (yield git.tryGetFetchUrl())) {
                deleteRepository = true;
            }
            // Fetch URL matches
            else {
                // Delete any index.lock and shallow.lock left by a previously canceled run or crashed git process
                let lockPaths = [
                    path.join(repositoryPath, '.git', 'index.lock'),
                    path.join(repositoryPath, '.git', 'shallow.lock')
                ];
                for (let i = 0; i < lockPaths.length; i++) {
                    let lockPath = lockPaths[i];
                    try {
                        yield io.rmRF(lockPath);
                    }
                    catch (error) {
                        core.debug(`Unable to delete '${lockPath}'. ${error.message}`);
                    }
                }
                // Clean
                if (clean) {
                    if (!(yield git.tryClean())) {
                        core.debug(`The clean command failed. This might be caused by: 1) path too long, 2) permission issue, or 3) file in use. For futher investigation, manually run 'git clean -ffdx' on the directory '${repositoryPath}'.`);
                        deleteRepository = true;
                    }
                    else {
                        let commands = [git.tryReset];
                        if (submodules) {
                            commands.push(git.trySubmoduleClean);
                            commands.push(git.trySubmoduleReset);
                        }
                        for (let i = 0; i < commands.length; i++) {
                            if (!(yield commands[i]())) {
                                deleteRepository = true;
                                break;
                            }
                        }
                    }
                    if (deleteRepository) {
                        core.warning(`Unable to clean or reset the repository. The repository will be recreated instead.`);
                    }
                }
            }
            // Delete the repository
            if (deleteRepository) {
                yield io.rmRF(repositoryPath);
            }
        }
        io.mkdirP(repositoryPath);
        core.info(`Working directory is '${repositoryPath}'`);
        // Initialize the repository
        if (!fsHelper.directoryExistsSync(path.join(repositoryPath, '.git'))) {
            yield git.init();
            yield git.remoteAdd('origin', repositoryUrl);
        }
        // Disable automatic garbage collection
        if (!(yield git.tryDisableAutomaticGarbageCollection())) {
            core.warning(`Unable to turn off git automatic garbage collection. The git fetch operation may trigger garbage collection and cause a delay.`);
        }
        // Remove possible previous extraheader
        yield removeGitConfig(git, `http.${repositoryUrl}.extraheader`);
        // Add extraheader (auth)
        let base64Credentials = Buffer.from(`x-access-token:${accessToken}`, 'utf8').toString('base64');
        core.setSecret(base64Credentials);
        yield git.config(`http.${repositoryUrl}.extraheader`, `AUTHORIZATION: basic ${base64Credentials}`);
        // LFS install
        if (lfs) {
            yield git.lfsInstall();
        }
        // Refspec
        let refSpec = ['+refs/heads/*:refs/remotes/origin/*'];
        let upperSourceBranch = sourceBranch.toUpperCase();
        let isPullRequest = upperSourceBranch.startsWith('REFS/PULL/') || upperSourceBranch.startsWith('REFS/REMOTES/PULL/');
        if (isPullRequest) {
            refSpec.push(`+${sourceBranch}:${getRemoteRef(sourceBranch)}`);
        }
        // Fetch
        yield git.fetch(fetchDepth, refSpec);
        // Checkout ref
        // If sourceBranch is a PR branch or sourceVersion is null, make sure branch name is a remote branch. we need checkout to detached head
        // (change refs/heads to refs/remotes/origin, refs/pull to refs/remotes/pull, or leave it as it when the branch name doesn't contain refs/...).
        // If sourceVersion was provided, just use that for checkout, since when you checkout a commit, it will be detached head.
        let checkoutRef = isPullRequest || !sourceVersion ? getRemoteRef(sourceBranch) : sourceVersion;
        // LFS fetch
        // Explicit lfs-fetch to avoid slow checkout (fetches one lfs object at a time).
        // Explicit lfs fetch will fetch lfs objects in parallel.
        if (lfs) {
            try {
                yield git.lfsFetch(checkoutRef);
            }
            catch (err) {
                if (fetchDepth > 0) {
                    core.warning(`Git LFS fetch failed on the shallow repository. This may happen when the retrieved commits (fetch depth ${fetchDepth}) for the branch does not include the target commit '${checkoutRef}'.`);
                }
                throw err;
            }
        }
        // Checkout
        try {
            yield git.checkout(checkoutRef);
        }
        catch (err) {
            if (fetchDepth > 0) {
                core.warning(`Git checkout failed on the shallow repository. This may happen when the retrieved commits (fetch depth ${fetchDepth}) for the branch does not include the target commit '${checkoutRef}'.`);
            }
            throw err;
        }
        // Submodules
        if (submodules) {
            git.submoduleSync(nestedSubmodules);
            git.submoduleUpdate(fetchDepth, nestedSubmodules);
        }
    });
}
exports.getSource = getSource;
;
/*
            // Set intra-task variable for post job cleanup
            executionContext.SetIntraActionState("repositoryPath", targetPath);
            executionContext.SetIntraActionState("modifiedgitconfig", JsonUtility.ToString(configModifications.Keys));
            foreach (var config in configModifications)
            {
                executionContext.SetIntraActionState(config.Key, config.Value);
            }
        }

        public async Task CleanupAsync(RunnerActionPluginExecutionContext executionContext)
        {
            ArgUtil.NotNull(executionContext, nameof(executionContext));
            var repositoryPath = Environment.GetEnvironmentVariable("STATE_repositoryPath");
            ArgUtil.NotNullOrEmpty(repositoryPath, nameof(repositoryPath));
            executionContext.Output($"Cleanup cached git credential from {repositoryPath}.");

            // Initialize git command manager
            GitCliManager gitCommandManager = new GitCliManager();
            await gitCommandManager.LoadGitExecutionInfo(executionContext);

            executionContext.Debug("Remove any extraheader and proxy setting from git config.");
            var configKeys = JsonUtility.FromString<List<string>>(Environment.GetEnvironmentVariable("STATE_modifiedgitconfig"));
            if (configKeys?.Count > 0)
            {
                foreach (var config in configKeys)
                {
                    var configValue = Environment.GetEnvironmentVariable($"STATE_{config}");
                    if (!string.IsNullOrEmpty(configValue))
                    {
                        await RemoveGitConfig(executionContext, gitCommandManager, repositoryPath, config, configValue);
                    }
                }
            }
        }

        private void RequirementCheck(RunnerActionPluginExecutionContext executionContext, GitCliManager gitCommandManager, bool checkGitLfs)
        {
            // v2.9 git exist use auth header.
            gitCommandManager.EnsureGitVersion(_minGitVersionSupportAuthHeader, throwOnNotMatch: true);

#if OS_WINDOWS
            // check git version for SChannel SSLBackend (Windows Only)
            bool schannelSslBackend = StringUtil.ConvertToBoolean(executionContext.GetRunnerContext("gituseschannel"));
            if (schannelSslBackend)
            {
                gitCommandManager.EnsureGitVersion(_minGitVersionSupportSSLBackendOverride, throwOnNotMatch: true);
            }
#endif
            if (checkGitLfs)
            {
                // v2.1 git-lfs exist use auth header.
                gitCommandManager.EnsureGitLFSVersion(_minGitLfsVersionSupportAuthHeader, throwOnNotMatch: true);
            }
        }

        private string GenerateBasicAuthHeader(RunnerActionPluginExecutionContext executionContext, string accessToken)
        {
            // use basic auth header with username:password in base64encoding.
            string authHeader = $"x-access-token:{accessToken}";
            string base64encodedAuthHeader = Convert.ToBase64String(Encoding.UTF8.GetBytes(authHeader));

            // add base64 encoding auth header into secretMasker.
            executionContext.AddMask(base64encodedAuthHeader);
            return $"basic {base64encodedAuthHeader}";
        }

        private async Task<bool> IsRepositoryOriginUrlMatch(RunnerActionPluginExecutionContext context, GitCliManager gitCommandManager, string repositoryPath, Uri expectedRepositoryOriginUrl)
        {
            context.Debug($"Checking if the repo on {repositoryPath} matches the expected repository origin URL. expected Url: {expectedRepositoryOriginUrl.AbsoluteUri}");
            if (!Directory.Exists(Path.Combine(repositoryPath, ".git")))
            {
                // There is no repo directory
                context.Debug($"Repository is not found since '.git' directory does not exist under. {repositoryPath}");
                return false;
            }

            Uri remoteUrl;
            remoteUrl = await gitCommandManager.GitGetFetchUrl(context, repositoryPath);

            if (remoteUrl == null)
            {
                // origin fetch url not found.
                context.Debug("Repository remote origin fetch url is empty.");
                return false;
            }

            context.Debug($"Repository remote origin fetch url is {remoteUrl}");
            // compare the url passed in with the remote url found
            if (expectedRepositoryOriginUrl.Equals(remoteUrl))
            {
                context.Debug("URLs match.");
                return true;
            }
            else
            {
                context.Debug($"The remote.origin.url of the repository under root folder '{repositoryPath}' doesn't matches source repository url.");
                return false;
            }
        }

        private async Task RemoveGitConfig(RunnerActionPluginExecutionContext executionContext, GitCliManager gitCommandManager, string targetPath, string configKey, string configValue)
        {
            int exitCode_configUnset = await gitCommandManager.GitConfigUnset(executionContext, targetPath, configKey);
            if (exitCode_configUnset != 0)
            {
                // if unable to use git.exe unset http.extraheader, http.proxy or core.askpass, modify git config file on disk. make sure we don't left credential.
                if (!string.IsNullOrEmpty(configValue))
                {
                    executionContext.Warning("An unsuccessful attempt was made using git command line to remove \"http.extraheader\" from the git config. Attempting to modify the git config file directly to remove the credential.");
                    string gitConfig = Path.Combine(targetPath, ".git/config");
                    if (File.Exists(gitConfig))
                    {
                        List<string> safeGitConfig = new List<string>();
                        var gitConfigContents = File.ReadAllLines(gitConfig);
                        foreach (var line in gitConfigContents)
                        {
                            if (!line.Contains(configValue))
                            {
                                safeGitConfig.Add(line);
                            }
                        }

                        File.WriteAllLines(gitConfig, safeGitConfig);
                    }
                }
                else
                {
                    executionContext.Warning($"Unable to remove \"{configKey}\" from the git config. To remove the credential, execute \"git config --unset - all {configKey}\" from the repository root \"{targetPath}\".");
                }
            }
        }

        private bool IsPullRequest(string sourceBranch)
        {
            return !string.IsNullOrEmpty(sourceBranch) &&
                (sourceBranch.StartsWith(_pullRefsPrefix, StringComparison.OrdinalIgnoreCase) ||
                 sourceBranch.StartsWith(_remotePullRefsPrefix, StringComparison.OrdinalIgnoreCase));
        }

        private string GetRemoteRefName(string refName)
        {
            if (string.IsNullOrEmpty(refName))
            {
                // If the refName is empty return the remote name for master
                refName = _remoteRefsPrefix + "master";
            }
            else if (refName.Equals("master", StringComparison.OrdinalIgnoreCase))
            {
                // If the refName is master return the remote name for master
                refName = _remoteRefsPrefix + refName;
            }
            else if (refName.StartsWith(_refsPrefix, StringComparison.OrdinalIgnoreCase))
            {
                // If the refName is refs/heads change it to the remote version of the name
                refName = _remoteRefsPrefix + refName.Substring(_refsPrefix.Length);
            }
            else if (refName.StartsWith(_pullRefsPrefix, StringComparison.OrdinalIgnoreCase))
            {
                // If the refName is refs/pull change it to the remote version of the name
                refName = refName.Replace(_pullRefsPrefix, _remotePullRefsPrefix);
            }

            return refName;
        }
    }
}
*/
// async function isExpectedRemoteUrl(
//     git: gitCommandManager.IGitCommandManager,
//     repositoryPath: string,
//     repositoryUrl: string):
//     Promise<boolean> {
//     core.debug(`Checking if the repository at '${repositoryPath}' has remote URL '${repositoryUrl}'`);
//     let dotGitPath = path.join(repositoryPath, '.git');
//     if (!fsHelper.directoryExistsSync(dotGitPath)) {
//         core.debug(`Directory not found: '${dotGitPath}'`);
//         return false;
//     }
//     git.setWorkingDirectory(repositoryPath);
//     let remoteUrl = await git.tryGetFetchUrl();
//     return remoteUrl == repositoryUrl;
// }
function getRemoteRef(ref) {
    if (!ref) {
        return 'refs/remotes/origin/master';
    }
    let upperRef = ref.toUpperCase();
    if (upperRef == 'MASTER') {
        return `refs/remotes/origin/${ref}`;
    }
    else if (upperRef.startsWith('REFS/HEADS/')) {
        return `refs/remotes/origin/${ref.substring('refs/heads/'.length)}`;
    }
    else if (upperRef.startsWith('REFS/PULL/')) {
        return `refs/remotes/pull/${ref.substring('refs/pull/'.length)}`;
    }
    return ref;
}
function removeGitConfig(git, configKey) {
    return __awaiter(this, void 0, void 0, function* () {
        if ((yield git.configExists(configKey)) &&
            !(yield git.tryConfigUnset(configKey))) {
            // Load the config contents
            core.warning(`Failed to remove '${configKey}' from the git config. Attempting to remove the config value by editing the file directly.`);
            let configPath = path.join(git.getWorkingDirectory(), '.git', 'config');
            fsHelper.fileExistsSync(configPath);
            let contents = fs.readFileSync(configPath).toString() || '';
            // Filter - only includes lines that do not contain the config key
            let upperConfigKey = configKey.toUpperCase();
            let split = contents.split('\n').filter(x => x.toUpperCase().indexOf(upperConfigKey) < 0);
            contents = split.join('\n');
            // Rewrite the config file
            fs.writeFileSync(configPath, contents);
        }
    });
}
