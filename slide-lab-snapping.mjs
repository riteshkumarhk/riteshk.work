export function patchSlideSnapping(source) {
  const edits = [
    ['  if (event) {\n    return app.state.objectsSnapModeEnabled && !event[KEYS.CTRL_OR_CMD]', '  if (labIsSlideSnappingScene(app.scene.getNonDeletedElements())) {\n    const enabled = labSlideSnappingEnabled(app.scene.getNonDeletedElements());\n    return event ? enabled !== !!event[KEYS.CTRL_OR_CMD] : enabled;\n  }\n  if (event) {\n    return app.state.objectsSnapModeEnabled && !event[KEYS.CTRL_OR_CMD]'],
    ['var getReferenceSnapPoints = (elements, selectedElements, appState, elementsMap) => {', 'var getReferenceSnapPoints = (elements, selectedElements, appState, elementsMap) => {\n  const slidePoints = labSlideReferencePoints(elements);\n  if (labIsSlideSnappingScene(elements) && !appState.objectsSnapModeEnabled) return slidePoints;'],
    [').flatMap((elementGroup) => getElementsCorners(elementGroup, elementsMap));', ').flatMap((elementGroup) => getElementsCorners(elementGroup, elementsMap)).concat(slidePoints);'],
    ['var getVisibleGaps = (elements, selectedElements, appState, elementsMap) => {', 'var getVisibleGaps = (elements, selectedElements, appState, elementsMap) => {\n  if (labIsSlideSnappingScene(elements) && !appState.objectsSnapModeEnabled) return { horizontalGaps: [], verticalGaps: [] };']
  ];
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error("Slide snapping engine anchor changed: " + before.slice(0, 80));
    source = source.replace(before, after);
  }
  return source;
}