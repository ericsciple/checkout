import * as core from '@actions/core';
import * as gitSourceProvider from './git-source-provider';

async function run() {
    try {
        // Cleanup
        await gitSourceProvider.cleanup();
    }
    catch (error) {
        core.setFailed(error.message);
    }
}
run();
