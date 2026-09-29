import test from "node:test";
import assert from "node:assert/strict";
import { whiteboardFocus, isWhiteboardVideoProvider, withWhiteboardVideoFiles, whiteboardRecordingEvidence } from "./src/js/whiteboard-media.mjs";

const base = "https://generativelanguage.googleapis.com";
const config = {provider:"gemini",base:base + "/v1beta",key:"synthetic-key"};
const recording = {id:"recording-1",blob:new Blob(["complete audio/video fixture"],{type:"video/webm"}),type:"video/webm",audio:true,duration:60};

test("Whiteboard focus gives newly started screen precedence and otherwise respects selection", () => {
  assert.equal(whiteboardFocus("",{camera:true}),"camera");
  assert.equal(whiteboardFocus("camera",{camera:true,screen:true},"screen"),"screen");
  assert.equal(whiteboardFocus("screen",{camera:true,screen:true},"camera"),"screen");
  assert.equal(whiteboardFocus("camera",{camera:true,screen:true}),"camera");
  assert.equal(whiteboardFocus("camera",{screen:true}),"screen");
  assert.equal(whiteboardFocus("screen",{camera:true}),"camera");
  assert.equal(whiteboardFocus("screen",{}),"");
});

test("Video provider is explicit and never treats proxy credentials as Gemini keys", () => {
  assert.equal(isWhiteboardVideoProvider(config),true);
  for (const changed of [{proxied:true},{provider:"anthropic"},{base:"https://example.com/v1beta"},{key:""}]) assert.equal(isWhiteboardVideoProvider({...config,...changed}),false);
});

function provider({state = "ACTIVE",failUpload = false,failDelete = false,untrusted = false} = {}) {
  const calls = []; let name;
  const fetcher = async (url,options) => {
    calls.push({url,options});
    if (options.method === "DELETE") return new Response(null,{status:failDelete ? 500 : 200});
    if (url.endsWith("/upload/v1beta/files")) {
      name = JSON.parse(options.body).file.name;
      return new Response(null,{headers:{"x-goog-upload-url":untrusted ? "https://example.com/upload" : base + "/upload-session"}});
    }
    if (url.endsWith("/upload-session")) return failUpload ? new Response(null,{status:503}) : Response.json({file:{name,uri:base + "/v1beta/" + name,state}});
    return Response.json({name,uri:base + "/v1beta/" + name,state:"ACTIVE"});
  };
  return {calls,fetcher};
}

test("Full video bytes are uploaded, processed, passed as fileData and deleted", async () => {
  const fake = provider({state:"PROCESSING"}), progress = [], warnings = [];
  const result = await withWhiteboardVideoFiles(config,[recording],{...fake,progress:message=>progress.push(message),warning:message=>warnings.push(message),poll:async()=>{},
    invoke:async files => { assert.equal(files.length,1); assert.match(files[0].fileData.fileUri,/\/files\/wb-/); assert.equal(files[0].fileData.mimeType,"video/webm"); return "review"; }});
  assert.equal(result,"review");
  const upload = fake.calls.find(call=>call.url.endsWith("/upload-session"));
  assert.equal(upload.options.body,recording.blob,"The original Blob, not snapshots or base64 text, is uploaded");
  assert.equal(await upload.options.body.text(),"complete audio/video fixture");
  assert.equal(fake.calls.at(-1).options.method,"DELETE");
  assert.ok(progress.some(message=>message.includes("processing"))); assert.deepEqual(warnings,[]);
});

test("Upload failure deletes the known file and never runs a text fallback", async () => {
  const fake = provider({failUpload:true}); let invoked = false;
  await assert.rejects(withWhiteboardVideoFiles(config,[recording],{...fake,progress(){},warning(){},invoke:async()=>{invoked=true;}}),/Video upload failed/);
  assert.equal(invoked,false); assert.equal(fake.calls.at(-1).options.method,"DELETE");
});

test("Cancellation during processing cleans up without using the aborted signal for deletion", async () => {
  const fake = provider({state:"PROCESSING"}), controller = new AbortController();
  await assert.rejects(withWhiteboardVideoFiles(config,[recording],{...fake,signal:controller.signal,progress(){},warning(){},
    poll:async()=>{controller.abort();controller.signal.throwIfAborted();},invoke:async()=>assert.fail("No review after cancellation")}),{name:"AbortError"});
  assert.equal(fake.calls.at(-1).options.method,"DELETE");
  assert.equal(fake.calls.at(-1).options.signal.aborted,false);
});

test("Cleanup failure is reported even after a successful review", async () => {
  const fake = provider({failDelete:true}), warnings = [];
  assert.equal(await withWhiteboardVideoFiles(config,[recording],{...fake,progress(){},warning:message=>warnings.push(message),invoke:async()=>"review"}),"review");
  assert.equal(warnings.length,1); assert.match(warnings[0],/cleanup could not be confirmed/);
});

test("Untrusted upload URLs and incomplete recordings never receive media", async () => {
  const fake = provider({untrusted:true});
  await assert.rejects(withWhiteboardVideoFiles(config,[recording],{...fake,progress(){},warning(){},invoke:async()=>{}}),/trusted browser upload URL/);
  assert.equal(fake.calls.length,1);
  for (const change of [{audio:false},{error:"Microphone lost"},{blob:new Blob()},{blob:{size:2_000_000_001}}]) {
    await assert.rejects(withWhiteboardVideoFiles(config,[{...recording,...change}],{fetcher:async()=>assert.fail("Must validate before upload")}),/complete audio\/video/);
  }
});

test("Recording evidence requires an existing recording and in-range numeric timestamps", () => {
  const good = {id:"recording-evidence-1",recordingId:"recording-1",seconds:15,status:"audible",detail:"Candidate explains a trade-off."};
  const rejected = [{...good,id:"turn-1"},{...good,seconds:61},{...good,seconds:-1},{...good,seconds:"15"},{...good,recordingId:"recording-2"},{...good,status:"invented"}];
  assert.deepEqual(whiteboardRecordingEvidence([good,...rejected,good],[recording]),[good]);
  assert.throws(()=>whiteboardRecordingEvidence(null,[recording]),/timestamped evidence/);
});
