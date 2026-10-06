import assert from 'node:assert/strict';

export async function assertResumeViewTools(toolbar) {
  await toolbar.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const metrics = await toolbar.evaluate(tools => {
    const style = getComputedStyle(tools), box = tools.getBoundingClientRect(), canvas = tools.parentElement.getBoundingClientRect();
    const count = getComputedStyle(tools.querySelector('.resume-view-tools__count'));
    return {
      right:canvas.right-box.right, bottom:canvas.bottom-box.bottom, height:box.height,
      inside:box.left>=canvas.left && box.right<=canvas.right && box.top>=canvas.top && box.bottom<=canvas.bottom,
      overflow:tools.scrollWidth-tools.clientWidth,
      padding:style.padding, gap:style.columnGap, radius:style.borderRadius, border:style.borderTopWidth,
      fontSize:count.fontSize, fontFamily:count.fontFamily.replace(/["'\s]/g,''), mono:style.getPropertyValue('--mono').replace(/["'\s]/g,''),
      buttons:[...tools.querySelectorAll('button')].map(button=>({label:button.getAttribute('aria-label')||button.textContent, width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height})),
      icons:[...tools.querySelectorAll('button svg')].map(icon=>({width:icon.getBoundingClientRect().width,height:icon.getBoundingClientRect().height}))
    };
  });
  assert.ok(Math.abs(metrics.right-12)<1,'Shared floaty right inset');
  assert.ok(Math.abs(metrics.bottom-12)<1,'Shared floaty bottom inset without an overlapping banner');
  assert.ok(Math.abs(metrics.height-44)<1,'Shared compact floaty height');
  assert.equal(metrics.inside,true,'Floaty stays within the document viewport');
  assert.ok(metrics.overflow<=1,'Floaty contents do not overflow');
  assert.equal(metrics.padding,'4px 6px'); assert.equal(metrics.gap,'4px'); assert.equal(metrics.radius,'8px');
  assert.ok(parseFloat(metrics.border)>0 && parseFloat(metrics.border)<=1);
  assert.equal(metrics.fontSize,'10px'); assert.equal(metrics.fontFamily,metrics.mono);
  assert.equal(metrics.buttons.length,4,'Only zoom out, zoom in, fit toggle and canvas lighting');
  assert.equal(metrics.icons.length,4,'Each control is icon-only, with no duplicate labelled Fit button');
  assert.ok(metrics.buttons.every(button=>button.width===34 && button.height===34),JSON.stringify(metrics.buttons));
  assert.ok(metrics.icons.every(icon=>icon.width===16 && icon.height===16),'Shared 16px button icons');
  return metrics;
}

export async function assertStudioToolbar(toolbar, { historyVisible = true } = {}) {
  const metrics = await toolbar.evaluate(bar => {
    const rect = bar.getBoundingClientRect(), navigation = bar.querySelector('.studio-worknav');
    const bounds = element => {
      const box = element.getBoundingClientRect();
      return { x:box.x-rect.x, y:box.y-rect.y, width:box.width, height:box.height };
    };
    const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
    const actionStyle = element => {
      const style = getComputedStyle(element);
      return {label:element.getAttribute('aria-label') || element.textContent.trim(), height:element.getBoundingClientRect().height, fontFamily:style.fontFamily, fontSize:parseFloat(style.fontSize), lineHeight:parseFloat(style.lineHeight), letterSpacing:parseFloat(style.letterSpacing), transform:style.textTransform};
    };
    return {
      viewport:innerWidth, rem:parseFloat(getComputedStyle(document.documentElement).fontSize),
      height:rect.height, overflow:bar.scrollWidth>bar.clientWidth+1,
      mono:getComputedStyle(bar).getPropertyValue('--mono'), sans:getComputedStyle(bar).getPropertyValue('--sans'),
      paddingTop:parseFloat(getComputedStyle(bar).paddingTop),
      back:bounds(navigation.querySelector('.studio-worknav__back')),
      history:bounds(navigation.querySelector('.studio-worknav__history')),
      buttons:[...navigation.querySelectorAll('button')].filter(visible).map(button=>({label:button.getAttribute('aria-label'), ...bounds(button)})),
      actions:[...bar.querySelectorAll('.adm__bar-prev,.adm__dev-btn,.adm__newtab,.merge-layout-toggle,.merge-host-slideview summary')].filter(visible).map(actionStyle),
      titles:[...bar.querySelectorAll('.atsv__ttl,.rws-document-name,.l2tab')].filter(visible).map(actionStyle),
      groupGaps:[...bar.querySelectorAll('.adm__prevgroup,.rws-workbar-actions,.atsv__mid,.merge-bar-views')].filter(visible).map(element=>parseFloat(getComputedStyle(element).columnGap))
    };
  });
  const near = (actual, expected, label) => assert.ok(Math.abs(actual-expected)<=1, `${label}: ${actual} vs ${expected}`);
  near(metrics.back.x, metrics.viewport<=760 ? 10 : metrics.rem*.9, 'Shared left inset');
  near(metrics.paddingTop,6,'Shared top inset');
  near(metrics.back.y,6.5,'Controls stay in the first toolbar row');
  near(metrics.back.width,34,'Back slot width'); near(metrics.back.height,34,'Back slot height');
  near(metrics.history.x,metrics.back.x+34+metrics.rem*.6,'History slot position');
  near(metrics.history.width,68+metrics.rem*.3,'Reserved Undo/Redo width');
  assert.equal(metrics.overflow,false,'Toolbar must not overflow');
  if (metrics.viewport>=1200) near(metrics.height,48,'Single-row toolbar height');
  const history = metrics.buttons.filter(button=>['Undo','Redo'].includes(button.label));
  assert.equal(history.length,historyVisible ? 2 : 0,'Only applicable history controls');
  for (const button of metrics.buttons) {
    near(button.width,34,`${button.label} width`); near(button.height,34,`${button.label} height`);
    near(button.y,metrics.back.y,`${button.label} row`);
  }
  if (historyVisible) {
    assert.deepEqual(history.map(button=>button.label),['Undo','Redo'],'DOM and visual history order agree');
    near(history[0].x,metrics.history.x,'Undo slot');
    near(history[1].x,metrics.history.x+34+metrics.rem*.3,'Redo slot');
  }
  for (const action of metrics.actions) {
    near(action.height,34,'CTA height');
    near(action.fontSize,metrics.rem*.6,'CTA font size');
    near(action.lineHeight,metrics.rem*.6*1.2,`${action.label} CTA line height`);
    assert.ok(Math.abs(action.letterSpacing-metrics.rem*.6*.09)<.05,'Shared CTA tracking');
    assert.equal(action.transform,'uppercase','Shared CTA label case');
    assert.equal(action.fontFamily.replace(/["'\s]/g,''),metrics.mono.replace(/["'\s]/g,''),'Shared CTA font family');
  }
  for (const title of metrics.titles) {
    near(title.fontSize,12,'Title/tab label size');
    assert.equal(title.fontFamily.replace(/["'\s]/g,''),metrics.sans.replace(/["'\s]/g,''),'Shared title/tab font family');
  }
  for (const gap of metrics.groupGaps) near(gap,metrics.rem*.6,'Shared action-group spacing');
  return metrics;
}
