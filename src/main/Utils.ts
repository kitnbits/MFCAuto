import * as assert from "assert";
import * as http from "http";
import * as https from "https";
import * as fs from "fs";

export enum LogLevel {
    /** No logging to the console, not even errors */
    SILENT,
    /** Only fatal or state corrupting errors */
    ERROR,
    /** Non-fatal warnings */
    WARNING,
    /** Status info, this is the default logging level */
    INFO,
    /** More verbose status info */
    VERBOSE,
    /** Debug information that won't be useful to most people */
    DEBUG,
    /** Debug information plus the entire packet log. This is very very verbose. */
    TRACE,
}

let logLevel = LogLevel.INFO;
let defaultLogFileName: string | undefined;
let defaultConsoleFormatter: ((msg: string) => string) | null | undefined;

/**
 * Sets default logging options
 * @param level Maximum LogLevel for which to log
 * @param logFileName Default file to log to
 * @param consoleFormatter Default formatter, usually you should leave this alone except
 * to possibly specify 'null' to turn off all console logging while leaving a fileRoot
 * to log only to a file instead
 */
export function setLogLevel(level: LogLevel, logFileName?: string, consoleFormatter?: ((msg: string) => string) | null) {
    "use strict";
    logLevel = level;
    defaultLogFileName = logFileName;
    defaultConsoleFormatter = consoleFormatter;
}

export function logWithLevelInternal(level: LogLevel, msg: string | (() => string), logFileName?: string, consoleFormatter?: ((msg: string) => string) | null): void {
    if (logFileName === undefined) {
        logFileName = defaultLogFileName;
    }
    if (consoleFormatter === undefined) {
        consoleFormatter = defaultConsoleFormatter;
    }
    logWithLevel(level, msg, logFileName, consoleFormatter);
}

export function logInternal(msg: string | (() => string), logFileName?: string, consoleFormatter?: ((msg: string) => string) | null): void {
    if (logFileName === undefined) {
        logFileName = defaultLogFileName;
    }
    if (consoleFormatter === undefined) {
        consoleFormatter = defaultConsoleFormatter;
    }
    log(msg, logFileName, consoleFormatter);
}

// Like "log" but respects different levels
export function logWithLevel(level: LogLevel, msg: string | (() => string), logFileName?: string, consoleFormatter?: ((msg: string) => string) | null): void {
    "use strict";
    if (logLevel >= level) {
        log(msg, logFileName, consoleFormatter);
    }
}

// Pads single digit number with a leading zero, simple helper function
function toStr(n: number): string {
    // tslint:disable-next-line:no-magic-numbers
    return n < 10 ? "0" + n.toString() : "" + n.toString();
}

function getDateTimeString(): string {
    const d = new Date();
    return (d.getFullYear().toString()) + "/" + (toStr(d.getMonth() + 1)) + "/" + (toStr(d.getDate())) + " - " + (toStr(d.getHours())) + ":" + (toStr(d.getMinutes())) + ":" + (toStr(d.getSeconds()));
}

// Helper logging function that timestamps each message and optionally outputs to a file as well
export function log(msg: string | (() => string), logFileName?: string, consoleFormatter?: ((msg: string) => string) | null): void {
    "use strict";
    assert.notStrictEqual(msg, undefined, "Trying to print undefined.  This usually indicates a bug upstream from the log function.");
    if (msg instanceof Function) {
        msg = msg();
    }

    const taggedMsg = `[${getDateTimeString()}${(logFileName !== undefined ? `, ${logFileName.toUpperCase()}` : "")}] ${msg}`;

    // Explicitly passing null, not undefined, as the consoleFormatter
    // means to skip the console output completely
    // tslint:disable-next-line:no-null-keyword
    if (consoleFormatter !== null) {
        if (consoleFormatter !== undefined) {
            console.log(consoleFormatter(taggedMsg));
        } else {
            console.log(taggedMsg);
        }
    }

    if (logFileName !== undefined) {
        const fd = fs.openSync(logFileName, "a");
        fs.writeSync(fd, taggedMsg + "\r\n");
        fs.closeSync(fd);
    }
}

// Takes a string, detects if it was URI encoded,
// and returns the decoded version
export function decodeIfNeeded(str: string): string {
    if (typeof str === "string" && str.indexOf("%") !== -1) {
        try {
            const decoded = decodeURIComponent(str);
            if (decoded === str) {
                // Apparently it wasn't actually encoded
                // So just return it
                return str;
            } else {
                // If it was fully URI encoded, then re-encoding
                // the decoded should return the original
                const encoded = encodeURIComponent(decoded);
                if (encoded === str) {
                    // Yep, it was fully encoded
                    return decoded;
                } else {
                    // It wasn't fully encoded, maybe it wasn't
                    // encoded at all. Be safe and return the
                    // original
                    logWithLevel(LogLevel.DEBUG, () => `[UTILS] decodeIfNeeded detected partially encoded string? '${str}'`);
                    return str;
                }
            }
        } catch (e) {
            logWithLevel(LogLevel.DEBUG, () => `[UTILS] decodeIfNeeded exception decoding '${str}'`);
            return str;
        }
    } else {
        return str;
    }
}

// Deprecated. This function is no longer used and may be removed from
// future versions of MFCAuto. For mixin patterns, please move to the
// new TypeScript 2.2+ syntax as described here:
//   https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-2.html
export function applyMixins(derivedCtor: Function, baseCtors: Function[]) {
    "use strict";
    baseCtors.forEach(baseCtor => {
        Object.getOwnPropertyNames(baseCtor.prototype).forEach(name => {
            // tslint:disable-next-line:no-unsafe-any
            derivedCtor.prototype[name] = baseCtor.prototype[name];
        });
    });
}

// Simple promisified httpGet helper that helps us use
// async/await and have cleaner code elsewhere
export async function httpGet(url: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        http.get(url, (res: http.IncomingMessage) => {
            let contents = "";
            res.on("data", (chunk: string) => {
                contents += chunk;
            });
            res.on("end", () => {
                resolve(contents);
            });
        }).on("error", (e: Error) => {
            reject(e);
        });
    });
}

// Simple promisified httpsGet helper that helps us use
// async/await and have cleaner code elsewhere
export async function httpsGet(url: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        https.get(url, (res: http.IncomingMessage) => {
            let contents = "";
            res.on("data", (chunk: string) => {
                contents += chunk;
            });
            res.on("end", () => {
                resolve(contents);
            });
        }).on("error", (e: Error) => {
            reject(e);
        });
    });
}
