/*
packetInspector.js

Used for dumping raw packets to the console to learn about the MFC protocol and debug changes in their code
*/

"use strict";

let fs = require("fs");
let mfc = require("../../lib/index.js");
let log = mfc.log;
let user = "guest";
let pass = "guest";

//To examine packet streams for a logged in user, put your
//username and hashed password (read the comment in Client.ts)
//in a file named cred.txt in the test folder. Separate them by
//a single newline. And this script will log in as that user.
//Otherwise it will default to using guest credentials, which
//also work fine but only reveal and subset of the message protocol.
//cred.txt is excluded from git via .gitignore. Please never commit
//your own password hash.
let cred = "cred.txt";
if (fs.existsSync(cred)) {
    let data = fs.readFileSync(cred).toString().split("\r\n");
    if (data.length >= 2) {
        user = data[0];
        pass = data[1];
    }
}
// mfc.setLogLevel(mfc.LogLevel.DEBUG);
let client = new mfc.Client(user, pass, {useWebSockets: true, camYou: true});

client.on("ANY", (packet) => {
    log(packet.toString(), "packetLog", null);
});

client.connectAndWaitForModels().then(() => {
    //Find the most popular model in free chat right now
    let freeModels = mfc.Model.findModels((m) => m.bestSession.vs === 0);
    freeModels.sort((a, b) => a.bestSession.rc - b.bestSession.rc);
    let topModel = freeModels[freeModels.length - 1];
    //Join her room for more interesting packets to inspect
    client.joinRoom(topModel.uid).catch(()=>{});
});
