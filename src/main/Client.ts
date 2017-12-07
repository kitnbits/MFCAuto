import { EventEmitter } from "events";
import * as net from "net";
import { LogLevel, logWithLevel, httpsGet } from "./Utils";
import * as constants from "./Constants";
import { Model } from "./Model";
import { Packet } from "./Packet";
import * as messages from "./sMessages";
import * as assert from "assert";
import * as WebSocket from "ws";
const load = require("load");

/**
 * Connection state of the client
 * @access private
 */
export const ClientState = {
    /** Not currently connected to MFC and not trying to connect */
    IDLE: "IDLE",
    /** Actively trying to connect to MFC but not currently connected */
    PENDING: "PENDING",
    /** Currently connected to MFC */
    ACTIVE: "ACTIVE",
} as {IDLE: "IDLE", PENDING: "PENDING", ACTIVE: "ACTIVE"};

/**
 * Creates and maintains a connection to MFC chat servers
 *
 * Client instances are [NodeJS EventEmitters](https://nodejs.org/api/all.html#events_class_eventemitter)
 * and will emit an event every time a Packet is received from the server. The
 * event will be named after the FCType of the Packet. See
 * [FCTYPE in ./src/main/Constants.ts](https://github.com/ZombieAlex/MFCAuto/blob/master/src/main/Constants.ts#L350)
 * for the complete list of possible events.
 *
 * Listening for Client events is an advanced feature and requires some
 * knowledge of MFC's chat server protocol, which will not be documented here.
 * Where possible, listen for events on [Model](#Model) instead.
 */
export class Client extends EventEmitter {
    /** Session ID assigned to this client by the server after login */
    public sessionId: number;
    /**
     * username used to log in to MFC, or, if the username was
     * left as "guest" then the server will have randomly generated
     * a new name for us like "Guest12345" and this value will
     * be updated to reflect that
     */
    public username: string;
    /** hashed password used by this client to log in */
    public password: string;
    /** User ID assigned to the currently logged in user */
    public uid: number | undefined;

    private _state: ClientStates;
    private _choseToLogIn: boolean = false;
    private _completedModels: boolean = false;
    private _completedTags: boolean = false;
    private readonly _options: ClientOptions;
    private readonly _baseUrl: string;
    private _serverConfig: ServerConfig | undefined;
    private _streamBuffer: Buffer;
    private _streamWebSocketBuffer: string;
    private _streamPosition: number;
    private _emoteParser: EmoteParser | undefined;
    private _client: net.Socket | WebSocket | undefined;
    private _keepAliveTimer: NodeJS.Timer | undefined;
    private _manualDisconnect: boolean;
    private _reconnectTimer?: NodeJS.Timer;
    private static _userQueryId: number;
    private _currentConnectionStartTime?: number;
    private _lastPacketTime?: number;
    private _lastStatePacketTime?: number;
    private static _connectedClientCount = 0;
    private static readonly _initialReconnectSeconds = 5;
    private static readonly _reconnectBackOffMultiplier = 1.5;
    private static readonly _maximumReconnectSeconds = 2400; // 40 Minutes
    private static _currentReconnectSeconds = 5;
    private static readonly webSocketNoiseFilter = /^\d{4}\d+ \d+ \d+ \d+ \d+/;

    /**
     * Client constructor
     * @param [username] Either "guest" or a real MFC member account name, default is "guest"
     * @param [password] Either "guest" or, to log in with a real account the password
     * should be a hash of your real password and NOT your actual plain text
     * password. You can discover the appropriate string to use by checking your browser
     * cookies after logging in via your browser.  In Firefox, go to Options->Privacy
     * and then "Show Cookies..." and search for "myfreecams".  You will see one
     * cookie named "passcode". Select it and copy the value listed as "Content".
     * It will be a long string of lower case letters that looks like gibberish.
     * *That* is the password to use here.
     * @param [options] A ClientOptions object detailing several optional Client settings
     * like whether to use WebSockets or traditional TCP sockets and whether to connect
     * to MyFreeCams.com or CamYou.com
     * @example
     * const mfc = require("MFCAuto");
     * const guestMFCClient = new mfc.Client();
     * const premiumMFCClient = new mfc.Client(premiumUsername, premiumPasswordHash);
     * const guestMFCFlashClient = new mfc.Client("guest", "guest", {useWebSockets: false});
     * const guestCamYouClient = new mfc.Client("guest", "guest", {camYou: true});
     * const guestCamYouFlashClient = new mfc.Client("guest", "guest", {useWebSockets: false, camYou: true});
     */
    constructor(username: string = "guest", password: string = "guest", options: boolean | ClientOptions = {}) {
        super();
        const defaultOptions: ClientOptions = {
            useWebSockets: true,
            camYou: false,
            useCachedServerConfig: false,
            silenceTimeout: 90000,
            stateSilenceTimeout: 120000,
            loginTimeout: 30000,
        };

        // v4.1.0 supported a third constructor parameter that was a boolean controlling whether to use
        // WebSockets (true) or not (false, the default). For backward compat reasons, we'll still handle
        // that case gracefully. New consumers should move to the options bag syntax.
        if (typeof options === "boolean") {
            logWithLevel(LogLevel.WARNING, `WARNING: Client useWebSockets as a boolean third constructor parameter is being deprecated, please see the release notes for v4.2.0 for the current way to use a websocket server connection`);
            options = { useWebSockets: options };
        }

        this._options = Object.assign({}, defaultOptions, options);
        this._baseUrl = this._options.camYou ? "camyou.com" : "myfreecams.com";

        this.username = username;
        this.password = password;
        this.sessionId = 0;
        this._streamBuffer = new Buffer(0);
        this._streamWebSocketBuffer = "";
        this._streamPosition = 0;
        this._manualDisconnect = false;
        this._state = ClientState.IDLE;
        logWithLevel(LogLevel.DEBUG, `[CLIENT] Constructed, State: ${this._state}`);
    }

    // #region Instance EventEmitter methods
    // These only need to be defined here because we are
    // refining the type signatures of each method for better
    // TypeScript error checking and intellisense
    public addListener(event: ClientEventName, listener: ClientEventCallback) {
        return super.addListener(event, listener);
    }
    /**
     * [EventEmitter](https://nodejs.org/api/all.html#events_class_eventemitter) method
     * See [FCTYPE in ./src/main/Constants.ts](https://github.com/ZombieAlex/MFCAuto/blob/master/src/main/Constants.ts#L350) for all possible event names
     */
    public on(event: ClientEventName, listener: ClientEventCallback) {
        return super.on(event, listener);
    }
    /**
     * [EventEmitter](https://nodejs.org/api/all.html#events_class_eventemitter) method
     * See [FCTYPE in ./src/main/Constants.ts](https://github.com/ZombieAlex/MFCAuto/blob/master/src/main/Constants.ts#L350) for all possible event names
     */
    public once(event: ClientEventName, listener: ClientEventCallback) {
        return super.once(event, listener);
    }
    public prependListener(event: ClientEventName, listener: ClientEventCallback) {
        return super.prependListener(event, listener);
    }
    public prependOnceListener(event: ClientEventName, listener: ClientEventCallback) {
        return super.prependOnceListener(event, listener);
    }
    /**
     * [EventEmitter](https://nodejs.org/api/all.html#events_class_eventemitter) method
     * See [FCTYPE in ./src/main/Constants.ts](https://github.com/ZombieAlex/MFCAuto/blob/master/src/main/Constants.ts#L350) for all possible event names
     */
    public removeListener(event: ClientEventName, listener: ClientEventCallback) {
        return super.removeListener(event, listener);
    }
    public removeAllListeners(event?: ClientEventName) {
        logWithLevel(LogLevel.WARNING, `WARNING: Using Client.removeAllListeners may break MFCAuto, which internally adds its own listeners at times`);
        return super.removeAllListeners(event);
    }
    public getMaxListeners() {
        return super.getMaxListeners();
    }
    public setMaxListeners(n: number) {
        return super.setMaxListeners(n);
    }
    public listeners(event: ClientEventName) {
        return super.listeners(event) as ClientEventCallback[];
    }
    public emit(event: ClientEventName, ...args: Array<Packet | Boolean>) {
        return super.emit(event, ...args);
    }
    public eventNames() {
        return super.eventNames() as ClientEventName[];
    }
    public listenerCount(type: ClientEventName) {
        return super.listenerCount(type);
    }
    public rawListeners(event: ClientEventName) {
        return super.rawListeners(event) as ClientEventCallback[];
    }
    // #endregion

    /**
     * Current server connection state:
     * - IDLE: Not currently connected to MFC and not trying to connect
     * - PENDING: Actively trying to connect to MFC but not currently connected
     * - ACTIVE: Currently connected to MFC
     *
     * If this client is PENDING and you wish to wait for it to enter ACTIVE,
     * use [client.ensureConnected](#clientensureconnectedtimeout).
     */
    public get state(): ClientStates {
        return this._state;
    }

    /**
     * How long the current client has been connected to a server
     * in milliseconds. Or 0 if this client is not currently connected
     */
    public get uptime(): number {
        if (this._state === ClientState.ACTIVE
            && this._currentConnectionStartTime) {
            return Date.now() - this._currentConnectionStartTime;
        } else {
            return 0;
        }
    }

    /**
     * Internal MFCAuto use only
     *
     * Reads data from the socket as quickly as possible and stores it in an internal buffer
     * readData is invoked by the "on data" event of the net.Socket object currently handling
     * the TCP connection to the MFC servers.
     * @param buf New Buffer to read from
     * @access private
     */
    private _readData(buf: Buffer): void {
        this._streamBuffer = Buffer.concat([this._streamBuffer, buf]);

        // The new buffer might contain a complete packet, try to read to find out...
        this._readPacket();
    }

    /**
     * Internal MFCAuto use only
     *
     * Reads data from the websocket as quickly as possible and stores it in an internal string
     * readWebSocketData is invoked by the "message" event of the WebSocket object currently
     * handling the connection to the MFC servers.
     * @param buf New string to read from
     * @access private
     */
    private _readWebSocketData(buf: string): void {
        this._streamWebSocketBuffer += buf;

        // The new buffer might contain a complete packet, try to read to find out...
        this._readWebSocketPacket();
    }

    /**
     * Internal MFCAuto use only
     *
     * Called with a single, complete, packet. This function processes the packet,
     * handling some special packets like FCTYPE_LOGIN, which gives our user name and
     * session ID when first logging in to mfc. It then calls out to any registered
     * event handlers.
     * @param packet Packet to be processed
     * @access private
     */
    private _packetReceived(packet: Packet): void {
        this._lastPacketTime = Date.now();
        logWithLevel(LogLevel.TRACE, packet.toString());

        // Special case some packets to update and maintain internal state
        switch (packet.FCType) {
            case constants.FCTYPE.LOGIN:
                // Store username and session id returned by the login response packet
                if (packet.nArg1 !== 0) {
                    logWithLevel(LogLevel.ERROR, `Login failed for user '${this.username}' password '${this.password}'`);
                    throw new Error("Login failed");
                } else {
                    if (typeof packet.sMessage === "string") {
                        this.sessionId = packet.nTo;
                        this.uid = packet.nArg2;
                        this.username = packet.sMessage;
                        logWithLevel(LogLevel.INFO, `Login handshake completed. Logged in as '${this.username}' with sessionId ${this.sessionId}`);

                        // Start the flow of ROOMDATA updates
                        this.ensureConnected(-1)
                            .then(() => this.TxCmd(constants.FCTYPE.ROOMDATA, 0, 1, 0))
                            .catch(() => { /* Ignore */ });
                    } else {
                        assert.strictEqual(typeof packet.sMessage, "string", `unexpected FCTYPE_LOGIN response format`);
                    }
                }
                break;
            case constants.FCTYPE.DETAILS:
            case constants.FCTYPE.ROOMHELPER:
            case constants.FCTYPE.SESSIONSTATE:
            case constants.FCTYPE.ADDFRIEND:
            case constants.FCTYPE.ADDIGNORE:
            case constants.FCTYPE.CMESG:
            case constants.FCTYPE.PMESG:
            case constants.FCTYPE.TXPROFILE:
            case constants.FCTYPE.USERNAMELOOKUP:
            case constants.FCTYPE.MYCAMSTATE:
            case constants.FCTYPE.MYWEBCAM:
            case constants.FCTYPE.JOINCHAN:
                // According to the site code, these packets can all trigger a user state update
                this._lastStatePacketTime = this._lastPacketTime;

                // Except in these specific cases...
                if ((packet.FCType === constants.FCTYPE.DETAILS && packet.nFrom === constants.FCTYPE.TOKENINC) ||
                    // 100 here is taken directly from MFC's top.js and has no additional
                    // explanation. My best guess is that it is intended to reference the
                    // constant: USER.ID_START. But since I'm not certain, I'll leave this
                    // "magic" number here.
                    // tslint:disable-next-line:no-magic-numbers
                    (packet.FCType === constants.FCTYPE.ROOMHELPER && packet.nArg2 < 100) ||
                    (packet.FCType === constants.FCTYPE.JOINCHAN && packet.nArg2 === constants.FCCHAN.PART)) {
                    break;
                }

                // Ok, we're good, merge if there's anything to merge
                if (packet.sMessage !== undefined) {
                    const msg = packet.sMessage as messages.Message;
                    const lv = msg.lv;
                    const sid = msg.sid;
                    let uid = msg.uid;
                    if (uid === 0 && sid > 0) {
                        uid = sid;
                    }
                    if (uid === undefined && packet.aboutModel !== undefined) {
                        uid = packet.aboutModel.uid;
                    }

                    // Only merge models (when we can tell). Unfortunately not every SESSIONSTATE
                    // packet has a user level property. So this is no worse than we had been doing
                    // before in terms of merging non-models...
                    if (uid !== undefined && uid !== -1 && (lv === undefined || lv === constants.FCLEVEL.MODEL)) {
                        // If we know this is a model, get her instance and create it
                        // if it does not exist.  Otherwise, don't create an instance
                        // for someone that might not be a mdoel.
                        const possibleModel = Model.getModel(uid, lv === constants.FCLEVEL.MODEL);
                        if (possibleModel !== undefined) {
                            possibleModel.merge(msg);
                        }
                    }
                }
                break;
            case constants.FCTYPE.TAGS:
                const tagPayload = packet.sMessage as messages.FCTypeTagsResponse;
                if (typeof tagPayload === "object") {
                    for (const key in tagPayload) {
                        if (tagPayload.hasOwnProperty(key)) {
                            const possibleModel = Model.getModel(key);
                            if (possibleModel !== undefined) {
                                possibleModel.mergeTags(tagPayload[key]);
                            }
                        }
                    }
                }
                break;
            case constants.FCTYPE.BOOKMARKS:
                const bmMsg = packet.sMessage as messages.BookmarksMessage;
                if (Array.isArray(bmMsg.bookmarks)) {
                    bmMsg.bookmarks.forEach((b) => {
                        const possibleModel = Model.getModel(b.uid);
                        if (possibleModel !== undefined) {
                            possibleModel.merge(b);
                        }
                    });
                }
                break;
            case constants.FCTYPE.EXTDATA:
                if (packet.nTo === this.sessionId && packet.nArg2 === constants.FCWOPT.REDIS_JSON) {
                    this._handleExtData(packet.sMessage as messages.ExtDataMessage).catch((reason) => {
                        logWithLevel(LogLevel.DEBUG, `[CLIENT] _packetReceived caught rejection from _handleExtData: ${reason}`);
                    });
                }
                break;
            case constants.FCTYPE.METRICS:
                // For METRICS, nTO is an FCTYPE indicating the type of data that's
                // starting or ending, nArg1 is the count of data received so far, and nArg2
                // is the total count of data, so when nArg1 === nArg2, we're done for that data
                // Note that after MFC server updates on 2017-04-18, Metrics packets are rarely,
                // or possibly never, sent
                break;
            case constants.FCTYPE.MANAGELIST:
                if (packet.nArg2 > 0 && packet.sMessage !== undefined && (packet.sMessage as messages.ManageListMessage).rdata !== undefined) {
                    const rdata = this.processListData((packet.sMessage as messages.ManageListMessage).rdata);
                    const nType: constants.FCL = packet.nArg2;

                    switch (nType) {
                        case constants.FCL.ROOMMATES:
                            if (Array.isArray(rdata)) {
                                rdata.forEach((viewer: messages.Message) => {
                                    if (viewer !== undefined) {
                                        const possibleModel = Model.getModel(viewer.uid, viewer.lv === constants.FCLEVEL.MODEL);
                                        if (possibleModel !== undefined) {
                                            possibleModel.merge(viewer);
                                        }
                                    }
                                });
                            }
                            break;
                        case constants.FCL.CAMS:
                            if (Array.isArray(rdata)) {
                                rdata.forEach((model: messages.Message) => {
                                    if (model !== undefined) {
                                        const possibleModel = Model.getModel(model.uid, model.lv === constants.FCLEVEL.MODEL);
                                        if (possibleModel !== undefined) {
                                            possibleModel.merge(model);
                                        }
                                    }
                                });
                                if (!this._completedModels) {
                                    this._completedModels = true;
                                    if (this._completedTags) {
                                        logWithLevel(LogLevel.DEBUG, `[CLIENT] emitting: CLIENT_MODELSLOADED`);
                                        this.emit("CLIENT_MODELSLOADED");
                                    }
                                }
                            }
                            break;
                        case constants.FCL.FRIENDS:
                            if (Array.isArray(rdata)) {
                                rdata.forEach((model: messages.Message) => {
                                    if (model !== undefined) {
                                        const possibleModel = Model.getModel(model.uid, model.lv === constants.FCLEVEL.MODEL);
                                        if (possibleModel !== undefined) {
                                            possibleModel.merge(model);
                                        }
                                    }
                                });
                            }
                            break;
                        case constants.FCL.IGNORES:
                            if (Array.isArray(rdata)) {
                                rdata.forEach((user: messages.Message) => {
                                    if (user !== undefined) {
                                        const possibleModel = Model.getModel(user.uid, user.lv === constants.FCLEVEL.MODEL);
                                        if (possibleModel !== undefined) {
                                            possibleModel.merge(user);
                                        }
                                    }
                                });
                            }
                            break;
                        case constants.FCL.TAGS:
                            const tagPayload2 = rdata as messages.FCTypeTagsResponse;
                            if (tagPayload2 !== undefined) {
                                for (const key in tagPayload2) {
                                    if (tagPayload2.hasOwnProperty(key)) {
                                        const possibleModel = Model.getModel(key);
                                        if (possibleModel !== undefined) {
                                            possibleModel.mergeTags(tagPayload2[key]);
                                        }
                                    }
                                }
                                if (!this._completedTags) {
                                    this._completedTags = true;
                                    if (this._completedModels) {
                                        logWithLevel(LogLevel.DEBUG, `[CLIENT] emitting: CLIENT_MODELSLOADED`);
                                        this.emit("CLIENT_MODELSLOADED");
                                    }
                                }
                            }
                            break;
                        default:
                            logWithLevel(LogLevel.DEBUG, `[CLIENT] _packetReceived unhandled list type on MANAGELIST packet: ${nType}`);
                    }
                }
                break;
            case constants.FCTYPE.ROOMDATA:
                if (packet.nArg1 === 0 && packet.nArg2 === 0) {
                    if (Array.isArray(packet.sMessage)) {
                        const sizeOfModelSegment = 2;
                        for (let i = 0; i < packet.sMessage.length; i = i + sizeOfModelSegment) {
                            const possibleModel = Model.getModel(packet.sMessage[i]);
                            if (possibleModel !== undefined) {
                                possibleModel.merge({ "sid": possibleModel.bestSessionId, "m": { "rc": packet.sMessage[i + 1] } } as messages.Message);
                            }
                        }
                    } else if (typeof (packet.sMessage) === "object") {
                        for (const key in packet.sMessage) {
                            if (packet.sMessage.hasOwnProperty(key)) {
                                const rdmsg = packet.sMessage as messages.RoomDataUserCountObjectMessage;
                                const possibleModel = Model.getModel(key);
                                if (possibleModel !== undefined) {
                                    possibleModel.merge({ "sid": possibleModel.bestSessionId, "m": { "rc": rdmsg[key] } } as messages.Message);
                                }
                            }
                        }
                    }

                }
                break;
            default:
                break;
        }

        // Fire this packet's event for any listeners
        this.emit(constants.FCTYPE[packet.FCType] as ClientEventName, packet);
        this.emit(constants.FCTYPE[constants.FCTYPE.ANY] as ClientEventName, packet);
    }

    /**
     * Internal MFCAuto use only
     *
     * Parses the incoming MFC stream buffer from a socket connection. For each
     * complete individual packet parsed, it will call packetReceived. Because
     * of the single-threaded async nature of node.js, there will often be partial
     * packets and this needs to handle that gracefully, only calling packetReceived
     * once we've parsed out a complete response.
     * @access private
     */
    private _readPacket(): void {
        let pos: number = this._streamPosition;
        const intParams: number[] = [];
        let strParam: string | undefined;

        try {
            // Each incoming packet is initially tagged with 7 int32 values, they look like this:
            //  0 = "Magic" value that is *always* -2027771214
            //  1 = "FCType" that identifies the type of packet this is (FCType being a MyFreeCams defined thing)
            //  2 = nFrom
            //  3 = nTo
            //  4 = nArg1
            //  5 = nArg2
            //  6 = sPayload, the size of the payload
            //  7 = sMessage, the actual payload.  This is not an int but is the actual buffer

            // Any read here could throw a RangeError exception for reading beyond the end of the buffer.  In theory we could handle this
            // better by checking the length before each read, but that would be a bit ugly.  Instead we handle the RangeErrors and just
            // try to read again the next time the buffer grows and we have more data

            // Parse out the first 7 integer parameters (Magic, FCType, nFrom, nTo, nArg1, nArg2, sPayload)
            const countOfIntParams = 7;
            const sizeOfInt32 = 4;
            for (let i = 0; i < countOfIntParams; i++) {
                intParams.push(this._streamBuffer.readInt32BE(pos));
                pos += sizeOfInt32;
            }
            const [magic, fcType, nFrom, nTo, nArg1, nArg2, sPayload] = intParams;

            // If the first integer is MAGIC, we have a valid packet
            if (magic === constants.MAGIC) {
                // If there is a JSON payload to this packet
                if (sPayload > 0) {
                    // If we don't have the complete payload in the buffer already, bail out and retry after we get more data from the network
                    if (pos + sPayload > this._streamBuffer.length) {
                        throw new RangeError(); // This is needed because streamBuffer.toString will not throw a rangeerror when the last param is out of the end of the buffer
                    }
                    // We have the full packet, store it and move our buffer pointer to the next packet
                    strParam = this._streamBuffer.toString("utf8", pos, pos + sPayload);
                    pos = pos + sPayload;
                }
            } else {
                // Magic value did not match?  In that case, all bets are off.  We no longer understand the MFC stream and cannot recover...
                // This is usually caused by a mis-alignment error due to incorrect buffer management (bugs in this code or the code that writes the buffer from the network)
                throw new Error(`Invalid packet received! - ${magic} Length == ${this._streamBuffer.length}`);
            }

            // At this point we have the full packet in the intParams and strParam values, but intParams is an unstructured array
            // Let's clean it up before we delegate to this.packetReceived.  (Leaving off the magic int, because it MUST be there always
            // and doesn't add anything to the understanding)
            let sMessage: messages.AnyMessage | undefined;
            if (strParam !== undefined && strParam !== "") {
                try {
                    sMessage = JSON.parse(strParam) as messages.AnyMessage;
                } catch (e) {
                    sMessage = strParam;
                }
            }
            this._packetReceived(new Packet(
                fcType,
                nFrom,
                nTo,
                nArg1,
                nArg2,
                sPayload,
                sMessage,
            ));

            // If there's more to read, keep reading (which would be the case if the network sent >1 complete packet in a single transmission)
            if (pos < this._streamBuffer.length) {
                this._streamPosition = pos;
                this._readPacket();
            } else {
                // We read the full buffer, clear the buffer cache so that we can
                // read cleanly from the beginning next time (and save memory)
                this._streamBuffer = new Buffer(0);
                this._streamPosition = 0;
            }
        } catch (e) {
            // RangeErrors are expected because sometimes the buffer isn't complete.  Other errors are not...
            if (!(e instanceof RangeError)) {
                throw e;
            } else {
                //  this.log("Expected exception (?): " + e);
            }
        }
    }

    /**
     * Internal MFCAuto use only
     *
     * Parses the incoming MFC data string from a WebSocket connection. For each
     * complete individual packet parsed, it will call packetReceived.
     * @access private
     */
    private _readWebSocketPacket(): void {
        const sizeTagLength = 4;

        while (this._streamWebSocketBuffer.length > sizeTagLength) {
            // Occasionally there is noise in the WebSocket buffer
            // it really should start with 5-6 digits followed by a
            // space. Where the first 4 digits are the size of the
            // total message and the last digits of that first 5-6
            // are the FCType of the first Packet in the buffer
            // We'll clean it up by shifting the buffer until we
            // find that pattern
            while (!Client.webSocketNoiseFilter.test(this._streamWebSocketBuffer) && this._streamWebSocketBuffer.length > sizeTagLength) {
                this._streamWebSocketBuffer = this._streamWebSocketBuffer.slice(1);
            }
            if (this._streamWebSocketBuffer.length <= sizeTagLength) {
                return;
            }

            // tslint:disable-next-line:no-magic-numbers
            const messageLength = parseInt(this._streamWebSocketBuffer.slice(0, sizeTagLength), 10);
            if (isNaN(messageLength)) {
                throw new Error("Invalid packet received! - " + this._streamWebSocketBuffer);
            }

            if (this._streamWebSocketBuffer.length < messageLength) {
                return;
            }

            this._streamWebSocketBuffer = this._streamWebSocketBuffer.slice(sizeTagLength);
            let currentMessage = this._streamWebSocketBuffer.slice(0, messageLength);

            this._streamWebSocketBuffer = this._streamWebSocketBuffer.slice(messageLength);

            const countOfIntParams = 5;
            const intParamsLength = currentMessage.split(" ", countOfIntParams).reduce((p, c) => p + c.length, 0) + countOfIntParams;
            // tslint:disable-next-line:no-magic-numbers
            const intParams = currentMessage.split(" ", countOfIntParams).map(s => parseInt(s, 10));
            const [FCType, nFrom, nTo, nArg1, nArg2] = intParams;
            currentMessage = currentMessage.slice(intParamsLength);

            let sMessage: messages.AnyMessage | undefined;
            if (currentMessage.length > 0) {
                try {
                    sMessage = JSON.parse(decodeURIComponent(currentMessage)) as messages.AnyMessage;
                } catch (e) {
                    // Guess it wasn't a JSON blob. OK, just use it raw.
                    sMessage = currentMessage;
                }
            }

            this._packetReceived(new Packet(
                FCType,
                nFrom,
                nTo,
                nArg1,
                nArg2,
                currentMessage.length,
                currentMessage.length === 0 ? undefined : sMessage,
            ));
        }
    }

    /**
     * Internal MFCAuto use only
     *
     * Incoming FCTYPE.EXTDATA messages are signals to request additional
     * data from an external REST API. This helper function handles that task
     * and invokes packetReceived with the results of the REST call
     * @param extData An ExtDataMessage
     * @returns A promise that resolves when data has been retrieves from
     * the web API and packetReceived has completed
     * @access private
     */
    private async _handleExtData(extData: messages.ExtDataMessage) {
        if (extData !== undefined && extData.respkey !== undefined) {
            const url = `https://www.${this._baseUrl}/php/FcwExtResp.php?respkey=${extData.respkey}&type=${extData.type}&opts=${extData.opts}&serv=${extData.serv}&`;

            logWithLevel(LogLevel.DEBUG, `[CLIENT] _handleExtData: ${JSON.stringify(extData)} - '${url}'`);
            const contentLogLimit = 80;
            let contents = "";
            try {
                contents = await httpsGet(url);
                logWithLevel(LogLevel.DEBUG, `[CLIENT] _handleExtData response: ${JSON.stringify(extData)} - '${url}'\n\t${contents.slice(0, contentLogLimit)}...`);
                // tslint:disable-next-line:no-unsafe-any
                const p = new Packet(extData.msg.type, extData.msg.from, extData.msg.to, extData.msg.arg1, extData.msg.arg2, extData.msglen, JSON.parse(contents));
                this._packetReceived(p);
            } catch (e) {
                logWithLevel(LogLevel.DEBUG, `[CLIENT] _handleExtData error: ${e} - ${JSON.stringify(extData)} - '${url}'\n\t${contents.slice(0, contentLogLimit)}...`);
            }
        }
    }

    /**
     * Processes the .rdata component of an FCTYPE.MANAGELIST server packet
     *
     * MANAGELIST packets are used by MFC for bulk dumps of data. For instance,
     * they're used when you first log in to send the initial lists of online
     * models, and when you first join a room to send the initial lists of
     * other members in the room.
     *
     * If an MFCAuto consumer script wants to intercept and interpret details
     * like that, it will need to listen for "MANAGELIST" events emitted from
     * the client instance and process the results using this function.
     *
     * Most of the details are encoded in the .rdata element of the ManageListMessage
     * and its format is cumbersome to deal with. This function handles the insanity.
     * @param rdata rdata property off a received ManageListMessage
     * @returns Either a list of Message elements, most common, or an
     * FCTypeTagsResponse, which is an object containing tag information for
     * one or more models.
     * @access private
     */
    public processListData(rdata: Array<Array<string | number | object>> | messages.FCTypeTagsResponse): Array<messages.Message> | messages.FCTypeTagsResponse {
        // Really MFC?  Really??  Ok, commence the insanity...
        if (Array.isArray(rdata) && rdata.length > 0) {
            const result: Array<messages.Message> = [];
            const expectedSchemaDepth = 2;
            const schema = rdata[0] as Array<string | { [index: string]: Array<string> }>;
            const schemaMap: Array<string | [string, string]> = [];

            logWithLevel(LogLevel.DEBUG, `[CLIENT] _processListData, processing schema: ${JSON.stringify(schema)}`);

            if (Array.isArray(schema)) {
                // Build a map of array index -> property path from the schema
                schema.forEach((prop) => {
                    if (typeof prop === "object") {
                        Object.keys(prop).forEach((key) => {
                            if (Array.isArray(prop[key])) {
                                prop[key].forEach((prop2: string) => {
                                    schemaMap.push([key, prop2]);
                                });
                            } else {
                                logWithLevel(LogLevel.DEBUG, `[CLIENT] _processListData. N-level deep schemas? ${JSON.stringify(schema)}`);
                            }
                        });
                    } else {
                        schemaMap.push(prop);
                    }
                });
                logWithLevel(LogLevel.DEBUG, `[CLIENT] _processListData. Calculated schema map: ${JSON.stringify(schemaMap)}`);
                rdata.slice(1).forEach((record) => {
                    if (Array.isArray(record)) {
                        // Now apply the schema
                        const msg: messages.Message = {} as messages.Message;
                        for (let i = 0; i < record.length; i++) {
                            if (schemaMap.length > i) {
                                const path = schemaMap[i];
                                if (typeof path === "string") {
                                    msg[path] = record[i];
                                } else if (path.length === expectedSchemaDepth) {
                                    if (msg[path[0]] === undefined) {
                                        msg[path[0]] = {};
                                    }
                                    (msg[path[0]] as messages.UserDetailsMessage | messages.ModelDetailsMessage | messages.SessionDetailsMessage | messages.ExtendedDetailsMessage)[path[1]] = record[i];
                                } else {
                                    logWithLevel(LogLevel.DEBUG, `[CLIENT] _processListData. N-level deep schemas? ${JSON.stringify(schema)}`);
                                }
                            } else {
                                logWithLevel(LogLevel.DEBUG, `[CLIENT] _processListData. Not enough elements in schema\n\tSchema: ${JSON.stringify(schema)}\n\tSchemaMap: ${JSON.stringify(schemaMap)}\n\tData: ${JSON.stringify(record)}`);
                            }
                        }

                        result.push(msg);
                    } else {
                        result.push(record);
                    }
                });
            } else {
                logWithLevel(LogLevel.DEBUG, `[CLIENT] _processListData. Malformed list data? ${JSON.stringify(schema)} - ${JSON.stringify(rdata)}`);
            }

            return result;
        } else {
            return rdata as Array<messages.Message> | messages.FCTypeTagsResponse;
        }
    }

    /**
     * Encodes raw chat text strings into a format the MFC servers understand
     * @param rawMsg A chat string like `I am happy :mhappy`
     * @returns A promise that resolve with the translated text like
     * `I am happy #~ue,2c9d2da6.gif,mhappy~#`
     * @access private
     */
    public async encodeRawChat(rawMsg: string): Promise<string> {
        // On MFC, this code is part of the ParseEmoteInput function in
        // https://www.myfreecams.com/_js/mfccore.js, and it is especially convoluted
        // code involving ajax requests back to the server depending on the text you're
        // sending and a giant hashtable of known emotes.
        return new Promise<string>((resolve, reject) => {
            // Pre-filters mostly taken from player.html's SendChat method
            if (rawMsg.match(/^\s*$/) !== null || rawMsg.match(/:/) === null) {
                resolve(rawMsg);
                return;
            }

            rawMsg = rawMsg.replace(/`/g, "'");
            rawMsg = rawMsg.replace(/<~/g, "'");
            rawMsg = rawMsg.replace(/~>/g, "'");
            this._ensureEmoteParserIsLoaded()
                .then(() => (this._emoteParser as EmoteParser).Process(rawMsg, resolve))
                .catch((reason) => reject(reason));
        });
    }

    // tslint:disable:no-any
    /**
     * Internal MFCAuto use only
     *
     * Dynamically loads script code from MFC, massaging it with the given massager
     * function first, and then passes the resulting instantiated object to the
     * given callback.
     *
     * We try to use this sparingly as it opens us up to breaks from site changes.
     * But it is still useful for the more complex or frequently updated parts
     * of MFC.
     * @param url URL from which to load the site script
     * @param massager Post-processor function that takes the raw site script and
     * converts/massages it to a usable form.
     * @returns A promise that resolves with the object loaded from site code
     * @access private
     */
    private async _loadFromMFC(url: string, massager?: (src: string) => string): Promise<any> {
        let contents = await httpsGet(url);
        if (massager !== undefined) {
            contents = massager(contents);
        }
        // tslint:disable-next-line:no-unsafe-any
        return (load.compiler(contents));
    }
    // tslint:enable:no-any

    /**
     * Internal MFCAuto use only
     *
     * Loads the emote parsing code from the MFC web site directly, if it's not
     * already loaded, and then invokes the given callback.  This is useful because
     * most scripts won't actually need the emote parsing capabilities, so lazy
     * loading it can speed up the common case.
     *
     * We're loading this code from the live site instead of re-coding it ourselves
     * here because of the complexity of the code and the fact that it has changed
     * several times in the past.
     * @returns A promise that resolves when this.emoteParser has been initialized
     * @access private
     */
    private async _ensureEmoteParserIsLoaded(): Promise<void> {
        if (this._emoteParser === undefined) {
            const obj = await this._loadFromMFC(`https://www.${this._baseUrl}/_js/mfccore.js`, (content) => {
                // Massager....Yes this is vulnerable to site breaks, but then
                // so is this entire module.

                // First, pull out only the ParseEmoteInput function
                const startIndex = content.indexOf("// js_build_core: MfcJs/ParseEmoteInput/ParseEmoteInput.js");
                const endIndex = content.indexOf("// js_build_core: ", startIndex + 1);
                assert.ok(startIndex !== -1 && endIndex !== -1 && startIndex < endIndex, "mfccore.js layout has changed, don't know what to do now");
                content = content.substr(startIndex, endIndex - startIndex);

                // Then massage the function somewhat and prepend some prerequisites
                content = `var document = {cookie: '', domain: '${this._baseUrl}', location: { protocol: 'https:' }};
                            var g_hPlatform = {
                                "id": 01,
                                "domain": "${this._baseUrl}",
                                "name": "MyFreeCams",
                                "code": "mfc",
                                "image_url": "https://img.mfcimg.com/",
                                "performer": "model",
                                "Performer": "Model",
                                "avatar_prefix": "avatar",
                            };
                            var XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;
                            function bind(that,f){return f.bind(that);}` + content;
                content = content.replace(/this.createRequestObject\(\)/g, "new XMLHttpRequest()");
                content = content.replace(/new MfcImageHost\(\)/g, "{host: function(){return '';}}");
                content = content.replace(/this\.Reset\(\);/g, "this.Reset();this.oReq = new XMLHttpRequest();");
                content = content.replace(/MfcClientRes/g, "undefined");
                return content;
            });

            // tslint:disable-next-line:no-unsafe-any
            this._emoteParser = new obj.ParseEmoteInput() as EmoteParser;
            this._emoteParser.setUrl(`https://api.${this._baseUrl}/parseEmote`);
        }
    }

    /**
     * Internal MFCAuto use only
     *
     * Loads the lastest server information from MFC, if it's not already loaded
     * @returns A promise that resolves when this.serverConfig has been initialized
     * @access private
     */
    private async _ensureServerConfigIsLoaded() {
        if (this._serverConfig === undefined) {
            if (this._options.useCachedServerConfig) {
                this._serverConfig = constants.CACHED_SERVERCONFIG;
            } else {
                const mfcConfig = await httpsGet(`https://www.${this._baseUrl}/_js/serverconfig.js?nc=${Math.random()}`);
                try {
                    this._serverConfig = JSON.parse(mfcConfig) as ServerConfig;
                } catch (e) {
                    logWithLevel(LogLevel.ERROR, `Error parsing serverconfig: '${mfcConfig}'`);
                    throw e;
                }
            }
        }
    }

    /**
     * Sends a command to the MFC chat server. Don't use this unless
     * you really know what you're doing.
     * @param nType FCTYPE of the message
     * @param nTo Number representing the channel or entity the
     * message is for. This is often left as 0.
     * @param nArg1 First argument of the message. Its meaning varies
     * depending on the FCTYPE of the message. Often left as 0.
     * @param nArg2 Second argument of the message. Its meaning
     * varies depending on the FCTYPE of the message. Often left as 0.
     * @param sMsg Payload of the message. Its meaning varies depending
     * on the FCTYPE of the message and is sometimes is stringified JSON.
     * Most often this should remain undefined.
     */
    public TxCmd(nType: constants.FCTYPE, nTo: number = 0, nArg1: number = 0, nArg2: number = 0, sMsg?: string): void {
        logWithLevel(LogLevel.DEBUG, `TxCmd Sending - nType: ${constants.FCTYPE[nType]}, nTo: ${nTo}, nArg1: ${nArg1}, nArg2: ${nArg2}, sMsg:${sMsg}`);
        if (this._client === undefined) {
            throw new Error("Cannot call TxCmd on a disconnected client");
        }

        if (this._client instanceof net.Socket) {
            // tslint:disable:no-magic-numbers
            const msgLength = (sMsg ? sMsg.length : 0);
            const buf = new Buffer((7 * 4) + msgLength);

            buf.writeInt32BE(constants.MAGIC, 0);
            buf.writeInt32BE(nType, 4);
            buf.writeInt32BE(this.sessionId, 8); // Session id, this is always our nFrom value
            buf.writeInt32BE(nTo, 12);
            buf.writeInt32BE(nArg1, 16);
            buf.writeInt32BE(nArg2, 20);
            buf.writeInt32BE(msgLength, 24);

            if (sMsg) {
                buf.write(sMsg, 28);
            }
            // tslint:enable:no-magic-numbers

            this._client.write(buf);
        } else {
            this._client.send(`${nType} ${this.sessionId} ${nTo} ${nArg1} ${nArg2}${sMsg ? " " + sMsg : ""}\n\0`);
        }

        // @TODO - Consider converting TxCmd to return a promise and catching any
        // exceptions in client.send. In those cases, we could call ._disconnected()
        // and wait on the CLIENT_CONNECTED event before trying to send the message
        // again and then only resolve when we finally do send the message (or until
        // manual disconnect() is called)
        //
        // On the other hand, during periods of long disconnect, that could cause a
        // swarm of pending commands that would flood the server when we finally
        // do get a connection, possibly causing MFC to drop and/or block us. So
        // we'd need to handle it gracefully.
    }

    /**
     * Sends a command to the MFC chat server. Don't use this unless
     * you really know what you're doing.
     * @param packet Packet instance encapsulating the command to be sent
     */
    public TxPacket(packet: Packet): void {
        this.TxCmd(packet.FCType, packet.nTo, packet.nArg1, packet.nArg2, JSON.stringify(packet.sMessage));
    }

    /**
     * Takes a number that might be a user id or a room id and converts
     * it to a user id (if necessary). The functionality here maps to
     * MFC's GetRoomOwnerId() within top.js
     * @param id A number that is either a model ID or room/channel ID
     * @returns The model ID corresponding to the given id
     */
    public static toUserId(id: number): number {
        // tslint:disable:no-magic-numbers
        if (id >= 1000000000) {                 // ?? Unexplained magic value
            id = id - 1000000000;
        } else if (id >= constants.CAMCHAN.ID_START) {    // CamYou public room ID
            id = id - constants.CAMCHAN.ID_START;
        } else if (id >= 300000000) {           // ?? Unexplained magic value
            id = id - 300000000;
        } else if (id >= constants.SESSCHAN.ID_START) {   // Group room IDs
            id = id - constants.SESSCHAN.ID_START;
        } else if (id >= constants.CHANNEL.ID_START) {    // MFC Public room IDs
            id = id - constants.CHANNEL.ID_START;
        }
        // tslint:enable:no-magic-numbers
        return id;
    }

    /**
     * Takes a number that might be a user id or a room id and converts
     * it to a room id (if necessary)
     * @param id A number that is either a model ID or a room/channel ID
     * @param [camYou] True if the ID calculation should be done for
     * CamYou.com. False if the ID calculation should be done for MFC.
     * Default is False
     * @returns The free chat room/channel ID corresponding to the given ID
     */
    public static toRoomId(id: number, camYou: boolean = false): number {
        const publicRoomId = camYou ? constants.CAMCHAN.ID_START : constants.CHANNEL.ID_START;
        if (id < publicRoomId) {
            id = id + publicRoomId;
        }
        return id;
    }

    /**
     * Send chat to a model's public chat room
     *
     * If the message is one you intend to send more than once,
     * and your message contains emotes, you can save some processing
     * overhead by calling client.encodeRawChat once for the string,
     * caching the result of that call, and passing that string here.
     *
     * Note that you must have previously joined the model's chat room
     * for the message to be sent successfully.
     * @param id Model or room/channel ID to send the chat to
     * @param msg Text to be sent, can contain emotes
     * @returns A promise that resolves after the text has
     * been sent to the server. There is no check on success and
     * the message may fail to be sent if you are muted or ignored
     * by the model
     */
    public async sendChat(id: number, msg: string) {
        const encodedMsg = await this.encodeRawChat(msg);
        id = Client.toRoomId(id, this._options.camYou);
        this.TxCmd(constants.FCTYPE.CMESG, id, 0, 0, encodedMsg);
    }

    /**
     * Send a PM to the given model or member
     *
     * If the message is one you intend to send more than once,
     * and your message contains emotes, you can save some processing
     * overhead by calling client.encodeRawChat once for the string,
     * caching the result of that call, and passing that string here.
     * @param id Model or member ID to send the PM to
     * @param msg Text to be sent, can contain emotes
     * @returns A promise that resolves after the text has
     * been sent to the server. There is no check on success and
     * the message may fail to be sent if you are muted or ignored
     * by the model or member
     */
    public async sendPM(id: number, msg: string) {
        const encodedMsg = await this.encodeRawChat(msg);
        id = Client.toUserId(id);
        this.TxCmd(constants.FCTYPE.PMESG, id, 0, 0, encodedMsg);
    }

    /**
     * Joins the public chat room of the given model
     * @param id Model ID or room/channel ID to join
     * @returns A promise that resolves after successfully
     * joining the chat room and rejects if the join fails
     * for any reason (you're banned, region banned, or
     * you're a guest and the model is not online)
     */
    public async joinRoom(id: number): Promise<Packet> {
        return new Promise<Packet>((resolve, reject) => {
            const roomId = Client.toRoomId(id, this._options.camYou);
            const modelId = Client.toUserId(id);

            const resultHandler = (p: Packet) => {
                if (p.aboutModel !== undefined && p.aboutModel.uid === modelId) {
                    this.removeListener("JOINCHAN", resultHandler);
                    this.removeListener("ZBAN", resultHandler);
                    this.removeListener("BANCHAN", resultHandler);
                    this.removeListener("CMESG", resultHandler);
                    switch (p.FCType) {
                        case constants.FCTYPE.CMESG:
                            // Success!
                            resolve(p);
                            break;
                        case constants.FCTYPE.JOINCHAN:
                            switch (p.nArg2) {
                                case constants.FCCHAN.JOIN:
                                    // Also success!
                                    resolve(p);
                                    break;
                                case constants.FCCHAN.PART:
                                    // Probably a bad model ID
                                    reject(p);
                                    break;
                                default:
                                    logWithLevel(LogLevel.DEBUG, `[CLIENT] joinRoom received an unexpected JOINCHAN response ${p.toString()}`);
                                    break;
                            }
                            break;
                        case constants.FCTYPE.ZBAN:
                        case constants.FCTYPE.BANCHAN:
                            reject(p);
                            break;
                        default:
                            logWithLevel(LogLevel.DEBUG, `[CLIENT] joinRoom received the impossible`);
                            reject(p);
                            break;
                    }
                }
            };

            // Listen for possible responses
            this.addListener("JOINCHAN", resultHandler);
            this.addListener("ZBAN", resultHandler);
            this.addListener("BANCHAN", resultHandler);
            this.addListener("CMESG", resultHandler);

            this.TxCmd(constants.FCTYPE.JOINCHAN, 0, roomId, constants.FCCHAN.JOIN);
        });
    }

    /**
     * Leaves the public chat room of the given model
     * @param id Model ID or room/channel ID to leave
     * @returns A promise that resolves immediately
     */
    public async leaveRoom(id: number) {
        if (this._state === ClientState.ACTIVE) {
            id = Client.toRoomId(id, this._options.camYou);
            this.TxCmd(constants.FCTYPE.JOINCHAN, 0, id, constants.FCCHAN.PART);
        }
        // Else, if we don't have a connection then we weren't really in the
        // room in the first place. No real point to raising an exception here
        // so just exit silently instead.
    }

    /**
     * Queries MFC for the latest state of a model or member
     *
     * This method does poll the server for the latest model status, which can
     * be useful in some situations, but it is **not the quickest way to know
     * when a model's state changes**. Instead, to know the instant a model
     * enters free chat, keep a Client connected and listen for changes on her
     * Model instance. For example:
     *
     *   ```javascript
     *   // Register a callback whenever AspenRae's video
     *   // state changes
     *   mfc.Model.getModel(3111899)
     *     .on("vs", (model, before, after) => {
     *       // This will literally be invoked faster than
     *       // you would see her cam on the website.
     *       // There is no faster way.
     *       if (after === mfc.STATE.FreeChat) {
     *         // She's in free chat now!
     *       }
     *   });
     *   ```
     * @param user Model or member name or ID
     * @returns A promise that resolves with a Message
     * containing the user's current details or undefined
     * if the given user was not found
     * @example
     * // Query a user, which happens to be a model, by name
     * client.queryUser("AspenRae").then((msg) => {
     *     if (msg === undefined) {
     *         console.log("AspenRae probably temporarily changed her name");
     *     } else {
     *         //Get the full Model instance for her
     *         let AspenRae = mfc.Model.getModel(msg.uid);
     *         //Do stuff here...
     *     }
     * });
     *
     * // Query a user by ID number
     * client.queryUser(3111899).then((msg) => {
     *     console.log(JSON.stringify(msg));
     *     //Will print something like:
     *     //  {"sid":0,"uid":3111899,"nm":"AspenRae","lv":4,"vs":127}
     * });
     *
     * // Query a member by name and check their status
     * client.queryUser("MyPremiumMemberFriend").then((msg) => {
     *     if (msg) {
     *         if (msg.vs !== mfc.STATE.Offline) {
     *             console.log("My friend is online!");
     *         } else {
     *             console.log("My friend is offline");
     *         }
     *     } else {
     *         console.log("My friend no longer exists by that name");
     *     }
     * });
     *
     * // Force update a model's status, without caring about the result here
     * // Potentially useful when your logic is in model state change handlers
     * client.queryUser(3111899);
     */
    public async queryUser(user: string | number) {
        // The number used for the queryId is returned by the chat server
        // and used to correlate the server response to the correct client
        // query. The exact number doesn't really matter except that it
        // should be unique if you're potentially sending multiple
        // USERNAMELOOKUP queries simultaneously (which we might be).
        // Starting with 20 simply because that's what MFC's web client
        // code uses. Literally any number would work.
        // tslint:disable-next-line:no-magic-numbers
        Client._userQueryId = Client._userQueryId !== undefined ? Client._userQueryId : 20;
        const queryId = Client._userQueryId++;
        return new Promise<messages.Message>((resolve) => {
            const handler = (p: Packet) => {
                // If this is our response
                if (p.nArg1 === queryId) {
                    this.removeListener("USERNAMELOOKUP", handler);
                    if (typeof p.sMessage === "string" || p.sMessage === undefined) {
                        // These states mean the user wasn't found.
                        // Be a little less ambiguous in our response by resolving
                        // with undefined in both cases.
                        resolve(undefined);
                    } else {
                        resolve(p.sMessage as messages.Message);
                    }
                }
            };
            this.prependListener("USERNAMELOOKUP", handler);
            if (typeof user === "number") {
                this.TxCmd(constants.FCTYPE.USERNAMELOOKUP, 0, queryId, user);
            } else if (typeof user === "string") {
                this.TxCmd(constants.FCTYPE.USERNAMELOOKUP, 0, queryId, 0, user);
            } else {
                throw new Error("Invalid argument");
            }
        });
    }

    /**
     * Connects to MFC
     *
     * Logging in is optional because not all queries to the server require you to log in.
     * For instance, MFC servers will respond to a USERNAMELOOKUP request without
     * requiring a login. However for most cases you probably do want to log in.
     * @param [doLogin] If True, log in with the credentials provided at Client construction.
     * If False, do not log in. Default is True
     * @returns A promise that resolves when the connection has been established
     * @example <caption>Most common case is simply to connect, log in, and start processing events</caption>
     * const mfc = require("MFCAuto");
     * const client = new mfc.Client();
     *
     * // Set up any desired callback hooks here using one or more of:
     * //   - mfc.Model.on(...) - to handle state changes for all models
     * //   - mfc.Model.getModel(...).on(...) - to handle state changes for only
     * //     the specific model retrieved via the .getModel call
     * //   - client.on(...) - to handle raw MFC server events, this is advanced
     *
     * // Then connect so that those events start processing.
     * client.connect();
     * @example <caption>If you need some logic to run after connection, use the promise chain</caption>
     * const mfc = require("MFCAuto");
     * const client = new mfc.Client();
     * client.connect()
     *      .then(() => {
     *          // Do whatever requires a connection here
     *      })
     *      .catch((reason) => {
     *          // Something went wrong
     *      });
     */
    public async connect(doLogin: boolean = true) {
        logWithLevel(LogLevel.DEBUG, `[CLIENT] connect(${doLogin}), state: ${ClientState[this._state]}`);
        if (this._state === ClientState.PENDING) {
            // If we're already trying to connect, just wait until that works
            return this.ensureConnected();
        } else if (this._state === ClientState.IDLE) {
            // If we're not already trying to connect, start trying
            this._choseToLogIn = doLogin;
            this._state = ClientState.PENDING;
            logWithLevel(LogLevel.DEBUG, `[CLIENT] State: ${this._state}`);
            return new Promise<void>((resolve, reject) => {
                // Reset any read buffers so we are in a consistent state
                this._streamBuffer = new Buffer(0);
                this._streamPosition = 0;
                this._streamWebSocketBuffer = "";

                // If we can't connect for any reason, we'll keep retrying
                // recursively forever, by design. Whenever we do eventually
                // manage to connect, we need to resolve this promise so
                // that callers can be assured we're always connected on
                // .then. If the user manually calls .disconnect() before
                // a connection can be established, we will reject the
                // returned promise.
                this.ensureConnected(this._options.connectionTimeout)
                    .then(() => resolve())
                    .catch((reason) => reject(reason));

                this._ensureServerConfigIsLoaded().then(() => {
                    if (!this._options.useWebSockets) {
                        // Use good old TCP sockets and the older Flash method of
                        // communicating with the MFC chat servers
                        const chatServer = (this._serverConfig as ServerConfig).chat_servers[Math.floor(Math.random() * (this._serverConfig as ServerConfig).chat_servers.length)];
                        logWithLevel(LogLevel.INFO, `Connecting to ${this._options.camYou ? "CamYou" : "MyFreeCams:"} chat server ${chatServer}...`);

                        this._client = net.connect(constants.FLASH_PORT, chatServer + `.${this._baseUrl}`, () => { // 'connect' listener
                            // Connecting without logging in is the rarer case, so make the default to log in
                            if (doLogin) {
                                this._disconnectIfNo(constants.FCTYPE.LOGIN, this._options.loginTimeout as number, "Server did not respond to the login request, retrying");
                                this.login();
                            }

                            this._state = ClientState.ACTIVE;
                            this._currentConnectionStartTime = Date.now();
                            logWithLevel(LogLevel.DEBUG, `[CLIENT] State: ${this._state}`);
                            Client._currentReconnectSeconds = Client._initialReconnectSeconds;
                            logWithLevel(LogLevel.DEBUG, `[CLIENT] emitting: CLIENT_CONNECTED, doLogin: ${doLogin}`);
                            this.emit("CLIENT_CONNECTED", doLogin);
                        });
                        this._client.on("data", (data: Buffer) => {
                            this._readData(data);
                        });
                        this._client.on("end", () => {
                            this._disconnected("Socket end");
                        });
                        this._client.on("error", (err) => {
                            this._disconnected(`Socket error: ${err}`);
                        });
                        this._client.on("close", () => {
                            this._disconnected("Socket close");
                        });
                    } else {
                        // Use websockets and the more modern way of
                        // communicating with the MFC chat servers
                        const wsSrvs = Object.getOwnPropertyNames((this._serverConfig as ServerConfig).websocket_servers);
                        const chatServer = wsSrvs[Math.floor(Math.random() * wsSrvs.length)];
                        logWithLevel(LogLevel.INFO, "Connecting to MyFreeCams websocket server " + chatServer + "...");

                        this._client = new WebSocket(`ws://${chatServer}.${this._baseUrl}:${constants.WEBSOCKET_PORT}/fcsl`, {
                            // protocol: this.serverConfig.websocket_servers[chatServer] as string,
                            origin: `https://m.${this._baseUrl}`,
                        });

                        this._client.on("open", () => {
                            (this._client as WebSocket).send("hello fcserver\n\0");

                            // Connecting without logging in is the rarer case, so make the default to log in
                            if (doLogin) {
                                this._disconnectIfNo(constants.FCTYPE.LOGIN, this._options.loginTimeout as number, "Server did not respond to the login request, retrying");
                                this.login();
                            }

                            this._state = ClientState.ACTIVE;
                            this._currentConnectionStartTime = Date.now();
                            logWithLevel(LogLevel.DEBUG, `[CLIENT] State: ${this._state}`);
                            Client._currentReconnectSeconds = Client._initialReconnectSeconds;
                            logWithLevel(LogLevel.DEBUG, `[CLIENT] emitting: CLIENT_CONNECTED, doLogin: ${doLogin}`);
                            this.emit("CLIENT_CONNECTED", doLogin);
                        });

                        this._client.on("message", (message) => {
                            this._readWebSocketData(message as string);
                        });

                        this._client.on("close", () => {
                            this._disconnected("WebSocket close");
                        });

                        this._client.on("error", (event) => {
                            this._disconnected(`WebSocket error: ${event.message} - ${event.error}`);
                        });
                    }

                    // Keep the server connection alive
                    this._keepAliveTimer = setInterval(
                        () => this._keepAlive(),
                        // WebSockets need the keepAlive ping every 15 seconds
                        // Flash Sockets need it only once every 2 minutes
                        // tslint:disable-next-line:no-magic-numbers
                        this._options.useWebSockets !== false ? 15 * 1000 : 120 * 1000,
                    );
                }).catch((reason) => {
                    this._disconnected(`Error while connecting: ${reason}`);
                });
            });
        }
    }

    /**
     * Internal MFCAuto use only
     *
     * Keeps the server collection alive by regularly sending NULL 'pings'.
     * Also monitors the connection to ensure traffic is flowing and kills
     * the connection if not. A setInterval loop calling this function is
     * creating when a connection is established and cleared on disconnect
     * @access private
     */
    private _keepAlive() {
        logWithLevel(LogLevel.DEBUG, `[CLIENT] _keepAlive() ${this._state}/${this._currentConnectionStartTime}`);
        if (this._state === ClientState.ACTIVE && this._currentConnectionStartTime) {
            const now = Date.now();
            const lastPacketDuration = now - (this._lastPacketTime || this._currentConnectionStartTime);
            const lastStatePacketDuration = now - (this._lastStatePacketTime || this._currentConnectionStartTime);

            if (lastPacketDuration > (this._options.silenceTimeout as number)
                || (this._choseToLogIn && lastStatePacketDuration > (this._options.stateSilenceTimeout as number))) {
                if (this._client !== undefined) {
                    logWithLevel(LogLevel.DEBUG, `[CLIENT] _keepAlive silence tripped, lastPacket: ${lastPacketDuration}, lastStatePacket: ${lastStatePacketDuration}`);
                    const msg = `Server has not responded for too long, forcing disconnect`;
                    logWithLevel(LogLevel.INFO, msg);
                    try {
                        if (this._client instanceof net.Socket) {
                            this._client.end();
                        } else {
                            this._client.close();
                        }
                    } catch (e) {
                        // Ignore
                    }
                    this._disconnected(msg);
                }
            } else {
                this.TxCmd(constants.FCTYPE.NULL, 0, 0, 0);
            }
        }
    }

    /**
     * Internal MFCAuto use only
     *
     * Helper utility that sets up a timer which will disconnect this client
     * after the given amount of time, if at least one instance of the given
     * packet type isn't received before then. Mainly used as a LOGIN timeout
     *
     * If the client disconnects on it own before the timer is up, no action
     * is taken
     * @param fctype
     * @param after
     * @param msg
     * @access private
     */
    private _disconnectIfNo(fctype: constants.FCTYPE, after: number, msg: string) {
        assert.notStrictEqual(this._state, ClientState.IDLE);
        const typeName = constants.FCTYPE[fctype] as ClientEventName;
        const timer = setTimeout(
            () => {
                logWithLevel(LogLevel.INFO, msg);
                if (this._client !== undefined) {
                    try {
                        if (this._client instanceof net.Socket) {
                            this._client.end();
                        } else {
                            this._client.close();
                        }
                    } catch (e) {
                        // Ignore
                    }
                }
                this._disconnected(msg);
            },
            after,
        );
        const stopper = () => {
            clearTimeout(timer);
        };

        this.once("CLIENT_MANUAL_DISCONNECT", stopper);
        this.once("CLIENT_DISCONNECTED", stopper);
        this.once(typeName, stopper);
        return timer;
    }

    /**
     * Returns a Promise that resolves when we have an active connection to the
     * server, which may be instantly or may be hours from now.
     *
     * When Client.connect (or .connectAndWaitForModels) is called, Client
     * will initiate a connection the MFC's chat servers and then try to
     * maintain an active connection forever. Of course, network issues happen
     * and the server connection may be lost temporarily. Client will try to
     * reconnect. However, many of the advanced features of Client, such as
     * .joinRoom, .sendChat, or .TxCmd, require an active connection and will
     * throw if there is not one at the moment.
     *
     * This is a helper function for those cases.
     *
     * This function does not *cause* connection or reconnection.
     * @param [timeout] Wait maximally this many milliseconds
     * Leave undefined for infinite, or set to -1 for no waiting.
     * @returns A Promise that resolves when a connection is present, either
     * because we were already connected or because we succeeded in our
     * reconnect attempt, and rejects when either the given timeout is reached
     * or client.disconnect() is called before we were able to establish a
     * connection. It also rejects if the user has not called .connect at all
     * yet.
     */
    public async ensureConnected(timeout?: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this._state === ClientState.IDLE) {
                // We're not connected or attempting to reconnect
                reject(new Error("Call connect() or connectAndWaitForModels() before attempting this"));
            } else if (this._state === ClientState.ACTIVE) {
                // We're apparently already connected
                resolve();
            } else if (timeout === -1) {
                // Doesn't look like we're connected but the caller asked
                // to not wait for connection, bail
                reject(new Error("Not currently connected"));
            } else {
                // Doesn't look like we're connected, set up all the listeners
                // required to wait for reconnection or timeout
                let timer: NodeJS.Timer | undefined;
                let resolver: () => void, rejecter: () => void;
                if (timeout) {
                    timer = setTimeout(
                        () => {
                            this.removeListener("CLIENT_MANUAL_DISCONNECT", rejecter);
                            this.removeListener("CLIENT_CONNECTED", resolver);
                            reject(new Error(`Timeout before connection could be established: ${timeout}ms`));
                        },
                        timeout,
                    );
                }
                resolver = () => {
                    this.removeListener("CLIENT_MANUAL_DISCONNECT", rejecter);
                    if (timer) {
                        clearTimeout(timer);
                    }
                    resolve();
                };
                rejecter = () => {
                    this.removeListener("CLIENT_CONNECTED", resolver);
                    if (timer) {
                        clearTimeout(timer);
                    }
                    reject(new Error("disconnect() requested before connection could be established"));
                };
                this.prependOnceListener("CLIENT_MANUAL_DISCONNECT", rejecter);
                this.prependOnceListener("CLIENT_CONNECTED", resolver);
            }
        });
    }

    /**
     * Internal MFCAuto use only
     *
     * Called by internal components when it's detected that we've lost our
     * connection to the server. It handles some cleanup tasks and the
     * reconnect logic. Users should definitely not be calling this function.
     * @access private
     */
    private _disconnected(reason: string) {
        if (this._state !== ClientState.IDLE) {
            logWithLevel(LogLevel.INFO, `Disconnected from ${this._baseUrl} - ${reason}`);
            this._completedModels = false;
            this._completedTags = false;
            this._client = undefined;
            this._currentConnectionStartTime = undefined;
            this._lastPacketTime = undefined;
            this._lastStatePacketTime = undefined;
            if (this._keepAliveTimer !== undefined) {
                clearInterval(this._keepAliveTimer);
                this._keepAliveTimer = undefined;
            }
            if (this._choseToLogIn === true && Client._connectedClientCount > 0) {
                Client._connectedClientCount--;
                logWithLevel(LogLevel.DEBUG, `[CLIENT] connectedClientCount: ${Client._connectedClientCount}`);
            }
            if (this.password === "guest" && this.username.startsWith("Guest")) {
                // If we had a successful guest login before, we'll have changed
                // username to something like Guest12345 or whatever the server assigned
                // to us. That is not valid to log in again, so reset it back to guest.
                this.username = "guest";
            }
            if (!this._manualDisconnect) {
                this._state = ClientState.PENDING;
                logWithLevel(LogLevel.DEBUG, `[CLIENT] State: ${this._state}`);
                logWithLevel(LogLevel.INFO, `Reconnecting in ${Client._currentReconnectSeconds} seconds...`);
                clearTimeout(this._reconnectTimer as NodeJS.Timer);
                // tslint:disable:align no-magic-numbers
                this._reconnectTimer = setTimeout(() => {
                    // Set us to IDLE briefly so that .connect
                    // will not ignore the request. It will set
                    // the state back to PENDING before turning
                    // over execution
                    this._state = ClientState.IDLE;
                    this.connect(this._choseToLogIn).catch((r) => {
                        this._disconnected(`Reconnection failed: ${r}`);
                    });
                    this._reconnectTimer = undefined;
                }, Client._currentReconnectSeconds * 1000);
                // tslint:enable:align no-magic-numbers

                // Gradually increase the reconnection time up to Client.maximumReconnectSeconds.
                // currentReconnectSeconds will be reset to initialReconnectSeconds once we have
                // successfully logged in.
                if (Client._currentReconnectSeconds < Client._maximumReconnectSeconds) {
                    Client._currentReconnectSeconds *= Client._reconnectBackOffMultiplier;
                }
            } else {
                this._state = ClientState.IDLE;
                logWithLevel(LogLevel.DEBUG, `[CLIENT] State: ${this._state}`);
                this._manualDisconnect = false;
            }
            logWithLevel(LogLevel.DEBUG, `[CLIENT] emitting: CLIENT_DISCONNECTED, _choseToLogIn: ${this._choseToLogIn}`);
            this.emit("CLIENT_DISCONNECTED", this._choseToLogIn);
            if (Client._connectedClientCount === 0) {
                Model.reset();
            }
        }
    }

    /**
     * Logs in to MFC. This should only be called after Client connect(false);
     * See the comment on Client's constructor for details on the password to use.
     */
    public login(username?: string, password?: string): void {
        // connectedClientCount is used to track when all clients receiving SESSIONSTATE
        // updates have disconnected, and as those are only sent for logged-in clients,
        // we shouldn't increment the counter for non-logged-in clients
        Client._connectedClientCount++;
        this._choseToLogIn = true;
        logWithLevel(LogLevel.DEBUG, `[CLIENT] _connectedClientCount: ${Client._connectedClientCount}`);

        if (username !== undefined) {
            this.username = username;
        }
        if (password !== undefined) {
            this.password = password;
        }

        let localUsername = this.username;
        if (this._options.camYou) {
            localUsername = "2/" + localUsername;
        }

        if (!this._options.useWebSockets) {
            this.TxCmd(constants.FCTYPE.LOGIN, 0, constants.LOGIN_VERSION.FLASH, 0, localUsername + ":" + this.password);
        } else {
            this.TxCmd(constants.FCTYPE.LOGIN, 0, constants.LOGIN_VERSION.WEBSOCKET, 0, localUsername + ":" + this.password);
        }
    }

    /**
     * Connects to MFC and logs in, just like this.connect(true),
     * but in this version the resolves when the initial list of
     * online models has been fully populated.
     * If you're logged in as a user with friended models, this will
     * also wait until your friends list is completely loaded.
     *
     * This method always logs in, because MFC servers won't send information
     * for all online models until you've logged as at least a guest.
     * @returns A promise that resolves when the model list is complete
     */
    public async connectAndWaitForModels() {
        if (this._state !== ClientState.ACTIVE) {
            return new Promise<void>((resolve, reject) => {
                this.prependOnceListener("CLIENT_MODELSLOADED", resolve);
                this.connect(true).catch((r) => reject(r));
            });
        }
    }

    /**
     * Disconnects a connected client instance
     * @returns A promise that resolves when the disconnect is complete
     */
    public async disconnect(): Promise<void> {
        logWithLevel(LogLevel.DEBUG, `[CLIENT] disconnect(), state: ${ClientState[this._state]}`);
        if (this._state !== ClientState.IDLE) {
            return new Promise<void>((resolve) => {
                this.emit("CLIENT_MANUAL_DISCONNECT");
                this._manualDisconnect = true;
                if (this._keepAliveTimer !== undefined) {
                    clearInterval(this._keepAliveTimer);
                    this._keepAliveTimer = undefined;
                }
                if (this._reconnectTimer !== undefined) {
                    clearTimeout(this._reconnectTimer);
                    this._reconnectTimer = undefined;
                }
                if (this._state === ClientState.ACTIVE) {
                    this.prependOnceListener("CLIENT_DISCONNECTED", () => {
                        resolve();
                    });
                }
                if (this._client !== undefined) {
                    if (this._client instanceof net.Socket) {
                        this._client.end();
                    } else {
                        this._client.close();
                    }
                }

                // If we're not currently connected, then calling
                // this._client.end() will not cause CLIENT_DISCONNECTED
                // to be emitted, so we shouldn't wait for that.
                if (this._state !== ClientState.ACTIVE) {
                    this._state = ClientState.IDLE;
                    logWithLevel(LogLevel.DEBUG, `[CLIENT] State: ${this._state}`);
                    this._manualDisconnect = false;
                    resolve();
                }
            });
        }
    }
}

export type ClientEventCallback = ((packet: Packet) => void) | (() => void);
/** Possible Client states */
export type ClientStates = "IDLE" | "PENDING" | "ACTIVE";
/** Possible Client events */
export type ClientEventName = "CLIENT_MANUAL_DISCONNECT" | "CLIENT_DISCONNECTED" | "CLIENT_MODELSLOADED" | "CLIENT_CONNECTED" | "ANY" | "UNKNOWN" | "NULL" | "LOGIN" | "ADDFRIEND" | "PMESG" | "STATUS" | "DETAILS" | "TOKENINC" | "ADDIGNORE" | "PRIVACY" | "ADDFRIENDREQ" | "USERNAMELOOKUP" | "ZBAN" | "BROADCASTNEWS" | "ANNOUNCE" | "MANAGELIST" | "INBOX" | "GWCONNECT" | "RELOADSETTINGS" | "HIDEUSERS" | "RULEVIOLATION" | "SESSIONSTATE" | "REQUESTPVT" | "ACCEPTPVT" | "REJECTPVT" | "ENDSESSION" | "TXPROFILE" | "STARTVOYEUR" | "SERVERREFRESH" | "SETTING" | "BWSTATS" | "TKX" | "SETTEXTOPT" | "SERVERCONFIG" | "MODELGROUP" | "REQUESTGRP" | "STATUSGRP" | "GROUPCHAT" | "CLOSEGRP" | "UCR" | "MYUCR" | "SLAVECON" | "SLAVECMD" | "SLAVEFRIEND" | "SLAVEVSHARE" | "ROOMDATA" | "NEWSITEM" | "GUESTCOUNT" | "PRELOGINQ" | "MODELGROUPSZ" | "ROOMHELPER" | "CMESG" | "JOINCHAN" | "CREATECHAN" | "INVITECHAN" | "KICKCHAN" | "QUIETCHAN" | "BANCHAN" | "PREVIEWCHAN" | "SHUTDOWN" | "LISTBANS" | "UNBAN" | "SETWELCOME" | "CHANOP" | "LISTCHAN" | "TAGS" | "SETPCODE" | "SETMINTIP" | "UEOPT" | "HDVIDEO" | "METRICS" | "OFFERCAM" | "REQUESTCAM" | "MYWEBCAM" | "MYCAMSTATE" | "PMHISTORY" | "CHATFLASH" | "TRUEPVT" | "BOOKMARKS" | "EVENT" | "STATEDUMP" | "RECOMMEND" | "EXTDATA" | "NOTIFY" | "PUBLISH" | "XREQUEST" | "XRESPONSE" | "EDGECON" | "ZGWINVALID" | "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "LOGOUT";
type EmoteParserCallback = (parsedString: string, aMsg2: { txt: string; url: string; code: string }[]) => void;
interface EmoteParser {
    Process(msg: string, callback: EmoteParserCallback): void;
    setUrl(url: string): void;
}
interface ServerConfig {
    ajax_servers: string[];
    chat_servers: string[];
    h5video_servers: { [index: number]: string };
    release: boolean;
    video_servers: string[];
    websocket_servers: { [index: string]: string };
}
export interface ClientOptions {
    useWebSockets?: boolean;
    camYou?: boolean;
    useCachedServerConfig?: boolean;
    silenceTimeout?: number;
    stateSilenceTimeout?: number;
    loginTimeout?: number;
    connectionTimeout?: number;
}
