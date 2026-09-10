import { presentDeckWithRenderer } from "../../src/js/deck-presenter.mjs";
import { presenterPanelMarkup, presenterPanelStyles, installPresenterPanel } from "../../src/js/presenter-panel.mjs";
import { createPresenterClock } from "../../src/js/presenter-clock.mjs";
window.fixturePresenter = presentDeckWithRenderer;
window.fixturePanel = { markup: presenterPanelMarkup, styles: presenterPanelStyles, install: installPresenterPanel, clock: createPresenterClock };