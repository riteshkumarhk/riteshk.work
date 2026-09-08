export function createScreenshot() {
  const canvas = document.createElement("canvas");
  canvas.width = 2560; canvas.height = 1440;
  const context = canvas.getContext("2d");
  context.fillStyle = "#f6f7f6"; context.fillRect(0, 0, 2560, 1440);
  context.fillStyle = "#203b34"; context.fillRect(0, 0, 450, 1440);
  context.fillStyle = "#ffffff"; context.font = "bold 62px sans-serif"; context.fillText("Fieldwork", 70, 125);
  context.font = "36px sans-serif";
  ["Overview", "Research", "Decisions", "Activity"].forEach((text, index) => context.fillText(text, 70, 290 + index * 100));
  context.fillStyle = "#25332f"; context.font = "bold 76px sans-serif"; context.fillText("Research overview", 550, 155);
  context.font = "34px sans-serif"; context.fillStyle = "#63746e"; context.fillText("Sprint 04 / Synthesis", 555, 225);
  ["12 interviews", "4 themes", "3 decisions"].forEach((text, index) => {
    context.fillStyle = ["#dcefe6", "#f8e8b7", "#dceafa"][index]; context.fillRect(550 + index * 630, 320, 580, 210);
    context.fillStyle = "#25332f"; context.font = "bold 46px sans-serif"; context.fillText(text, 595 + index * 630, 438);
  });
  context.fillStyle = "#ffffff"; context.fillRect(550, 615, 1840, 650);
  context.fillStyle = "#25332f"; context.font = "bold 45px sans-serif"; context.fillText("What we learned", 600, 710);
  ["People need a clear starting point", "Context makes choices easier", "Progress should remain visible"].forEach((text, index) => {
    context.fillStyle = "#e8eeeb"; context.fillRect(600, 790 + index * 145, 1740, 2);
    context.fillStyle = "#316655"; context.font = "36px sans-serif"; context.fillText(`0${index + 1}`, 610, 870 + index * 145);
    context.fillStyle = "#25332f"; context.fillText(text, 730, 870 + index * 145);
  });
  return new Promise(resolve => canvas.toBlob(blob => resolve(new File([blob], "fieldwork-original.png", { type: "image/png" })), "image/png"));
}

export const nativeFixtures = {
  rich: { layout: "free", blocks: [{ kind: "text", x: 5, y: 8, w: 90, size: "lg", font: "serif",
    text: '<p>A <strong>clearer</strong> next step.</p><p><em>Context</em> before complexity.</p>' }] },
  section: { layout: "free", blocks: [{ kind: "section", x: 3, y: 6, w: 94,
    block: { type: "text", title: "The decision", body: '<p>Make the next action clear without hiding the alternatives.</p><ul><li>Keep the context visible</li><li>Give progress a place</li></ul>' } }] }
};