import * as core from '@actions/core';
import * as coreCommand from '@actions/core/lib/command';
import * as fsHelper from './fs-helper';
import * as gitSourceProvider from './git-source-provider';
import * as github from '@actions/github'
import * as io from '@actions/io';
import * as path from 'path';

async function run() {
    try {
        // Runner workspace
        let runnerWorkspacePath = process.env['RUNNER_WORKSPACE'];
        if (!runnerWorkspacePath) {
            throw new Error('RUNNER_WORKSPACE not defined');
        }
        runnerWorkspacePath = path.resolve(runnerWorkspacePath);
        core.debug(`RUNNER_WORKSPACE = '${runnerWorkspacePath}'`);
        fsHelper.directoryExistsSync(runnerWorkspacePath, true);

        // Temp
        let tempPath = process.env['RUNNER_TEMP'];
        if (!tempPath) {
            throw new Error('RUNNER_TEMP not defined');
        }
        tempPath = path.resolve(tempPath);
        core.debug(`RUNNER_TEMP = '${tempPath}'`);
        fsHelper.directoryExistsSync(tempPath, true);

        // Qualified repository
        let qualifiedRepository = core.getInput('repository') || `${github.context.repo.owner}/${github.context.repo.repo}`;
        core.debug(`qualified repository = '${qualifiedRepository}'`);
        let splitRepository = qualifiedRepository.split('/');
        if (splitRepository.length != 2 || !splitRepository[0] || !splitRepository[1]) {
            throw new Error(`Invalid repository '${qualifiedRepository}'. Expected format {owner}/{repo}.`);
        }

        // Repository path
        let repositoryPath = core.getInput('path') || splitRepository[1];
        repositoryPath = path.resolve(runnerWorkspacePath, repositoryPath);
        if (!repositoryPath.startsWith(path.resolve(runnerWorkspacePath).replace(/\\/g, '/') + path.sep)) {
            throw new Error(`Repository path '${repositoryPath}' is not under '${runnerWorkspacePath}'`);
        }

        // Self repo?
        let isSelfRepository = qualifiedRepository.toUpperCase() == `${github.context.repo.owner}/${github.context.repo.repo}`.toUpperCase();
        if (isSelfRepository) {

            // Original repository path
            let originalRepositoryPath = process.env['GITHUB_WORKSPACE'];
            if (!originalRepositoryPath) {
                throw new Error('GITHUB_WORKSPACE not defined');
            }
            originalRepositoryPath = path.resolve(originalRepositoryPath);
            core.debug(`GITHUB_WORKSPACE = '${originalRepositoryPath}'`);
            fsHelper.directoryExistsSync(originalRepositoryPath, true);

            // Move the repo path
            if ((process.platform != 'win32' && repositoryPath != originalRepositoryPath) ||
                (process.platform == 'win32' && repositoryPath.toUpperCase() != originalRepositoryPath.toUpperCase())) {

                // Move the directory
                console.log(`Moving '${originalRepositoryPath}' to '${repositoryPath}'`);
                io.mv(originalRepositoryPath, repositoryPath, { force: true });

                // Update the context
                coreCommand.issueCommand('set-workspace', {}, repositoryPath);
            }
        }

        // Source branch, source version
        let sourceBranch: string;
        let sourceVersion: string;
        let ref = core.getInput('ref');
        if (!ref) {
            if (isSelfRepository) {
                sourceBranch = github.context.ref;
                sourceVersion = github.context.sha;
            }
            else {
                sourceBranch = 'master';
                sourceVersion = '';
            }
        }
        // SHA?
        else if (ref.match(/^[0-9a-fA-F]{40}$/)) {
            // If ref is a SHA and the repo is self, use github.ref as source branch since it might be refs/pull/*
            // sourceBranch = isSelfRepository ? github.context.ref : 'refs/heads/master';

            sourceBranch = '';
            sourceVersion = ref;
        }
        else {
            sourceBranch = ref;
            sourceVersion = '';
        }
        core.debug(`source branch = '${sourceBranch}'`);
        core.debug(`source version = '${sourceVersion}'`);

        // Clean
        let clean = true;
        if ((core.getInput('clean') || '').toUpperCase() == 'FALSE') {
            clean = false;
        }
        core.debug(`clean = ${clean}`);

        // Submodules
        let submodules = false;
        let recursiveSubmodules = false;
        let submodulesString = (core.getInput('submodules') || '').toUpperCase();
        if (submodulesString == 'RECURSIVE') {
            submodules = true;
            recursiveSubmodules = true;
        }
        else if (submodulesString == 'TRUE') {
            submodules = true;
        }
        core.debug(`submodules = ${submodules}`);
        core.debug(`recursive submodules = ${recursiveSubmodules}`);

        // Fetch depth
        let fetchDepth = Math.floor(Number(core.getInput('fetch-depth') || '1'));
        if (isNaN(fetchDepth) || fetchDepth < 0) {
            fetchDepth = 0;
        }
        core.debug(`fetch depth = ${fetchDepth}`);

        // LFS
        let lfs = false;
        if ((core.getInput('lfs') || '').toUpperCase() == 'TRUE') {
            lfs = true;
        }
        core.debug(`lfs = ${lfs}`);

        // Access token
        let accessToken = core.getInput('token');

        try {
            // Register problem matcher
            coreCommand.issueCommand('add-matcher', {}, path.join(__dirname, 'problem-matcher.json'));

            // Get sources
            await gitSourceProvider.getSource(
                runnerWorkspacePath,
                repositoryPath,
                splitRepository[0], // repo owner
                splitRepository[1], // repo name
                sourceBranch,
                sourceVersion,
                clean,
                submodules,
                recursiveSubmodules,
                fetchDepth,
                lfs,
                accessToken);
        }
        finally {
            // Unregister problem matcher
            coreCommand.issueCommand('remove-matcher', {owner: "checkout-git"}, '');
        }
    }
    catch (error) {
        core.setFailed(error.message);
    }
}
run();
