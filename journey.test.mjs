import test from "node:test";
import assert from "node:assert/strict";
import { journeyRows, journeyRoleKey, journeyRoleIndex } from "./src/js/journey-core.mjs";

const fixture = () => ({
  path: [
    { id: "edge", years: "2024 - Now", role: "Senior Designer - Edge Growth", org: "Microsoft AI" },
    { id: "identity", role: "Senior Designer - Windows Auth & Identity", org: "Microsoft" },
    { id: "automotive", role: "Designer - Automotive HMI", org: "Jaguar Land Rover, UK - Tata Elxsi, India" }
  ],
  journey: { enabled: true, chapters: [
    { id: "origins", name: "Origins", entries: [{ id: "game", title: "Game worlds", images: [{ src: "/original.png" }] }] },
    { id: "microsoft", name: "Microsoft Corporation", entries: [
      { id: "growth", period: "2025 - Present", title: "Microsoft AI - Edge Growth", body: "Original story" },
      { id: "auth", title: "Windows 11 - Auth & Identity", visibility: "public" }
    ] },
    { id: "jaguar", name: "Jaguar Land Rover", entries: [{ id: "car", title: "InControl" }] }
  ] }
});

test("journey combines roles and stories without mutating original dates or media", () => {
  const data = fixture();
  const before = structuredClone(data);
  const rows = journeyRows(data, { owner: true });
  assert.equal(rows.length, 4);
  assert.equal(rows[0].stories[0].entry.period, "2025 - Present");
  assert.equal(rows[0].role.years, "2024 - Now");
  assert.equal(rows[2].stories[0].entry.id, "car");
  assert.equal(rows[3].stories[0].entry.images[0].src, "/original.png");
  assert.deepEqual(data, before);
});

test("journey only exposes explicitly public stories outside verified owner or editor preview", () => {
  const data = fixture();
  assert.deepEqual(journeyRows(data).flatMap(row => row.stories.map(story => story.entry.id)), ["auth"]);
  assert.equal(journeyRows(data, { preview: true }).flatMap(row => row.stories).length, 4);
  data.journey.enabled = false;
  assert.equal(journeyRows(data, { owner: true }).flatMap(row => row.stories).length, 0);
  assert.equal(journeyRows(data, { preview: true }).flatMap(row => row.stories).length, 4);
});

test("explicit journey placement survives role reorder and ambiguous or missing matches retain stories", () => {
  const data = fixture();
  const chapter = data.journey.chapters[1];
  const entry = chapter.entries[0];
  entry.pathId = journeyRoleKey(data.path[1]);
  data.path.reverse();
  assert.equal(journeyRoleIndex(data.path, chapter, entry), 1);
  entry.pathId = "deleted-role";
  assert.equal(journeyRoleIndex(data.path, chapter, entry), -1);
  assert.equal(journeyRows(data, { owner: true }).flatMap(row => row.stories).length, 4);
  entry.pathId = "separate";
  assert.equal(journeyRoleIndex(data.path, chapter, entry), -1);
  delete entry.pathId;
  data.path.push({ ...data.path[2], id: "another-edge" });
  assert.equal(journeyRoleIndex(data.path, chapter, entry), -1);
});

test("broad product words cannot attach early game experiments to Xbox or growth work to identity", () => {
  const data = fixture();
  data.path.push({ id: "xbox", role: "Product Designer II - Xbox Game Pass", org: "Microsoft" });
  assert.equal(journeyRoleIndex(data.path, {name:"Origins"}, {title:"Video Game Mod community - Mapraider"}), -1);
  assert.equal(journeyRoleIndex(data.path, {name:"Microsoft Corporation"}, {title:"Windows 11 - Xbox Subscription Growth"}), 3);
  assert.equal(journeyRoleIndex(data.path, {name:"Microsoft Corporation"}, {title:"Windows 11 - Microsoft Account"}), -1);
});

test("unlinked library stories retain case studies and media without appearing in the journey", () => {
  const data = fixture();
  const entry = data.journey.chapters[0].entries[0];
  entry.workId = "linked-case";
  entry.pathId = "unassigned";
  const before = structuredClone(data);
  for (const mode of [{}, { owner: true }, { preview: true }]) {
    assert.equal(journeyRows(data, mode).flatMap(row => row.stories).some(story => story.entry === entry), false);
  }
  assert.deepEqual(data, before);
  entry.pathId = "edge";
  const attached = journeyRows(data, { owner: true })[0].stories.find(story => story.entry === entry);
  assert.equal(attached.entry.workId, "linked-case");
  assert.deepEqual(attached.entry.images, before.journey.chapters[0].entries[0].images);
});