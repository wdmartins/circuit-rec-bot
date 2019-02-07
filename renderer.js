// Limitations: The bot can only be in a single call at a time. Multiple
// client crendentials app would be needed to be in multiple calls at
// the same time.

const config = require('electron').remote.require('./config.json');
var fs = require('fs');
var recordedBlobs = [];
var mediaRecorder;
var call;
var recordingOptions = {
    mimeType: 'audio/webm;codecs="opus"',
    audioBitsPerSecond: 16000
};
var audioElement;

// Create circuit SDK client instance
const client = new Circuit.Client(config.bot);

const { ipcRenderer } = require('electron');

ipcRenderer.on("dial", function(sender, number) {
    audioElement = document.querySelector('audio');
    if (!MediaRecorder.isTypeSupported(recordingOptions.mimeType)) {
        console.log(`[RENDERER] Error: mimeType ${recordingOptions.mimeType} is not supported`);
    }
    recordedBlobs = [];
    client.dialNumber(number, null, {audio: true, video: false})
    .then(c => call = c)
    .catch(error => console.error(`[RENDERER] Error dialing number. Error: ${error}`));
});

function setupCall(call) {
    var remoteAudioStream = client.getRemoteStreams(call.callId).find(s => s.getAudioTracks().length > 0);
    var remoteMediaStream = new MediaStream(remoteAudioStream.getAudioTracks());

    mediaRecorder = new MediaRecorder(remoteMediaStream, recordingOptions);
    mediaRecorder.onstop = handleStop;
    mediaRecorder.ondataavailable = handleDataAvailable;
    mediaRecorder.onerror = handleOnError;
    mediaRecorder.onstart = handleOnStart;

    console.log('[RENDERER] Start monitoring and recording');

    // For audio monitoring
    audioElement.srcObject = remoteAudioStream;

}

function handleOnStart() {
    console.log(`[RENDERER] Media Recording Started`);
}

function handleOnError(error) {
    console.error(`[RENDERER] MediaRecorder Error: ${error}`);
}
function handleStop() {
    console.log(`[RENDERER] Recording stop. BitsPerSecond: ${mediaRecorder.audioBitsPerSecond}`);
    var fileReader = new FileReader();
    fileReader.onload = function() {
      fs.writeFileSync(config.ogg_file, Buffer.from(new Uint8Array(this.result)));
    };
    fileReader.readAsArrayBuffer(new Blob(recordedBlobs, {type:'audio/webm;codecs="opus"'}));
    setTimeout(ipcRenderer.send('recordingReady'), 3000);
}

function handleDataAvailable(event) {
    console.log(`[RENDERER] Recording data available`);
    if (event.data && event.data.size > 0) {
        recordedBlobs.push(event.data);
      }
}

function startRecording(stream) {
    console.log(`[RENDERER] Start Recording`);
    mediaRecorder.start(1000);
}

function endCall() {
    client.endCall(call.callId);
}

function stopRecording() {
    console.log(`[RENDERER] Stoping recorder. BitsPerSecond: ${mediaRecorder.audioBitsPerSecond}`);
    mediaRecorder && mediaRecorder.stop();
}

function processEvent(evt) {
    console.log(`[RENDERER] Process event ${evt.type}`);
    switch(evt.type) {
        case 'callStatus':
            if (evt.reason === 'sdpConnected') {
                setupCall(call);
                startRecording();
                setTimeout(endCall, 10000);
            }
            break;
        case 'callEnded':
            stopRecording();
            break;
        default: 
            console.log(`[RENDERER] Ignoring evet ${evt.type}`);
            break;
    }
}
// Program (async IIFE function)
(async () => {
    try {
        // Logon
        const user = await client.logon();
        console.log(`[RENDERER] Logged on as bot: ${user.emailAddress}`);
        Circuit.supportedEvents.forEach(function(e) {
            client.addEventListener(e, processEvent)
        });
    } catch (ex) {
        console.error(ex);
    }
})();
