let exporting = false;
figma.showUI(__html__, { width: 360, height: 180, themeColors: true });
figma.ui.onmessage = async function (message) {
  if (message.type === 'close') { figma.closePlugin(); return; }
  if (message.type !== 'export' || exporting) return;
  exporting = true;
  try {
    await figma.currentPage.loadAsync();
    const grids = figma.currentPage.children.filter(node => node.type === 'SLIDE_GRID' && node.visible !== false);
    if (grids.length !== 1) throw new Error('Open a page with exactly one slide grid.');
    const slides = grids[0].children.flatMap(row => row.visible === false ? [] : row.children).filter(node => node.type === 'SLIDE' && node.visible !== false && !node.isSkippedSlide);
    if (!slides.length || slides.length > 80) throw new Error('Export 1-80 visible slides.');
    let total = 0;
    const output = [];
    function texts(node, result) {
      if (node.visible === false) return;
      if (node.type === 'TEXT') result.push(node.characters);
      if (node.children) node.children.forEach(child => texts(child, result));
    }
    for (const slide of slides) {
      const runs = []; texts(slide, runs);
      const text = runs.join('\n');
      if (text.length > 16000) throw new Error('Slide ' + slide.name + ' exceeds 16,000 text characters.');
      const bytes = await slide.exportAsync({ format: 'PNG', constraint: { type: 'WIDTH', value: 1280 } });
      const image = 'data:image/png;base64,' + figma.base64Encode(bytes);
      total += image.length + text.length;
      if (image.length > 8000000 || total > 28000000) throw new Error('Export is too large. Split the deck or use PDF.');
      output.push({ nodeId: slide.id, name: slide.name, text, image });
      figma.ui.postMessage({ type: 'progress', text: 'Exported ' + output.length + ' of ' + slides.length + ' slides' });
    }
    figma.ui.postMessage({ type: 'ready', payload: { schema: 'rk-figma-slides-v1', title: figma.root.name, slides: output } });
  } catch (error) { figma.ui.postMessage({ type: 'error', text: error.message || 'Export failed.' }); }
  finally { exporting = false; }
};