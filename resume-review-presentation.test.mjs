import test from "node:test";
import assert from "node:assert/strict";
import { groupResumeFindings, resumeReviewSections, resumeFindingTargets, resumeContextPosition } from "./src/js/resume-review-presentation.mjs";

test("Concrete suggestions are upfront while broader review remains expandable without duplicates", () => {
  const fixes = [
    { category: "readability", priority: "medium" },
    { category: "role", priority: "medium", anchor: { quote: "Existing evidence" } },
    { category: "impact", priority: "low", anchor: { type: "none" } },
    { category: "story", priority: "low" },
    { category: "interview", priority: "medium", anchor: { quote: "A claim to explain" } },
    { category: "story", priority: "high" },
    { priority: "low" },
  ];
  const items = fixes.map((finding, index) => ({ finding, index })), before = JSON.stringify(items);
  const sections = resumeReviewSections(items);
  const indices = groups => groups.flatMap(group => group.items.map(item => item.index)).sort();
  assert.deepEqual(indices(sections.suggestions), [0, 1, 5, 6]);
  assert.deepEqual(indices(sections.assessments), [2, 3, 4]);
  assert.equal(JSON.stringify(items), before);
  assert.deepEqual(resumeReviewSections([]), { suggestions: [], assessments: [] });
  const mapped = items.map(item => ({ ...item, finding: { priority: item.finding.priority, criterionId: "ats-" + item.index } }));
  assert.deepEqual(indices(resumeReviewSections(mapped, { kind: "ats", result: { fixes } }).suggestions), [0, 1, 5, 6]);
  assert.deepEqual(indices(resumeReviewSections([{ index: 0, finding: { criterionId: "scope", priority: "medium" } }],
    { breakdown: [{ id: "scope", evidence: [{ fieldId: "summary" }] }] }).suggestions), [0]);
});

test("Review categories preserve every finding without inventing classification or scores", () => {
  const items = [
    { index: 0, finding: { category: "impact", action: "Clarify contribution" } },
    { index: 1, finding: { action: "Unclassified legacy advice" } },
    { index: 2, finding: { category: "invented" } },
  ];
  const before = JSON.stringify(items), groups = groupResumeFindings(items);
  assert.deepEqual(groups.map(group => [group.id, group.items.length]), [["impact", 1], ["recommendations", 2]]);
  assert.equal(JSON.stringify(items), before);
  const review = { kind: "ats", result: { fixes: [{ category: "impact" }, {}, { category: "story" }] } };
  assert.deepEqual(groupResumeFindings(items, review).map(group => group.id), ["impact", "story", "recommendations"]);
});

test("Finding targets support ATS and evidence rubric without inventing overall anchors", () => {
  const fields = [{ id: "summary" }, { id: "bullet" }];
  assert.deepEqual(resumeFindingTargets({ fieldIds: ["summary", "summary", "missing"] }, { kind: "ats" }, fields), ["summary"]);
  assert.deepEqual(resumeFindingTargets({ criterionId: "scope" }, { breakdown: [{ id: "scope", evidence: [{ fieldId: "bullet" }] }] }, fields), ["bullet"]);
  assert.deepEqual(resumeFindingTargets({}, {}, fields), []);
  assert.deepEqual(resumeFindingTargets({ fieldIds: ["summary"] }, { kind: "ats" }, fields, { fieldId: "bullet" }), ["bullet"]);
  assert.deepEqual(resumeFindingTargets({ fieldIds: ["summary"] }, { kind: "ats" }, fields, { fieldId: "missing" }), []);
});

test("Context panel stays inside narrow and wide stages and clear of bottom controls", () => {
  for (const width of [200, 320, 640, 1200]) {
    for (const height of [220, 700]) {
      const stage = { width, height, left: 40, top: 80 };
      for (const anchor of [null, { left: 60, right: 250, top: 100, bottom: 170 }, { left: 2000, right: 2200, top: -100, bottom: 900 }]) {
        const box = resumeContextPosition(stage, { height: 600 }, anchor);
        assert.ok(box.left >= 12 && box.left + box.width <= width - 12);
        assert.ok(box.top >= 12 && box.top + Math.min(600, box.maxHeight) <= height - 72);
      }
    }
  }
});
