import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";

const run = promisify(execFile);
const seconds = Number(process.env.WB_MEDIA_SECONDS || 20);
const enabled = process.env.WB_MEDIA_VALIDATION === "1";

test("Whiteboard recorded media retains foreground and background frame/audio fidelity in real time",
  {skip: !enabled, timeout: (seconds + 300) * 1000}, async () => {
    assert.ok(Number.isFinite(seconds) && seconds >= 10 && seconds <= 3600);
    const output = process.env.WB_MEDIA_EVIDENCE || join(tmpdir(),"rk-whiteboard-engine-" + Date.now());
    await mkdir(output,{recursive:true});
    const source = await readFile(new URL("./src/js/whiteboard-media.mjs",import.meta.url),"utf8");
    const server = createServer(async (request,response) => {
      if(request.method==="POST" && request.url==="/recording") {
        try {await pipeline(request,createWriteStream(join(output,"recording.webm")));response.end("Saved");}
        catch(error){response.statusCode=500;response.end(error.message);}
        return;
      }
      response.setHeader("Content-Type",request.url === "/engine.mjs" ? "text/javascript" : "text/html");
      response.end(request.url === "/engine.mjs" ? source : '<!doctype html><title>Synthetic Whiteboard engine validation</title><body style="background:#222;color:white"><h1>Synthetic media test - no devices or AI</h1></body>');
    });
    server.listen(0,"127.0.0.1"); await once(server,"listening");
    const profile=await mkdtemp(join(tmpdir(),"rk-whiteboard-engine-profile-"));
    const native=spawn(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",[
      "--user-data-dir="+profile,"--remote-debugging-port=0","--remote-debugging-address=127.0.0.1","--no-first-run","--no-default-browser-check",
      "--disable-background-networking","--disable-component-update","--disable-extensions","--mute-audio","--autoplay-policy=no-user-gesture-required",
      ...(process.env.WB_MEDIA_HEADFUL==="1"?[]:["--headless=new"]),"about:blank"
    ],{stdio:"ignore"});
    let browser;
    try {
      let port;
      for(let attempt=0;attempt<100;attempt++) {
        try {port=(await readFile(join(profile,"DevToolsActivePort"),"utf8")).split("\n")[0];break;}
        catch(error){if(error.code!=="ENOENT")throw error;await new Promise(resolve=>setTimeout(resolve,100));}
      }
      assert.ok(port,"Isolated browser must expose its local debugging endpoint");
      browser=await chromium.connectOverCDP("http://127.0.0.1:"+port,{noDefaults:true});
      const context = browser.contexts()[0];
      await context.route("**/*",route=>new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
      const owner = await context.newPage();
      const errors = []; owner.on("pageerror",error=>errors.push(error.message));
      await owner.goto("http://127.0.0.1:" + server.address().port);
      const popup = owner.waitForEvent("popup");
      await owner.evaluate(()=>{window.fixture=window.open("/source","whiteboard-synthetic-source");});
      const board = await popup; await board.waitForLoadState();
      await board.evaluate(async (seconds) => {
        const canvas=document.createElement("canvas");canvas.width=1920;canvas.height=1080;document.body.append(canvas);
        const camera=document.createElement("canvas");camera.width=640;camera.height=360;
        const cameraDrawing=camera.getContext("2d");cameraDrawing.scale(1/3,1/3);
        const drawing=canvas.getContext("2d");
        const audio=new AudioContext(), oscillator=audio.createOscillator(), gain=audio.createGain(), destination=audio.createMediaStreamDestination();
        gain.gain.value=0.1;oscillator.connect(gain);gain.connect(destination);
        await audio.resume();oscillator.start();
        await new Promise(resolve=>setTimeout(resolve,1200));
        const audioStart=audio.currentTime;
        const started=performance.now();window.fixtureEpoch=performance.timeOrigin+started;window.drawCount=0;
        for(let second=0;second<seconds+20;second++) oscillator.frequency.setValueAtTime(second%2 ? 880 : 440,audioStart+second);
        function draw() {
          drawing.fillStyle="#fff";drawing.fillRect(0,0,1920,1080);
          drawing.fillStyle="#142333";drawing.font="36px sans-serif";drawing.fillText("Refund journey - synthetic board",60,80);
          for(let row=0;row<5;row++) {
            const x=60+row*350;
            drawing.strokeStyle="#213d52";drawing.lineWidth=2;drawing.strokeRect(x,180,290,200);
            drawing.font="20px sans-serif";drawing.fillText(["Request","Eligibility","Method","Confirm","Track"][row],x+16,220);
            drawing.font="14px sans-serif";drawing.fillText("Explain the decision and trade-off",x+16,260);
            drawing.fillText("Keep the customer informed",x+16,290);
            drawing.font="12px sans-serif";drawing.fillText("14 days / original payment method",x+16,325);
          }
          const tick=Math.floor((performance.now()-started)/100);
          cameraDrawing.fillStyle="#51477f";cameraDrawing.fillRect(0,0,1920,1080);
          cameraDrawing.fillStyle="#fff";cameraDrawing.font="64px sans-serif";cameraDrawing.fillText("Synthetic camera",60,200);
          for(const [context,sourceBit] of [[drawing,0],[cameraDrawing,1]]) {
            for(let bit=0;bit<17;bit++){context.fillStyle=(bit===16?sourceBit:tick & (1<<bit)) ? "#fff" : "#000";context.fillRect(60+bit*80,500,70,70);}
          }
          drawing.fillStyle="#d8a657";drawing.fillRect((tick*17)%1700,650,140,80);
          drawing.fillStyle="#142333";drawing.font="30px monospace";drawing.fillText("Frame marker: "+tick,60,850);
          window.drawCount++;
        }
        const screenTrack=new MediaStreamTrackGenerator({kind:"video"}),cameraTrack=new MediaStreamTrackGenerator({kind:"video"});
        const screenWriter=screenTrack.writable.getWriter(),cameraWriter=cameraTrack.writable.getWriter();
        window.boardStream=new MediaStream([screenTrack]);window.cameraStream=new MediaStream([cameraTrack]);
        // Synthetic devices must keep producing frames even when the fixture tab is hidden.
        window.deviceClock=new Worker(URL.createObjectURL(new Blob(["setInterval(()=>postMessage('frame'),1000/15)"],{type:"text/javascript"})));
        let writing=false;
        window.deviceClock.onmessage=async()=>{
          if(writing)return;writing=true;draw();
          const timestamp=Math.round((performance.now()-started)*1000);
          const screenFrame=new VideoFrame(canvas,{timestamp}),cameraFrame=new VideoFrame(camera,{timestamp});
          try {await Promise.all([screenWriter.write(screenFrame),cameraWriter.write(cameraFrame)]);}
          finally {screenFrame.close();cameraFrame.close();writing=false;}
        };
        draw();
        window.micStream=destination.stream;window.audio=audio;window.boardCanvas=canvas;
      },seconds);
      await new Promise(resolve=>setTimeout(resolve,1200));
      await owner.bringToFront();
      await owner.evaluate(async () => {
        const {startWhiteboardRecording}=await import("/engine.mjs");
        window.videos={};
        for(const source of ["screen","camera"]) {
          const video=document.createElement("video");video.muted=true;video.srcObject=source==="screen"?window.fixture.boardStream:window.fixture.cameraStream;document.body.append(video);await video.play();
          window.videos[source]=video;
        }
        window.focusSource="screen";
        navigator.mediaDevices.getUserMedia=async()=>window.fixture.micStream.clone();
        window.engineErrors=[];
        window.sourceOffset=(performance.timeOrigin+performance.now()-window.fixture.fixtureEpoch)/1000;
        window.capture=await startWhiteboardRecording({video:()=>window.videos[window.focusSource],source:()=>window.focusSource,onError:message=>window.engineErrors.push(message)});
        window.encodedBytes=0;window.chunks=0;
        window.capture.recorder.addEventListener("dataavailable",event=>{window.encodedBytes+=event.data.size;window.chunks++;});
        window.validationStarted=performance.now();
        window.visibilityLog=[];
        document.addEventListener("visibilitychange",()=>window.visibilityLog.push({seconds:(performance.now()-window.validationStarted)/1000,state:document.visibilityState}));
      });
      await new Promise(resolve=>setTimeout(resolve,3000));
      await board.bringToFront();
      if(process.env.WB_MEDIA_HEADFUL==="1") {
        for(const page of [owner,board]) {
          const session=await context.newCDPSession(page);
          const {windowId}=await session.send("Browser.getWindowForTarget");
          await session.send("Browser.setWindowBounds",{windowId,bounds:{windowState:"minimized"}});
          await session.detach();
        }
      }
      const visibility = {owner:await owner.evaluate(()=>document.visibilityState),board:await board.evaluate(()=>document.visibilityState)};
      const wallStarted=Date.now();
      console.log(JSON.stringify({phase:"recording",seconds,visibility,output}));
      const memory=[];
      async function sampleMemory() {
        const session=await browser.newBrowserCDPSession();
        const {processInfo}=await session.send("SystemInfo.getProcessInfo");await session.detach();
        const ids=processInfo.map(process=>process.id);
        const {stdout}=await run("powershell",["-NoProfile","-Command",`$p=@(Get-Process | Where-Object {$_.Id -in @(${ids.join(",")})}); if(!$p.Count){throw 'Test browser processes disappeared'}; [pscustomobject]@{workingSet=($p|Measure-Object WorkingSet64 -Sum).Sum;privateBytes=($p|Measure-Object PrivateMemorySize64 -Sum).Sum;exitedProcesses=${ids.length}-$p.Count}|ConvertTo-Json -Compress`]);
        memory.push({seconds:(Date.now()-wallStarted)/1000,...JSON.parse(stdout),...await owner.evaluate(()=>({blobBytes:window.encodedBytes,chunks:window.chunks,heap:performance.memory?.usedJSHeapSize}))});
      }
      await sampleMemory();
      for(const [part,source] of [[1,"camera"],[2,"screen"],[3,null]]) {
        await new Promise(resolve=>setTimeout(resolve,Math.max(0,wallStarted+seconds*1000*part/3-Date.now())));
        if(source) await owner.evaluate(source=>{window.focusSource=source;window.capture.syncSource?.();},source);
        await sampleMemory();
      }
      const result=await owner.evaluate(async () => {
        const recording=await window.capture.stop();
        window.recordedBlob=recording.blob;
        return {duration:recording.duration,bytes:recording.blob.size,type:recording.type,error:recording.error,errors:window.engineErrors,timeline:recording.timeline,sourceOffset:window.sourceOffset,
          elapsed:(performance.now()-window.validationStarted)/1000,encodedBytes:window.encodedBytes,chunks:window.chunks,drawCount:window.fixture.drawCount,
          processor:typeof MediaStreamTrackProcessor,endVisibility:document.visibilityState,visibilityLog:window.visibilityLog};
      });
      await owner.evaluate(async()=>{const response=await fetch("/recording",{method:"POST",body:window.recordedBlob});if(!response.ok)throw new Error("Local recording save failed");});
      await board.locator("canvas").screenshot({path:join(output,"source-board.png")});
      const metadata=JSON.parse((await run("ffprobe",["-v","error","-show_streams","-show_format","-of","json",join(output,"recording.webm")],{maxBuffer:4*1024*1024})).stdout);
      const frames=JSON.parse((await run("ffprobe",["-v","error","-select_streams","v:0","-show_entries","frame=best_effort_timestamp_time","-of","json",join(output,"recording.webm")],{maxBuffer:16*1024*1024})).stdout).frames.map(frame=>Number(frame.best_effort_timestamp_time));
      const background=frames.filter(time=>time>=5);
      const gaps=background.slice(1).map((time,index)=>time-background[index]);
      const video=metadata.streams.find(stream=>stream.codec_type==="video"),audio=metadata.streams.find(stream=>stream.codec_type==="audio");
      await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-ss","5","-i",join(output,"recording.webm"),"-frames:v","1",join(output,"recorded-board.png")]);
      await run("ffmpeg",["-hide_banner","-loglevel","error","-y","-i",join(output,"recording.webm"),"-vn","-ac","1","-ar","8000","-f","f32le",join(output,"audio.f32")]);
      const samples=await readFile(join(output,"audio.f32"));
      const rms=[];for(let offset=0;offset+32000<=samples.length;offset+=32000){let energy=0;for(let i=0;i<8000;i++){const value=samples.readFloatLE(offset+i*4);energy+=value*value;}rms.push(Math.sqrt(energy/8000));}
      const markerResult=await run("ffmpeg",["-hide_banner","-y","-i",join(output,"recording.webm"),"-vf","select='isnan(prev_selected_t)+gte(t-prev_selected_t,1)',crop=1350:70:60:500,scale=17:1:flags=neighbor,format=rgb24,showinfo","-an","-fps_mode","passthrough","-f","rawvideo",join(output,"markers.rgb")],{maxBuffer:8*1024*1024});
      const markerTimes=[...markerResult.stderr.matchAll(/pts_time:([\d.]+)/g)].map(match=>Number(match[1]));
      const markerPixels=await readFile(join(output,"markers.rgb"));
      assert.equal(markerPixels.length,markerTimes.length*17*3);
      const markers=markerTimes.map((time,index)=>{
        let tick=0;for(let bit=0;bit<16;bit++)if(markerPixels[(index*17+bit)*3]>128)tick|=1<<bit;
        const source=markerPixels[(index*17+16)*3]>128?"camera":"screen";
        return {time,source,sourceSeconds:tick/10,lag:time+result.sourceOffset-tick/10};
      }).filter(marker=>marker.time>=5);
      const wrongSource=markers.filter(marker=>marker.source!==result.timeline.findLast(entry=>entry.seconds<=marker.time-0.2)?.source && !result.timeline.some(entry=>Math.abs(entry.seconds-marker.time)<0.4));
      const audioStart=Number(audio?.start_time);
      const toneErrors=[];
      for(let second=5;second+1<samples.length/32000;second++) {
        const expectedSourceSecond=Math.floor(second+audioStart+result.sourceOffset)+0.5;
        const sampleSecond=expectedSourceSecond-audioStart-result.sourceOffset;
        const offset=Math.round(sampleSecond*8000);
        let crossings=0;for(let index=offset;index<offset+800;index++)if(samples.readFloatLE(index*4)<=0&&samples.readFloatLE((index+1)*4)>0)crossings++;
        const frequency=crossings*10,expected=Math.floor(expectedSourceSecond)%2?880:440;
        if(Math.abs(frequency-expected)>30)toneErrors.push({second:sampleSecond,frequency,expected});
      }
      const report={...result,wallSeconds:(Date.now()-wallStarted)/1000,visibility,memory,video:{width:video?.width,height:video?.height,codec:video?.codec_name,frames:frames.length,backgroundFps:background.length/Math.max(1,frames.at(-1)-5),maxBackgroundGap:Math.max(0,...gaps),markerSamples:markers.length,maxMarkerLag:Math.max(...markers.map(marker=>marker.lag)),wrongSource:wrongSource.length},audio:{codec:audio?.codec_name,start:audioStart,seconds:samples.length/4/8000,minOneSecondRms:Math.min(...rms),toneErrors},pageErrors:errors};
      await writeFile(join(output,"report.json"),JSON.stringify(report,null,2));
      await rm(join(output,"audio.f32"));await rm(join(output,"markers.rgb"));
      console.log(JSON.stringify(report));
      assert.equal(visibility.owner,"hidden","Test must exercise a genuinely backgrounded owner page");
      assert.equal(result.endVisibility,"hidden");
      assert.ok(result.visibilityLog.filter(entry=>entry.seconds>=5).every(entry=>entry.state==="hidden"),"Owner must stay hidden throughout the background phase");
      assert.equal(result.error,"");assert.deepEqual(errors,[]);assert.deepEqual(result.errors,[]);
      assert.ok(audio,"The decoded recording has an audio stream");
      assert.ok(Math.abs(report.audio.seconds-result.duration)<1,"Audio remains aligned with wall-clock recording duration");
      assert.ok(report.audio.minOneSecondRms>0.01,"Every full recorded second retains the synthetic microphone tone");
      assert.deepEqual(toneErrors,[],"Decoded audio frequency markers remain aligned with the visual source clock");
      assert.deepEqual(result.timeline.map(entry=>entry.source),["screen","camera","screen"]);
      assert.equal(wrongSource.length,0,"Decoded frames follow focus changes within the same recording");
      assert.ok(markers.every(marker=>Math.abs(marker.lag)<0.4),"Recorded frames remain current, not just repeatedly encoded stale frames");
      assert.ok(memory.at(-1).privateBytes-memory[0].privateBytes<350_000_000+result.bytes*4,"Private-memory growth stays bounded relative to retained media");
      assert.ok(report.video.backgroundFps>=10,"Background recording retains at least 10 fps from a 15 fps source");
      assert.ok(report.video.maxBackgroundGap<0.5,"No background capture gaps of half a second");
      assert.equal(video.width,1920,"A 1080p shared board must not lose its original text resolution");
      assert.equal(video.height,1080);
    } finally {
      if(browser?.isConnected()){const session=await browser.newBrowserCDPSession();await session.send("Browser.close").catch(error=>console.error("Browser cleanup:",error.message));await browser.close();}
      if(native.exitCode===null){const exited=once(native,"exit");native.kill();await exited;}
      server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
      await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:300});
    }
  });
