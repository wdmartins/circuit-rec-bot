// Limitations: The bot can only be in a single call at a time. Multiple
// client crendentials app would be needed to be in multiple calls at
// the same time.

const config = require('electron').remote.require('./config.json');
var fs = require('fs');
var timeout;
var recordedBlobs = [];
var mediaRecorder;

// Create circuit SDK client instance
const client = new Circuit.Client(config.bot);

const { ipcRenderer } = require('electron');

ipcRenderer.on("stream", function (sender, convId, rtcSessionId, command) {
    console.log('Received stream command');
    if (command === `start`) {
        startStream(convId, rtcSessionId);
        // Ensure call is always up and stream is sent. E.g. bot could have been dropped
        timeout = setInterval(async () => await startStream(), 10 * 1000);
    } else if (command === `stop`) {
        clearInterval(timeout);
        stopStream(rtcSessionId);
        mediaRecorder && mediaRecorder.stop();
    }
});

async function stopStream(rtcSessionId) {
    let call = await client.findCall(rtcSessionId);
    if (call) {
        call = await client.leaveConference(call.callId);
    }
}

async function startStream(convId, rtcSessionId) {
    try {
        let call = await client.findCall(rtcSessionId);

        if (!call) {
            call = await client.startConference(convId, { audio: false, video: false });
        } else if (call.isRemote) {
            await client.joinConference(call.callId, { audio: false, video: false })
        }

        // Wait 2s second before setting the stream to allow the initial negotiation to finish
        // Alternatively we could also listen for callStatus event of reason sdpConnected
        await sleep(2000);

        // Check if the already streaming on the screenshare stream
        if (!call.localMediaType.audio) {
            let constraints = { audio: true, video: false };
            navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
                client.setAudioVideoStream(call.callId, stream);

                sleep(5000).then(function() {
                    var remoteAudioStream = client.getRemoteStreams(call.callId).find(s => s.getAudioTracks().length > 0);
                    var remoteMediaStream = new MediaStream(remoteAudioStream.getAudioTracks());

                    // For Debugging show on index.html page
                    let audio = document.querySelector('audio');
                    audio.srcObject = remoteAudioStream;
                    audio.onloadedmetadata = e => audio.play();

                    setupRecording(new MediaStream(remoteMediaStream));
                });
            }).catch(function(error) {
                console.log(`Error getting user media. Error: ${error}`)
            });

            // Send stream on Circuit's screenshare stream. Alternatively use setAudioVideoStream
            // for regular video.
            //await client.setScreenshareStream(call.callId, mediaStream);

            //var remoteAudioStream = client.getRemoteStreams(call.callId).find(s => s.getAudioTracks().length > 0);
            //var remoteMediaStream = new MediaStream(remoteAudioStream.getAudioTracks());
            //var audioTrack = mediaStream.getAudioTracks();
            //setupRecording(new MediaStream(mediaStream));

        } else {
            mediaRecorder && mediaRecorder.requestData();
        }
    } catch (err) {
        console.error(`${err.name}: ${err.message}`);
    }
}

function setupRecording(stream) {
    //var options = {mimeType: 'audio/webm'};
    var options = {mimeType: 'audio/webm'};
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        console.log(`Error: mimeType ${options.mimeType} is not supported`);
    }
    var recordedBlobs = [];
    mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorder.onstop = handleStop;
    mediaRecorder.ondataavailable = handleDataAvailable;
    mediaRecorder.onerror = handleOnError;
    mediaRecorder.onstart = function(s) {
        console.log(`Media Recording Started`);
    };
    mediaRecorder.start(1500);
    console.log(`Recording setup`);
}

function handleOnError(error) {
    console.log(`MediaRecorder Error: ${error}`);
}
function handleStop() {
    console.log(`Recording stop`);
    var fileReader = new FileReader();
    fileReader.onload = function() {
      fs.writeFileSync('test.wav', Buffer.from(new Uint8Array(this.result)));
    };
    fileReader.readAsArrayBuffer(new Blob(recordedBlobs));
}

function handleDataAvailable(event) {
    console.log(`Recording data available`);
    if (event.data && event.data.size > 0) {
        recordedBlobs.push(event.data);
      }
}
// Helper sleep function
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Program (async IIFE function)
(async () => {
    try {
        // Logon
        const user = await client.logon();
        console.log(`Logged on as bot: ${user.emailAddress}`);

    } catch (ex) {
        console.error(ex);
    }
})();

// Print all events for debugging
Circuit.supportedEvents.forEach(e => client.addEventListener(e, console.log));
