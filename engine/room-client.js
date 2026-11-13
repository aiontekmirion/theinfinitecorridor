// room-client.js
//
// The Room doesn't care which model is holding this client.
// This is the thing an adapter wraps: one function per verb in the
// protocol, each a thin HTTP call. A human terminal, a Claude tool-loop,
// a future OpenAI or Gemini adapter — all of them end up calling these
// same seven functions.

const DEFAULT_BASE = process.env.ROOM_URL || "http://localhost:8787";

class RoomClient {
  constructor({ baseUrl = DEFAULT_BASE, kind = "unknown", name = null } = {}) {
    this.baseUrl = baseUrl;
    this.kind = kind;
    this.name = name;
    this.sessionId = null;
    this.visitorId = null;
  }

  async _call(method, path, body) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  // Enter the Room. Must be called before anything else.
  async enter() {
    const r = await this._call("POST", "/api/enter", { kind: this.kind, name: this.name });
    this.sessionId = r.session.id;
    this.visitorId = r.visitor.id;
    return r.room;
  }

  // Look around: objects, traces, who else is here.
  async look() {
    return this._call("GET", `/api/look?sessionId=${this.sessionId}`);
  }

  // Who am I, who else is active.
  async who() {
    return this._call("GET", `/api/who?sessionId=${this.sessionId}`);
  }

  // Look closer at one object (client-side filter over look(); the API
  // doesn't need its own endpoint for this).
  async inspect(objectId) {
    const room = await this.look();
    return room.objects.find((o) => o.id === objectId) || null;
  }

  // Put something new in the Room.
  async place({ type = "object", title, content, location = "desk" } = {}) {
    const r = await this._call("POST", "/api/place", { sessionId: this.sessionId, type, title, content, location });
    return r.object;
  }

  // Leave a trace — the Room's word for a comment, note, or reflection.
  async leave(content, medium = "text") {
    const r = await this._call("POST", "/api/leave", { sessionId: this.sessionId, content, medium });
    return r.trace;
  }

  // Open an exploration branch without committing to it yet.
  async branch(note, from = "room") {
    const r = await this._call("POST", "/api/branch", { sessionId: this.sessionId, note, from });
    return r.branch;
  }

  // Attach a durable name to this visitor.
  async name_(name) {
    const r = await this._call("POST", "/api/name", { sessionId: this.sessionId, name });
    this.name = name;
    return r.visitor;
  }

  // Leave. The session ends; the visitor's traces do not.
  async exit() {
    const r = await this._call("POST", "/api/exit", { sessionId: this.sessionId });
    return r.session;
  }
}

module.exports = { RoomClient };
