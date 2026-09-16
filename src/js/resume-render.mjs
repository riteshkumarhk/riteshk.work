export const RESUME_FONTS = { inter: { name: 'Inter', family: 'Inter', css: 'Inter, sans-serif', files: ['inter-normal-400-latin.woff2', 'inter-normal-600-latin.woff2'] }, gelasio: { name: 'Gelasio', family: 'Gelasio', css: 'Gelasio, serif', files: ['gelasio-normal-400-latin.woff2', 'gelasio-normal-600-latin.woff2'] }, gambetta: { name: 'Gambetta', family: 'Gambetta', css: 'Gambetta, serif', files: ['gambetta-normal-300700-latin.woff2'] }, mono: { name: 'JetBrains Mono', family: 'JetBrains Mono', css: '"JetBrains Mono", monospace', files: ['jetbrainsmono-normal-400-latin.woff2', 'jetbrainsmono-normal-500-latin.woff2'] } };
export const RESUME_RENDER_VERSION = 9;
export const escapeResumeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function resumeHref(value) {
  const text = String(value || '').trim();
  if (/^(mailto:|tel:)/i.test(text)) return text;
  try { const url = new URL(/^https?:/i.test(text) ? text : 'https://' + text); return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') ? url.href : ''; } catch { return ''; }
}

export function resumeBody(document) {
  const model = document.model, escape = escapeResumeHtml;
  const field = (id, value, tag = 'span', cls = '') => `<${tag} class="${cls}" data-field="${escape(id)}">${escape(value)}</${tag}>`;
  const contact = model.contact;
  const links = [contact.email ? `<a href="mailto:${escape(contact.email)}">${field('contact.email', contact.email)}</a>` : '', contact.phone ? field('contact.phone', contact.phone) : '', contact.location ? field('contact.location', contact.location) : '', ...contact.links.map(link => `<a href="${escape(resumeHref(link.url))}">${field(link.id + '.label', link.label || link.url)}</a>`)].filter(Boolean).join('<span class="contact-separator" aria-hidden="true"> / </span>');
  const header = `<header class="resume-header">${field('name', model.name, 'h1')}${field('title', model.title, 'p', 'resume-title')}<div class="resume-contact">${links}</div></header>`;
  const summary = model.summary ? `<section class="resume-summary"><h2>Profile</h2>${field('summary', model.summary, 'p')}</section>` : '';
  const sectionHtml = section => {
    let body = '';
    if (section.kind === 'experience') body = section.items.map(item => `<article class="resume-entry"><div class="entry-heading">${field(item.id + '.role', item.role, 'h3')}${field(item.id + '.dates', item.dates, 'span', 'dates')}</div><div class="entry-meta">${field(item.id + '.org', item.org)}${item.location ? ' / ' + field(item.id + '.location', item.location) : ''}</div><ul class="resume-import-list">${item.bullets.map(bullet => `<li><span class="resume-import-marker" aria-hidden="true">&#8226; </span>${field(bullet.id, bullet.text)}</li>`).join('')}</ul></article>`).join('');
    else if (section.kind === 'education') body = section.items.map(item => `<article class="resume-entry"><div class="entry-heading">${field(item.id + '.school', item.school, 'h3')}${field(item.id + '.dates', item.dates, 'span', 'dates')}</div><p class="education-description">${field(item.id + '.credential', item.credential)}${item.note ? ' ' + field(item.id + '.note', item.note) : ''}</p></article>`).join('');
    else if (section.kind === 'skills') body = section.groups.map(group => `<p class="skill-group">${field(group.id + '.label', group.label, 'strong')}${group.label ? ': ' : ''}${field(group.id + '.items', group.items.join(', '))}</p>`).join('');
    else if (section.kind === 'text') {
      body = section.text.split(/\n\s*\n/).map(paragraph => {
        const lines = paragraph.split('\n'), blocks = []; let point = null;
        for (const line of lines) {
          const marker = /^([\u2022\u25e6\u25aa\u2023]|[-*]|\d+[.)])\s+(.+)$/.exec(line);
          if (marker) { point = { marker: marker[1], text: marker[2] }; blocks.push(point); }
          else if (point) point.text += (/-$/.test(point.text) && /^\p{Ll}/u.test(line.trim()) ? '' : ' ') + line.trim();
          else blocks.push({ text: line });
        }
        let listOpen = false, html = '';
        for (const block of blocks) {
          if (block.marker && !listOpen) { html += '<ul class="resume-import-list">'; listOpen = true; }
          if (!block.marker && listOpen) { html += '</ul>'; listOpen = false; }
          html += block.marker ? '<li><span class="resume-import-marker" aria-hidden="true">' + escape(block.marker) + ' </span><span>' + escape(block.text) + '</span></li>' : '<p>' + escape(block.text) + '</p>';
        }
        return '<div class="resume-import-paragraph">' + html + (listOpen ? '</ul>' : '') + '</div>';
      }).join('');
      body = '<div data-field="' + escape(section.id + '.text') + '">' + body + '</div>';
    }
    else {
      const entries = (section.items || []).map(item => `<article class="resume-entry"><div class="entry-heading">${field(item.id + '.title', item.title, 'h3')}${item.dates ? field(item.id + '.dates', item.dates, 'span', 'dates') : ''}</div>${section.kind === 'links' && resumeHref(item.meta) ? `<a href="${escape(resumeHref(item.meta))}">${field(item.id + '.meta', item.meta)}</a>` : field(item.id + '.meta', item.meta, 'p')}</article>`);
      const columns = document.design.layout === 'hybrid' && [2, 3].includes(section.columns) ? section.columns : 1;
      for (let index = 0; index < entries.length; index += columns) body += columns > 1 ? `<div class="resume-entry-row" style="--entry-columns:${columns}">${entries.slice(index, index + columns).join('')}</div>` : entries[index];
    }
    return `<section data-section="${escape(section.id)}">${field(section.id + '.heading', section.heading, 'h2')}${body}</section>`;
  };
  if (document.design.layout === 'sidebar') {
    const side = model.sections.filter(section => !['experience', 'text'].includes(section.kind));
    const main = model.sections.filter(section => ['experience', 'text'].includes(section.kind));
    return header + `<div class="resume-columns"><div>${summary}${main.map(sectionHtml).join('')}</div><aside>${side.map(sectionHtml).join('')}</aside></div>`;
  }
  return header + summary + model.sections.map(sectionHtml).join('');
}

export function renderResumeHtml(document, { interactive = false, base = '', sourceOnly = false } = {}) {
  const design = document.design, font = RESUME_FONTS[design.font] || RESUME_FONTS.inter;
  const size = design.size === 'letter' ? '215.9mm 279.4mm' : '210mm 297mm';
  const margin = design.margin === 'narrow' ? '10mm' : '15mm';
  const scale = design.density === 'compact' ? .93 : design.density === 'airy' ? 1.07 : 1;
  const bodySize = Number.isFinite(design.bodySize) && design.bodySize >= 8 && design.bodySize <= 14 ? design.bodySize : 10 * scale;
  const lineHeight = Number.isFinite(design.lineHeight) && design.lineHeight >= 1.15 && design.lineHeight <= 1.8 ? design.lineHeight : design.density === 'compact' ? 1.25 : 1.48;
  const accent = /^#[a-f0-9]{6}$/i.test(design.accent) ? design.accent : '#167d83';
  const style = `@page{size:${size};margin:${margin};@bottom-right{content:counter(page) ' / ' counter(pages);font-family:Inter,sans-serif;font-size:8pt;color:#666}}
*{box-sizing:border-box}html{font-size:16px}body{margin:0;color:#242628;background:white;font-family:${font.css};font-size:${10 * scale}pt;line-height:1.48;letter-spacing:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}h1,h2,h3,p,ul{margin:0}h1{font-size:${27 * scale}pt;line-height:1.15;font-weight:600}h2{font-size:${9 * scale}pt;text-transform:uppercase;font-weight:600;color:${accent};border-bottom:1px solid #d8dedc;padding-bottom:5px;margin:18px 0 9px;break-after:avoid}h3{font-size:${10.5 * scale}pt;font-weight:600;break-after:avoid}p{white-space:pre-line}.resume-header{padding-bottom:13px;border-bottom:2px solid ${accent};break-inside:avoid}.resume-title{color:${accent};font-size:${11 * scale}pt;margin-top:6px}.resume-contact{font-size:${8.1 * scale}pt;color:#53595b;margin-top:10px}.resume-contact a{color:inherit;text-decoration:none;overflow-wrap:anywhere}.contact-separator{color:#9aa2a3;margin:0 5px}.entry-heading{display:flex;justify-content:space-between;gap:12px;align-items:baseline}.dates{font-size:${8.5 * scale}pt;color:#586062;flex-shrink:0}.entry-meta{color:#586062;font-size:${9 * scale}pt;margin:3px 0 6px;break-after:avoid}.resume-entry{margin-bottom:13px;break-inside:${design.keepWhole ? 'avoid' : 'auto'}}ul{padding-left:16px}li{padding-left:2px;margin-bottom:5px;orphans:2;widows:2}li::marker{color:${accent}}.skill-group{margin-bottom:6px}.skill-group strong{font-weight:600}.resume-columns{display:grid;grid-template-columns:minmax(0,1fr) 30%;gap:25px}.resume-columns aside{border-left:1px solid #d8dedc;padding-left:18px}.resume-summary{break-inside:avoid}section{min-width:0}a{overflow-wrap:anywhere}[data-field]{overflow-wrap:break-word}.pagedjs_pages{display:flex;flex-direction:column;align-items:center;gap:20px}.pagedjs_page{flex:none;background:white;box-shadow:0 1px 5px #0002}.pagedjs_margin-bottom-right{color:#687073}@media print{.pagedjs_pages{display:block}.pagedjs_page{box-shadow:none;margin:0!important}}
.resume-import-list{padding:0;list-style:none}.resume-import-list li{display:flex;gap:6px;white-space:pre-line;padding:0}.resume-import-marker{flex:0 0 auto;min-width:8px}.resume-import-paragraph+.resume-import-paragraph{margin-top:8px}
.resume-entry-row{display:grid;grid-template-columns:repeat(var(--entry-columns),minmax(0,1fr));gap:14px;break-inside:avoid}.resume-entry-row .resume-entry{min-width:0;break-inside:avoid}
.entry-heading{flex-wrap:wrap;column-gap:12px;row-gap:2px;break-after:avoid}.entry-heading h3{min-width:0;flex:1 1 120px}.entry-heading .dates{max-width:100%;margin-left:auto;text-align:right;white-space:normal;overflow-wrap:anywhere}.education-description{white-space:normal}
${design.density === 'compact' ? 'body{line-height:1.25}h2{margin:10px 0 6px;padding-bottom:3px}.resume-header{padding-bottom:8px}.resume-title{margin-top:3px}.resume-contact{margin-top:6px}.entry-meta{margin:2px 0 3px}.resume-entry{margin-bottom:8px}li{margin-bottom:2px}.skill-group{margin-bottom:4px}.resume-import-paragraph+.resume-import-paragraph{margin-top:6px}' : ''}
body{font-size:${bodySize}pt;line-height:${lineHeight}}
${interactive ? '[data-field]{cursor:text;border-radius:2px}[data-field]:hover,[data-field]:focus{outline:1px solid #ba863c;outline-offset:3px;background:#d8a65712}' : ''}`;
  if (sourceOnly) return { body: resumeBody(document), css: style };
  const signature = JSON.stringify([document.id, document.name, document.target, document.model, document.design, document.sourceIds]);
  const identity = JSON.stringify({ documentId: document.id, signature }).replace(/</g, '\\u003c');
  const fontQueries = JSON.stringify([...new Set(['400 12px "' + font.family + '"', '600 12px "' + font.family + '"', '400 12px "Inter"'])]);
  return `<!doctype html><html><head><meta charset="utf-8"><base href="${escapeResumeHtml(base || '/')}"/><title>${escapeResumeHtml(document.name)}</title><link rel="stylesheet" href="/css/fonts.css"><style>${style}</style><script>window.PagedConfig={auto:false};</script><script src="/studio/resume-preview/assets/paged.polyfill.js"></script></head><body><template id="source">${resumeBody(document)}</template><div id="pages"></div><script>
(async()=>{
  const identity=${identity};
  const notify=message=>parent.postMessage({...identity,...message},new URL(document.baseURI).origin);
  try{
    const fontQueries=${fontQueries};
    const faces=await Promise.all(fontQueries.map(query=>document.fonts.load(query)));
    await document.fonts.ready;
    if(faces.some(loaded=>!loaded.length)||!fontQueries.every(query=>document.fonts.check(query)))throw new Error('A required resume font did not load. Nothing was substituted.');
    const result=await new Paged.Previewer().preview(document.querySelector('#source').content,undefined,document.querySelector('#pages'));
    await document.fonts.ready;
    ${interactive ? `const previewStyle=document.createElement('style');previewStyle.textContent='@media screen{html,body{background:transparent}.pagedjs_pages{display:flex;flex-direction:column;align-items:center;gap:32px;width:max-content;padding:32px 48px 56px}.pagedjs_page{border-radius:3px;box-shadow:var(--resume-page-shadow,0 1px 2px rgba(0,0,0,.2),0 24px 44px -20px rgba(0,0,0,.55))}}';document.head.append(previewStyle);` : ''}
    ${interactive ? "const previewBounds=document.querySelector('.pagedjs_pages').getBoundingClientRect();" : ''}
    window.resumeReady={...identity,pages:result.total,width:${interactive ? 'Math.ceil(previewBounds.right)' : "document.querySelector('.pagedjs_page').offsetWidth"},height:${interactive ? 'Math.ceil(previewBounds.bottom)' : 'document.body.scrollHeight'},fontLoaded:fontQueries.every(query=>document.fonts.check(query)),renderVersion:${RESUME_RENDER_VERSION}};
    const pageLimit=${Number.isInteger(design.pageLimit) && design.pageLimit >= 1 && design.pageLimit <= 50 ? design.pageLimit : 'null'};
    if(pageLimit&&result.total>pageLimit)window.resumeReady.layoutError='Layout exceeds the '+pageLimit+'-page limit ('+result.total+' pages). Adjust the layout or explicitly change the page limit before exporting.';
    const overflow=[...document.querySelectorAll('.pagedjs_page [data-field]')].some(element=>{
      const area=element.closest('.pagedjs_page').getBoundingClientRect();
      const range=document.createRange();range.selectNodeContents(element);
      return [...range.getClientRects()].some(rect=>rect.width>0&&rect.height>0&&(rect.left<area.left-2||rect.right>area.right+2||rect.top<area.top-2||rect.bottom>area.bottom+2));
    });
    if(!overflow)document.documentElement.dataset.resumeVerified=String(result.total);
    notify({type:'resume-ready',...window.resumeReady});
    ${interactive ? `document.querySelectorAll('[data-field]').forEach(element=>{element.tabIndex=0;element.setAttribute('role','button');element.setAttribute('aria-label','Edit '+element.textContent.slice(0,70));});
    const select=event=>{const field=event.target.closest('[data-field]');if(field){event.preventDefault();notify({type:'resume-field',fieldId:field.dataset.field});}};
    document.addEventListener('click',select);document.addEventListener('keydown',event=>{if(event.key==='Enter')select(event);});` : ''}
  }catch(error){window.resumeError=error.message;notify({type:'resume-error',message:error.message});}
})();</script></body></html>`;
}