"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const http = require("http");
const https = require("https");
const fs = require("fs");
var LogLevel;
(function (LogLevel) {
    /** No logging to the console, not even errors */
    LogLevel[LogLevel["SILENT"] = 0] = "SILENT";
    /** Only fatal or state corrupting errors */
    LogLevel[LogLevel["ERROR"] = 1] = "ERROR";
    /** Non-fatal warnings */
    LogLevel[LogLevel["WARNING"] = 2] = "WARNING";
    /** Status info, this is the default logging level */
    LogLevel[LogLevel["INFO"] = 3] = "INFO";
    /** More verbose status info */
    LogLevel[LogLevel["VERBOSE"] = 4] = "VERBOSE";
    /** Debug information that won't be useful to most people */
    LogLevel[LogLevel["DEBUG"] = 5] = "DEBUG";
    /** Debug information plus the entire packet log. This is very very verbose. */
    LogLevel[LogLevel["TRACE"] = 6] = "TRACE";
})(LogLevel = exports.LogLevel || (exports.LogLevel = {}));
let logLevel = LogLevel.INFO;
function setLogLevel(level) {
    "use strict";
    logLevel = level;
}
exports.setLogLevel = setLogLevel;
// Like "log" but respects different levels
function logWithLevel(level, msg, fileRoot, consoleFormatter) {
    "use strict";
    if (logLevel >= level) {
        log(msg, fileRoot, consoleFormatter);
    }
}
exports.logWithLevel = logWithLevel;
// Helper logging function that timestamps each message and optionally outputs to a file as well
function log(msg, fileRoot, consoleFormatter) {
    "use strict";
    assert.notStrictEqual(msg, undefined, "Trying to print undefined.  This usually indicates a bug upstream from the log function.");
    // Pads single digit number with a leading zero, simple helper function for log2
    // tslint:disable-next-line:no-magic-numbers
    function toStr(n) { return n < 10 ? "0" + n.toString() : "" + n.toString(); }
    const d = new Date();
    let taggedMsg = "[" + (toStr(d.getMonth() + 1)) + "/" + (toStr(d.getDate())) + "/" + (d.getFullYear().toString()) + " - " + (toStr(d.getHours())) + ":" + (toStr(d.getMinutes())) + ":" + (toStr(d.getSeconds())) /* + "." + (d.getMilliseconds().toString())*/;
    if (fileRoot !== undefined) {
        taggedMsg += (", " + fileRoot.toUpperCase() + "] " + msg);
    }
    else {
        taggedMsg += ("] " + msg);
    }
    // Explicitly passing null, not undefined, as the consoleFormatter
    // means to skip the console output completely
    // tslint:disable-next-line:no-null-keyword
    if (consoleFormatter !== null) {
        if (consoleFormatter !== undefined) {
            console.log(consoleFormatter(taggedMsg));
        }
        else {
            console.log(taggedMsg);
        }
    }
    if (fileRoot !== undefined) {
        const fd = fs.openSync(fileRoot + ".txt", "a");
        fs.writeSync(fd, taggedMsg + "\r\n");
        fs.closeSync(fd);
    }
}
exports.log = log;
// Takes a string, detects if it was URI encoded,
// and returns the decoded version
function decodeIfNeeded(str) {
    if (typeof str === "string" && str.indexOf("%") !== -1) {
        try {
            const decoded = decodeURIComponent(str);
            if (decoded === str) {
                // Apparently it wasn't actually encoded
                // So just return it
                return str;
            }
            else {
                // If it was fully URI encoded, then re-encoding
                // the decoded should return the original
                const encoded = encodeURIComponent(decoded);
                if (encoded === str) {
                    // Yep, it was fully encoded
                    return decoded;
                }
                else {
                    // It wasn't fully encoded, maybe it wasn't
                    // encoded at all. Be safe and return the
                    // original
                    logWithLevel(LogLevel.DEBUG, `[UTILS] decodeIfNeeded detected partially encoded string? '${str}'`);
                    return str;
                }
            }
        }
        catch (e) {
            logWithLevel(LogLevel.DEBUG, `[UTILS] decodeIfNeeded exception decoding '${str}'`);
            return str;
        }
    }
    else {
        return str;
    }
}
exports.decodeIfNeeded = decodeIfNeeded;
// Deprecated. This function is no longer used and may be removed from
// future versions of MFCAuto. For mixin patterns, please move to the
// new TypeScript 2.2+ syntax as described here:
//   https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-2.html
function applyMixins(derivedCtor, baseCtors) {
    "use strict";
    baseCtors.forEach(baseCtor => {
        Object.getOwnPropertyNames(baseCtor.prototype).forEach(name => {
            // tslint:disable-next-line:no-unsafe-any
            derivedCtor.prototype[name] = baseCtor.prototype[name];
        });
    });
}
exports.applyMixins = applyMixins;
// Simple promisified httpGet helper that helps us use
// async/await and have cleaner code elsewhere
function httpGet(url) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            http.get(url, (res) => {
                let contents = "";
                res.on("data", (chunk) => {
                    contents += chunk;
                });
                res.on("end", () => {
                    resolve(contents);
                });
            }).on("error", (e) => {
                reject(e);
            });
        });
    });
}
exports.httpGet = httpGet;
// Simple promisified httpsGet helper that helps us use
// async/await and have cleaner code elsewhere
function httpsGet(url) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            https.get(url, (res) => {
                let contents = "";
                res.on("data", (chunk) => {
                    contents += chunk;
                });
                res.on("end", () => {
                    resolve(contents);
                });
            }).on("error", (e) => {
                reject(e);
            });
        });
    });
}
exports.httpsGet = httpsGet;
//# sourceMappingURL=Utils.js.map