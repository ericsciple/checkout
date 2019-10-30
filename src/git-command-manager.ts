import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fshelper from './fs-helper';
import * as io from '@actions/io';
import * as path from 'path';
import { start } from 'repl';

export interface IGitCommandManager {
    branchExists(remote: boolean, pattern: string): Promise<boolean>;
    checkout(ref: string, startPoint: string): Promise<void>;
    config(configKey: string, configValue: string): Promise<void>;
    configExists(configKey: string): Promise<boolean>;
    fetch(fetchDepth: number, refSpec: string[]): Promise<void>;
    getWorkingDirectory(): string;
    init(): Promise<void>;
    lfsFetch(ref: string): Promise<void>;
    lfsInstall(): Promise<void>;
    remoteAdd(remoteName: string, remoteUrl: string): Promise<void>;
    setWorkingDirectory(path: string): void;
    submoduleSync(recursive: boolean): Promise<void>;
    submoduleUpdate(fetchDepth: number, recursive: boolean): Promise<void>;
    tagExists(pattern: string): Promise<boolean>;
    tryClean(): Promise<boolean>;
    tryConfigUnset(configKey: string): Promise<boolean>;
    tryDisableAutomaticGarbageCollection(): Promise<boolean>;
    tryGetFetchUrl(): Promise<string>;
    tryReset(): Promise<boolean>;
    trySubmoduleClean(): Promise<boolean>;
    trySubmoduleReset(): Promise<boolean>;
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

    public async branchExists(
        remote: boolean,
        pattern: string)
        : Promise<boolean> {

        let args = ['branch', '--list'];
        if (remote) {
            args.push('--remote');
        }
        args.push(pattern);

        let output = await this.execGit(args);
        return !!output.stdout.trim();
    }

    public async checkout(
        ref: string,
        startPoint: string) {

        let args = ['checkout', '--progress', '--force'];
        if (startPoint) {
            args.push('-B', ref, startPoint);
        }
        else {
            args.push(ref);
        }

        await this.execGit(args);
    }

    public async config(
        configKey: string,
        configValue: string) {

        await this.execGit(['config', configKey, configValue]);
    }

    public async configExists(configKey: string): Promise<boolean> {
        let pattern = configKey.replace(/[^a-zA-Z0-9_]/g, (x) => { return `\\${x}` });
        let output = await this.execGit(['config', '--name-only', '--get-regexp', pattern], true);
        return output.exitCode == 0;
    }

    public async fetch(
        fetchDepth: number,
        refSpec: string[])
        : Promise<void> {

        let args = ['-c', 'protocol.version=2', 'fetch', '--no-tags', '--prune', '--progress', '--no-recurse-submodules'];
        if (fetchDepth > 0) {
            args.push(`--depth=${fetchDepth}`);
        }
        else if (fshelper.fileExistsSync(path.join(this.workingDirectory, '.git', 'shallow'))) {
            args.push('--unshallow');
        }

        args.push('origin');
        refSpec.forEach(x => args.push(x));

        let attempt = 1;
        while (true) {
            let allowAllExitCodes = attempt < 3;
            let output = await this.execGit(args, allowAllExitCodes);
            if (output.exitCode == 0) {
                break;
            }

            let seconds = this.getRandomIntInclusive(1, 10);
            core.warning(`Git fetch failed with exit code ${output.exitCode}. Waiting ${seconds} seconds before trying again.`);
            await this.sleep(seconds * 1000);
            attempt++;
        }
    }

    public getWorkingDirectory(): string {
        return this.workingDirectory;
    }

    public async init() {
        await this.execGit(['init', this.workingDirectory]);
    }

    public async lfsFetch(ref: string) {
        let args = ['lfs', 'fetch', 'origin', ref];

        let attempt = 1;
        while (true) {
            let allowAllExitCodes = attempt < 3;
            let output = await this.execGit(args, allowAllExitCodes);
            if (output.exitCode == 0) {
                break;
            }

            let seconds = this.getRandomIntInclusive(1, 10);
            core.warning(`Git lfs fetch failed with exit code ${output.exitCode}. Waiting ${seconds} seconds before trying again.`);
            await this.sleep(seconds * 1000);
            attempt++;
        }
    }

    public async lfsInstall() {
        await this.execGit(['lfs', 'install', '--local']);
    }

    public async remoteAdd(
        remoteName: string,
        remoteUrl: string) {

        await this.execGit(['remote', 'add', remoteName, remoteUrl]);
    }

    public setWorkingDirectory(path: string) {
        this.workingDirectory = path;
    }

    public async submoduleSync(recursive: boolean) {
        let args = ['submodule', 'sync'];
        if (recursive) {
            args.push('--recursive');
        }

        await this.execGit(args);
    }

    public async submoduleUpdate(
        fetchDepth: number,
        recursive: boolean) {

        let args = ['submodule', 'update', '--init', '--force'];
        if (fetchDepth > 0) {
            args.push(`--depth=${fetchDepth}`);
        }

        if (recursive) {
            args.push('--recursive');
        }

        await this.execGit(args);
    }

    public async tagExists(pattern: string): Promise<boolean> {
        let output = await this.execGit(['tag', '--list', pattern]);
        return !!output.stdout.trim();
    }

    public async tryClean(): Promise<boolean> {
        let output = await this.execGit(['clean', '-ffdx'], true);
        return output.exitCode == 0;
    }

    public async tryConfigUnset(configKey: string): Promise<boolean> {
        let output = await this.execGit(['config', '--unset-all', configKey], true);
        return output.exitCode == 0;
    }

    public async tryDisableAutomaticGarbageCollection(): Promise<boolean> {
        let output = await this.execGit(['config', 'gc.auto', '0'], true);
        return output.exitCode == 0;
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

    public async tryReset(): Promise<boolean> {
        let output = await this.execGit(['reset', '--hard', 'HEAD'], true);
        return output.exitCode == 0;
    }

    public async trySubmoduleClean(): Promise<boolean> {
        let output = await this.execGit(['submodule', 'foreach', 'git', 'clean', '-ffdx'], true);
        return output.exitCode == 0;
    }

    public async trySubmoduleReset(): Promise<boolean> {
        let output = await this.execGit(['submodule', 'foreach', 'git', 'reset', '--hard', 'HEAD'], true);
        return output.exitCode == 0;
    }

    public static async createCommandManager(
        workingDirectory: string,
        lfs: boolean)
        : Promise<GitCommandManager> {

        let result = new GitCommandManager();
        await result.initializeCommandManager(workingDirectory, lfs);
        return result;
    }

    private async execGit(
        args: string[],
        allowAllExitCodes: boolean = false)
        : Promise<GitOutput> {

        fshelper.directoryExistsSync(this.workingDirectory, true);

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

    private getRandomIntInclusive(
        minimum: number,
        maximum: number)
        : number {

        minimum = Math.floor(minimum);
        maximum = Math.floor(maximum);
        return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
    }

    private async sleep(milliseconds): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }
}

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
