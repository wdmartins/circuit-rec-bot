'use strict';

// Electron
const electron = require('electron');
const app = electron.app;
const BrowserWindow = electron.BrowserWindow;
const { ipcMain } = require('electron');
const path = require('path');
const url = require('url');

// Load configuration
const config = require('./config.json');
const packjson = require('./package.json');

// Logger
const bunyan = require('bunyan');

// Command Processing
const Commander = require('./commandProcess.js');
const ffmpeg = require('fluent-ffmpeg');  
const mime = require('mime');  

// Transciber as a child process
const fork = require('child_process').fork;
const program = path.resolve('transcriber.js');
const child = fork(program);

let debug = /--debug/.test(process.argv[2]);
let win;

function createWindow() {
    // Create the browser window.
    win = new BrowserWindow({
        width: 1200,
        height: 900,
        show: !!debug
    });

    // and load the index.html of the app.
    win.loadURL(url.format({
        pathname: path.join(__dirname, 'index.html'),
        protocol: 'file:',
        slashes: true
    }));

    // Open the DevTools in debug mode
    debug && win.webContents.on('did-frame-finish-load', () => win.webContents.openDevTools());

    // Emitted when the window is closed.
    win.on('closed', () => win = null);
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
});

app.on('activate', function () {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow();
    }
});

// SDK logger
var sdkLogger = bunyan.createLogger({
    name: 'sdk',
    stream: process.stdout,
    level: config.sdkLogLevel
});

// Application logger
var logger = bunyan.createLogger({
    name: 'app',
    stream: process.stdout,
    level: 'info'
});

// Node utils
var util = require('util');
var assert = require('assert');

// File system
var fs = require('fs');

// Circuit SDK
logger.info('[APP]: get Circuit instance');
var Circuit = require('circuit-sdk');

logger.info('[APP]: Circuit set bunyan logger');
Circuit.setLogger(sdkLogger);

var client = new Circuit.Client({
    client_id: config.bot.client_id,
    client_secret: config.bot.client_secret,
    domain: config.domain,
    scope: 'ALL'
});

var Robot = function () {
    var self = this;
    var conversation = null;
    var commander = new Commander(logger);
    var user = {};

    //*********************************************************************
    //* initBot
    //*********************************************************************
    this.initBot = function () {
        logger.info(`[ROBOT]: initialize robot`);
        return new Promise(function (resolve, reject) {
            //Nothing to do for now
            resolve();
        });
    };

    //*********************************************************************
    //* logonBot
    //*********************************************************************
    this.logonBot = function () {
        return new Promise(function(resolve, reject) {
            var retry;
            self.addEventListeners(client);
            var logon = function () {
                client.logon().then(logonUser => {
                    logger.info(`[ROBOT]: Client created and logged as ${logonUser.userId}`);
                    user = logonUser;
                    clearInterval(retry);
                    setTimeout(resolve, 5000);
                }).catch(error => {
                    logger.error(`[ROBOT]: Error logging Bot. Error: ${error}`);
                });
            }
            logger.info(`[ROBOT]: Create robot instance with id: ${config.bot.client_id}`);
            retry = setInterval(logon, 2000);
        });
    };

    //*********************************************************************
    //* updateUserData
    //*********************************************************************
    this.updateUserData = function () {
        return new Promise(function (resolve, reject) {
            user.firstName = config.bot.first_name;
            user.lastName = config.bot.last_name;
            user.jobTitle = config.bot.job_title;
            user.company = config.bot.company;
            logger.info(`[ROBOT]: Update user ${user.userId} data with firstname: ${user.firstName} and lastname: ${user.lastName}`);
            client.updateUser(user).then(self.setPresence({ state: Circuit.Enums.PresenceState.AVAILABLE })).then(resolve);
        });
    }

    //*********************************************************************
    //* addEventListeners
    //*********************************************************************
    this.addEventListeners = function (client) {
        logger.info(`[ROBOT]: addEventListeners`);
        Circuit.supportedEvents.forEach(function(e) {
            logger.info(`[ROBOT] add Event listener for ${e}`);
            client.addEventListener(e, self.processEvent)
        });
    };

    //*********************************************************************
    //* setPresence
    //*********************************************************************
    this.setPresence = function (presence) {
        return new Promise(function (resolve, reject) {
            client.setPresence(presence).then(resolve);
        });
    };

    //*********************************************************************
    //* logEvent -- helper
    //*********************************************************************
    this.logEvent = function (evt) {
        logger.info(`[ROBOT]: ${evt.type} event received`);
        logger.debug(`[ROBOT]:`, util.inspect(evt, { showHidden: true, depth: null }));
    };

    //*********************************************************************
    //* getConversation
    //*********************************************************************
    this.getConversation = function () {
        return new Promise(function (resolve, reject) {
            if (config.convId) {
                client.getConversationById(config.convId)
                    .then(conv => {
                        logger.info(`[ROBOT]: checkIfConversationExists`);
                        if (conv) {
                            logger.info(`[ROBOT]: conversation ${conv.convId} exists`);
                            resolve(conv);
                        } else {
                            logger.info(`[ROBOT]: conversation with id ${conv.convId} does not exist`);
                            reject(`conversation with id ${conv.convId} does not exist`);
                        }
                    });
            } else {
                client.getDirectConversationWithUser(config.botOwnerEmail)
                    .then(conv => {
                        logger.info(`[ROBOT]: checkIfConversationExists`);
                        if (conv) {
                            logger.info(`[ROBOT]: conversation ${conv.convId} exists`);
                            resolve(conv);
                        } else {
                            logger.info(`[ROBOT]: conversation does not exist, create new conversation`);
                            return client.createDirectConversation(config.botOwnerEmail);
                        }
                    });
            }
        });
    };

    //*********************************************************************
    //* say Hi
    //*********************************************************************
    this.sayHi = function (evt) {
        return new Promise(function (resolve, reject) {
            logger.info(`[ROBOT]: say hi`);
            self.getConversation()
                .then(conv => {
                    logger.info(`[ROBOT]: send conversation item`);
                    conversation = conv;
                    resolve();
                    return self.buildConversationItem(null, `Hi from ${config.bot.nick_name}`,
                        `I am ready`).
                        then(item => client.addTextItem(conversation.convId, item));
                });
        });
    };

    //*********************************************************************
    //* buildConversationItem
    //*********************************************************************
    this.buildConversationItem = function (parentId, subject, content, attachments) {
        return new Promise(function (resolve, reject) {
            var attach = attachments && [attachments];
            var item = {
                parentId: parentId,
                subject: subject,
                content: content,
                contentType: Circuit.Constants.TextItemContentType.RICH,
                attachments: attach
            };
            resolve(item);
        })
    };

    //*********************************************************************
    //* terminate -- helper
    //*********************************************************************
    this.terminate = function (err) {
        var error = new Error(err);
        logger.error(`[ROBOT]: Robot failed ${error.message}`);
        logger.error(error.stack);
        process.exit(1);
    };

    //*********************************************************************
    //* processEvent
    //*********************************************************************
    this.processEvent = function (evt) {
        self.logEvent(evt);
        switch (evt.type) {
            case 'itemAdded':
                self.processItemAddedEvent(evt);
                break;
            case 'itemUpdated':
                self.processItemUpdatedEvent(evt);
                break;
            case 'callStatus':
                self.processCallStatusEvent(evt);
                break;
            case 'userUpdated':
                self.processUserUpdatedEvent(evt);
                break;
            default:
                logger.info(`[ROBOT]: unhandled event ${evt.type}`);
                break;
        }
    };

    //*********************************************************************
    //* processUserUpdatedEvent
    //*********************************************************************
    this.processUserUpdatedEvent = function (evt) {
        user = evt.user;
    };

    //*********************************************************************
    //* processItemAddedEvent
    //*********************************************************************
    this.processItemAddedEvent = function (evt) {
        if (evt.item.text && evt.item.creatorId !== user.userId) {
            logger.info(`[ROBOT] Recieved itemAdded event with itemId [${evt.item.itemId}] and content [${evt.item.text.content}]`);
            self.processCommand(evt.item.convId, evt.item.parentItemId || evt.item.itemId, evt.item.text.content);
        }
    };

    //*********************************************************************
    //* processItemUpdatedEvent
    //*********************************************************************
    this.processItemUpdatedEvent = function (evt) {
        if (evt.item.text && evt.item.creatorId !== user.userId) {
            if (evt.item.text.content) {
                var lastPart = evt.item.text.content.split('<hr/>').pop();
                logger.info(`[ROBOT] Recieved itemUpdated event with: ${lastPart}`);
                self.processCommand(evt.item.parentItemId || evt.item.itemId, lastPart);
            }
        }
    };

    //*********************************************************************
    //* processCallStatusEvent
    //*********************************************************************
    this.processCallStatusEvent = function (evt) {
        logger.info(`[ROBOT]: Received callStatus event with call state ${evt.call.state}`);
        if (evt.call.reason === `sdpConnected`) {
            logger.info(`[ROBOT] SDP Connected. Start Recording`);
            this.startRecording(call);
        }
        // if (evt.call.state === 'Started') {
        //     self.stream(evt.call.convId, `start`);
        // }
    };

    //*********************************************************************
    //* isItForMe?
    //*********************************************************************
    this.isItForMe = function (command) {
        return (command.indexOf('mention') !== -1 && command.indexOf(user.displayName) !== -1);
    };

    //*********************************************************************
    //* processCommand
    //*********************************************************************
    this.processCommand = function (convId, itemId, command) {
        logger.info(`[ROBOT] Processing command: [${command}]`);
        if (self.isItForMe(command)) {
            var withoutName = command.substr(command.indexOf('</span> ') + 8);
            logger.info(`[ROBOT] Command is for me. Processing [${withoutName}]`);
            commander.processCommand(withoutName, function (reply, params) {
                logger.info(`[ROBOT] Interpreting command to ${reply} with parms ${JSON.stringify(params)}`);
                switch (reply) {
                    case 'status':
                        self.reportStatus(convId, itemId);
                        transcode(config.ogg_file, config.raw_file);
                        break;
                    case 'version':
                        self.reportVersion(convId, itemId);
                        break;
                    case 'showHelp':
                        self.showHelp(convId, itemId);
                        break;
                    case 'startStream':
                        self.stream(convId, `start`);
                        break;
                    case 'stopStream':
                        self.stream(convId, `stop`);
                        break;
                    case 'dial':
                        self.dial(convId, itemId, params);
                        break;
                    case 'shutdown':
                        self.shutdown();
                        break;
                    default:
                        logger.info(`[ROBOT] I do not understand [${withoutName}]`);
                        self.buildConversationItem(itemId, null,
                            `I do not understand <b>[${withoutName}]</b>`).
                            then(item => client.addTextItem(convId || conversation.convId, item));
                        break;
                }
            });
        } else {
            logger.info(`[ROBOT] Ignoring command: it is not for me`);
        }
    };

    //*********************************************************************
    //* reportStatus
    //*********************************************************************
    this.reportStatus = function (convId, itemId) {
        self.buildConversationItem(itemId, null,
            `Status <b>On</b>`).
            then(item => client.addTextItem(convId || conversation.convId, item));
    };

    //*********************************************************************
    //* reportVersion
    //*********************************************************************
    this.reportVersion = function (convId, itemId) {
        self.buildConversationItem(itemId, null,
            `Version: <b>${packjson.version}</b>`).
            then(item => client.addTextItem(convId || conversation.convId, item));
    };

    //*********************************************************************
    //* showHelp
    //*********************************************************************
    this.showHelp = function (convId, itemId) {
        logger.info(`[ROBOT] Displaying help...`);
        commander.buildHelp().then(help => self.buildConversationItem(itemId, 'HELP', help)
            .then(item => client.addTextItem(convId || conversation.convId, item)));
    };

    //*********************************************************************
    //* dial phone number
    //*********************************************************************
    this.dial = function (convId, itemId, params) {
        if (!params || !params.length) {
            logger.error(`[ROBOT] No number to dial`);
            self.buildConversationItem(itemId, `ERROR`, "Unable to dial. Number missing")
            .then(item => client.addTextItem(convId || conversation.convId, item));
        } else {
            logger.info(`[ROBOT] Sending dial message to renderer`);
            win.webContents.send("dial", params && params.join());
            self.buildConversationItem(itemId, `Dialing`, `Dialing ${params.join()}`)
            .then(item => client.addTextItem(convId || conversation.convId, item));
        }
    }

    this.startRecording = async function(call) {
        logger.info(`[ROBOT] Sending startRecording to renderer`);
        win.webContents.send("startRecording", call);
    }

    this.shutdown = function (reason) {
        logger.warn(`[ROBOT] Shutting down. Reason: ${reason}`);
        client.logout();
        throw new Error('Terminated by user');
    }
}

ipcMain.on("recordingReady", function(sender, params) {
    logger.info(`[ROBOT] Recording is ready for transcoding`);
    // Transcode file for google speech transcription
    transcode(config.ogg_file, config.raw_file).then(function() {
        logger.info(`[ROBOT] Transcoding complete`);
    }).catch(e => logger.error(e)); 
});

// /opt/ffmpeg/ffmpeg -acodec opus -i test.raw -f s16le -acodec pcm_s16le -ar 16000 output.raw
function transcode(fileIn, fileOut) {
    return new Promise(function(resolve, reject) {
        if (!fileIn || !fileOut) {
            throw new Error('You must specify a path for both input and output files.');
        }
        if (!fs.existsSync(fileIn)) {
            throw new Error(`Input file must exist. Input file: ${fileIn}`);
        }
        if (mime.lookup(fileIn).indexOf('audio') > -1) {
            try {
                ffmpeg()
                    .input(fileIn)
                    .outputOptions([
                        '-f s16le',
                        '-acodec pcm_s16le',
                        '-vn',
                        '-ac 1',
                        '-ar 16k',
                        '-map_metadata -1'
                    ])
                    .save(fileOut)
                    .on('end', () => resolve(fileOut));
            } catch (e) {
                reject(e);
            }
        } else {
            throw new Error('File must have audio mime.');
        }   
    });
}
//*********************************************************************
//* main
//*********************************************************************
var robot = new Robot();
robot.initBot()
    .then(robot.logonBot)
    .then(robot.sayHi)
    .catch(robot.terminate);

