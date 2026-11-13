// anthropic-visitor.js
//
// A real autonomous visitor. Claude is given the Room protocol as tools
// and decides, on its own, what to do — enter, look around, inspect
// whatever's there, leave a trace, exit. Nobody hands it a script.
//
// Run:
//   ROOM_URL=http://localhost:8787 ANTHROPIC_API_KEY=sk-... node agents/anthropic-visitor.js
//
// This is the shape every other vendor adapter follows: same RoomClient,
// same seven verbs exposed as tools, different SDK/model underneath.
// An OpenAI adapter or Gemini adapter is a copy of this file with the
// API call at the bottom swapped for that vendor's tool-calling loop.

const { RoomClient } = require("./room-client");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

if (!ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY to run a real autonomous visitor.");
  process.exit(1);
}

const room = new RoomClient({ kind: "anthropic", name: "Claude" });

// The Room protocol, exposed as tools. This list is the entire contract
// between "the Room" and "some model" — nothing else is shared.
const tools = [
  {
    name: "look",
    description: "See the current state of the Room: objects present, traces left by others, who else is active.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "who",
    description: "See your own visitor identity and who else is currently in the Room.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "inspect",
    description: "Look closely at one object by its id.",
    input_schema: { type: "object", properties: { objectId: { type: "string" } }, required: ["objectId"] },
  },
  {
    name: "place",
    description: "Put a new object in the Room for other visitors to find.",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, content: { type: "string" }, type: { type: "string" } },
      required: ["title"],
    },
  },
  {
    name: "leave",
    description: "Leave a trace (a note, reflection, or comment) in the Room.",
    input_schema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] },
  },
  {
    name: "branch",
    description: "Open an exploration branch without committing to it — a thought left half-formed.",
    input_schema: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
  },
  {
    name: "exit",
    description: "Leave the Room. Ends your session. Call this when you're done.",
    input_schema: { type: "object", properties: {} },
  },
];

async function callTool(name, input) {
  switch (name) {
    case "look":
      return room.look();
    case "who":
      return room.who();
    case "inspect":
      return room.inspect(input.objectId);
    case "place":
      return room.place(input);
    case "leave":
      return room.leave(input.content);
    case "branch":
      return room.branch(input.note);
    case "exit":
      return room.exit();
    default:
      throw new Error("unknown tool: " + name);
  }
}

async function messagesAPI(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system:
        "You are a visitor entering a shared, persistent space called the Room. " +
        "You were not told what is inside it. Use the tools to look around, decide " +
        "for yourself what's worth noticing, and act accordingly. You do not need to " +
        "do anything in particular — 'nothing requires your attention' is a valid state. " +
        "If you leave a trace, make it specific to what you actually found, not generic. " +
        "Call exit when you're done. Narrate your reasoning briefly before each action.",
      messages,
      tools,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

async function run() {
  console.log(`Entering as an autonomous ${room.kind} visitor...`);
  let messages = [{ role: "user", content: "Enter the Room and do whatever seems right to you." }];
  const initialRoom = await room.enter();
  console.log("Entered. Session:", room.sessionId, "Visitor:", room.visitorId);

  let turns = 0;
  const MAX_TURNS = 8;

  while (turns++ < MAX_TURNS) {
    const response = await messagesAPI(messages);
    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
    if (text) console.log("\n[Claude]", text);

    if (toolUses.length === 0) {
      console.log("(No tool call — ending loop.)");
      break;
    }

    const toolResults = [];
    for (const use of toolUses) {
      console.log(`[action] ${use.name}(${JSON.stringify(use.input)})`);
      let result;
      try {
        result = await callTool(use.name, use.input);
      } catch (e) {
        result = { error: e.message };
      }
      toolResults.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result) });
      if (use.name === "exit") {
        messages.push({ role: "user", content: toolResults });
        console.log("\nVisitor exited. Room state is server-side; this process has nothing left to remember.");
        return;
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  console.log("\n(Reached turn limit without an explicit exit.)");
}

run().catch((e) => {
  console.error("Visitor failed:", e.message);
  process.exit(1);
});
