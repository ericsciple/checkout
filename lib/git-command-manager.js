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
const exec = __importStar(require("@actions/exec"));
const fshelper = __importStar(require("./fs-helper"));
const io = __importStar(require("@actions/io"));
const path = __importStar(require("path"));
function CreateCommandManager(workingDirectory, lfs) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield GitCommandManager.createCommandManager(workingDirectory, lfs);
    });
}
exports.CreateCommandManager = CreateCommandManager;
class GitCommandManager {
    // Private constructor; use createCommandManager()
    constructor() {
        this.gitEnv = {
            "GIT_TERMINAL_PROMPT": "0",
            "GCM_INTERACTIVE": "Never" // Disable prompting for git credential manager
        };
        this.gitPath = '';
        this.lfs = false;
        this.workingDirectory = '';
    }
    branchExists(remote, pattern) {
        return __awaiter(this, void 0, void 0, function* () {
            let args = ['branch', '--list'];
            if (remote) {
                args.push('--remote');
            }
            args.push(pattern);
            let output = yield this.execGit(args);
            return !!output.stdout.trim();
        });
    }
    checkout(ref, startPoint) {
        return __awaiter(this, void 0, void 0, function* () {
            let args = ['checkout', '--progress', '--force'];
            if (startPoint) {
                args.push('-B', ref, startPoint);
            }
            else {
                args.push(ref);
            }
            yield this.execGit(args);
        });
    }
    config(configKey, configValue) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.execGit(['config', configKey, configValue]);
        });
    }
    configExists(configKey) {
        return __awaiter(this, void 0, void 0, function* () {
            let pattern = configKey.replace(/[^a-zA-Z0-9_]/g, (x) => { return `\\${x}`; });
            let output = yield this.execGit(['config', '--name-only', '--get-regexp', pattern], true);
            return output.exitCode == 0;
        });
    }
    fetch(fetchDepth, refSpec) {
        return __awaiter(this, void 0, void 0, function* () {
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
                let output = yield this.execGit(args, allowAllExitCodes);
                if (output.exitCode == 0) {
                    break;
                }
                let seconds = this.getRandomIntInclusive(1, 10);
                core.warning(`Git fetch failed with exit code ${output.exitCode}. Waiting ${seconds} seconds before trying again.`);
                yield this.sleep(seconds * 1000);
                attempt++;
            }
        });
    }
    getWorkingDirectory() {
        return this.workingDirectory;
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.execGit(['init', this.workingDirectory]);
        });
    }
    lfsFetch(ref) {
        return __awaiter(this, void 0, void 0, function* () {
            let args = ['lfs', 'fetch', 'origin', ref];
            let attempt = 1;
            while (true) {
                let allowAllExitCodes = attempt < 3;
                let output = yield this.execGit(args, allowAllExitCodes);
                if (output.exitCode == 0) {
                    break;
                }
                let seconds = this.getRandomIntInclusive(1, 10);
                core.warning(`Git lfs fetch failed with exit code ${output.exitCode}. Waiting ${seconds} seconds before trying again.`);
                yield this.sleep(seconds * 1000);
                attempt++;
            }
        });
    }
    lfsInstall() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.execGit(['lfs', 'install', '--local']);
        });
    }
    log1() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.execGit(['log', '-1']);
        });
    }
    remoteAdd(remoteName, remoteUrl) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.execGit(['remote', 'add', remoteName, remoteUrl]);
        });
    }
    // public setWorkingDirectory(path: string) {
    //     this.workingDirectory = path;
    // }
    submoduleSync(recursive) {
        return __awaiter(this, void 0, void 0, function* () {
            let args = ['submodule', 'sync'];
            if (recursive) {
                args.push('--recursive');
            }
            yield this.execGit(args);
        });
    }
    submoduleUpdate(fetchDepth, recursive) {
        return __awaiter(this, void 0, void 0, function* () {
            let args = ['-c', 'protocol.version=2', 'submodule', 'update', '--init', '--force'];
            if (fetchDepth > 0) {
                args.push(`--depth=${fetchDepth}`);
            }
            if (recursive) {
                args.push('--recursive');
            }
            yield this.execGit(args);
        });
    }
    tagExists(pattern) {
        return __awaiter(this, void 0, void 0, function* () {
            let output = yield this.execGit(['tag', '--list', pattern]);
            return !!output.stdout.trim();
        });
    }
    tryClean() {
        return __awaiter(this, void 0, void 0, function* () {
            let output = yield this.execGit(['clean', '-ffdx'], true);
            return output.exitCode == 0;
        });
    }
    tryConfigUnset(configKey) {
        return __awaiter(this, void 0, void 0, function* () {
            let output = yield this.execGit(['config', '--unset-all', configKey], true);
            return output.exitCode == 0;
        });
    }
    tryDisableAutomaticGarbageCollection() {
        return __awaiter(this, void 0, void 0, function* () {
            let output = yield this.execGit(['config', 'gc.auto', '0'], true);
            return output.exitCode == 0;
        });
    }
    tryGetFetchUrl() {
        return __awaiter(this, void 0, void 0, function* () {
            let output = yield this.execGit(['config', '--get', 'remote.origin.url'], true);
            if (output.exitCode != 0) {
                return '';
            }
            let stdout = output.stdout.trim();
            if (stdout.indexOf('\n') >= 0) {
                return '';
            }
            return stdout;
        });
    }
    tryReset() {
        return __awaiter(this, void 0, void 0, function* () {
            let output = yield this.execGit(['reset', '--hard', 'HEAD'], true);
            return output.exitCode == 0;
        });
    }
    trySubmoduleClean() {
        return __awaiter(this, void 0, void 0, function* () {
            let output = yield this.execGit(['submodule', 'foreach', 'git', 'clean', '-ffdx'], true);
            return output.exitCode == 0;
        });
    }
    trySubmoduleReset() {
        return __awaiter(this, void 0, void 0, function* () {
            let output = yield this.execGit(['submodule', 'foreach', 'git', 'reset', '--hard', 'HEAD'], true);
            return output.exitCode == 0;
        });
    }
    static createCommandManager(workingDirectory, lfs) {
        return __awaiter(this, void 0, void 0, function* () {
            let result = new GitCommandManager();
            yield result.initializeCommandManager(workingDirectory, lfs);
            return result;
        });
    }
    execGit(args, allowAllExitCodes = false) {
        return __awaiter(this, void 0, void 0, function* () {
            fshelper.directoryExistsSync(this.workingDirectory, true);
            let result = new GitOutput();
            let env = {};
            Object.keys(process.env).forEach(x => env[x] = process.env[x]);
            Object.keys(this.gitEnv).forEach(x => env[x] = this.gitEnv[x]);
            let stdout = [];
            let options = {
                cwd: this.workingDirectory,
                env: env,
                ignoreReturnCode: allowAllExitCodes,
                listeners: {
                    stdout: (data) => {
                        stdout.push(data.toString());
                    }
                }
            };
            result.exitCode = yield exec.exec(this.gitPath, args, options);
            result.stdout = stdout.join('');
            return result;
        });
    }
    initializeCommandManager(workingDirectory, lfs) {
        return __awaiter(this, void 0, void 0, function* () {
            this.workingDirectory = workingDirectory;
            // this.setWorkingDirectory(workingDirectory);
            // Git-lfs will try to pull down assets if any of the local/user/system setting exist.
            // If the user didn't enable `LFS` in their pipeline definition, disable LFS fetch/checkout.
            this.lfs = lfs;
            if (!this.lfs) {
                this.gitEnv["GIT_LFS_SKIP_SMUDGE"] = "1";
            }
            this.gitPath = yield io.which('git', true);
            // Git version
            core.debug("Getting git version");
            let gitVersion = new Version();
            let gitOutput = yield this.execGit(["version"]);
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
                let gitLfsPath = yield io.which("git-lfs", true);
                gitOutput = yield this.execGit(["lfs", "version"]);
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
        });
    }
    getRandomIntInclusive(minimum, maximum) {
        minimum = Math.floor(minimum);
        maximum = Math.floor(maximum);
        return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
    }
    sleep(milliseconds) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise(resolve => setTimeout(resolve, milliseconds));
        });
    }
}
class GitOutput {
    constructor() {
        this.stdout = '';
        this.exitCode = 0;
    }
}
class Version {
    constructor(version) {
        this.isSet = false;
        this.major = 0;
        this.minor = 0;
        this.patch = 0;
        this.isPatchSet = false;
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
    checkMinimum(minimum) {
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
    toString() {
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
