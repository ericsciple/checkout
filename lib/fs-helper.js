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
exports.directoryExistsSync = directoryExistsSync;
