# MFCAuto API Reference
## Classes

<dl>
<dt><a href="#Client">Client</a></dt>
<dd><p>Creates and maintains a connection to MFC chat servers</p>
<p>Client instances are <a href="https://nodejs.org/api/all.html#events_class_eventemitter">NodeJS EventEmitters</a>
and will emit an event every time a Packet is received from the server. The
event will be named after the FCType of the Packet. See
<a href="https://github.com/ZombieAlex/MFCAuto/blob/master/src/main/Constants.ts#L350">FCTYPE in ./src/main/Constants.ts</a>
for the complete list of possible events.</p>
<p>Listening for Client events is an advanced feature and requires some
knowledge of MFC&#39;s chat server protocol, which will not be documented here.
Where possible, listen for events on <a href="#Model">Model</a> instead.</p>
</dd>
<dt><a href="#Model">Model</a></dt>
<dd><p>Model represents a single MFC model. The Model constructor also serves as a
static repository of all models.</p>
<p>Both the Model constructor and individual instances are <a href="https://nodejs.org/api/all.html#events_class_eventemitter">NodeJS EventEmitters</a>
and will emit events when any property of a model changes, including room
topic, camscore, Miss MFC rank, tags, online/offline/free chat/private/group
show status and many other events.</p>
<p><b>Listening for these events is the fastest way to know when something changes
for a model on MFC, bar none.</b> MFCAuto is not polling MFC for this
information, it is registering as a proper client for MFC&#39;s chat controller
servers and being told by the server the instant that anything changes.</p>
<p>In most cases, Model event callbacks will be invoked more quickly than you
will see the model&#39;s state update in the browser because MFC&#39;s browser code
throttles the display of updates from the server. MFCAuto has no such
limitations.</p>
</dd>
<dt><a href="#Packet">Packet</a></dt>
<dd><p>Packet represents a single, complete message received from the chat server</p>
</dd>
</dl>

<a name="Client"></a>

## Client
Creates and maintains a connection to MFC chat servers

Client instances are [NodeJS EventEmitters](https://nodejs.org/api/all.html#events_class_eventemitter)
and will emit an event every time a Packet is received from the server. The
event will be named after the FCType of the Packet. See
[FCTYPE in ./src/main/Constants.ts](https://github.com/ZombieAlex/MFCAuto/blob/master/src/main/Constants.ts#L350)
for the complete list of possible events.

Listening for Client events is an advanced feature and requires some
knowledge of MFC's chat server protocol, which will not be documented here.
Where possible, listen for events on [Model](#Model) instead.

**Kind**: global class

* [Client](#Client)
    * [new Client([username], [password], [options])](#new_Client_new)
    * _instance_
        * [.connect([doLogin])](#Client+connect)
        * [.connectAndWaitForModels()](#Client+connectAndWaitForModels)
        * [.disconnect()](#Client+disconnect)
        * [.ensureConnected([timeout])](#Client+ensureConnected)
        * [.joinRoom(id)](#Client+joinRoom)
        * [.leaveRoom(id)](#Client+leaveRoom)
        * [.login()](#Client+login)
        * [.on()](#Client+on)
        * [.once()](#Client+once)
        * [.queryUser(user)](#Client+queryUser)
        * [.removeListener()](#Client+removeListener)
        * [.sendChat(id, msg)](#Client+sendChat)
        * [.sendPM(id, msg)](#Client+sendPM)
        * [.state](#Client+state)
        * [.TxCmd(nType, nTo, nArg1, nArg2, sMsg)](#Client+TxCmd)
        * [.TxPacket(packet)](#Client+TxPacket)
        * [.uptime](#Client+uptime)
    * _static_
        * [.toRoomId(id, [camYou])](#Client.toRoomId)
        * [.toUserId(id)](#Client.toUserId)

<a name="new_Client_new"></a>

### new Client([username], [password], [options])
Client constructor


| Param | Default | Description |
| --- | --- | --- |
| [username] | <code>guest</code> | Either "guest" or a real MFC member account name, default is "guest" |
| [password] | <code>guest</code> | Either "guest" or, to log in with a real account the password should be a hash of your real password and NOT your actual plain text password. You can discover the appropriate string to use by checking your browser cookies after logging in via your browser.  In Firefox, go to Options->Privacy and then "Show Cookies..." and search for "myfreecams".  You will see one cookie named "passcode". Select it and copy the value listed as "Content". It will be a long string of lower case letters that looks like gibberish. *That* is the password to use here. |
| [options] |  | A ClientOptions object detailing several optional Client settings like whether to use WebSockets or traditional TCP sockets and whether to connect to MyFreeCams.com or CamYou.com |

<a name="Client+connect"></a>

### client.connect([doLogin])
Connects to MFC

Logging in is optional because not all queries to the server require you to log in.
For instance, MFC servers will respond to a USERNAMELOOKUP request without
requiring a login. However for most cases you probably do want to log in.

**Kind**: instance method of [<code>Client</code>](#Client)
**Returns**: A promise that resolves when the connection has been established

| Param | Default | Description |
| --- | --- | --- |
| [doLogin] | <code>true</code> | If True, log in with the credentials provided at Client construction. If False, do not log in. Default is True |

**Example** *(Most common case is simply to connect, log in, and start processing events)*
```js
const mfc = require("MFCAuto");
const client = new mfc.Client();

// Set up any desired callback hooks here using one or more of:
//   - mfc.Model.on(...) - to handle state changes for all models
//   - mfc.Model.getModel(...).on(...) - to handle state changes for only
//     the specific model retrieved via the .getModel call
//   - client.on(...) - to handle raw MFC server events, this is advanced

// Then connect so that those events start processing.
client.connect();
```
**Example** *(If you need some logic to run after connection, use the promise chain)*
```js
const mfc = require("MFCAuto");
const client = new mfc.Client();
client.connect()
     .then(() => {
         // Do whatever requires a connection here
     })
     .catch((reason) => {
         // Something went wrong
     });
```
<a name="Client+connectAndWaitForModels"></a>

### client.connectAndWaitForModels()
Connects to MFC and logs in, just like this.connect(true),
but in this version the returned promise resolves when the initial
list of online models has been fully populated.
If you're logged in as a user with friended models, this will
also wait until your friends list is completely loaded.

This method always logs in, because MFC servers won't send information
for all online models until you've logged as at least a guest.

**Kind**: instance method of [<code>Client</code>](#Client)
**Returns**: A promise that resolves when the model list is complete
<a name="Client+disconnect"></a>

### client.disconnect()
Disconnects a connected client instance

**Kind**: instance method of [<code>Client</code>](#Client)
**Returns**: A promise that resolves when the disconnect is complete
<a name="Client+ensureConnected"></a>

### client.ensureConnected([timeout])
Returns a Promise that resolves when we have an active connection to the
server, which may be instantly or may be hours from now.

When Client.connect (or .connectAndWaitForModels) is called, Client
will initiate a connection the MFC's chat servers and then try to
maintain an active connection forever. Of course, network issues happen
and the server connection may be lost temporarily. Client will try to
reconnect. However, many of the advanced features of Client, such as
.joinRoom, .sendChat, or .TxCmd, require an active connection and will
throw if there is not one at the moment.

This is a helper function for those cases.

This function does not *cause* connection or reconnection.

**Kind**: instance method of [<code>Client</code>](#Client)
**Returns**: A Promise that resolves when a connection is present, either
because we were already connected or because we succeeded in our
reconnect attempt, and rejects when either the given timeout is reached
or client.disconnect() is called before we were able to establish a
connection. It also rejects if the user has not called .connect at all
yet.

| Param | Description |
| --- | --- |
| [timeout] | Wait maximally this many milliseconds Leave undefined for infinite, or set to -1 for no waiting. |

<a name="Client+joinRoom"></a>

### client.joinRoom(id)
Joins the public chat room of the given model

**Kind**: instance method of [<code>Client</code>](#Client)
**Returns**: A promise that resolves after successfully
joining the chat room and rejects if the join fails
for any reason (you're banned, region banned, or
you're a guest and the model is not online)

| Param | Description |
| --- | --- |
| id | Model ID or room/channel ID to join |

<a name="Client+leaveRoom"></a>

### client.leaveRoom(id)
Leaves the public chat room of the given model

**Kind**: instance method of [<code>Client</code>](#Client)
**Returns**: A promise that resolves immediately

| Param | Description |
| --- | --- |
| id | Model ID or room/channel ID to leave |

<a name="Client+login"></a>

### client.login()
Logs in to MFC. This should only be called after Client connect(false);
See the comment on Client's constructor for details on the password to use.

**Kind**: instance method of [<code>Client</code>](#Client)
<a name="Client+on"></a>

### client.on()
[EventEmitter](https://nodejs.org/api/all.html#events_class_eventemitter) method
See [FCTYPE in ./src/main/Constants.ts](https://github.com/ZombieAlex/MFCAuto/blob/master/src/main/Constants.ts#L350) for all possible event names

**Kind**: instance method of [<code>Client</code>](#Client)
<a name="Client+once"></a>

### client.once()
[EventEmitter](https://nodejs.org/api/all.html#events_class_eventemitter) method
See [FCTYPE in ./src/main/Constants.ts](https://github.com/ZombieAlex/MFCAuto/blob/master/src/main/Constants.ts#L350) for all possible event names

**Kind**: instance method of [<code>Client</code>](#Client)
<a name="Client+queryUser"></a>

### client.queryUser(user)
Queries MFC for the latest state of a model or member

This method does poll the server for the latest model status, which can
be useful in some situations, but it is **not the quickest way to know
when a model's state changes**. Instead, to know the instant a model
enters free chat, keep a Client connected and listen for changes on her
Model instance. For example:

  ```javascript
  // Register a callback whenever AspenRae's video
  // state changes
  mfc.Model.getModel(3111899)
    .on("vs", (model, before, after) => {
      // This will literally be invoked faster than
      // you would see her cam on the website.
      // There is no faster way.
      if (after === mfc.STATE.FreeChat) {
        // She's in free chat now!
      }
  });
  ```

**Kind**: instance method of [<code>Client</code>](#Client)
**Returns**: A promise that resolves with a Message
containing the user's current details or undefined
if the given user was not found

| Param | Description |
| --- | --- |
| user | Model or member name or ID |

**Example**
```js
// Query a user, which happens to be a model, by name
client.queryUser("AspenRae").then((msg) => {
    if (msg === undefined) {
        console.log("AspenRae probably temporarily changed her name");
    } else {
        //Get the full Model instance for her
        let AspenRae = mfc.Model.getModel(msg.uid);
        //Do stuff here...
    }
});

// Query a user by ID number
client.queryUser(3111899).then((msg) => {
    console.log(JSON.stringify(msg));
    //Will print something like:
    //  {"sid":0,"uid":3111899,"nm":"AspenRae","lv":4,"vs":127}
});

// Query a member by name and check their status
client.queryUser("MyPremiumMemberFriend").then((msg) => {
    if (msg) {
        if (msg.vs !== mfc.STATE.Offline) {
            console.log("My friend is online!");
        } else {
            console.log("My friend is offline");
        }
    } else {
        console.log("My friend no longer exists by that name");
    }
});

// Force update a model's status, without caring about the result here
// Potentially useful when your logic is in model state change handlers
client.queryUser(3111899);
```
<a name="Client+removeListener"></a>

### client.removeListener()
[EventEmitter](https://nodejs.org/api/all.html#events_class_eventemitter) method
See [FCTYPE in ./src/main/Constants.ts](https://github.com/ZombieAlex/MFCAuto/blob/master/src/main/Constants.ts#L350) for all possible event names

**Kind**: instance method of [<code>Client</code>](#Client)
<a name="Client+sendChat"></a>

### client.sendChat(id, msg)
Send chat to a model's public chat room

If the message is one you intend to send more than once,
and your message contains emotes, you can save some processing
overhead by calling client.encodeRawChat once for the string,
caching the result of that call, and passing that string here.

Note that you must have previously joined the model's chat room
for the message to be sent successfully.

**Kind**: instance method of [<code>Client</code>](#Client)
**Returns**: A promise that resolves after the text has
been sent to the server. There is no check on success and
the message may fail to be sent if you are muted or ignored
by the model

| Param | Description |
| --- | --- |
| id | Model or room/channel ID to send the chat to |
| msg | Text to be sent, can contain emotes |

<a name="Client+sendPM"></a>

### client.sendPM(id, msg)
Send a PM to the given model or member

If the message is one you intend to send more than once,
and your message contains emotes, you can save some processing
overhead by calling client.encodeRawChat once for the string,
caching the result of that call, and passing that string here.

**Kind**: instance method of [<code>Client</code>](#Client)
**Returns**: A promise that resolves after the text has
been sent to the server. There is no check on success and
the message may fail to be sent if you are muted or ignored
by the model or member

| Param | Description |
| --- | --- |
| id | Model or member ID to send the PM to |
| msg | Text to be sent, can contain emotes |

<a name="Client+state"></a>

### client.state
Current server connection state:
- IDLE: Not currently connected to MFC and not trying to connect
- PENDING: Actively trying to connect to MFC but not currently connected
- ACTIVE: Currently connected to MFC

If this client is PENDING and you wish to wait for it to enter ACTIVE,
use [client.ensureConnected](#clientensureconnectedtimeout).

**Kind**: instance property of [<code>Client</code>](#Client)
<a name="Client+TxCmd"></a>

### client.TxCmd(nType, nTo, nArg1, nArg2, sMsg)
Sends a command to the MFC chat server. Don't use this unless
you really know what you're doing.

**Kind**: instance method of [<code>Client</code>](#Client)

| Param | Default | Description |
| --- | --- | --- |
| nType |  | FCTYPE of the message |
| nTo | <code>0</code> | Number representing the channel or entity the message is for. This is often left as 0. |
| nArg1 | <code>0</code> | First argument of the message. Its meaning varies depending on the FCTYPE of the message. Often left as 0. |
| nArg2 | <code>0</code> | Second argument of the message. Its meaning varies depending on the FCTYPE of the message. Often left as 0. |
| sMsg |  | Payload of the message. Its meaning varies depending on the FCTYPE of the message and is sometimes is stringified JSON. Most often this should remain undefined. |

<a name="Client+TxPacket"></a>

### client.TxPacket(packet)
Sends a command to the MFC chat server. Don't use this unless
you really know what you're doing.

**Kind**: instance method of [<code>Client</code>](#Client)

| Param | Description |
| --- | --- |
| packet | Packet instance encapsulating the command to be sent |

<a name="Client+uptime"></a>

### client.uptime
How long the current client has been connected to a server
in milliseconds. Or 0 if this client is not currently connected

**Kind**: instance property of [<code>Client</code>](#Client)
<a name="Client.toRoomId"></a>

### Client.toRoomId(id, [camYou])
Takes a number that might be a user id or a room id and converts
it to a room id (if necessary)

**Kind**: static method of [<code>Client</code>](#Client)
**Returns**: The free chat room/channel ID corresponding to the given ID

| Param | Default | Description |
| --- | --- | --- |
| id |  | A number that is either a model ID or a room/channel ID |
| [camYou] | <code>false</code> | True if the ID calculation should be done for CamYou.com. False if the ID calculation should be done for MFC. Default is False |

<a name="Client.toUserId"></a>

### Client.toUserId(id)
Takes a number that might be a user id or a room id and converts
it to a user id (if necessary). The functionality here maps to
MFC's GetRoomOwnerId() within top.js

**Kind**: static method of [<code>Client</code>](#Client)
**Returns**: The model ID corresponding to the given id

| Param | Description |
| --- | --- |
| id | A number that is either a model ID or room/channel ID |

<a name="Model"></a>

## Model
Model represents a single MFC model. The Model constructor also serves as a
static repository of all models.

Both the Model constructor and individual instances are [NodeJS EventEmitters](https://nodejs.org/api/all.html#events_class_eventemitter)
and will emit events when any property of a model changes, including room
topic, camscore, Miss MFC rank, tags, online/offline/free chat/private/group
show status and many other events.

Listening for these events is the fastest way to know when something changes
for a model on MFC, bar none. MFCAuto is not polling MFC for this
information, it is registering as a proper client for MFC's chat controller
servers and being told by the server the instant that anything changes.

In most cases, Model event callbacks will be invoked more quickly than you
will see the model's state update in the browser because MFC's browser code
throttles the display of updates from the server. MFCAuto has no such
limitations.

**Kind**: global class

* [Model](#Model)
    * _instance_
        * [.bestSession](#Model+bestSession)
        * [.getSocialMedia()](#Model+getSocialMedia)
        * [.on(event, listener)](#Model+on)
        * [.once(event, listener)](#Model+once)
        * [.removeListener()](#Model+removeListener)
        * [.removeWhen(condition)](#Model+removeWhen)
        * [.tags](#Model+tags)
        * [.when(condition, onTrue, [onFalseAfterTrue])](#Model+when)
    * _static_
        * [.findModels(filter)](#Model.findModels)
        * [.getModel(id, [createIfNecessary])](#Model.getModel)
        * [.knownModels](#Model.knownModels)
        * [.on](#Model.on)
        * [.once](#Model.once)
        * [.removeListener](#Model.removeListener)
        * [.removeWhen(condition)](#Model.removeWhen)
        * [.when(condition, onTrue, [onFalseAfterTrue])](#Model.when)

<a name="Model+bestSession"></a>

### model.bestSession
The most accurate session for this model

bestSession can potentially contain any or all of these properties and
possibly more as MFC updates its chat protocol

|Property name|Type|Description|
|---|---|---|
|age|number|Model's age, if she specified one
|basics_muted|number|0 if basics are not muted in the model's room, 1 if they are
|blurb|string|The model's bio blurb which shows at the top of their profile and directly under their name in the user menu
|camscore|number|The model's current camscore
|camserv|number|What video server is currently hosting her stream
|chat_bg|number|Chat background color
|chat_color|string|Chat color as a hex RGB value
|chat_font|number|Chat font represented as an integer indexing into a set list of fonts
|city|string|User provided city details (often a lie, there's no validation here)
|continent|string|Two letter continent abbreviation such as "EU", "SA", "NA" etc for the model's current IP address based on geo-location data. Note that many models use VPNs so their IP geolocation may not accurately reflect their real world location
|country|string|User provided country details (often a lie, but must one of a standard set of real countries)
|creation|number|Timestamp of the model's account creation
|ethnic|string|Model's user provided ethnicity
|guests_muted|number|0 if guests are not muted in the model's room, 1 if they are
|hidecs|boolean|If true, the model is hiding her camscore on the website (.bestSession.camscore will still have her camscore)
|kbit|number|This used to contain the upstream bandwidth of the model, but is now always 0
|lastnews|number|The timestamp of the model's last newsfeed entry
|missmfc|number|A number indicating whether a model has been in the top 3 of Miss MFC before or not
|model_sw|number|1 if the model is logged in via the model software, 0 if they are using the website instead
|new_model|number|1 if this model is considered "new" and 0 if she isn't
|nm|string|The model's current name
|occupation|string|Model's user provided occupation
|photos|number|A count of the number of photos on the model's profile
|pid|number|1 if this model is on MFC, 2 if she's on CamYou
|profile|number|1 if this user has a profile or 0 if not
|rank|number|The model's current Miss MFC rank for this month, or 0 if the model is ranked greater than 1000
|rc|number|The number of people in the model's room
|share_albums|number|Count of albums on MFC Share
|share_clubs|number|Count of clubs on MFC Share
|share_collections|number|Count of collections on MFC Share
|share_follows|number|Count of followers on MFC Share
|share_stores|number|Count of items on MFC Share (things like SnapChat)
|share_tm_album|number|Timestamp of most recent MFC Share album
|sid|number|The model's MFC session ID
|topic|string|The model's current room topic
|truepvt|number|If a model is in vs STATE.Private and this value is 1, then that private is a true private. There is no unique state for true private, you have to check both vs and truepvt values.
|uid|number|The model's user ID
|vs|A number mapping to [FCVIDEO](https://github.com/ZombieAlex/MFCAuto/blob/master/src/main/Constants.ts#L493) or the more friendly form, [STATE](https://github.com/ZombieAlex/MFCAuto/blob/master/src/main/Constants.ts#L10)|The general status of a model (online, offline, away, freechat, private, or groupshow). There are many other status possibilities, but those are the ones you likely care about.

**Kind**: instance property of [<code>Model</code>](#Model)
<a name="Model+getSocialMedia"></a>

### model.getSocialMedia()
Retrieves social media details for this model. This
will include any Twitter or Instagram account she has
listed with MFC as well as some basic MFC Share details

**Kind**: instance method of [<code>Model</code>](#Model)
**Returns**: A promise that resolves with a ModelSocialMedia
object or undefined
<a name="Model+on"></a>

### model.on(event, listener)
[EventEmitter](https://nodejs.org/api/all.html#events_class_eventemitter)
method that registers a callback for change events on this model

This variant will listen for changes on the current model. To listen for
changes on *all* models use the [model.on instance method](#modelon-1)

**Kind**: instance method of [<code>Model</code>](#Model)

| Param | Description |
| --- | --- |
| event | "uid", "tags", "nm" or any of the property names of [model.bestSession](#modelbestsession) |
| listener | A callback to be invoked whenever the property indicated by the event name changes for this model. The callback will be given 3 parameters: this model instance, the value of the property before the change, and the value of the property after the change. |

**Example**
```js
// Print to the console whenever AspenRae's video state changes
const mfc = require("MFCAuto");
const client = new mfc.Client();
const AspenRae = mfc.Model.getModel(3111899);

AspenRae.on("vs", (model, before, after) => {
     console.log(`AspenRae's state changed to ${mfc.STATE[after]}`);
});

client.connect();
```
<a name="Model+once"></a>

### model.once(event, listener)
[EventEmitter](https://nodejs.org/api/all.html#events_class_eventemitter)
method like model.on but the registered callback is only invoked once,
on the first instance of the given event

**Kind**: instance method of [<code>Model</code>](#Model)

| Param | Description |
| --- | --- |
| event | "uid", "tags", "nm" or any of the property names of [model.bestSession](#modelbestsession) |
| listener | A callback to be invoked whenever the property indicated by the event name changes for this model. The callback will be given 3 parameters: this model instance, the value of the property before the change, and the value of the property after the change. |

<a name="Model+removeListener"></a>

### model.removeListener()
[EventEmitter](https://nodejs.org/api/all.html#events_class_eventemitter)
method that removes a listener callback previously registered with
model.on or model.once

**Kind**: instance method of [<code>Model</code>](#Model)
<a name="Model+removeWhen"></a>

### model.removeWhen(condition)
Removes a when callback previously registered with model.when

**Kind**: instance method of [<code>Model</code>](#Model)
**Returns**: True if the given function was successfully removed,
false if it was not found as a registered when callback

| Param | Description |
| --- | --- |
| condition | A Function that had previously been registered as a condition filter |

<a name="Model+tags"></a>

### model.tags
The model's Tags

**Kind**: instance property of [<code>Model</code>](#Model)
<a name="Model+when"></a>

### model.when(condition, onTrue, [onFalseAfterTrue])
Registers callback for when this model when starts matching a
specific condition and, optionally, when she then stops matching the
condition

**Kind**: instance method of [<code>Model</code>](#Model)

| Param | Description |
| --- | --- |
| condition | Function that takes a Model instance and returns true if she matches the target condition, false if she doesn't |
| onTrue | Function that will be invoked when this model starts matching the condition. It is given the model instance and the message that caused her to start matching the condition as parameters |
| [onFalseAfterTrue] | If not left undefined, this Function will be invoked when this model was previously matching the condition and has stopped matching the condition. |

**Example**
```js
const AspenRae = mfc.Model.getModel(3111899);
AspenRae.when(
    (m) => m.bestSession.vs !== mfc.STATE.Offline,
    (m) => console.log('AspenRae has logged on!'),
    (m) => console.log('AspenRae has logged off')
)
```
<a name="Model.findModels"></a>

### Model.findModels(filter)
Retrieves a list of models matching the given filter

**Kind**: static method of [<code>Model</code>](#Model)
**Returns**: An array of Model instances matching the filter function

| Param | Description |
| --- | --- |
| filter | A filter function that takes a Model instance and returns a boolean indicating whether the model should be returned, True, or not, False |

<a name="Model.getModel"></a>

### Model.getModel(id, [createIfNecessary])
Retrieves a specific model instance by user id from knownModels, creating
the model instance if it does not already exist.

**Kind**: static method of [<code>Model</code>](#Model)
**Returns**: The Model instance for the given model, or undefined if the model
does not exist and createIfNecessary was False

| Param | Default | Description |
| --- | --- | --- |
| id |  | Model id of the model to retrieve. It should be a valid model ID. The [first example here](https://github.com/ZombieAlex/MFCAuto/blob/master/README.md) has one way to discover a model's ID, using MFCAuto and client.queryUser.  Another, simpler, way is to open a model's chat room as a "Popup" and look at the URL of that room.  In the URL, there will be a portion that says "broadcaster_id=3111899".  That number is that model's ID. |
| [createIfNecessary] | <code>true</code> | If the model is not found in Model.knownModels and this value is True, the default, a new model instance will be created for her and returned. If the model is not found and this value is False undefined will be returned. |

<a name="Model.knownModels"></a>

### Model.knownModels
Map of all known models that is built up as we receive model
information from the server. This should not usually be accessed
directly. If you wish to access a specific model, use
[Model.getModel](#modelgetmodelid-createifnecessary) instead.

**Kind**: static property of [<code>Model</code>](#Model)
<a name="Model.on"></a>

### Model.on
[EventEmitter](https://nodejs.org/api/all.html#events_class_eventemitter)
method that registers a callback for model change events.

This variant will listen for changes on *all* models. To listen for
changes on one specific model use the [model.on instance method](#modelon)

**Kind**: static property of [<code>Model</code>](#Model)

| Param | Description |
| --- | --- |
| event | "uid", "tags", "nm" or any of the property names of [model.bestSession](#modelbestsession) |
| listener | A callback to be invoked whenever the property indicated by the event name changes for any model. The callback will be given 3 parameters: the model instance that changed, the value of the property before the change, and the value of the property after the change: |

**Example**
```js
// Print to the console whenever any model's video state changes
const mfc = require("MFCAuto");
const client = new mfc.Client();

mfc.Model.on("vs", (model, before, after) => {
     console.log(`${model.nm}'s state changed to ${mfc.STATE[after]}`);
});

client.connect();
```
<a name="Model.once"></a>

### Model.once
[EventEmitter](https://nodejs.org/api/all.html#events_class_eventemitter)
method like Model.on but the registered callback is only invoked once,
on the first instance of the given event

**Kind**: static property of [<code>Model</code>](#Model)

| Param | Description |
| --- | --- |
| event | "uid", "tags", "nm" or any of the property names of [model.bestSession](#modelbestsession) |
| listener | A callback to be invoked whenever the property indicated by the event name changes for any model. The callback will be given 3 parameters: the model instance that changed, the value of the property before the change, and the value of the property after the change: |

<a name="Model.removeListener"></a>

### Model.removeListener
[EventEmitter](https://nodejs.org/api/all.html#events_class_eventemitter)
method that removes a listener callback previously registered with
Model.on or Model.once

**Kind**: static property of [<code>Model</code>](#Model)
<a name="Model.removeWhen"></a>

### Model.removeWhen(condition)
Removes a when callback previously registered with Model.when

**Kind**: static method of [<code>Model</code>](#Model)
**Returns**: True if the given function was successfully removed,
false if it was not found as a registered when callback

| Param | Description |
| --- | --- |
| condition | A Function that had previously been registered as a condition filter |

<a name="Model.when"></a>

### Model.when(condition, onTrue, [onFalseAfterTrue])
Registers callback for when any Model starts matching a specific
condition and, optionally, when they then stop matching the
condition

**Kind**: static method of [<code>Model</code>](#Model)

| Param | Description |
| --- | --- |
| condition | Function that takes a Model instance and returns true if she matches the target condition, false if she doesn't |
| onTrue | Function that will be invoked when a model starts matching the condition. It is given the Model instance and the message that caused her to start matching the condition as parameters |
| [onFalseAfterTrue] | If not left undefined, this Function will be invoked when a model that was previously matching the condition stops matching the condition. |

**Example**
```js
mfc.Model.when(
    (m) => m.bestSession.rc > 2000,
    (m) => console.log(`${m.nm} has over 2000 viewers!`),
    (m) => console.log(`${m.nm} no longer has over 2000 viewers`)
);
```
<a name="Packet"></a>

## Packet
Packet represents a single, complete message received from the chat server

**Kind**: global class

* [Packet](#Packet)
    * [.aboutModel](#Packet+aboutModel)
    * [.chatString](#Packet+chatString)
    * [.pMessage](#Packet+pMessage)

<a name="Packet+aboutModel"></a>

### packet.aboutModel
The model this packet is loosely "about", meaning
who's receiving the tip/chat/status update/etc.
For some packets this can be undefined.

**Kind**: instance property of [<code>Packet</code>](#Packet)
<a name="Packet+chatString"></a>

### packet.chatString
For chat, PM, or tip messages, this property returns the text of the
message as it would appear in the MFC chat window with the username
prepended, etc:

  `AspenRae: Thanks guys! :mhappy`

This is useful for logging.

**Kind**: instance property of [<code>Packet</code>](#Packet)
<a name="Packet+pMessage"></a>

### packet.pMessage
Returns the formatted text of chat, PM, or tip messages.  For instance
the raw sMessage.msg string may be something like:
  `I am happy #~ue,2c9d2da6.gif,mhappy~#`
This returns that in the more human readable format:
  `I am happy :mhappy`

**Kind**: instance property of [<code>Packet</code>](#Packet)
