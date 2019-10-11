import core from '@actions/core';
import exec from '@actions/exec'
import fs from 'fs';
import github from '@actions/github'
import io from '@actions/io';
import path from 'path';

// Object.keys(process.env).sort().forEach(
//     key => {
//         console.log(`${key}=${process.env[key]}`);
//     });
// console.log(`pwd=${process.cwd()}`);

// Runner workspace
let runnerWorkspacePath = process.env['RUNNER_WORKSPACE'];
if (!runnerWorkspacePath) {
    throw new Error('RUNNER_WORKSPACE not defined');
}
runnerWorkspacePath = path.resolve(runnerWorkspacePath);
core.debug(`RUNNER_WORKSPACE = '${runnerWorkspacePath}'`);
fs.statSync(runnerWorkspacePath);

// Temp
let tempPath = process.env['RUNNER_TEMP'];
if (!tempPath) {
    throw new Error('RUNNER_TEMP not defined');
}
tempPath = path.resolve(tempPath);
core.debug(`RUNNER_TEMP = '${tempPath}'`);
fs.statSync(tempPath);

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
    fs.statSync(originalRepositoryPath);

    // Move the repo path
    if ((process.platform != 'win32' && repositoryPath != originalRepositoryPath) ||
        (process.platform == 'win32' && repositoryPath.toUpperCase() != originalRepositoryPath.toUpperCase())) {

        // Move the directory
        console.log(`Moving '${originalRepositoryPath}' to '${repositoryPath}'`);
        io.mv(originalRepositoryPath, repositoryPath, { force: true });

        // Update the context
        // todo: set-workspace
    }
}

// Source branch, source version
let sourceBranch: string;
let sourceVersion: string;
let ref = core.getInput('ref');
if (!ref) {
    sourceBranch = github.context.ref;
    sourceVersion = github.context.sha;
}
// SHA?
else if (ref.match(/^[0-9a-fA-F]{40}$/)) {
    // If ref is a SHA and the repo is self, use github.ref as source branch since it might be refs/pull/*
    sourceBranch = isSelfRepository ? github.context.ref : 'refs/heads/master';

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

// Submodules
let submodules = core.getInput('submodules');

// Fetch depth
// todo

/**
            bool clean = StringUtil.ConvertToBoolean(executionContext.GetInput(Pipelines.PipelineConstants.CheckoutTaskInputs.Clean), true);
            string submoduleInput = executionContext.GetInput(Pipelines.PipelineConstants.CheckoutTaskInputs.Submodules);

            int fetchDepth = 0;
            if (!int.TryParse(executionContext.GetInput("fetch-depth"), out fetchDepth) || fetchDepth < 0)
            {
                fetchDepth = 0;
            }

            bool gitLfsSupport = StringUtil.ConvertToBoolean(executionContext.GetInput(Pipelines.PipelineConstants.CheckoutTaskInputs.Lfs));
            string accessToken = executionContext.GetInput(Pipelines.PipelineConstants.CheckoutTaskInputs.Token);
            if (string.IsNullOrEmpty(accessToken))
            {
                accessToken = executionContext.GetGitHubContext("token");
            }

            // register problem matcher
            string matcherFile = Path.Combine(tempDirectory, $"git_{Guid.NewGuid()}.json");
            File.WriteAllText(matcherFile, GitHubSourceProvider.ProblemMatcher, new UTF8Encoding(false));
            executionContext.Output($"##[add-matcher]{matcherFile}");
            try
            {
                await new GitHubSourceProvider().GetSourceAsync(executionContext,
                                                                expectRepoPath,
                                                                repoFullName,
                                                                sourceBranch,
                                                                sourceVersion,
                                                                clean,
                                                                submoduleInput,
                                                                fetchDepth,
                                                                gitLfsSupport,
                                                                accessToken,
                                                                token);
            }
            finally
            {
                executionContext.Output("##[remove-matcher owner=checkout-git]");
            }

 */
