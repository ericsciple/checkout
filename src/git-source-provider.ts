import * as core from '@actions/core';
import * as coreCommand from '@actions/core/lib/command';
import * as fs from 'fs';
import * as fsHelper from './fs-helper';
import * as gitCommandManager from './git-command-manager';
import * as io from '@actions/io';
import * as path from 'path';

export async function getSource(
    runnerWorkspacePath: string,
    repositoryPath: string,
    repositoryOwner: string,
    repositoryName: string,
    sourceBranch: string,
    sourceVersion: string,
    clean: boolean,
    submodules: boolean,
    nestedSubmodules: boolean,
    fetchDepth: number,
    lfs: boolean,
    accessToken: string) {

    core.info(`Syncing repository: ${repositoryOwner}/${repositoryName}`);
    let repositoryUrl = `https://github.com/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}`;

    let git = await gitCommandManager.CreateCommandManager(runnerWorkspacePath, lfs);
    git.setWorkingDirectory(repositoryPath);

    // Repository exists
    if (fsHelper.existsSync(repositoryPath)) {

        let deleteRepository = false;

        // Fetch URL does not match
        if (!fsHelper.directoryExistsSync(path.join(repositoryPath, '.git')) ||
            repositoryUrl != await git.tryGetFetchUrl()) {

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
                    await io.rmRF(lockPath);
                }
                catch (error) {
                    core.debug(`Unable to delete '${lockPath}'. ${error.message}`);
                }
            }

            // Clean
            if (clean) {
                if (!(await git.tryClean())) {
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
                        if (!(await commands[i]())) {
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
            await io.rmRF(repositoryPath);
        }
    }

    io.mkdirP(repositoryPath);

    core.info(`Working directory is '${repositoryPath}'`);

    // Initialize the repository
    if (!fsHelper.directoryExistsSync(path.join(repositoryPath, '.git'))) {
        await git.init();
        await git.remoteAdd('origin', repositoryUrl);
    }

    // Disable automatic garbage collection
    if (!(await git.tryDisableAutomaticGarbageCollection())) {
        core.warning(`Unable to turn off git automatic garbage collection. The git fetch operation may trigger garbage collection and cause a delay.`);
    }

    // Remove possible previous extraheader
    let extraHeaderConfigKey = `http.${repositoryUrl}.extraheader`;
    await removeGitConfig(git, extraHeaderConfigKey);

    // Add extraheader (auth)
    let base64Credentials = Buffer.from(`x-access-token:${accessToken}`, 'utf8').toString('base64');
    core.setSecret(base64Credentials);
    await git.config(extraHeaderConfigKey, `AUTHORIZATION: basic ${base64Credentials}`);

    // LFS install
    if (lfs) {
        await git.lfsInstall();
    }

    // Refspec
    let refSpec = ['+refs/heads/*:refs/remotes/origin/*'];
    let upperSourceBranch = sourceBranch.toUpperCase();
    let isPullRequest = upperSourceBranch.startsWith('REFS/PULL/') || upperSourceBranch.startsWith('REFS/REMOTES/PULL/');
    if (isPullRequest) {
        refSpec.push(`+${sourceBranch}:${getRemoteRef(sourceBranch)}`);
    }

    // Fetch
    await git.fetch(fetchDepth, refSpec);

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
            await git.lfsFetch(checkoutRef);
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
        await git.checkout(checkoutRef);
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

    // Set intra-task state for cleanup
    coreCommand.issueCommand('save-state', {name: 'repositoryPath'}, repositoryPath);
    coreCommand.issueCommand('save-state', {name: 'configKey'}, extraHeaderConfigKey);
};

export async function cleanup() {
    // Repository path
    let repositoryPath = process.env['STATE_repositoryPath'];
    if (!repositoryPath) {
        throw new Error('Environment variable STATE_repositoryPath not set');
    }
    fsHelper.directoryExistsSync(repositoryPath, true);

    // Config key
    let configKey = process.env['STATE_configKey'];
    if (!configKey) {
        throw new Error('Environment variable STATE_configKey not set');
    }

    // Remove the config key
    let git = await gitCommandManager.CreateCommandManager(repositoryPath, false);
    await removeGitConfig(git, configKey);
}

function getRemoteRef(ref: string): string {
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

async function removeGitConfig(
    git: gitCommandManager.IGitCommandManager,
    configKey: string) {

    if (await git.configExists(configKey) &&
        !(await git.tryConfigUnset(configKey))) {

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
}
