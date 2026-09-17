/* Mocked browser/RTC tests: no microphone, network, or speech provider is used. */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const vm = require("node:vm");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Element {
  constructor() { this.children = []; this.listeners = {}; this.disabled = false; this.textContent = ""; }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  querySelector() { return null; }
  get firstChild() { return this.children[0]; }
  click() { return this.listeners.click?.(); }
}

function harness(options = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const rooms = [], requests = [], timers = new Map();
  let nextTimer = 0;
  class Room extends EventEmitter {
    constructor() {
      super();
      this.index = rooms.length;
      this.disconnectCount = 0;
      this.canPlaybackAudio = !options.autoplayBlocked;
      this.remoteParticipants = new Map([["worker", {}]]);
      this.localParticipant = {
        identity: "browser",
        isMicrophoneEnabled: false,
        setMicrophoneEnabled: async (enabled) => {
          if (options.microphone) await options.microphone(this.index, enabled);
          this.localParticipant.isMicrophoneEnabled = enabled;
        },
      };
      rooms.push(this);
    }
    async connect(url, token) {
      this.url = url; this.token = token;
      await options.connect?.(this.index);
    }
    async disconnect() {
      this.disconnectCount += 1;
      this.localParticipant.isMicrophoneEnabled = false;
      this.emit("Disconnected");
    }
    async startAudio() { if (options.autoplayBlocked) throw new Error("Autoplay blocked"); }
    registerTextStreamHandler(topic, handler) { this.textHandler = handler; }
  }
  const events = new Proxy({}, { get: (_, event) => event });
  const document = {
    getElementById: element,
    createElement: () => new Element(),
    createTextNode: (text) => Object.assign(new Element(), { textContent: text }),
  };
  const window = {
    isSecureContext: true,
    LivekitClient: { Room, RoomEvent: events, Track: { Kind: { Audio: "audio" } } },
    addEventListener: () => {},
  };
  const context = {
    document, window, navigator: { mediaDevices: { getUserMedia() {} }, sendBeacon() {} },
    performance: { now: () => 1 }, AbortSignal, Blob, URL, console,
    setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
    fetch: async (path, request) => {
      requests.push({ path, body: JSON.parse(request.body) });
      return { ok: true, json: async () => path === "/session/end" ? { ended: true } : {
        url: "wss://example.invalid", token: "test-browser-jwt", room: "test-room",
        sessionHandle: "test-session-handle", expiresAt: new Date(Date.now() + 600_000).toISOString(),
      } };
    },
  };
  vm.runInNewContext(readFileSync(join(__dirname, "app.js"), "utf8"), context);
  return { element, rooms, requests };
}

test("connect, reconnect events, microphone, and end cleanup work through the UI", async () => {
  const h = harness();
  await h.element("start").click();
  assert.equal(h.element("connection-state").textContent, "Connected");
  assert.equal(h.rooms[0].localParticipant.isMicrophoneEnabled, true);
  h.rooms[0].emit("Reconnecting");
  assert.equal(h.element("connection-state").textContent, "Reconnecting");
  h.rooms[0].emit("Reconnected");
  assert.equal(h.element("connection-state").textContent, "Connected");
  await h.element("end").click();
  await new Promise(setImmediate);
  assert.equal(h.rooms[0].disconnectCount, 1);
  assert.equal(h.rooms[0].localParticipant.isMicrophoneEnabled, false);
  assert.equal(h.requests.at(-1).path, "/session/end");
  assert.equal(h.element("start").disabled, false);
});

test("autoplay denial keeps the connected microphone session available for manual audio unlock", async () => {
  const h = harness({ autoplayBlocked: true });
  await h.element("start").click();
  assert.equal(h.element("connection-state").textContent, "Connected");
  assert.equal(h.rooms[0].localParticipant.isMicrophoneEnabled, true);
  assert.equal(h.element("audio").textContent, "Enable speaker audio");
  assert.equal(h.element("audio").disabled, false);
});

test("a microphone permission result arriving after End cannot restart capture", async () => {
  const pending = deferred(), entered = deferred();
  const h = harness({ microphone: async () => { entered.resolve(); await pending.promise; } });
  const starting = h.element("start").click();
  await entered.promise;
  h.element("end").click();
  await new Promise(setImmediate);
  pending.resolve();
  await starting;
  assert.equal(h.rooms[0].disconnectCount, 2);
  assert.equal(h.rooms[0].localParticipant.isMicrophoneEnabled, false);
  assert.equal(h.element("connection-state").textContent, "Not connected");
});

test("a cancelled connection failure cannot end a newer session", async () => {
  const pending = deferred(), entered = deferred();
  const h = harness({ connect: async (index) => {
    if (index === 0) { entered.resolve(); await pending.promise; }
  } });
  const obsolete = h.element("start").click();
  await entered.promise;
  h.element("end").click();
  await new Promise(setImmediate);
  await h.element("start").click();
  pending.reject(new Error("old connection failed"));
  await obsolete;
  assert.equal(h.rooms[1].disconnectCount, 0);
  assert.equal(h.element("connection-state").textContent, "Connected");
  assert.equal(h.rooms[1].localParticipant.isMicrophoneEnabled, true);
});

test("obsolete room events and playback do not change a new session", async () => {
  const h = harness();
  await h.element("start").click();
  h.element("end").click();
  await new Promise(setImmediate);
  await h.element("start").click();
  h.rooms[0].emit("Reconnecting");
  h.rooms[0].emit("TrackSubscribed", { kind: "audio", attach() { assert.fail("Stale track attached"); } });
  assert.equal(h.element("connection-state").textContent, "Connected");
  assert.equal(h.rooms[1].disconnectCount, 0);
});

test("final transcript replaces interim text and cannot be overwritten by late interim delivery", async () => {
  const h = harness();
  await h.element("start").click();
  const send = (words, final) => h.rooms[0].textHandler({
    info: { id: "stream", attributes: { "lk.segment_id": "segment", "lk.transcription_final": String(final) } },
    async *[Symbol.asyncIterator]() { yield words; },
  }, { identity: "browser" });
  await send("unfinished", false);
  assert.equal(h.element("transcript").children[0].className, "partial");
  await send("Final transcript", true);
  await send("delayed unfinished", false);
  const line = h.element("transcript").children[0];
  assert.equal(h.element("transcript").children.length, 1);
  assert.equal(line.children[0].textContent, "YOU");
  assert.equal(line.children[1].textContent, "Final transcript");
  assert.equal(line.className, "");
});
