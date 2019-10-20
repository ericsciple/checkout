"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
function directoryExistsSync(path, required) {
    if (!path) {
        throw new Error("Arg 'path' must not be empty");
    }
    let stats;
    try {
        stats = fs.statSync(path);
    }
    catch (error) {
        if (error.code == 'ENOENT') {
            if (!required) {
                return false;
            }
            throw new Error(`Directory '${path}' does not exist`);
        }
        throw new Error(`Encountered an error when checking whether path '${path}' exists: ${error.message}`);
    }
    if (stats.isDirectory()) {
        return true;
    }
    else if (!required) {
        return false;
    }
    throw new Error(`Directory '${path}' does not exist`);
}
exports.directoryExistsSync = directoryExistsSync;
function existsSync(path) {
    if (!path) {
        throw new Error("Arg 'path' must not be empty");
    }
    let stats;
    try {
        stats = fs.statSync(path);
    }
    catch (error) {
        if (error.code == 'ENOENT') {
            return false;
        }
        throw new Error(`Encountered an error when checking whether path '${path}' exists: ${error.message}`);
    }
    return true;
}
exports.existsSync = existsSync;
function fileExistsSync(path) {
    if (!path) {
        throw new Error("Arg 'path' must not be empty");
    }
    let stats;
    try {
        stats = fs.statSync(path);
    }
    catch (error) {
        if (error.code == 'ENOENT') {
            return false;
        }
        throw new Error(`Encountered an error when checking whether path '${path}' exists: ${error.message}`);
    }
    if (!stats.isDirectory()) {
        return true;
    }
    return false;
}
exports.fileExistsSync = fileExistsSync;
