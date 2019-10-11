"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = __importDefault(require("@actions/core"));
const fs_1 = __importDefault(require("fs"));
const github_1 = __importDefault(require("@actions/github"));
const io_1 = __importDefault(require("@actions/io"));
const path_1 = __importDefault(require("path"));
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
runnerWorkspacePath = path_1.default.resolve(runnerWorkspacePath);
core_1.default.debug(`RUNNER_WORKSPACE = '${runnerWorkspacePath}'`);
fs_1.default.statSync(runnerWorkspacePath);
// Temp
let tempPath = process.env['RUNNER_TEMP'];
if (!tempPath) {
    throw new Error('RUNNER_TEMP not defined');
}
tempPath = path_1.default.resolve(tempPath);
core_1.default.debug(`RUNNER_TEMP = '${tempPath}'`);
fs_1.default.statSync(tempPath);
// Qualified repository
let qualifiedRepository = core_1.default.getInput('repository') || `${github_1.default.context.repo.owner}/${github_1.default.context.repo.repo}`;
core_1.default.debug(`qualified repository = '${qualifiedRepository}'`);
let splitRepository = qualifiedRepository.split('/');
if (splitRepository.length != 2 || !splitRepository[0] || !splitRepository[1]) {
    throw new Error(`Invalid repository '${qualifiedRepository}'. Expected format {owner}/{repo}.`);
}
// Repository path
let repositoryPath = core_1.default.getInput('path') || splitRepository[1];
repositoryPath = path_1.default.resolve(runnerWorkspacePath, repositoryPath);
if (!repositoryPath.startsWith(path_1.default.resolve(runnerWorkspacePath).replace(/\\/g, '/') + path_1.default.sep)) {
    throw new Error(`Repository path '${repositoryPath}' is not under '${runnerWorkspacePath}'`);
}
// Self repo?
let isSelfRepository = qualifiedRepository.toUpperCase() == `${github_1.default.context.repo.owner}/${github_1.default.context.repo.repo}`.toUpperCase();
if (isSelfRepository) {
    // Original repository path
    let originalRepositoryPath = process.env['GITHUB_WORKSPACE'];
    if (!originalRepositoryPath) {
        throw new Error('GITHUB_WORKSPACE not defined');
    }
    originalRepositoryPath = path_1.default.resolve(originalRepositoryPath);
    core_1.default.debug(`GITHUB_WORKSPACE = '${originalRepositoryPath}'`);
    fs_1.default.statSync(originalRepositoryPath);
    // Move the repo path
    if ((process.platform != 'win32' && repositoryPath != originalRepositoryPath) ||
        (process.platform == 'win32' && repositoryPath.toUpperCase() != originalRepositoryPath.toUpperCase())) {
        // Move the directory
        console.log(`Moving '${originalRepositoryPath}' to '${repositoryPath}'`);
        io_1.default.mv(originalRepositoryPath, repositoryPath, { force: true });
        // Update the context
        // todo: set-workspace
    }
}
// Source branch, source version
let sourceBranch;
let sourceVersion;
let ref = core_1.default.getInput('ref');
if (!ref) {
    sourceBranch = github_1.default.context.ref;
    sourceVersion = github_1.default.context.sha;
}
// SHA?
else if (ref.match(/^[0-9a-fA-F]{40}$/)) {
    // If ref is a SHA and the repo is self, use github.ref as source branch since it might be refs/pull/*
    sourceBranch = isSelfRepository ? github_1.default.context.ref : 'refs/heads/master';
    sourceVersion = ref;
}
else {
    sourceBranch = ref;
    sourceVersion = '';
}
core_1.default.debug(`source branch = '${sourceBranch}'`);
core_1.default.debug(`source version = '${sourceVersion}'`);
// Clean
let clean = true;
if ((core_1.default.getInput('clean') || '').toUpperCase() == 'FALSE') {
    clean = false;
}
// Submodules
let submodules = core_1.default.getInput('submodules');
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
