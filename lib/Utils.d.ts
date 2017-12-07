export declare enum LogLevel {
    /** No logging to the console, not even errors */
    SILENT = 0,
    /** Only fatal or state corrupting errors */
    ERROR = 1,
    /** Non-fatal warnings */
    WARNING = 2,
    /** Status info, this is the default logging level */
    INFO = 3,
    /** More verbose status info */
    VERBOSE = 4,
    /** Debug information that won't be useful to most people */
    DEBUG = 5,
    /** Debug information plus the entire packet log. This is very very verbose. */
    TRACE = 6,
}
export declare function setLogLevel(level: LogLevel): void;
export declare function logWithLevel(level: LogLevel, msg: string, fileRoot?: string, consoleFormatter?: (msg: string) => string): void;
export declare function log(msg: string, fileRoot?: string, consoleFormatter?: (msg: string) => string | null): void;
export declare function decodeIfNeeded(str: string): string;
export declare function applyMixins(derivedCtor: Function, baseCtors: Function[]): void;
export declare function httpGet(url: string): Promise<string>;
export declare function httpsGet(url: string): Promise<string>;
