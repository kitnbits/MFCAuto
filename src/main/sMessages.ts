import {FCTYPE} from "./Constants";

// The Packet class represents a complete message from the MFC chat server.  Many
// of those messages will contain an sMessage JSON payload.  The types in this file
// attempt to capture all the possible permutations of sMessages.

// It's quite likely this is an incomplete list, and it's certain that my
// understanding of MFC's messages is imperfect.  Neither of those facts impact
// the functionality of MFCAuto.  This file acts mostly as a means of increasing
// understanding of the MFC communication protocol.

// The AnyMessage union describes all possible sMessage types
export type AnyMessage = FCTypeLoginResponse|FCTypeSlaveVShareResponse|FCTypeTagsResponse|FCTokenIncResponse|RoomDataMessage|ExtDataMessage|ManageListMessage|BookmarksMessage|RoomDataUserCountObjectMessage|RoomDataUserCountArrayMessage|Message;

export type FCTypeLoginResponse = string; // After successfully logging in, a FCTYPE.LOGIN response is sent whose sMessage is your chat name as a plain string
export type FCTypeSlaveVShareResponse = number[]; // FCTYPE.SLAVEVSHARE messages contain this payload which I don't understand
export interface FCTypeTagsResponse { // FCTYPE.TAGS messages
    // A numbered property like "18137786": string[];
    // Where the numbered property is a model ID and the array of strings are the models tags
    [index: string]: string[];
}
export interface FCTokenIncResponse { // FCTYPE.TOKENINC messages are received when someone tips publically in a room you're in
    ch: number;
    flags: number;
    m: [number, number, string]; // Format is [sender's id, receiver's id, receiver's name]
    sesstype: number;
    stamp: number;
    tokens: number; // The actual count of tokens tipped
    u: [number, number, string]; // Format is [###, ###, sender's name (or 'anonymous' for anon tips)]
}

export interface RoomDataMessage {
    countdown: boolean;
    model: number;
    sofar: number;
    src: string;
    topic: string;
    total: number;
}

export interface RoomDataUserCountObjectMessage {
    [index: string]: number;
}

export type RoomDataUserCountArrayMessage = number[];

// ExtData messages are often prompts to issue AJAX requests and then
// take the result of those requests and pipe them back through as a
// specific FCTYPE defined by the ExtDataMessage
export interface ExtDataMessage {
    msg: {
        arg1: number;
        arg2: number;
        from: number;
        len: number;
        to: number;
        type: FCTYPE;
    };
    msglen: number;
    opts: number;
    respkey: number;
    serv: number;
    type: FCTYPE;
}

export interface ManageListMessage {
    count: number;
    op: number;
    owner: number;
    rdata: any[] | FCTypeTagsResponse; // If it's an array, the first element of this array is a schema for the data that follows
    channel: any;
}

export interface BookmarksMessage {
    bookmarks: BaseMessage[];
}

export interface BaseMessage {
    sid: number;    // Session ID
    uid: number;    // User ID
    lv?: number;    // User level, see the FCLEVEL enum in Constants.ts
    nm?: string;    // User name for chat
    vs?: number;    // Video State, see either STATE or FCVIDEO in Constants.ts
    msg?: string;   // The text of any chat message or PM if this is a CMESG or PMESG FCType
    [index: string]: any; // Catch all to cover what I don't know and appease the TypeScript compiler in some cases
}


// Most other sMessage types will look like this (including DETAILS, SESSIONSTATE, PMESG, CMESG)
export interface Message extends BaseMessage {
    u?: UserDetailsMessage;
    m?: ModelDetailsMessage;
    s?: SessionDetailsMessage;
}

// Model specific user details.  The object can have as few as one property,
// usually 'rc' in that case, or many. No single property is always present.
export interface ModelDetailsMessage {
    camscore?: number;  // The model's current camscore as a floating point value
    continent?: string; // Two letter continent abbreviate "EU", "SA", "NA" etc for the model.  This seems based on geo-location information about the model's IP.  It is not tied to what the model claims is her country in her bio details.
    flags?: number;     // Bit mask of various model settings.  Need to document better @TODO
    kbit?: number;      // Upstream bandwidth of the model, this seems to be broken and is almost always 0 now
    lastnews?: number;  // Time stamp of this model's last post to their MFC news feed
    mg?: number;        // Model group, this is leftover from the days of MFC having a separate asian page
    missmfc?: number;   // A number indicating whether a model has been Miss MFC before or not, controls the crown icon on model pics on the main page
    new_model?: number; // 1 if this model is considered "new" 0 if not
    rank?: number;      // Ths current Miss MFC ranking of this model, or 0 if the model is ranked >250
    rc?: number;        // Count of users in this model's room
    topic?: string;     // The current topic of the model's room
    hidecs?: boolean;   // If true, do not show this model's camscore on the model menu
    [index: string]: any; // Catch all to cover what I don't know and appease the TypeScript compiler in some cases
}

// General user details. This contains user details common for all users (models
// and members).
export interface UserDetailsMessage {
    age?: number;           // User's age based on user provided details (so this is very often a lie)
    avatar?: number;        // Unknown @TODO, it is usually a small integer value in the 1 to 3 range
    blurb?: string;         // User's bio blurb which shows at the top of their profile and directly under their name in the user menu
    camserv?: number;       // Details about which MFC video server is hosting the users's video stream.  Haven't fully deciphered this @TODO
    chat_bg?: number;       // Chat background color
    chat_color?: string;    // Chat color as a hex RGB value
    chat_font?: number;     // Chat font represented as an integer indexing into a set list of fonts
    chat_opt?: number;      // Unclear what all options are encoded here but it's a bit mask I believe @TODO
    city?: string;          // User provided city details (often a lie, there's no validation here)
    country?: string;       // User provided country details (often a lie, but must one of a standard set of real countries)
    creation?: number;      // Date this user's account was created
    ethnic?: string;        // User provided ethnicity (often a lie)
    occupation?: string;    // User provided occupation description (almost always a lie)
    photos?: number;        // A count of the number of photos this user has on their profile.  Really.  No idea why this is here.
    profile?: number;       // An integer that is either 1 if this user has a profile or 0 if not
    [index: string]: any; // Catch all to cover what I don't know and appease the TypeScript compiler in some cases
}

// Suspect but have not confirmed that this portion would light up with actual
// useful tokens remaining, 'tk', and reward point, 'rp', values if you're logged
// in as a premium user
export interface SessionDetailsMessage {
    ga2?: string;    // As a guest, this is always the empty string ""
    gst?: string;    // As a guest, this is always the empty string ""
    ip?: string;     // As a guest, this is always the string "0.0.0.0"
    rp?: number;     // As a guest, this is always 0
    tk?: number;     // As a guest, this is always 0
    [index: string]: any; // Catch all to cover what I don't know and appease the TypeScript compiler in some cases
}
