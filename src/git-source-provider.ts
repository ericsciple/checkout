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
    ref: string,
    commit: string,
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
                    let commands = [() => git.tryReset];
                    if (submodules) {
                        commands.push(() => git.trySubmoduleClean);
                        commands.push(() => git.trySubmoduleReset);
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

    // Fetch
    let refSpec = getRefSpec(ref, commit);
    await git.fetch(fetchDepth, refSpec);

    // Checkout info
    let checkoutInfo = await getCheckoutInfo(git, ref, commit);

    // LFS fetch
    // Explicit lfs-fetch to avoid slow checkout (fetches one lfs object at a time).
    // Explicit lfs fetch will fetch lfs objects in parallel.
    if (lfs) {
        await git.lfsFetch(checkoutInfo.startPoint || checkoutInfo.ref);
        // try {
        //     await git.lfsFetch(checkoutInfo.startPoint || checkoutInfo.ref);
        // }
        // catch (err) {
        //     if (fetchDepth > 0) {
        //         core.warning(`Git LFS fetch failed on the shallow repository. This may happen when the retrieved commits (fetch depth ${fetchDepth}) for the branch does not include the target commit '${checkoutRef}'.`);
        //     }

        //     throw err;
        // }
    }

    // Checkout
    await git.checkout(checkoutInfo.ref, checkoutInfo.startPoint);
    // try {
    //     await git.checkout(checkoutInfo.ref, checkoutInfo.startPoint);
    // }
    // catch (err) {
    //     if (fetchDepth > 0) {
    //         core.warning(`Git checkout failed on the shallow repository. This may happen when the retrieved commits (fetch depth ${fetchDepth}) for the branch does not include the target commit '${checkoutRef}'.`);
    //     }

    //     throw err;
    // }

    // Submodules
    if (submodules) {
        git.submoduleSync(nestedSubmodules);
        git.submoduleUpdate(fetchDepth, nestedSubmodules);
    }

    // Set intra-task state for cleanup
    coreCommand.issueCommand('save-state', { name: 'repositoryPath' }, repositoryPath);
    coreCommand.issueCommand('save-state', { name: 'configKey' }, extraHeaderConfigKey);
};

export async function cleanup() {
    // Repository path
    let repositoryPath = process.env['STATE_repositoryPath'];
    if (!repositoryPath) {
        throw new Error('Environment variable STATE_repositoryPath not set');
    }
    if (!fsHelper.fileExistsSync(path.join(repositoryPath, '.git', 'config'))) {
        return;
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

function getRefSpec(
    ref: string,
    commit: string)
    : string[] {

    if (!ref && !commit) {
        throw new Error('Args ref and commit cannot both be empty');
    }

    let upperRef = (ref || '').toUpperCase();

    // SHA
    if (commit) {
        // refs/heads
        if (upperRef.startsWith('REFS/HEADS/')) {
            let branch = ref.substring('refs/heads/'.length);
            return [`+${commit}:refs/remotes/origin/${branch}`];
        }
        // refs/pull/
        else if (upperRef.startsWith('REFS/PULL/')) {
            let branch = ref.substring('refs/pull/'.length);
            return [`+${commit}:refs/remotes/pull/${branch}`];
        }
        // refs/tags/
        else if (upperRef.startsWith('REFS/TAGS/')) {
            return [`+${commit}:${ref}`];
        }
        // Otherwise no destination ref
        else {
            return [commit];
        }
    }
    // Unqualified ref, check for a matching branch or tag
    else if (!upperRef.startsWith('REFS/')) {
        return [`+refs/heads/${ref}*:refs/remotes/origin/${ref}*`, `+refs/tags/${ref}*:refs/tags/${ref}*`];
    }
    // refs/heads/
    else if (upperRef.startsWith('REFS/HEADS/')) {
        let branch = ref.substring('refs/heads/'.length);
        return [`+${ref}:refs/remotes/origin/${branch}`];
    }
    // refs/pull/
    else if (upperRef.startsWith('REFS/PULL/')) {
        let branch = ref.substring('refs/pull/'.length);
        return [`+${ref}:refs/remotes/pull/${branch}`];
    }
    // refs/tags/
    else {
        return [`+${ref}:${ref}`]
    }
}

async function getCheckoutInfo(
    git: gitCommandManager.IGitCommandManager,
    ref: string,
    commit: string)
    : Promise<ICheckoutInfo> {

    if (!ref && !commit) {
        throw new Error('Args ref and commit cannot both be empty');
    }

    let result = {} as ICheckoutInfo;
    let upperRef = (ref || '').toUpperCase();

    // SHA
    if (!ref) {
        result.ref = commit;
    }
    // refs/heads/
    if (upperRef.startsWith('REFS/HEADS/')) {
        let branch = ref.substring('refs/heads/'.length);
        result.ref = branch;
        result.startPoint = `refs/remotes/origin/${branch}`;
    }
    // refs/pull/
    else if (upperRef.startsWith('REFS/PULL/')) {
        let branch = ref.substring('refs/pull/'.length);
        result.ref = `refs/remotes/pull/${branch}`;
    }
    // refs/tags/
    else if (upperRef.startsWith('REFS/')) {
        result.ref = ref;
    }
    // Unqualified ref, check for a matching branch or tag
    else {
        if (await git.branchExists(true, `origin/${ref}`)) {
            result.ref = ref;
            result.startPoint = `refs/remotes/origin/${ref}`;
        }
        else if (await git.tagExists(`refs/tags/${ref}`)) {
            result.ref = `refs/tags/${ref}`;
        }
        else {
            throw new Error(`A branch or tag with the name '${ref}' could not be found`);
        }
    }

    return result;
}

// function getRefSpec(
//     ref: string,
//     commit: string)
//     : string[] {

//     if (!ref && !commit) {
//         throw new Error('Args ref and commit cannot both be empty');
//     }

//     // If no ref, fetch all branches and tags. Fetching a specific commit is not reliable.
//     // GitHub does not allow fetching a specific commit unless the commit is the tip of a branch.
//     if (!ref) {
//         return [`+refs/heads/*:refs/remotes/origin/*`, `+refs/tags/*:refs/tags/*`];
//     }

//     // Unqualified ref, check for a matching branch or tag
//     let upperRef = ref.toUpperCase();
//     if (!upperRef.startsWith('REFS/')) {
//         return [`+refs/heads/${ref}*:refs/remotes/origin/${ref}*`, `+refs/tags/${ref}*:refs/tags/${ref}*`];
//     }
//     // refs/heads/
//     else if (upperRef.startsWith('REFS/HEADS/')) {
//         return [`+${ref}:refs/remotes/origin/${ref.substring('refs/heads/'.length)}`];
//     }
//     // refs/pull/
//     else if (upperRef.startsWith('REFS/PULL/')) {
//         return [`+${ref}:refs/remotes/pull/${ref.substring('refs/pull/'.length)}`];
//     }
//     // refs/tags/
//     else {
//         return [`+${ref}:${ref}`];
//     }
// }

// async function getCheckoutInfo(
//     git: gitCommandManager.IGitCommandManager,
//     ref: string,
//     commit: string)
//     : Promise<ICheckoutInfo> {

//     if (!ref && !commit) {
//         throw new Error('Args ref and commit cannot both be empty');
//     }

//     let result = {} as ICheckoutInfo;

//     if (commit) {
//         result.commit = commit;
//     }

//     // When the ref is unqualified, check for a matching branch
//     let upperRef = ref.toUpperCase();
//     if (!upperRef.startsWith('REFS/')) {

//         if (await git.branchExists(true, `origin/${ref}`)) {
//             result.ref = ref;
//             result.upstream = `origin/${ref}`;
//         }
//         else if (!commit) {
//             result.ref = `${ref}`;
//         }
//     }
//     // refs/heads/
//     else if (upperRef.startsWith('REFS/HEADS/')) {
//         let branch = ref.substring('refs/heads/'.length);
//         result.ref = branch;
//         result.upstream = `origin/${branch}`;
//     }
//     // Manually supplied refs/pull/ (no commit info)
//     else if (!commit && upperRef.startsWith('REFS/PULL/')) {
//         result.ref = `refs/remotes/pull/${ref.substring('refs/pull'.length)}`;
//     }
//     // Manually supplied refs/tags/ (no commit info)
//     else if (!commit) {
//         result.ref = ref;
//     }

//     return result;
// }

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

interface ICheckoutInfo {
    ref: string;
    startPoint: string;
}
