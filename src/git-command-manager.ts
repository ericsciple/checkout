import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as execInterfaces from '@actions/exec/lib/interfaces'
import * as fshelper from './fs-helper';
import * as io from '@actions/io';
import { defaultCoreCipherList } from 'constants';
import { ExecOptions } from 'child_process';
import { context } from '@actions/github';

export interface IGitCommandManager {
    configExist(): Promise<boolean>;
    init(): Promise<void>;
    remoteAdd(remoteName: string, remoteUrl: string): Promise<void>;
    setWorkingDirectory(path: string);
    tryClean(): Promise<number>;
    tryDisableAutomaticGarbageCollection(): Promise<number>;
    tryGetFetchUrl(): Promise<string>;
    tryReset(): Promise<number>;
    trySubmoduleClean(): Promise<number>;
    trySubmoduleReset(): Promise<number>;
}

export async function CreateCommandManager(
    workingDirectory: string,
    lfs: boolean):
    Promise<IGitCommandManager> {

    return await GitCommandManager.createCommandManager(workingDirectory, lfs);
}

class GitCommandManager {
    private gitEnv = {
        "GIT_TERMINAL_PROMPT": "0", // Disable git prompt
        "GCM_INTERACTIVE": "Never"  // Disable prompting for git credential manager
    };
    private gitPath: string = '';
    private lfs: boolean = false;
    private workingDirectory: string = '';

    // Private constructor; use createCommandManager()
    private constructor() {
    }

    public async configExists(configKey: string): Promise<boolean> {
        let pattern = configKey.replace(/[^a-zA-Z0-9_]/g, (x) => { return `\\${x}`});
        let output = await this.execGit(['config', '--name-only', '--get-regexp', pattern], true);
        return output.exitCode == 0;
    }

    public async init() {
        await this.execGit(['init', this.workingDirectory]);
    }

    public async remoteAdd(
        remoteName: string,
        remoteUrl: string) {

        await this.execGit(['remote', 'add', remoteName, remoteUrl]);
    }
    
    public setWorkingDirectory(path: string) {
        fshelper.directoryExistsSync(path, true);
        this.workingDirectory = path;
    }

    public async tryClean(): Promise<number> {
        let output = await this.execGit(['clean', '-ffdx'], true);
        return output.exitCode;
    }

    public async tryConfigUnset(configKey: string): Promise<boolean> {
        let output = await this.execGit(['config', '--unset-all', configKey]);
        return output.exitCode == 0;
    }

    public async tryDisableAutomaticGarbageCollection(): Promise<number> {
        let output = await this.execGit(['config', 'gc.auto', '0'], true);
        return output.exitCode;
    }
    
    public async tryGetFetchUrl(): Promise<string> {
        let output = await this.execGit(['config', '--get', 'remote.origin.url'], true);

        if (output.exitCode != 0) {
            return '';
        }

        let stdout = output.stdout.trim();
        if (stdout.indexOf('\n') >= 0) {
            return '';
        }

        return stdout;
    }

    public async tryReset(): Promise<number> {
        let output = await this.execGit(['reset', '--hard', 'HEAD'], true);
        return output.exitCode;
    }

    public async trySubmoduleClean(): Promise<number> {
        let output = await this.execGit(['submodule', 'foreach', 'git', 'clean', '-ffdx'], true);
        return output.exitCode;
    }

    public async trySubmoduleReset(): Promise<number> {
        let output = await this.execGit(['submodule', 'foreach', 'git', 'reset', '--hard', 'HEAD'], true);
        return output.exitCode;
    }

    public static async createCommandManager(
        workingDirectory: string,
        lfs: boolean):
        Promise<GitCommandManager> {

        let result = new GitCommandManager();
        await result.initializeCommandManager(workingDirectory, lfs);
        return result;
    }

    private async execGit(
        args: string[],
        allowAllExitCodes: boolean = false):
        Promise<GitOutput> {

        let result = new GitOutput();

        let env = {};
        Object.keys(process.env).forEach(x => env[x] = process.env[x]);
        Object.keys(this.gitEnv).forEach(x => env[x] = this.gitEnv[x]);

        let stdout: string[] = [];

        let options = {
            cwd: this.workingDirectory,
            env: env,
            ignoreReturnCode: allowAllExitCodes,
            listeners: {
                stdout: (data: Buffer) => {
                    stdout.push(data.toString());
                }
            }
        };

        result.exitCode = await exec.exec(this.gitPath, args, options);
        result.stdout = stdout.join('');
        return result;
    }

    private async initializeCommandManager(
        workingDirectory: string,
        lfs: boolean) {

        this.setWorkingDirectory(workingDirectory);

        // Git-lfs will try to pull down assets if any of the local/user/system setting exist.
        // If the user didn't enable `LFS` in their pipeline definition, disable LFS fetch/checkout.
        this.lfs = lfs;
        if (!this.lfs) {
            this.gitEnv["GIT_LFS_SKIP_SMUDGE"] = "1";
        }

        this.gitPath = await io.which('git', true);

        // Git version
        core.debug("Getting git version");
        let gitVersion = new Version();
        let gitOutput = await this.execGit(["version"]);
        let stdout = gitOutput.stdout.trim();
        if (stdout.indexOf('\n') < 0) {
            let match = stdout.match(/\d+\.\d+(\.\d+)?/);
            if (match) {
                gitVersion = new Version(match[0]);
            }
        }
        if (!gitVersion.isSet) {
            throw new Error("Unable to determine git version");
        }

        // Minimum git version
        let minimumGitVersion = new Version("2.9"); // Auth header not supported before 2.9
        if (!gitVersion.checkMinimum(minimumGitVersion)) {
            throw new Error(`Minimum required git version is ${minimumGitVersion}. Your git ('${this.gitPath}') is ${gitVersion}`);
        }

        if (this.lfs) {
            // Git-lfs version
            core.debug("Getting git-lfs version");
            let gitLfsVersion = new Version();
            let gitLfsPath = await io.which("git-lfs", true);
            gitOutput = await this.execGit(["lfs", "version"]);
            stdout = gitOutput.stdout.trim();
            if (stdout.indexOf('\n') < 0) {
                let match = stdout.match(/\d+\.\d+(\.\d+)?/);
                if (match) {
                    gitLfsVersion = new Version(match[0]);
                }
            }
            if (!gitLfsVersion.isSet) {
                throw new Error("Unable to determine git-lfs version");
            }

            // Minimum git-lfs version
            let minimumGitLfsVersion = new Version("2.1"); // Auth header not supported before 2.1
            if (!gitLfsVersion.checkMinimum(minimumGitLfsVersion)) {
                throw new Error(`Minimum required git-lfs version is ${minimumGitLfsVersion}. Your git-lfs ('${gitLfsPath}') is ${gitLfsVersion}`);
            }
        }

        // Set the user agent
        let gitHttpUserAgent = `git/${gitVersion} (github-actions-checkout)`;
        core.debug(`Set git useragent to: ${gitHttpUserAgent}`);
        this.gitEnv["GIT_HTTP_USER_AGENT"] = gitHttpUserAgent;
    }
}

/*

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.IO;
using GitHub.Runner.Sdk;
using GitHub.Services.Common;
using GitHub.DistributedTask.Pipelines.ContextData;

namespace GitHub.Runner.Plugins.Repository
{
    public class GitCliManager
    {
        // git init <LocalDir>
        public async Task<int> GitInit(RunnerActionPluginExecutionContext context, string repositoryPath)
        {
            context.Debug($"Init git repository at: {repositoryPath}.");
            string repoRootEscapeSpace = StringUtil.Format(@"""{0}""", repositoryPath.Replace(@"""", @"\"""));
            return await ExecuteGitCommandAsync(context, repositoryPath, "init", StringUtil.Format($"{repoRootEscapeSpace}"));
        }

        // git fetch --tags --prune --progress --no-recurse-submodules [--depth=15] origin [+refs/pull/*:refs/remote/pull/*]
        public async Task<int> GitFetch(RunnerActionPluginExecutionContext context, string repositoryPath, string remoteName, int fetchDepth, List<string> refSpec, string additionalCommandLine, CancellationToken cancellationToken)
        {
            context.Debug($"Fetch git repository at: {repositoryPath} remote: {remoteName}.");
            if (refSpec != null && refSpec.Count > 0)
            {
                refSpec = refSpec.Where(r => !string.IsNullOrEmpty(r)).ToList();
            }

            // default options for git fetch.
            string options = StringUtil.Format($"--tags --prune --progress --no-recurse-submodules {remoteName} {string.Join(" ", refSpec)}");

            // If shallow fetch add --depth arg
            // If the local repository is shallowed but there is no fetch depth provide for this build,
            // add --unshallow to convert the shallow repository to a complete repository
            if (fetchDepth > 0)
            {
                options = StringUtil.Format($"--tags --prune --progress --no-recurse-submodules --depth={fetchDepth} {remoteName} {string.Join(" ", refSpec)}");
            }
            else
            {
                if (File.Exists(Path.Combine(repositoryPath, ".git", "shallow")))
                {
                    options = StringUtil.Format($"--tags --prune --progress --no-recurse-submodules --unshallow {remoteName} {string.Join(" ", refSpec)}");
                }
            }

            int retryCount = 0;
            int fetchExitCode = 0;
            while (retryCount < 3)
            {
                fetchExitCode = await ExecuteGitCommandAsync(context, repositoryPath, "fetch", options, additionalCommandLine, cancellationToken);
                if (fetchExitCode == 0)
                {
                    break;
                }
                else
                {
                    if (++retryCount < 3)
                    {
                        var backOff = BackoffTimerHelper.GetRandomBackoff(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(10));
                        context.Warning($"Git fetch failed with exit code {fetchExitCode}, back off {backOff.TotalSeconds} seconds before retry.");
                        await Task.Delay(backOff);
                    }
                }
            }

            return fetchExitCode;
        }

        // git fetch --no-tags --prune --progress --no-recurse-submodules [--depth=15] origin [+refs/pull/*:refs/remote/pull/*] [+refs/tags/1:refs/tags/1]
        public async Task<int> GitFetchNoTags(RunnerActionPluginExecutionContext context, string repositoryPath, string remoteName, int fetchDepth, List<string> refSpec, string additionalCommandLine, CancellationToken cancellationToken)
        {
            context.Debug($"Fetch git repository at: {repositoryPath} remote: {remoteName}.");
            if (refSpec != null && refSpec.Count > 0)
            {
                refSpec = refSpec.Where(r => !string.IsNullOrEmpty(r)).ToList();
            }

            string options;

            // If shallow fetch add --depth arg
            // If the local repository is shallowed but there is no fetch depth provide for this build,
            // add --unshallow to convert the shallow repository to a complete repository
            if (fetchDepth > 0)
            {
                options = StringUtil.Format($"--no-tags --prune --progress --no-recurse-submodules --depth={fetchDepth} {remoteName} {string.Join(" ", refSpec)}");
            }
            else if (File.Exists(Path.Combine(repositoryPath, ".git", "shallow")))
            {
                options = StringUtil.Format($"--no-tags --prune --progress --no-recurse-submodules --unshallow {remoteName} {string.Join(" ", refSpec)}");
            }
            else
            {
                // default options for git fetch.
                options = StringUtil.Format($"--no-tags --prune --progress --no-recurse-submodules {remoteName} {string.Join(" ", refSpec)}");
            }

            int retryCount = 0;
            int fetchExitCode = 0;
            while (retryCount < 3)
            {
                fetchExitCode = await ExecuteGitCommandAsync(context, repositoryPath, "fetch", options, additionalCommandLine, cancellationToken);
                if (fetchExitCode == 0)
                {
                    break;
                }
                else
                {
                    if (++retryCount < 3)
                    {
                        var backOff = BackoffTimerHelper.GetRandomBackoff(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(10));
                        context.Warning($"Git fetch failed with exit code {fetchExitCode}, back off {backOff.TotalSeconds} seconds before retry.");
                        await Task.Delay(backOff);
                    }
                }
            }

            return fetchExitCode;
        }

        // git lfs fetch origin [ref]
        public async Task<int> GitLFSFetch(RunnerActionPluginExecutionContext context, string repositoryPath, string remoteName, string refSpec, string additionalCommandLine, CancellationToken cancellationToken)
        {
            context.Debug($"Fetch LFS objects for git repository at: {repositoryPath} remote: {remoteName}.");

            // default options for git lfs fetch.
            string options = StringUtil.Format($"fetch origin {refSpec}");

            int retryCount = 0;
            int fetchExitCode = 0;
            while (retryCount < 3)
            {
                fetchExitCode = await ExecuteGitCommandAsync(context, repositoryPath, "lfs", options, additionalCommandLine, cancellationToken);
                if (fetchExitCode == 0)
                {
                    break;
                }
                else
                {
                    if (++retryCount < 3)
                    {
                        var backOff = BackoffTimerHelper.GetRandomBackoff(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(10));
                        context.Warning($"Git lfs fetch failed with exit code {fetchExitCode}, back off {backOff.TotalSeconds} seconds before retry.");
                        await Task.Delay(backOff);
                    }
                }
            }

            return fetchExitCode;
        }

        // git lfs pull
        public async Task<int> GitLFSPull(RunnerActionPluginExecutionContext context, string repositoryPath, string additionalCommandLine, CancellationToken cancellationToken)
        {
            context.Debug($"Download LFS objects for git repository at: {repositoryPath}.");

            int retryCount = 0;
            int pullExitCode = 0;
            while (retryCount < 3)
            {
                pullExitCode = await ExecuteGitCommandAsync(context, repositoryPath, "lfs", "pull", additionalCommandLine, cancellationToken);
                if (pullExitCode == 0)
                {
                    break;
                }
                else
                {
                    if (++retryCount < 3)
                    {
                        var backOff = BackoffTimerHelper.GetRandomBackoff(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(10));
                        context.Warning($"Git lfs pull failed with exit code {pullExitCode}, back off {backOff.TotalSeconds} seconds before retry.");
                        await Task.Delay(backOff);
                    }
                }
            }

            return pullExitCode;
        }

        // git symbolic-ref -q <HEAD>
        public async Task<int> GitSymbolicRefHEAD(RunnerActionPluginExecutionContext context, string repositoryPath)
        {
            context.Debug($"Check whether HEAD is detached HEAD.");
            return await ExecuteGitCommandAsync(context, repositoryPath, "symbolic-ref", "-q HEAD");
        }

        // git checkout -f --progress <commitId/branch>
        public async Task<int> GitCheckout(RunnerActionPluginExecutionContext context, string repositoryPath, string committishOrBranchSpec, CancellationToken cancellationToken)
        {
            context.Debug($"Checkout {committishOrBranchSpec}.");

            // Git 2.7 support report checkout progress to stderr during stdout/err redirect.
            string options;
            if (gitVersion >= new Version(2, 7))
            {
                options = StringUtil.Format("--progress --force {0}", committishOrBranchSpec);
            }
            else
            {
                options = StringUtil.Format("--force {0}", committishOrBranchSpec);
            }

            return await ExecuteGitCommandAsync(context, repositoryPath, "checkout", options, cancellationToken);
        }

        // git checkout -B --progress branch remoteBranch
        public async Task<int> GitCheckoutB(RunnerActionPluginExecutionContext context, string repositoryPath, string newBranch, string startPoint, CancellationToken cancellationToken)
        {
            context.Debug($"Checkout -B {newBranch} {startPoint}.");

            // Git 2.7 support report checkout progress to stderr during stdout/err redirect.
            string options;
            if (gitVersion >= new Version(2, 7))
            {
                options = $"--progress --force -B {newBranch} {startPoint}";
            }
            else
            {
                options = $"--force -B {newBranch} {startPoint}";
            }

            return await ExecuteGitCommandAsync(context, repositoryPath, "checkout", options, cancellationToken);
        }

        // git clean -ffdx
        public async Task<int> GitClean(RunnerActionPluginExecutionContext context, string repositoryPath)
        {
            context.Debug($"Delete untracked files/folders for repository at {repositoryPath}.");

            // Git 2.4 support git clean -ffdx.
            string options;
            if (gitVersion >= new Version(2, 4))
            {
                options = "-ffdx";
            }
            else
            {
                options = "-fdx";
            }

            return await ExecuteGitCommandAsync(context, repositoryPath, "clean", options);
        }

        // git reset --hard <commit>
        public async Task<int> GitReset(RunnerActionPluginExecutionContext context, string repositoryPath, string commit = "HEAD")
        {
            context.Debug($"Undo any changes to tracked files in the working tree for repository at {repositoryPath}.");
            return await ExecuteGitCommandAsync(context, repositoryPath, "reset", $"--hard {commit}");
        }

        // get remote set-url <origin> <url>
        public async Task<int> GitRemoteAdd(RunnerActionPluginExecutionContext context, string repositoryPath, string remoteName, string remoteUrl)
        {
            context.Debug($"Add git remote: {remoteName} to url: {remoteUrl} for repository under: {repositoryPath}.");
            return await ExecuteGitCommandAsync(context, repositoryPath, "remote", StringUtil.Format($"add {remoteName} {remoteUrl}"));
        }

        // get remote set-url <origin> <url>
        public async Task<int> GitRemoteSetUrl(RunnerActionPluginExecutionContext context, string repositoryPath, string remoteName, string remoteUrl)
        {
            context.Debug($"Set git fetch url to: {remoteUrl} for remote: {remoteName}.");
            return await ExecuteGitCommandAsync(context, repositoryPath, "remote", StringUtil.Format($"set-url {remoteName} {remoteUrl}"));
        }

        // get remote set-url --push <origin> <url>
        public async Task<int> GitRemoteSetPushUrl(RunnerActionPluginExecutionContext context, string repositoryPath, string remoteName, string remoteUrl)
        {
            context.Debug($"Set git push url to: {remoteUrl} for remote: {remoteName}.");
            return await ExecuteGitCommandAsync(context, repositoryPath, "remote", StringUtil.Format($"set-url --push {remoteName} {remoteUrl}"));
        }

        // git submodule foreach git clean -ffdx
        public async Task<int> GitSubmoduleClean(RunnerActionPluginExecutionContext context, string repositoryPath)
        {
            context.Debug($"Delete untracked files/folders for submodules at {repositoryPath}.");

            // Git 2.4 support git clean -ffdx.
            string options;
            if (gitVersion >= new Version(2, 4))
            {
                options = "-ffdx";
            }
            else
            {
                options = "-fdx";
            }

            return await ExecuteGitCommandAsync(context, repositoryPath, "submodule", $"foreach git clean {options}");
        }

        // git submodule foreach git reset --hard HEAD
        public async Task<int> GitSubmoduleReset(RunnerActionPluginExecutionContext context, string repositoryPath)
        {
            context.Debug($"Undo any changes to tracked files in the working tree for submodules at {repositoryPath}.");
            return await ExecuteGitCommandAsync(context, repositoryPath, "submodule", "foreach git reset --hard HEAD");
        }

        // git submodule update --init --force [--depth=15] [--recursive]
        public async Task<int> GitSubmoduleUpdate(RunnerActionPluginExecutionContext context, string repositoryPath, int fetchDepth, string additionalCommandLine, bool recursive, CancellationToken cancellationToken)
        {
            context.Debug("Update the registered git submodules.");
            string options = "update --init --force";
            if (fetchDepth > 0)
            {
                options = options + $" --depth={fetchDepth}";
            }
            if (recursive)
            {
                options = options + " --recursive";
            }

            return await ExecuteGitCommandAsync(context, repositoryPath, "submodule", options, additionalCommandLine, cancellationToken);
        }

        // git submodule sync [--recursive]
        public async Task<int> GitSubmoduleSync(RunnerActionPluginExecutionContext context, string repositoryPath, bool recursive, CancellationToken cancellationToken)
        {
            context.Debug("Synchronizes submodules' remote URL configuration setting.");
            string options = "sync";
            if (recursive)
            {
                options = options + " --recursive";
            }

            return await ExecuteGitCommandAsync(context, repositoryPath, "submodule", options, cancellationToken);
        }

        // git config --get remote.origin.url
        public async Task<Uri> GitGetFetchUrl(RunnerActionPluginExecutionContext context, string repositoryPath)
        {
            context.Debug($"Inspect remote.origin.url for repository under {repositoryPath}");
            Uri fetchUrl = null;

            List<string> outputStrings = new List<string>();
            int exitCode = await ExecuteGitCommandAsync(context, repositoryPath, "config", "--get remote.origin.url", outputStrings);

            if (exitCode != 0)
            {
                context.Warning($"'git config --get remote.origin.url' failed with exit code: {exitCode}, output: '{string.Join(Environment.NewLine, outputStrings)}'");
            }
            else
            {
                // remove empty strings
                outputStrings = outputStrings.Where(o => !string.IsNullOrEmpty(o)).ToList();
                if (outputStrings.Count == 1 && !string.IsNullOrEmpty(outputStrings.First()))
                {
                    string remoteFetchUrl = outputStrings.First();
                    if (Uri.IsWellFormedUriString(remoteFetchUrl, UriKind.Absolute))
                    {
                        context.Debug($"Get remote origin fetch url from git config: {remoteFetchUrl}");
                        fetchUrl = new Uri(remoteFetchUrl);
                    }
                    else
                    {
                        context.Debug($"The Origin fetch url from git config: {remoteFetchUrl} is not a absolute well formed url.");
                    }
                }
                else
                {
                    context.Debug($"Unable capture git remote fetch uri from 'git config --get remote.origin.url' command's output, the command's output is not expected: {string.Join(Environment.NewLine, outputStrings)}.");
                }
            }

            return fetchUrl;
        }

        // git config <key> <value>
        public async Task<int> GitConfig(RunnerActionPluginExecutionContext context, string repositoryPath, string configKey, string configValue)
        {
            context.Debug($"Set git config {configKey} {configValue}");
            return await ExecuteGitCommandAsync(context, repositoryPath, "config", StringUtil.Format($"{configKey} {configValue}"));
        }

        // git config --get-all <key>
        public async Task<bool> GitConfigExist(RunnerActionPluginExecutionContext context, string repositoryPath, string configKey)
        {
            // git config --get-all {configKey} will return 0 and print the value if the config exist.
            context.Debug($"Checking git config {configKey} exist or not");

            // ignore any outputs by redirect them into a string list, since the output might contains secrets.
            List<string> outputStrings = new List<string>();
            int exitcode = await ExecuteGitCommandAsync(context, repositoryPath, "config", StringUtil.Format($"--get-all {configKey}"), outputStrings);

            return exitcode == 0;
        }

        // git config --unset-all <key>
        public async Task<int> GitConfigUnset(RunnerActionPluginExecutionContext context, string repositoryPath, string configKey)
        {
            context.Debug($"Unset git config --unset-all {configKey}");
            return await ExecuteGitCommandAsync(context, repositoryPath, "config", StringUtil.Format($"--unset-all {configKey}"));
        }

        // git config gc.auto 0
        public async Task<int> GitDisableAutoGC(RunnerActionPluginExecutionContext context, string repositoryPath)
        {
            context.Debug("Disable git auto garbage collection.");
            return await ExecuteGitCommandAsync(context, repositoryPath, "config", "gc.auto 0");
        }

        // git repack -adfl
        public async Task<int> GitRepack(RunnerActionPluginExecutionContext context, string repositoryPath)
        {
            context.Debug("Compress .git directory.");
            return await ExecuteGitCommandAsync(context, repositoryPath, "repack", "-adfl");
        }

        // git prune
        public async Task<int> GitPrune(RunnerActionPluginExecutionContext context, string repositoryPath)
        {
            context.Debug("Delete unreachable objects under .git directory.");
            return await ExecuteGitCommandAsync(context, repositoryPath, "prune", "-v");
        }

        // git count-objects -v -H
        public async Task<int> GitCountObjects(RunnerActionPluginExecutionContext context, string repositoryPath)
        {
            context.Debug("Inspect .git directory.");
            return await ExecuteGitCommandAsync(context, repositoryPath, "count-objects", "-v -H");
        }

        // git lfs install --local
        public async Task<int> GitLFSInstall(RunnerActionPluginExecutionContext context, string repositoryPath)
        {
            context.Debug("Ensure git-lfs installed.");
            return await ExecuteGitCommandAsync(context, repositoryPath, "lfs", "install --local");
        }

        // git lfs logs last
        public async Task<int> GitLFSLogs(RunnerActionPluginExecutionContext context, string repositoryPath)
        {
            context.Debug("Get git-lfs logs.");
            return await ExecuteGitCommandAsync(context, repositoryPath, "lfs", "logs last");
        }

        // git version
        public async Task<Version> GitVersion(RunnerActionPluginExecutionContext context)
        {
            context.Debug("Get git version.");
            string runnerWorkspace = context.GetRunnerContext("workspace");
            ArgUtil.Directory(runnerWorkspace, "runnerWorkspace");
            Version version = null;
            List<string> outputStrings = new List<string>();
            int exitCode = await ExecuteGitCommandAsync(context, runnerWorkspace, "version", null, outputStrings);
            context.Output($"{string.Join(Environment.NewLine, outputStrings)}");
            if (exitCode == 0)
            {
                // remove any empty line.
                outputStrings = outputStrings.Where(o => !string.IsNullOrEmpty(o)).ToList();
                if (outputStrings.Count == 1 && !string.IsNullOrEmpty(outputStrings.First()))
                {
                    string verString = outputStrings.First();
                    // we interested about major.minor.patch version
                    Regex verRegex = new Regex("\\d+\\.\\d+(\\.\\d+)?", RegexOptions.IgnoreCase);
                    var matchResult = verRegex.Match(verString);
                    if (matchResult.Success && !string.IsNullOrEmpty(matchResult.Value))
                    {
                        if (!Version.TryParse(matchResult.Value, out version))
                        {
                            version = null;
                        }
                    }
                }
            }

            return version;
        }

        // git lfs version
        public async Task<Version> GitLfsVersion(RunnerActionPluginExecutionContext context)
        {
            context.Debug("Get git-lfs version.");
            string runnerWorkspace = context.GetRunnerContext("workspace");
            ArgUtil.Directory(runnerWorkspace, "runnerWorkspace");
            Version version = null;
            List<string> outputStrings = new List<string>();
            int exitCode = await ExecuteGitCommandAsync(context, runnerWorkspace, "lfs version", null, outputStrings);
            context.Output($"{string.Join(Environment.NewLine, outputStrings)}");
            if (exitCode == 0)
            {
                // remove any empty line.
                outputStrings = outputStrings.Where(o => !string.IsNullOrEmpty(o)).ToList();
                if (outputStrings.Count == 1 && !string.IsNullOrEmpty(outputStrings.First()))
                {
                    string verString = outputStrings.First();
                    // we interested about major.minor.patch version
                    Regex verRegex = new Regex("\\d+\\.\\d+(\\.\\d+)?", RegexOptions.IgnoreCase);
                    var matchResult = verRegex.Match(verString);
                    if (matchResult.Success && !string.IsNullOrEmpty(matchResult.Value))
                    {
                        if (!Version.TryParse(matchResult.Value, out version))
                        {
                            version = null;
                        }
                    }
                }
            }

            return version;
        }

        private async Task<int> ExecuteGitCommandAsync(RunnerActionPluginExecutionContext context, string repoRoot, string command, string options, CancellationToken cancellationToken = default(CancellationToken))
        {
            string arg = StringUtil.Format($"{command} {options}").Trim();
            context.Command($"git {arg}");

            var processInvoker = new ProcessInvoker(context);
            processInvoker.OutputDataReceived += delegate (object sender, ProcessDataReceivedEventArgs message)
            {
                context.Output(message.Data);
            };

            processInvoker.ErrorDataReceived += delegate (object sender, ProcessDataReceivedEventArgs message)
            {
                context.Output(message.Data);
            };

            return await processInvoker.ExecuteAsync(
                workingDirectory: repoRoot,
                fileName: gitPath,
                arguments: arg,
                environment: gitEnv,
                requireExitCodeZero: false,
                outputEncoding: s_encoding,
                cancellationToken: cancellationToken);
        }

        private async Task<int> ExecuteGitCommandAsync(RunnerActionPluginExecutionContext context, string repoRoot, string command, string options, IList<string> output)
        {
            string arg = StringUtil.Format($"{command} {options}").Trim();
            context.Command($"git {arg}");

            if (output == null)
            {
                output = new List<string>();
            }

            var processInvoker = new ProcessInvoker(context);
            processInvoker.OutputDataReceived += delegate (object sender, ProcessDataReceivedEventArgs message)
            {
                output.Add(message.Data);
            };

            processInvoker.ErrorDataReceived += delegate (object sender, ProcessDataReceivedEventArgs message)
            {
                context.Output(message.Data);
            };

            return await processInvoker.ExecuteAsync(
                workingDirectory: repoRoot,
                fileName: gitPath,
                arguments: arg,
                environment: gitEnv,
                requireExitCodeZero: false,
                outputEncoding: s_encoding,
                cancellationToken: default(CancellationToken));
        }

        private async Task<int> ExecuteGitCommandAsync(RunnerActionPluginExecutionContext context, string repoRoot, string command, string options, string additionalCommandLine, CancellationToken cancellationToken)
        {
            string arg = StringUtil.Format($"{additionalCommandLine} {command} {options}").Trim();
            context.Command($"git {arg}");

            var processInvoker = new ProcessInvoker(context);
            processInvoker.OutputDataReceived += delegate (object sender, ProcessDataReceivedEventArgs message)
            {
                context.Output(message.Data);
            };

            processInvoker.ErrorDataReceived += delegate (object sender, ProcessDataReceivedEventArgs message)
            {
                context.Output(message.Data);
            };

            return await processInvoker.ExecuteAsync(
                workingDirectory: repoRoot,
                fileName: gitPath,
                arguments: arg,
                environment: gitEnv,
                requireExitCodeZero: false,
                outputEncoding: s_encoding,
                cancellationToken: cancellationToken);
        }
    }
}

*/

class GitOutput {
    public stdout: string = '';
    public exitCode: number = 0;
}

class Version {
    public readonly isSet: boolean = false;
    private readonly major: number = 0;
    private readonly minor: number = 0;
    private readonly patch: number = 0;
    private readonly isPatchSet: boolean = false;

    constructor(version?: string) {
        if (version) {
            let match = version.match(/^(\d+)\.(\d+)(\.(\d+))?$/);
            if (match) {
                this.major = Number(match[1]);
                this.minor = Number(match[2]);
                this.isSet = true;
                if (match[4]) {
                    this.patch = Number(match[4]);
                    this.isPatchSet = true;
                }
            }
        }
    }

    public checkMinimum(minimum: Version): boolean {
        if (!minimum.isSet) {
            throw new Error("Arg minimum is not set");
        }

        // Major is insufficient
        if (this.major < minimum.major) {
            return false;
        }

        // Major is equal
        if (this.major == minimum.major) {

            // Minor is insufficient
            if (this.minor < minimum.minor) {
                return false;
            }

            // Minor is equal
            if (this.minor == minimum.minor) {

                // Patch is insufficient
                if (this.patch < minimum.patch) {
                    return false;
                }
            }
        }

        return true;
    }

    public toString(): string {
        let result = '';
        if (this.isSet) {
            result = `${this.major}.${this.minor}`;
            if (this.isPatchSet) {
                result += `.${this.patch}`;
            }
        }

        return result;
    }
}
