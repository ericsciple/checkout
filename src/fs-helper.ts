import * as fs from 'fs';

export function directoryExistsSync(path: string, required?: boolean): boolean {
    if (!path) {
        throw new Error("Arg 'path' must not be empty");
    }

    let stats: fs.Stats;
    try {
        stats = fs.statSync(path);
    }
    catch (error) {
        if (error.code == 'ENOENT') {
            if (required) {
                throw new Error(`Directory '${path}' does not exist`);
            }

            return false;
        }
        else {
            throw new Error(`Encountered an error when checking whether directory '${path}' exists: ${error.message}`);
        }
    }

    if (!stats.isDirectory()) {
        throw new Error(`Directory '${path}' does not exist`);
    }

    return true;
}


export function existsSync(path: string): boolean {
    if (!path) {
        throw new Error("Arg 'path' must not be empty");
    }

    let stats: fs.Stats;
    try {
        stats = fs.statSync(path);
    }
    catch (error) {
        if (error.code == 'ENOENT') {
            return false;
        }
        else {
            throw new Error(`Encountered an error when checking whether path '${path}' exists: ${error.message}`);
        }
    }

    return true;
}