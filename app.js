/* ═══════════════════════════════════════════════════════════════════
   sunflower

   The site knows nothing about birthdays, apologies or Valentine's.
   It knows three things:
     1. templates/index.json lists the folders
     2. each folder has a manifest.json declaring its editable fields
     3. each folder has an index.html full of {{tokens}}

   Everything else — the shelf, the editor, the preview, the link —
   is derived. To add a gift you drop in a folder. No code changes.
   ═══════════════════════════════════════════════════════════════════ */

const TEMPLATES = [];          // loaded from disk at boot
let current = null;            // template being edited
let values  = {};              // the sender's answers
let currentPage = null;        // page tab being edited (from manifest.pages)

/* ── fonts the sender can pick from (type:"font" in a manifest) ─────
   The template just writes {{font_family}} into its CSS; the injector
   swaps the picked name for a real font stack and loads the webfonts. */
const FONTS = [
  { name:'Georgia',           css:"Georgia, serif" },
  { name:'Caveat',            css:"'Caveat', cursive",            g:"Caveat:wght@600;700" },
  { name:'Dancing Script',    css:"'Dancing Script', cursive",    g:"Dancing+Script:wght@500;700" },
  { name:'Gloria Hallelujah', css:"'Gloria Hallelujah', cursive", g:"Gloria+Hallelujah" },
  { name:'Pacifico',          css:"'Pacifico', cursive",          g:"Pacifico" },
  { name:'Playfair Display',  css:"'Playfair Display', serif",    g:"Playfair+Display:wght@500;700" },
  { name:'Outfit',            css:"'Outfit', sans-serif",         g:"Outfit:wght@300;400;500" },
  { name:'Comic Neue',        css:"'Comic Neue', cursive",        g:"Comic+Neue:wght@400;700" },
  { name:'Courier Prime',     css:"'Courier Prime', monospace",   g:"Courier+Prime" },
  { name:'Baloo 2',           css:"'Baloo 2', cursive",           g:"Baloo+2:wght@500;600;700;800" },
  { name:'Special Elite',     css:"'Special Elite', monospace",   g:"Special+Elite" },
  { name:'Oswald',            css:"'Oswald', sans-serif",         g:"Oswald:wght@500;600" },
  { name:'Gaegu',             css:"'Gaegu', cursive",             g:"Gaegu:wght@400;700" },
  { name:'Fredoka',           css:"'Fredoka', sans-serif",        g:"Fredoka:wght@500;600;700" }
];
const FONT_LINK = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${
  FONTS.filter(f => f.g).map(f => 'family=' + f.g).join('&')}&display=swap">`;
const fontCSS = name => (FONTS.find(f => f.name === name) || FONTS[0]).css;

/* a template's thumbnail — thumbnail/… paths (and absolute/root) are used
   as-is; a bare filename lives in the template's own asset folder */
const thumbURL = t => !t.thumbnail ? ''
  : (/^(https?:|\/|thumbnail\/)/.test(t.thumbnail) ? t.thumbnail : t.assetsBaseURL + t.thumbnail);

/* ── stickers ───────────────────────────────────────────────────────
   Image stickers live in stickers/ and are listed in stickers/index.json.
   Emoji stickers need no files at all. Placed stickers are stored in
   values._stickers = { pageId: [{id, src|emoji, x, y, w, r}] } where
   x/y are % of the 375×667 phone viewport, w is % of its width and
   r is degrees — so they travel inside the gift link like any field. */
let STICKERS = [];
const EMOJIS = ['🎂','🎈','🎉','🥳','❤️','💖','⭐','✨','🌸','🌻','🎁','😊','🦋','👑','🍰','💐'];

/* the colour dots shown for every type:"color" field */
const SWATCHES = ['#f4602a','#e8402f','#f5992e','#ffd935','#54b167','#59c2f0',
                  '#2979f2','#4a44d4','#a855e0','#e84a68','#16181f','#ffffff'];

/* stickers the sender uploads themselves — kept on this device,
   embedded into the gift as small data-URLs when placed */
let customStickers = [];
const customStore = makeStore('heyflowers.customStickers');
customStickers = customStore.read();

/* ── the open editor: a blank canvas the sender builds from scratch.
   Reuses the same element/overlay engine as templates, but its pages
   are dynamic and its gift HTML is generated rather than read from a
   folder. Registered as a template with openEditor:true. ─────────── */
const BLANK = {
  id:'blank', name:'Open editor', tagline:'make anything', category:'Blank',
  openEditor:true, thumbnail:null, fields:[],
  pages:[{ id:'p1', label:'Page 1', mount:'#pg-p1', display:'flex', bg:'#4aa9f5' }]
};
const SHAPES = ['rect','circle','star','heart','tri'];

/* ───────────────────────── 1. load the folders ───────────────────── */
async function boot(){
  try{
    const reg = await fetch('templates/index.json', { cache: 'no-cache' }).then(r => r.json());
    for (const id of reg.templates){
      const dir = `templates/${id}/`;
      const [manifest, html] = await Promise.all([
        fetch(dir + 'manifest.json', { cache: 'no-cache' }).then(r => r.json()),
        fetch(dir + 'index.html', { cache: 'no-cache' }).then(r => r.text())
      ]);
      manifest.dir  = dir;
      manifest.html = html;
      manifest.assetsBaseURL = manifest.assetsBaseURL || dir;
      TEMPLATES.push(manifest);
    }
  }catch(err){
    shelf.innerHTML = `<div class="loading">Couldn't read the template folder.<br>
      Serve this over http (see README) — <code>fetch</code> won't work from a file:// path.</div>`;
    console.error(err);
    return;
  }
  try{
    const s = await fetch('stickers/index.json').then(r => r.json());
    // absolute so they survive inside a gift's <base>-scoped iframe
    STICKERS = (s.stickers || []).map(f => new URL('stickers/' + f, location.href).href);
  }catch{ /* no sticker folder yet — the emoji row still works */ }
  paintShelf(TEMPLATES);
  routeFromHash();          // a gift link opens straight into the gift
  logVisit();               // count the visit for the admin dashboard (no-op if not set up)
}

/* ───────────────────────── 2. the injector ───────────────────────── */
/* the working pages for a gift — a template's from its manifest, the
   open editor's from the sender's own (growable) page list */
function getPagesFor(tpl, vals){
  return tpl.openEditor ? (vals._pages || tpl.pages || []) : (tpl.pages || []);
}

/* Fills a COPY of the template. The original file is never touched.
   The open editor has no template file, so its gift is generated. */
function inject(tpl, vals, opts = {}){
  if (tpl.openEditor) return buildBlankGift(tpl, vals, opts);
  // an absolute base so the template's own relative assets (its stickers/,
  // birthday-assets/, crush-assets/ …) resolve inside a srcdoc iframe
  const absBase = new URL(tpl.assetsBaseURL || '', location.href).href;
  const field = k => tpl.fields.find(f => f.key === k) || {};
  const dflt  = k => field(k).default || '';
  const valueFor = key => {
    let v = vals[key];
    if (v === undefined || v === null || v === '') v = dflt(key);
    if (field(key).type === 'font') return fontCSS(v);
    if (v && /_url$/.test(key) && !/^(https?:|data:|blob:)/.test(v)) v = new URL(v, absBase).href;
    return v;
  };

  /* A token written as "{{key}}" sits inside a quoted JS string or an HTML
     attribute. Substituting raw text there is how a newline or a quote in
     someone's message could break the template's whole <script> and leave
     the gift frozen. JSON.stringify supplies the quotes AND the escaping. */
  let html = tpl.html.replace(/"\{\{(\w+)\}\}"/g, (m, key) => {
    if (field(key).type === 'font') return m;            // css stack, not a string
    return JSON.stringify(String(valueFor(key) ?? ''));
  });

  html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    let v = vals[key];
    if (v === undefined || v === null || v === '') v = dflt(key);
    if (field(key).type === 'font') return fontCSS(v);   // name → real css stack
    // a bare filename means "an asset that lives with the template" → make it
    // absolute so the <base> tag (pointed at the template) doesn't double it
    if (v && /_url$/.test(key) && !/^(https?:|data:|blob:)/.test(v)) v = new URL(v, absBase).href;
    return v;
  });
  const baseTag = `<base href="${absBase}">`;
  html = /<head[^>]*>/i.test(html)
    ? html.replace(/<head([^>]*)>/i, `<head$1>\n${baseTag}`)
    : html.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}</head>`);
  if (tpl.fields.some(f => f.type === 'font'))
    html = html.replace('</head>', FONT_LINK + '\n</head>');
  html = html.replace('</body>', giftRuntime(tpl, vals, opts) + '\n</body>');
  return html;
}

/* Paints the sender's placed elements (stickers, text, shapes, images)
   and freehand drawings into each page, and lets the editor jump the
   preview to the page being edited. In the editor (opts.editor) the
   draggable overlay shows the elements instead, so nothing is painted. */
function giftRuntime(tpl, vals, opts){
  const pages = getPagesFor(tpl, vals).filter(p => p.mount);
  if (!pages.length) return '';
  const st = vals._stickers || {}, dr = vals._draw || {};
  const json = x => JSON.stringify(x).replace(/<\//g, '<\\/');

  const layers = opts.editor ? '' : pages.map(p => {
    const els = st[p.id] || [], draws = dr[p.id] || [];
    if (!els.length && !draws.length) return '';
    const inner = strokesSVG(draws) + els.map(el =>
      `<div style="position:absolute;${elemBox(el)}">${elemInner(el, true)}</div>`).join('');
    return `<div data-lay-for="${esc(p.mount)}">${inner}</div>`;
  }).join('');

  return `<div id="__lay" style="display:none">${layers}</div>
<script>(function(){
var PAGES=${json(pages)};
function q(s){return document.querySelector(s)}
var holder=document.getElementById('__lay');
PAGES.forEach(function(p){
  var m=q(p.mount); if(!m||!holder) return;
  var src=holder.querySelector('[data-lay-for="'+p.mount+'"]');
  if(!src) return;
  var lay=document.createElement('div');
  lay.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:900;overflow:hidden;';
  lay.innerHTML=src.innerHTML;
  if(getComputedStyle(m).position==='static') m.style.position='relative';
  m.appendChild(lay);
});
if(holder) holder.remove();
addEventListener('message',function(e){
  var d=e.data; if(!d||!d.__gotoPage) return;
  // if the page declares a route, drive the template's own navigation there
  if(d.route!=null && location.hash!==d.route){ location.hash=d.route; }
  // mounts the current page uses (several pages may share one, e.g. #hf-stage)
  var keep={}; PAGES.forEach(function(p){ if(p.id===d.__gotoPage) keep[p.mount]=p.display||'block'; });
  PAGES.forEach(function(p){
    var m=q(p.mount); if(!m) return;
    if(p.mount in keep){ m.style.display=keep[p.mount]; m.style.opacity='1'; }
    else m.style.display='none';
  });
});
})();<\/script>`;
}

/* the open editor's gift: one full-bleed coloured page per page,
   click to advance, elements + drawings painted by giftRuntime */
function buildBlankGift(tpl, vals, opts){
  const pages = getPagesFor(tpl, vals);
  const body = pages.map((p, i) =>
    `<div class="pg" id="${p.mount.slice(1)}" style="background:${p.bg || '#fff'};display:${i ? 'none' : 'flex'}"></div>`).join('');
  const dots = pages.length > 1
    ? `<div class="pgdots">${pages.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>a gift</title>${FONT_LINK}
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%}
body{font-family:'Fredoka',system-ui,sans-serif;overflow:hidden}
.pg{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
.pgdots{position:fixed;left:0;right:0;bottom:16px;display:flex;gap:8px;justify-content:center;z-index:1000}
.pgdots i{width:9px;height:9px;border-radius:50%;background:rgba(0,0,0,.28)}
.pgdots i.on{background:rgba(0,0,0,.72)}
</style></head><body>${body}${dots}
<script>(function(){
var mounts=${JSON.stringify(pages.map(p => p.mount))}, i=0, EDITOR=${!!opts.editor};
var els=mounts.map(function(s){return document.querySelector(s)});
function show(n){ els.forEach(function(e,k){ if(e) e.style.display=k===n?'flex':'none'; });
  document.querySelectorAll('.pgdots i').forEach(function(x,k){ x.className=k===n?'on':''; }); }
if(!EDITOR && mounts.length>1)
  document.body.addEventListener('click',function(){ i=(i+1)%mounts.length; show(i); });
})();<\/script>
${giftRuntime(tpl, vals, opts)}
</body></html>`;
}

/* ───────────────────────── 3. the shelf ──────────────────────────── */
/* Two rows of cards drifting in opposite directions. Each track holds
   its card sequence TWICE so the -50% keyframe loops seamlessly. */
/* Signed out → the drifting marquee (it's the landing page's charm).
   Signed in  → a calm static grid: you're here to pick one and build,
   so every template sits still and fully visible.                     */
function paintShelf(all){
  const list = all.filter(t => !t.openEditor);   // the blank canvas isn't a card
  if (!list.length){ shelf.innerHTML = '<div class="loading">Nothing matches that.</div>'; return; }
  // just the thumbnail — no caption; the image speaks for itself
  const card = t => `
    <button class="gift-card" data-open="${t.id}" aria-label="${esc(t.name)}">
      <div class="bed">${
        t.thumbnail
          ? `<img src="${thumbURL(t)}" alt="${esc(t.name)}" onerror="this.replaceWith(fallback('${t.name}'))">`
          : `<div class="fallback">${esc(t.name)}</div>`
      }</div>
    </button>`;

  const signedIn = !!(window.HFAuth && window.HFAuth.user && window.HFAuth.user());
  shelf.classList.toggle('as-grid', signedIn);
  if (signedIn){
    shelf.innerHTML = `<div class="shelf-grid">${list.map(card).join('')}</div>`;
    return;
  }
  const reps = Math.max(1, Math.ceil(6 / list.length));
  const seq  = Array.from({ length: reps }, () => list.map(card).join('')).join('');
  const row  = rev => `<div class="marquee"><div class="mq-track${rev ? ' rev' : ''}">${seq}${seq}</div></div>`;
  shelf.innerHTML = row(false) + row(true);
}
function fallback(name){
  const d = document.createElement('div');
  d.className = 'fallback';
  d.textContent = name;
  return d;
}

/* ───────────────────────── 4. the editor, built from the manifest ── */
/* One control per field TYPE. No per-template logic anywhere. */
const CONTROL = {
  text:      f => `<input type="text" data-k="${f.key}" value="${esc(f.value)}" placeholder="${esc(f.placeholder||'')}">`,
  paragraph: f => `<textarea data-k="${f.key}" placeholder="${esc(f.placeholder||'')}">${esc(f.value)}</textarea>`,
  image:     f => uploadControl(f, 'image'),
  music:     f => uploadControl(f, 'audio'),
  video:     f => uploadControl(f, 'video'),
  color:     f => `<input type="color" data-k="${f.key}" value="${f.value || '#FFC24B'}">`,
  date:      f => `<input type="date" data-k="${f.key}" value="${esc(f.value)}">`,
  select:    f => `<select data-k="${f.key}">${(f.options||[]).map(o =>
                    `<option ${o===f.value?'selected':''}>${esc(o)}</option>`).join('')}</select>`,
  font:      f => `<select data-k="${f.key}" class="font-sel">${FONTS.map(ft =>
                    `<option value="${esc(ft.name)}" ${ft.name===f.value?'selected':''}
                     style="font-family:${esc(ft.css)}">${esc(ft.name)}</option>`).join('')}</select>`
};

/* set when a signed-out visitor picks a template — we reopen it for them
   the moment they finish signing in, instead of dumping them on the shelf */
let pendingOpen = null;
function openEditor(id, preset, resumeKey){
  // browse freely, but you must be signed in to actually make a gift
  if (window.HFAuth && !window.HFAuth.isIn()){
    pendingOpen = { id, preset, resumeKey };
    window.HFAuth.open('signup');
    return;
  }
  current = TEMPLATES.find(t => t.id === id);
  if (!current) return;
  draftKey = resumeKey !== undefined ? resumeKey : null;

  values = {};
  current.fields.forEach(f => values[f.key] = (preset && preset[f.key] !== undefined)
    ? preset[f.key]
    : (f.default !== undefined ? f.default : ''));
  const clone = x => x ? JSON.parse(JSON.stringify(x)) : {};
  values._stickers = clone(preset && preset._stickers);
  values._draw     = clone(preset && preset._draw);
  if (current.openEditor)
    values._pages  = (preset && preset._pages) ? clone(preset._pages)
                                               : JSON.parse(JSON.stringify(current.pages));

  pTitle.textContent = current.name;
  pSub.textContent   = current.description || '';

  const pages  = getPages();
  currentPage  = pages.length ? pages[0].id : null;
  currentPanel = current.openEditor ? 'pages' : 'text';
  selEl        = null;
  drawMode     = false;
  paintTabs();
  paintSidebar();
  paintFields();
  paintOverlay();

  refreshPreview();
  go('compose');
}

/* ── pages: templates get their pages from the manifest; the open
   editor keeps its (growable) pages in values._pages ─────────────── */
function getPages(){
  if (current && current.openEditor)
    return values._pages || (values._pages = JSON.parse(JSON.stringify(current.pages)));
  return (current && current.pages) || [];
}
const pageDef = id => getPages().find(p => p.id === id);

function paintTabs(){
  const tabs = getPages();
  const add  = current && current.openEditor
    ? `<button type="button" id="addPage" title="Add a page">＋</button>` : '';
  ptabs.innerHTML = (tabs.length < 2 && !add) ? '' : tabs.map(p =>
    `<button type="button" data-ptab="${esc(p.id)}"
       class="${p.id === currentPage ? 'on' : ''}">${esc(p.label)}</button>`).join('') + add;
}

/* ── the sidebar panels ─────────────────────────────────────────────
   Templates expose the manifest (text/stickers/colours/fonts/media);
   the open editor exposes freeform tools (pages/text/images/…/draw).  */
const PANELS_TEMPLATE = [
  { id:'text',     label:'Text',     ic:'Aa' },
  { id:'stickers', label:'Stickers', ic:'☺'  },
  { id:'colors',   label:'Colours',  ic:'◑'  },
  { id:'font',     label:'Fonts',    ic:'ℱ'  }
];
const PANELS_BLANK = [
  { id:'pages',    label:'Pages',    ic:'▤'  },
  { id:'text',     label:'Text',     ic:'Aa' },
  { id:'images',   label:'Images',   ic:'▣'  },
  { id:'stickers', label:'Stickers', ic:'☺'  },
  { id:'shapes',   label:'Shapes',   ic:'◆'  },
  { id:'draw',     label:'Draw',     ic:'✎'  },
  { id:'colors',   label:'Page BG',  ic:'◑'  }
];
let currentPanel = 'text';
const activePanels = () => (current && current.openEditor) ? PANELS_BLANK : PANELS_TEMPLATE;
const panelLabel  = id => (activePanels().find(p => p.id === id) || {}).label || '';

function paintSidebar(){
  edSide.innerHTML = activePanels().map(p =>
    `<button class="sd ${p.id === currentPanel ? 'on' : ''}" data-panel="${p.id}">
       <span class="ic">${p.ic}</span>${esc(p.label)}</button>`).join('');
}

function fieldHTML(f){
  const build = CONTROL[f.type] || CONTROL.text;
  return `<div class="f">
    <div class="lab">${esc(f.label)}${f.required ? '<span class="req">*</span>' : ''}</div>
    ${f.placeholder ? `<div class="help">e.g. ${esc(f.placeholder)}</div>` : ''}
    ${build({ ...f, value: values[f.key] })}
  </div>`;
}

/* colour fields render as a dot grid + a custom picker */
function colorFieldHTML(f){
  const cur = (values[f.key] || '').toLowerCase();
  return `<div class="f">
    <div class="lab">${esc(f.label)}</div>
    <div class="swatches">
      ${SWATCHES.map(c => `<button type="button" class="dot ${c === cur ? 'on' : ''}"
         data-swk="${f.key}" data-swv="${c}" style="background:${c}" title="${c}"></button>`).join('')}
      <label class="dot custom" title="Custom colour">
        <input type="color" data-k="${f.key}" value="${esc(values[f.key] || '#ffffff')}">
      </label>
    </div>
  </div>`;
}

/* font fields render as preset rows, each shown in its own face */
function fontFieldHTML(f){
  return `<div class="f">
    <div class="lab">${esc(f.label)}</div>
    <div class="font-list">
      ${FONTS.map(ft => `<button type="button" class="font-row ${ft.name === values[f.key] ? 'on' : ''}"
         data-fk="${f.key}" data-fv="${esc(ft.name)}"
         style="font-family:${esc(ft.css)}">${esc(ft.name)}<span>${esc(ft.name)}</span></button>`).join('')}
    </div>
  </div>`;
}

function paintFields(){
  if (!current) return;
  panelTitle.textContent = panelLabel(currentPanel);
  const blank = current.openEditor;

  /* manifest-driven panels (used by templates, and 'text'/'stickers' shared) */
  const fieldPanel = (types, perPage) => {
    let list = current.fields.filter(f => types.includes(f.type || 'text'));
    if (perPage && getPages().length > 1)
      list = list.filter(f => (f.page || getPages()[0].id) === currentPage);
    return list;
  };

  let html = '';
  switch (currentPanel){
    case 'pages':    html = pagesPanelHTML(); break;
    case 'stickers': html = selInspector() + stickerPickerHTML(); break;
    case 'images':   html = imagesPanelHTML(); break;
    case 'shapes':   html = shapesPanelHTML(); break;
    case 'draw':     html = drawPanelHTML(); break;
    case 'colors':
      html = blank ? pageBgPanelHTML()
                   : (fieldPanel(['color']).map(colorFieldHTML).join('') || emptyMsg());
      break;
    case 'font':
      html = fieldPanel(['font']).map(fontFieldHTML).join('') || emptyMsg();
      break;
    case 'media':
      html = fieldPanel(['image','music','video']).map(fieldHTML).join('') || emptyMsg();
      break;
    case 'text':
    default:
      if (blank){
        html = selInspector() +
          `<button type="button" class="up-btn" id="addTextBtn">＋ &nbsp;Add a text box</button>
           <div class="help">Add text, then drag it, resize from the corner, spin from the top.
             Select it to change the words, font, size and colour.</div>`;
      } else {
        // text AND media (photo/video/song) for this page — uploads live on
        // the page itself now, so there's no separate Media tab
        html = fieldPanel(['text','paragraph','date','select','image','music','video'], true)
                 .map(fieldHTML).join('') || emptyMsg();
      }
  }
  fields.innerHTML = html;
}
const emptyMsg = () => `<div class="panel-empty">Nothing of this kind here — try another tab.</div>`;

/* ── the selection inspector: edit the currently-selected element ─── */
function selInspector(){
  const el = selEl && elemList().find(s => s.id === selEl);
  if (!el) return '';
  if (el.type === 'text')
    return `<div class="inspector">
      <div class="lab small">Selected text</div>
      <textarea data-eltext="${el.id}" rows="2">${esc(el.text || '')}</textarea>
      <div class="lab small">Font</div>
      <select data-elfont="${el.id}">${FONTS.map(ft =>
        `<option value="${esc(ft.name)}" ${ft.name === (el.font||'Fredoka') ? 'selected' : ''}
          style="font-family:${esc(ft.css)}">${esc(ft.name)}</option>`).join('')}</select>
      <div class="lab small">Colour</div>
      ${swatchRow(el.color || '#111827', 'eltextcol', el.id)}
      <button type="button" class="mini-del" data-eldel="${el.id}">Delete text</button>
    </div>`;
  if (el.type === 'shape')
    return `<div class="inspector">
      <div class="lab small">Shape fill</div>
      ${swatchRow(el.fill || '#ffd935', 'elshapecol', el.id)}
      <button type="button" class="mini-del" data-eldel="${el.id}">Delete shape</button>
    </div>`;
  return `<div class="inspector">
    <div class="lab small">Selected sticker</div>
    <button type="button" class="mini-del" data-eldel="${el.id}">Delete</button>
  </div>`;
}
function swatchRow(cur, kind, id){
  cur = (cur || '').toLowerCase();
  return `<div class="swatches">
    ${SWATCHES.map(c => `<button type="button" class="dot ${c === cur ? 'on' : ''}"
       data-${kind}="${id}" data-col="${c}" style="background:${c}"></button>`).join('')}
    <label class="dot custom"><input type="color" data-${kind}="${id}" data-col="live" value="${esc(cur || '#000000')}"></label>
  </div>`;
}

/* ── open-editor panels ─────────────────────────────────────────── */
function pagesPanelHTML(){
  const pages = getPages();
  return `<div class="lab small">Pages</div>
    <div class="page-list">${pages.map((p, i) => `
      <div class="page-row ${p.id === currentPage ? 'on' : ''}" data-gopage="${p.id}">
        <span class="pg-dot" style="background:${p.bg || '#fff'}"></span>
        <span class="pg-name">${esc(p.label)}</span>
        ${pages.length > 1 ? `<button type="button" class="pg-x" data-delpage="${p.id}" title="Delete page">✕</button>` : ''}
      </div>`).join('')}</div>
    <button type="button" class="up-btn" id="addPageBtn">＋ &nbsp;Add a page</button>
    <div class="help">Each page is a screen of the gift. The recipient taps to move to the next one.</div>`;
}
function pageBgPanelHTML(){
  const p = pageDef(currentPage) || {};
  return `<div class="lab small">Background of “${esc(p.label || 'page')}”</div>
    ${swatchRow(p.bg || '#ffffff', 'pagebg', currentPage)}`;
}
function imagesPanelHTML(){
  return `<button type="button" class="up-btn" id="imgUpBtn">⤴ &nbsp;Upload an image</button>
    <input type="file" id="imgUpload" accept="image/*" hidden>
    ${customStickers.length ? `<div class="lab small">Your uploads</div>
      <div class="stick-grid">${customStickers.map((s, i) =>
        `<button type="button" data-cs="${i}"><img src="${esc(s)}" alt=""></button>`).join('')}</div>` : ''}
    <div class="help">Photos are placed on the page — drag, resize and spin like anything else.</div>`;
}
function shapesPanelHTML(){
  const label = { rect:'Square', circle:'Circle', star:'Star', heart:'Heart', tri:'Triangle' };
  return selInspector() +
    `<div class="lab small">Add a shape</div>
     <div class="shape-grid">${SHAPES.map(s =>
       `<button type="button" class="shape-btn" data-shape="${s}">
          <svg viewBox="0 0 100 100" style="width:34px;height:34px">${
            shapeSVG({ shape: s, fill: shapeFill }).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>
          <span>${label[s]}</span></button>`).join('')}</div>
     <div class="lab small">Fill colour</div>
     ${swatchRow(shapeFill, 'shapefill', 'x')}`;
}
function drawPanelHTML(){
  const clears = (drawList().length) ? `<button type="button" class="mini-del" id="clearDraw">Clear drawing</button>` : '';
  return `<button type="button" class="up-btn ${drawMode ? 'active' : ''}" id="drawToggle">
      ${drawMode ? '✓ Drawing — tap to stop' : '✎ Start drawing'}</button>
    <div class="lab small">Pen colour</div>
    ${swatchRow(drawColor, 'drawcol', 'x')}
    <div class="lab small">Pen size</div>
    <input type="range" min="1" max="24" value="${drawWidth}" id="drawWidth" class="range">
    ${clears}
    <div class="help">Turn drawing on, then draw on the canvas with your mouse or finger.</div>`;
}

/* the sticker panel: upload your own, your saved ones, emoji, the shelf */
function stickerPickerHTML(){
  const p = pageDef(currentPage);
  if (!p || !p.mount)
    return `<div class="panel-empty">Pick a page tab above to place stickers on it.</div>`;
  return `
    <button type="button" class="up-btn" id="stickUpBtn">⤴ &nbsp;Upload your own sticker</button>
    <input type="file" id="stickUpload" accept="image/*" hidden>
    ${customStickers.length ? `<div class="lab small">Your stickers</div>
      <div class="stick-grid">${customStickers.map((s, i) =>
        `<button type="button" data-cs="${i}"><img src="${esc(s)}" alt=""></button>`).join('')}</div>` : ''}
    <div class="lab small">Emoji</div>
    <div class="emoji-row">${EMOJIS.map(e =>
      `<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>
    ${STICKERS.length ? `<div class="lab small">Sticker shelf</div>
      <div class="stick-grid">${STICKERS.map(s =>
        `<button type="button" data-stick="${esc(s)}"><img src="${esc(s)}" alt="" loading="lazy"
          onerror="this.closest('button').remove()"></button>`).join('')}</div>` : ''}
    <div class="help">Tap a sticker to drop it on this page, then drag it anywhere.
      Corner handle resizes, top handle spins. Uploaded stickers make the link heavier.</div>`;
}

/* uploads are shrunk to sticker size so the gift link stays sendable */
function handleStickerUpload(file){
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(img.src);
    const s = Math.min(1, 200 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width  = Math.max(1, Math.round(img.width  * s));
    c.height = Math.max(1, Math.round(img.height * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/png');
    if (url.length > 150000){ toast('That image is too heavy for a gift link'); return; }
    customStickers.unshift(url);
    customStickers = customStickers.slice(0, 12);
    customStore.write(customStickers);
    paintFields();
    addElement({ src: url });
    toast('Sticker added — drag it into place');
  };
  img.onerror = () => toast("Couldn't read that image");
  img.src = URL.createObjectURL(file);
}

/* ── media fields: upload a photo or a song instead of pasting a URL ─ */
function uploadControl(f, kind){
  const v = f.value || '';
  const url = /^(data:|blob:)/.test(v) ? '' : v;   // keep the box for plain links only
  const label  = kind === 'audio' ? 'Upload a song' : kind === 'video' ? 'Upload a video' : 'Upload a photo';
  const accept = kind === 'audio' ? 'audio/*'       : kind === 'video' ? 'video/*'        : 'image/*';
  return `
    <button type="button" class="up-btn" data-upk="${f.key}">⤴ &nbsp;${label}</button>
    <input type="file" accept="${accept}" data-upfile="${f.key}" data-upkind="${kind}" hidden>
    <div class="up-preview">${mediaPreview(v, kind)}</div>
    <input type="url" class="up-url" data-k="${f.key}" value="${esc(url)}" placeholder="…or paste a link">`;
}
function mediaPreview(v, kind){
  if (!v) return '';
  if (kind === 'audio') return `<div class="mp-audio">♪ &nbsp;song attached</div>`;
  if (kind === 'video') return `<video class="mp-vid" src="${esc(v)}" controls muted playsinline></video>`;
  return `<img class="mp-img" src="${esc(v)}" alt="">`;
}

/* photos are downscaled + re-encoded so the gift link stays sendable;
   songs are read as-is (great in preview, big ones warn about the link) */
function handleMediaUpload(key, kind, file){
  if (!file) return;
  if (kind === 'image'){
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      const max = 1400, s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width  = Math.max(1, Math.round(img.width  * s));
      c.height = Math.max(1, Math.round(img.height * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      values[key] = c.toDataURL('image/jpeg', 0.82);
      paintFields(); refreshPreview(); saveDraft();
      if (values[key].length > 900000) toast('Big photo — the gift link will be large');
    };
    img.onerror = () => toast("Couldn't read that image");
    img.src = URL.createObjectURL(file);
  } else {
    const rd = new FileReader();
    rd.onload = () => {
      values[key] = rd.result;
      paintFields(); refreshPreview(); saveDraft();
      const big = kind === 'video' ? 4000000 : 1500000;
      if (rd.result.length > big)
        toast(kind === 'video'
          ? 'Plays in preview — but a video this size is too big to fit in a share link'
          : 'Long song — plays in preview, but may be too big for a share link');
    };
    rd.onerror = () => toast("Couldn't read that file");
    rd.readAsDataURL(file);
  }
}

/* ── the preview ──────────────────────────────────────────────────
   The template is a real running page, so it can't be re-mounted on
   every keystroke — it would restart the envelope mid-type. That was
   the glitch. So: it refreshes when you FINISH a field (blur), or when
   you press ↻. While you type, the label goes amber to say "stale".   */
let stale = false, idle;

fields.addEventListener('input', e => {
  const k = e.target.dataset.k;
  if (!k) return;
  values[k] = e.target.value;
  markStale();
  clearTimeout(idle);
  idle = setTimeout(saveDraft, 400);          // draft saves quietly, preview does not
});
fields.addEventListener('change', e => {      // fires on blur — you've finished the field
  if (e.target.dataset.k) refreshPreview();
});
fields.addEventListener('click', e => {       // the sticker shelf + pickers
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.stick) addElement({ src: d.stick });
  if (d.emoji) addElement({ emoji: d.emoji });
  if (d.cs !== undefined){ const s = customStickers[+d.cs]; if (s) addElement({ src: s }); }
  if (b.id === 'stickUpBtn') fields.querySelector('#stickUpload').click();
  if (b.id === 'imgUpBtn')   fields.querySelector('#imgUpload').click();
  if (b.id === 'addTextBtn') addElement({ type:'text', text:'Your text', color:'#111827', font:'Fredoka', size:7 });
  if (b.id === 'addPageBtn') addPage();
  if (d.shape) addElement({ type:'shape', shape:d.shape, fill:shapeFill });
  if (b.id === 'drawToggle'){ drawMode = !drawMode; selEl = null; paintOverlay(); paintFields(); }
  if (b.id === 'clearDraw'){ if (values._draw) values._draw[currentPage] = []; paintOverlay(); paintFields(); saveDraft(); }
  if (d.eldel){ deleteEl(d.eldel); }
  if (d.gopage){ switchPage(d.gopage); }
  if (d.delpage){ deletePage(d.delpage); }
  if (d.upk) fields.querySelector(`[data-upfile="${d.upk}"]`).click();
  if (d.col && d.col !== 'live') applyColorDot(d);   // a colour swatch dot
  if (d.swk){                                  // a template colour dot
    values[d.swk] = d.swv;
    paintFields(); refreshPreview(); saveDraft();
  }
  if (d.fk){                                   // a template font preset row
    values[d.fk] = d.fv;
    paintFields(); refreshPreview(); saveDraft();
  }
});
fields.addEventListener('change', e => {      // uploads, custom colours, element font
  const t = e.target, d = t.dataset;
  if (t.id === 'stickUpload'){ handleStickerUpload(t.files[0]); t.value = ''; }
  if (t.id === 'imgUpload'){   handleImagePlace(t.files[0]);   t.value = ''; }
  if (d.upfile){ handleMediaUpload(d.upfile, d.upkind, t.files[0]); t.value = ''; }
  if (d.col === 'live') applyColorDot(d, t.value);       // custom colour committed
  if (d.elfont){ const el = elemList().find(s => s.id === d.elfont); if (el){ el.font = t.value; paintOverlay(); saveDraft(); } }
});
/* live edits: typing in a text box, sliding the pen size, picking a colour */
fields.addEventListener('input', e => {
  const t = e.target, d = t.dataset;
  if (d.eltext){ const el = elemList().find(s => s.id === d.eltext); if (el){ el.text = t.value; paintOverlay(); clearTimeout(idle); idle = setTimeout(saveDraft, 400); } }
  if (t.id === 'drawWidth'){ drawWidth = +t.value; }
  if (d.col === 'live') applyColorDot(d, t.value);
});

/* apply a colour (from a swatch dot's data-col, or a custom picker's value) */
function applyColorDot(d, live){
  const color = live || d.col;
  if (d.eltextcol){  const el = elemList().find(s => s.id === d.eltextcol);  if (el) el.color = color; paintOverlay(); }
  else if (d.elshapecol){ const el = elemList().find(s => s.id === d.elshapecol); if (el) el.fill = color; paintOverlay(); }
  else if (d.shapefill){ shapeFill = color; }
  else if (d.drawcol){ drawColor = color; }
  else if (d.pagebg){ const p = pageDef(d.pagebg); if (p){ p.bg = color; refreshPreview(); } }
  else return;
  if (!live) paintFields();      // reflect the new selection (skip while dragging the picker)
  saveDraft();
}

/* ── open-editor page management ──────────────────────────────────── */
function switchPage(id){
  currentPage = id;
  selEl = null; drawMode = false;
  paintTabs(); paintFields(); paintOverlay();
  sendGotoPage();
}
function addPage(){
  const pages = getPages();
  const n = pages.length + 1;
  const id = 'p' + Date.now().toString(36).slice(-4);
  pages.push({ id, label: 'Page ' + n, mount: '#pg-' + id, display: 'flex',
               bg: pages[pages.length - 1] && pages[pages.length - 1].bg || '#4aa9f5' });
  currentPage = id;
  paintTabs(); paintFields(); paintOverlay();
  refreshPreview();     // the gift needs a new page div
  saveDraft();
}
function deletePage(id){
  const pages = getPages();
  if (pages.length < 2) return;
  const i = pages.findIndex(p => p.id === id);
  if (i < 0) return;
  pages.splice(i, 1);
  if (values._stickers) delete values._stickers[id];
  if (values._draw) delete values._draw[id];
  if (currentPage === id) currentPage = pages[Math.max(0, i - 1)].id;
  paintTabs(); paintFields(); paintOverlay();
  refreshPreview();
  saveDraft();
}
function deleteEl(id){
  values._stickers[currentPage] = elemList().filter(s => s.id !== id);
  if (selEl === id) selEl = null;
  paintOverlay(); paintFields(); saveDraft();
}
/* uploaded photos placed straight onto the canvas as an element */
function handleImagePlace(file){
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(img.src);
    const max = 900, s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * s));
    c.height = Math.max(1, Math.round(img.height * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.82);
    customStickers.unshift(url);
    customStickers = customStickers.slice(0, 12);
    customStore.write(customStickers);
    paintFields();
    addElement({ src: url });
    toast('Image placed — drag it into position');
  };
  img.onerror = () => toast("Couldn't read that image");
  img.src = URL.createObjectURL(file);
}
pvRefresh.onclick = refreshPreview;
pvFull.onclick    = () => openGift(current, values);

function markStale(){
  stale = true;
  pvHint.textContent = 'tap ↻ to update';
  pvHint.classList.add('stale');
}
function refreshPreview(){
  if (!current) return;
  stale = false;
  pvHint.textContent = 'live preview';
  pvHint.classList.remove('stale');
  pv.srcdoc = inject(current, values, { editor: true });
  scalePreview();
}

/* jump the running preview to the page being edited — and, if the page
   declares a `route`, tell the template to navigate there (its own sections) */
function sendGotoPage(){
  const p = pageDef(currentPage);
  if (p && p.mount && pv.contentWindow)
    pv.contentWindow.postMessage({ __gotoPage: p.id, route: p.route }, '*');
}
pv.addEventListener('load', sendGotoPage);

/* the preview iframe renders at a fixed 375px phone width, then we scale it
   to whatever width the frame ended up — so the gift never clips at the edges */
function scalePreview(){
  if (!pv || !pv.parentElement) return;
  const w = pv.parentElement.clientWidth, h = pv.parentElement.clientHeight;
  if (!w || !h) return;
  const s = Math.max(w / 375, h / 667);   // cover the frame — never leave a gap
  pv.style.transform = `scale(${s.toFixed(4)})`;
  svo.style.transform = pv.style.transform;   // sticker overlay tracks the same scale
}
addEventListener('resize', scalePreview);

/* ── the element overlay ───────────────────────────────────────────
   A 375×667 layer sits over the preview and holds everything the sender
   adds: stickers, emoji, text, shapes — all draggable. Freehand drawing
   is a separate strokes layer. giftRuntime() re-creates the identical
   markup inside the opened gift, so the editor is a true preview.     */
let selEl = null, drawMode = false, drawColor = '#111827', drawWidth = 5, shapeFill = '#ffd935';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function elemList(){
  if (!values._stickers) values._stickers = {};
  return values._stickers[currentPage] || (values._stickers[currentPage] = []);
}
function drawList(){
  if (!values._draw) values._draw = {};
  return values._draw[currentPage] || (values._draw[currentPage] = []);
}

/* one element's inner content, sized to fill its box.
   forGift → font sizes in vw (scale with the device); editor → px on
   the fixed 375-wide canvas (1 width-% ≈ 3.75px).                     */
function elemInner(el, forGift){
  const u = n => forGift ? n + 'vw' : (n * 3.75) + 'px';
  if (el.type === 'text')
    return `<div class="el-text" style="font-family:${fontCSS(el.font || 'Fredoka')};
      color:${el.color || '#111827'};font-size:${u(el.size || 6)};font-weight:600;
      line-height:1.18;text-align:center;white-space:pre-wrap;word-break:break-word;">${esc(el.text || '')}</div>`;
  if (el.type === 'shape') return shapeSVG(el);
  if (el.emoji)
    return `<div class="el-emoji" style="font-size:${u(el.w * 0.9)};line-height:1;text-align:center;">${el.emoji}</div>`;
  return `<img src="${esc(el.src)}" alt="" draggable="false" style="width:100%;display:block;">`;
}
function shapeSVG(el){
  const f = el.fill || '#ffd935';
  const p = {
    rect:   `<rect x="3" y="3" width="94" height="94" rx="12" fill="${f}"/>`,
    circle: `<ellipse cx="50" cy="50" rx="48" ry="48" fill="${f}"/>`,
    star:   `<path d="M50 3 61 38 98 38 68 60 79 96 50 74 21 96 32 60 2 38 39 38Z" fill="${f}"/>`,
    heart:  `<path d="M50 90 C14 62 4 40 4 25 C4 12 15 4 27 4 C37 4 45 10 50 19 C55 10 63 4 73 4 C85 4 96 12 96 25 C96 40 86 62 50 90Z" fill="${f}"/>`,
    tri:    `<path d="M50 4 96 94 4 94Z" fill="${f}"/>`
  }[el.shape] || '';
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%;display:block;">${p}</svg>`;
}
function strokesSVG(list){
  return `<svg class="strokes" viewBox="0 0 375 667" preserveAspectRatio="none"
    style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;">${
    (list || []).map(s => `<path d="${s.d}" fill="none" stroke="${s.stroke}" stroke-width="${s.sw}"
      stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;
}
/* the inline placement for an element's box */
function elemBox(el){
  const h = (el.type === 'shape') ? `height:${el.h || el.w}%;` : '';
  return `left:${el.x}%;top:${el.y}%;width:${el.w}%;${h}transform:translate(-50%,-50%) rotate(${el.r || 0}deg)`;
}

function addElement(base){
  const p = pageDef(currentPage);
  if (!p || !p.mount){ toast('Add a page first'); return; }
  const id = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const defW = base.type === 'text' ? 60 : base.type === 'shape' ? 26 : base.emoji ? 14 : 24;
  const el = { id, x: 50, y: 45, w: defW, r: 0, ...base };
  if (base.type === 'shape' && el.h == null) el.h = defW;
  elemList().push(el);
  selEl = id;
  paintOverlay();
  paintFields();
  saveDraft();
}

function paintOverlay(){
  if (!current){ svo.innerHTML = ''; return; }
  const p = pageDef(currentPage);
  const canPlace = p && p.mount;
  const els   = canPlace ? elemList() : [];
  const draws = canPlace ? drawList() : [];
  svo.classList.toggle('drawing', drawMode);
  svo.innerHTML = strokesSVG(draws) + els.map(s => `
    <div class="sv ${s.id === selEl ? 'sel' : ''}" data-sid="${s.id}" style="${elemBox(s)}">
      ${elemInner(s, false)}
      <button type="button" class="sv-del" title="Remove">✕</button>
      <div class="sv-rot" title="Spin"></div>
      <div class="sv-res" title="Resize"></div>
    </div>`).join('');
}

/* live-update one element mid-drag without rebuilding the DOM */
function nudgeEl(el){
  const n = svo.querySelector(`[data-sid="${el.id}"]`);
  if (!n) return;
  n.style.left = el.x + '%';
  n.style.top  = el.y + '%';
  n.style.width = el.w + '%';
  if (el.type === 'shape') n.style.height = (el.h || el.w) + '%';
  n.style.transform = `translate(-50%,-50%) rotate(${el.r || 0}deg)`;
  const tx = n.querySelector('.el-text');  if (tx) tx.style.fontSize = ((el.size || 6) * 3.75) + 'px';
  const em = n.querySelector('.el-emoji'); if (em) em.style.fontSize = (el.w * 0.9 * 3.75) + 'px';
}

let svDrag = null, curStroke = null;
svo.addEventListener('pointerdown', e => {
  /* draw mode: start a freehand stroke */
  if (drawMode){
    const rect = svo.getBoundingClientRect();
    const X = x => (x - rect.left) / rect.width  * 375;
    const Y = y => (y - rect.top)  / rect.height * 667;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', drawColor);
    path.setAttribute('stroke-width', drawWidth);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    curStroke = { d: `M${X(e.clientX).toFixed(1)} ${Y(e.clientY).toFixed(1)}`, path, X, Y };
    path.setAttribute('d', curStroke.d);
    (svo.querySelector('svg.strokes') || svo).appendChild(path);
    try{ svo.setPointerCapture(e.pointerId); }catch{}
    e.preventDefault();
    return;
  }
  const box = e.target.closest('.sv');
  if (!box) return;
  const st = elemList().find(s => s.id === box.dataset.sid);
  if (!st) return;
  if (e.target.closest('.sv-del')){
    values._stickers[currentPage] = elemList().filter(s => s !== st);
    selEl = null;
    paintOverlay();
    paintFields();
    saveDraft();
    return;
  }
  if (selEl !== st.id){ selEl = st.id; paintOverlay(); paintFields(); }
  const rect = svo.getBoundingClientRect();
  const px = (e.clientX - rect.left) / rect.width  * 100;
  const py = (e.clientY - rect.top)  / rect.height * 100;
  const aspect = rect.height / rect.width;
  const mode = e.target.closest('.sv-res') ? 'res'
             : e.target.closest('.sv-rot') ? 'rot' : 'move';
  svDrag = { st, mode, rect, aspect,
             dx: px - st.x, dy: py - st.y,
             w0: st.w, h0: st.h || st.w, s0: st.size || 6,
             d0: Math.hypot(px - st.x, (py - st.y) * aspect) };
  e.preventDefault();
});
addEventListener('pointermove', e => {
  if (curStroke){
    curStroke.d += ` L${curStroke.X(e.clientX).toFixed(1)} ${curStroke.Y(e.clientY).toFixed(1)}`;
    curStroke.path.setAttribute('d', curStroke.d);
    return;
  }
  if (!svDrag) return;
  const { st, mode, aspect } = svDrag;
  const px = (e.clientX - svDrag.rect.left) / svDrag.rect.width  * 100;
  const py = (e.clientY - svDrag.rect.top)  / svDrag.rect.height * 100;
  if (mode === 'move'){
    st.x = clamp(px - svDrag.dx, 0, 100);
    st.y = clamp(py - svDrag.dy, 0, 100);
  }else if (mode === 'res'){
    const k = clamp(Math.hypot(px - st.x, (py - st.y) * aspect) / Math.max(svDrag.d0, 0.001), 0.05, 6);
    st.w = clamp(svDrag.w0 * k, 3, 130);
    if (st.h != null)        st.h    = clamp(svDrag.h0 * k, 3, 200);
    if (st.type === 'text')  st.size = clamp(svDrag.s0 * k, 1.5, 40);
  }else{
    const ang = Math.atan2((py - st.y) * aspect, px - st.x);
    st.r = Math.round(ang * 180 / Math.PI + 90);
  }
  nudgeEl(st);
});
addEventListener('pointerup', () => {
  if (curStroke){
    drawList().push({ d: curStroke.d, stroke: drawColor, sw: drawWidth });
    curStroke = null;
    saveDraft();
    return;
  }
  if (svDrag){ svDrag = null; saveDraft(); }
});
addEventListener('keydown', e => {
  if (e.key === 'Escape' && !svDrag){
    if (drawMode){ drawMode = false; paintOverlay(); paintFields(); }
    else if (selEl){ selEl = null; paintOverlay(); paintFields(); }
  }
});

/* The sent screen shows a still card, not a running template — you're
   done editing by then, and it keeps that page light. */
function posterHTML(){
  const t = current, v = values;
  if (t.openEditor){
    const pages = getPagesFor(t, v).length;
    return `<div class="q">✎ your creation</div>
      <div class="to">${esc(draftLabel(t, v))}</div>
      <div class="meta">${pages} page${pages === 1 ? '' : 's'} · open editor</div>`;
  }
  const first = t.fields.find(f => f.type === 'text' && f.required) || t.fields[0] || {};
  const line  = t.fields.find(f => f.type === 'paragraph');
  return `
    ${t.thumbnail ? `<img src="${thumbURL(t)}" alt="" onerror="this.remove()">` : ''}
    ${v.question ? `<div class="q">${esc(v.question)}</div>` : ''}
    ${first.key && v[first.key] ? `<div class="to">${esc(v[first.key])}</div>` : ''}
    ${line && v[line.key] ? `<div class="msg">${strip(v[line.key])}</div>` : ''}
    <div class="meta">${[
      v.photo_url ? 'photo' : null,
      v.music_url ? 'song'  : null,
      t.experienceTime
    ].filter(Boolean).join(' · ')}</div>`;
}

/* ───────────────────────── 5. open the gift for real ─────────────── */
/* The gift should feel like it came from the sender and nobody else — no
   branding, no "made with", no template name (that last one quietly
   reframes something handmade as something picked off a shelf). The
   person who was sent it just sees who it's for. */
function openGift(tpl, vals, opts = {}){
  const forYou = !!opts.recipient;
  const to = draftLabel(tpl, vals);
  viewerTag.textContent = forYou
    ? (to && to !== 'someone' ? `for ${to}` : '')
    : `${tpl.category} · ${tpl.tagline || ''}`;

  document.body.classList.toggle('as-recipient', forYou);
  closeBtn.hidden = forYou;            // nothing to close back to — they arrived here

  viewer.hidden = false;
  document.body.style.overflow = 'hidden';
  viewFrame.srcdoc = inject(tpl, vals);
  window._viewing = { tpl, vals, recipient: forYou };
}
function closeGift(){
  viewer.hidden = true;
  viewFrame.srcdoc = '';
  document.body.style.overflow = '';
  if (location.hash.startsWith('#g=')) history.replaceState(null, '', location.pathname);
}
replayBtn.onclick = () => {
  const v = window._viewing;
  if (v) viewFrame.srcdoc = inject(v.tpl, v.vals);
};
closeBtn.onclick  = closeGift;
addEventListener('keydown', e => { if (e.key === 'Escape' && !viewer.hidden) closeGift(); });

/* ───────────────────────── 6. wrap it: the link IS the gift ──────── */
/* Everything the recipient needs is encoded in the URL, so this works
   with no backend at all. Swap encode/decode for a Supabase row later
   and nothing else in this file changes. */
function encodeGift(id, vals){
  const json = JSON.stringify({ t: id, v: vals });
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function decodeGift(str){
  const b = str.replace(/-/g,'+').replace(/_/g,'/');
  return JSON.parse(decodeURIComponent(escape(atob(b))));
}

/* Everything about a gift normally rides in the URL, which makes links
   thousands of characters long — unusable on Instagram and far too big for
   a QR code. When Supabase is reachable we park the payload in a row and
   put a short slug in the link instead. If that fails for any reason we
   fall back to the long self-contained link, which always works. */
/* A QR only holds ~2–3KB, so it can represent a short link but never a
   full self-contained one. Show it when it will actually scan, hide it
   otherwise rather than render something broken. */
function paintQR(url){
  const wrap = document.getElementById('qrWrap');
  const cv = document.getElementById('qrCanvas');
  if (!wrap || !cv) return;
  if (url.length > 300){ wrap.hidden = true; return; }   // long link → no QR
  const g = window.QRCode || window.qrcode;
  if (!g){ wrap.hidden = true; return; }
  try{
    const q = g(0, 'M'); q.addData(url); q.make();
    const n = q.getModuleCount(), size = cv.width, cell = size / (n + 2);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#10131b';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
      if (q.isDark(r, c)) ctx.fillRect((c+1)*cell, (r+1)*cell, cell+.5, cell+.5);
    wrap.hidden = false;
  }catch{ wrap.hidden = true; }
}

const SLUG_ABC = 'abcdefghijkmnpqrstuvwxyz23456789';
function makeSlug(n = 7){
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return [...a].map(x => SLUG_ABC[x % SLUG_ABC.length]).join('');
}
async function shortenGift(tpl, vals, payload){
  try{
    const sb = window.HF_SB, u = window.HFAuth && window.HFAuth.user && window.HFAuth.user();
    if (!sb || !u) return null;
    const slug = makeSlug();
    const { error } = await sb.from('gifts').insert({
      user_id: u.id, template: tpl.id, title: draftLabel(tpl, vals), slug, payload
    });
    if (error) return null;                      // column missing → long link
    return slug;
  }catch{ return null; }
}

async function wrap(){
  const missing = current.fields.filter(f => f.required && !values[f.key]);
  if (missing.length){
    toast(`${missing[0].label} is needed first`);
    return;
  }
  const payload = encodeGift(current.id, values);
  const base = location.origin + location.pathname;
  let url = base + '#g=' + payload;
  const slug = await shortenGift(current, values, payload);
  if (slug) url = base + '#' + slug;
  glink.textContent = url;
  glink.dataset.url = url;
  paintQR(url);
  sentPoster.innerHTML = posterHTML();
  // shortenGift already wrote the cloud row; don't write a second one
  remember(current, values, url, { skipCloud: !!slug });
  dropDraft();
  go('sent');
}

copyBtn.onclick = async () => {
  try{ await navigator.clipboard.writeText(glink.dataset.url); toast('Link copied'); }
  catch{ toast('Press ⌘C to copy'); }
};
openSentBtn.onclick = () => openGift(current, values);
previewBtn.onclick  = () => openGift(current, values);
wrapBtn.onclick     = wrap;

/* just signed in: pick up whatever they were trying to do, and repaint the
   profile since the drafts/sent storage is now scoped to their account */
document.addEventListener('hf:signedin', () => {
  paintShelf(TEMPLATES);          // marquee → calm static grid
  const p = pendingOpen;
  pendingOpen = null;
  if (p) openEditor(p.id, p.preset, p.resumeKey);
  else if (document.getElementById('mine').classList.contains('on')) paintMine();
});
/* signed out again → back to the drifting shelf */
document.addEventListener('hf:signedout', () => paintShelf(TEMPLATES));

/* a gift link opens straight into the gift */
function showDecoded(payload){
  const { t, v } = decodeGift(payload);
  const tpl = TEMPLATES.find(x => x.id === t);
  if (tpl) openGift(tpl, v, { recipient: true });     // they were sent this
}
async function routeFromHash(){
  const hash = location.hash;
  const full = hash.match(/^#g=(.+)$/);
  if (full){
    try{ showDecoded(full[1]); }catch{ toast("That link looks broken"); }
    return;
  }
  // a short link: #abc1234 — look the gift up by its slug
  const short = hash.match(/^#([a-z0-9]{5,16})$/i);
  if (!short) return;
  try{
    const sb = window.HF_SB;
    if (!sb) return;
    const { data, error } = await sb.from('gifts')
      .select('payload').eq('slug', short[1]).maybeSingle();
    if (error || !data || !data.payload){ toast("That link looks broken"); return; }
    showDecoded(data.payload);
  }catch{ toast("That link looks broken"); }
}
addEventListener('hashchange', routeFromHash);

/* ───────────────────────── 7. gifts I've sent (this device) ──────── */
/* Keys are scoped to the signed-in account, so two people sharing a browser
   never see each other's drafts or sent gifts. Signed out (or with Supabase
   unconfigured) it falls back to the plain key. */
function makeStore(base){
  let mem = [];
  const key = () => {
    try{
      const u = window.HFAuth && window.HFAuth.user && window.HFAuth.user();
      return u ? base + '.' + String(u.id).slice(0, 8) : base;
    }catch{ return base; }
  };
  return {
    read(){ try{ return JSON.parse(localStorage.getItem(key())) || []; }catch{ return mem; } },
    write(list){ try{ localStorage.setItem(key(), JSON.stringify(list)); }catch{ mem = list; } }
  };
}
const store  = makeStore('sunflower.sent');    // link generated
const drafts = makeStore('sunflower.drafts');  // started, not sent

/* ── optional cloud sync (Supabase) ───────────────────────────────────
   Mirrors sent gifts onto the account and logs a visit, so they persist
   with the user and feed the admin dashboard. Everything here NO-OPS
   silently when signed out or when the tables aren't set up yet — the
   localStorage flow above is always the source of truth for the UI. */
function cloudSaveGift(tpl, vals, url){
  try{
    const sb = window.HF_SB, u = window.HFAuth && window.HFAuth.user && window.HFAuth.user();
    if (!sb || !u) return;
    sb.from('gifts').insert({ user_id: u.id, template: tpl.id, title: draftLabel(tpl, vals), url })
      .then(() => {}, () => {});
  }catch{}
}
function logVisit(){
  try{
    const sb = window.HF_SB;
    if (!sb || sessionStorage.getItem('hf.visited')) return;
    sessionStorage.setItem('hf.visited', '1');   // one ping per tab session
    sb.from('visits').insert({ path: location.pathname, ref: document.referrer || null, ua: navigator.userAgent })
      .then(() => {}, () => {});
  }catch{}
}

let draftKey = null;
function draftLabel(tpl, vals){
  const first = tpl.fields.find(f => f.required) || tpl.fields[0];
  return (first && vals[first.key]) || (tpl.openEditor ? 'my creation' : 'someone');
}
function saveDraft(){
  if (!current) return;
  const list = drafts.read();
  if (draftKey === null) draftKey = Date.now();
  const i = list.findIndex(d => d.key === draftKey);
  const entry = { key: draftKey, id: current.id, to: draftLabel(current, values), at: Date.now(), vals: { ...values } };
  if (i >= 0) list[i] = entry; else list.unshift(entry);
  drafts.write(list.slice(0, 40));
}
function dropDraft(){
  if (draftKey === null) return;
  drafts.write(drafts.read().filter(d => d.key !== draftKey));
  draftKey = null;
}

function remember(tpl, vals, url, opts = {}){
  const list = store.read();
  list.unshift({ id: tpl.id, to: draftLabel(tpl, vals), at: Date.now(), url, vals });
  store.write(list.slice(0, 60));
  if (!opts.skipCloud) cloudSaveGift(tpl, vals, url);  // keep it on the account
}
function paintMine(){
  const sent = store.read();
  const dr   = drafts.read();

  const ps = document.getElementById('pstat');
  if (ps){
    const synced = !!(window.HFAuth && window.HFAuth.user && window.HFAuth.user());
    ps.textContent = `${sent.length} sent · ${dr.length} draft${dr.length===1?'':'s'} · `
      + (synced ? 'saved to your account' : 'kept on this device');
  }

  const tpl    = id => TEMPLATES.find(x => x.id === id);
  const title  = id => (tpl(id) || {}).name || id;
  const thumb  = id => {
    const t = tpl(id);
    return t && t.thumbnail
      ? `<img src="${thumbURL(t)}" alt="" onerror="this.replaceWith(document.createTextNode('🎁'))">`
      : '🎁';
  };
  const code = url => { const m = (url || '').match(/#g=(.+)$/); return m ? m[1].slice(-6).toUpperCase() : ''; };

  mineList.innerHTML = sent.length ? sent.map((g, i) => `
    <div class="p-row">
      <div class="p-thumb">${thumb(g.id)}</div>
      <div class="p-info">
        <div class="t">${esc(title(g.id))} — for ${esc(g.to)}</div>
        <div class="s">gift · ${code(g.url)} · ${new Date(g.at).toLocaleDateString()}</div>
      </div>
      <div class="p-acts">
        <button data-mine-open="${i}">Open</button>
        <button data-mine-copy="${i}">Copy</button>
        <button data-mine-edit="${i}">Edit</button>
      </div>
    </div>`).join('')
    : `<div class="p-empty">Nothing sent yet.</div>`;

  draftList.innerHTML = dr.length ? dr.map((g, i) => `
    <div class="p-row">
      <div class="p-thumb">${thumb(g.id)}</div>
      <div class="p-info">
        <div class="t">${esc(title(g.id))} — for ${esc(g.to)}</div>
        <div class="s">draft · ${new Date(g.at).toLocaleDateString()}</div>
      </div>
      <div class="p-acts">
        <button data-draft-edit="${i}">Keep editing</button>
        <button data-draft-del="${i}">Delete</button>
      </div>
    </div>`).join('')
    : `<div class="p-empty">No drafts. Start one from the shelf.</div>`;
}
draftList.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const list = drafts.read();
  if (b.dataset.draftEdit !== undefined){
    const d = list[b.dataset.draftEdit];
    if (d) openEditor(d.id, d.vals, d.key);
  }
  if (b.dataset.draftDel !== undefined){
    list.splice(b.dataset.draftDel, 1);
    drafts.write(list);
    paintMine();
    toast('Draft deleted');
  }
});
mineList.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const list = store.read();
  const open = b.dataset.mineOpen, copy = b.dataset.mineCopy, edit = b.dataset.mineEdit;
  const g = list[open ?? copy ?? edit];
  if (!g) return;
  const tpl = TEMPLATES.find(t => t.id === g.id);
  if (open !== undefined) openGift(tpl, g.vals);
  if (copy !== undefined) navigator.clipboard.writeText(g.url).then(() => toast('Link copied'));
  if (edit !== undefined) openEditor(g.id, g.vals);  // becomes a new draft
});

/* ───────────────────────── 8. plumbing ──────────────────────────── */
const esc   = s => String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
const strip = s => esc(String(s ?? '').replace(/<br\s*\/?>/gi, ' '));

/* our own little scroll animation — native smooth scrolling is flaky
   (and would fight go()'s jump-to-top in the same click). Timer-driven
   rather than rAF so it also runs in embedded/throttled webviews. */
function glideTo(el){
  const from = scrollY;
  const to   = Math.max(0, el.getBoundingClientRect().top + scrollY - 70);
  const t0   = performance.now(), dur = 550;
  (function step(){
    const p = Math.min(1, (performance.now() - t0) / dur);
    const e = p < .5 ? 2*p*p : 1 - Math.pow(-2*p + 2, 2) / 2;   // ease in-out
    scrollTo(0, from + (to - from) * e);
    if (p < 1) setTimeout(step, 16);
  })();
}

/* one nav button lit at a time — template, price or profile */
function setNav(btnId){
  ['tab-gallery', 'tab-price', 'tab-mine'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.classList.toggle('on', id === btnId);
  });
}

function go(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  setNav(id === 'mine' ? 'tab-mine' : 'tab-gallery');
  document.body.classList.toggle('editing', id === 'compose');  // hides the site nav
  if (id === 'mine') paintMine();
  if (id === 'compose') scalePreview();
  scrollTo(0, 0);
}

let toastTimer;
function toast(msg){
  let el = document.querySelector('.toast');
  if (!el){ el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}

document.addEventListener('click', e => {
  const nav = e.target.closest('[data-go]');
  if (nav) go(nav.dataset.go);
  const card = e.target.closest('[data-open]');
  if (card) openEditor(card.dataset.open);
  if (e.target.closest('[data-open-blank]')) openEditor('blank');
  if (e.target.closest('#addPage')){ addPage(); return; }
  const tab = e.target.closest('[data-ptab]');
  if (tab && current) switchPage(tab.dataset.ptab);
  const pan = e.target.closest('[data-panel]');
  if (pan && current){
    currentPanel = pan.dataset.panel;
    paintSidebar();
    paintFields();
  }
  const sc = e.target.closest('[data-scrollto]');
  if (sc){
    go('gallery');
    const t = document.querySelector(sc.dataset.scrollto);
    if (t) glideTo(t);
    setNav(sc.dataset.scrollto === '#pricing' ? 'tab-price' : 'tab-gallery');
  }
  const th = e.target.closest('[data-theme]');
  if (th){
    document.body.classList.toggle('dark', th.dataset.theme === 'dark');
    lt.classList.toggle('on', th.dataset.theme === 'light');
    dk.classList.toggle('on', th.dataset.theme === 'dark');
  }
});
/* ── the butterfly wanders — and flies to a flower when you hover it ── */
(function(){
  const el = document.getElementById('fly');
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches){ if(el) el.style.display='none'; return; }
  const blooms = [...document.querySelectorAll('.bloom')];
  let x = innerWidth*.2, y = innerHeight*.55, tx = x, ty = y, flip = 1;
  let scale = 1, targetScale = 1, visiting = false;

  function wander(){
    tx = 60 + Math.random()*(innerWidth - 140);
    ty = innerHeight*.28 + Math.random()*innerHeight*.5;
  }
  (function repick(){ if (!visiting) wander(); setTimeout(repick, 3500 + Math.random()*4000); })();

  /* hover a sunflower: the butterfly comes over and gets big */
  addEventListener('mousemove', e => {
    let near = null, best = 170;
    for (const b of blooms){
      const r = b.getBoundingClientRect();
      const cx = r.left + r.width/2, cy = r.top + r.height*0.26;
      const d = Math.hypot(e.clientX - cx, e.clientY - cy);
      if (d < best){ best = d; near = r; }
    }
    if (near){
      visiting = true;  targetScale = 2.1;
      tx = near.left + near.width/2 - 15;
      ty = near.top  + near.height*0.20 - 12;
    } else if (visiting){
      visiting = false; targetScale = 1; wander();
    }
  }, { passive:true });

  let vx = 0, vy = 0;
  (function step(){
    const dx = tx - x, dy = ty - y;
    const pull = visiting ? .045 : .018;
    vx += (dx*pull - vx)*.12;           // spring-eased velocity → no sudden jerks
    vy += (dy*pull - vy)*.12;
    x += vx;
    y += vy + (visiting ? 0 : Math.sin(Date.now()/650)*.5);
    scale += (targetScale - scale)*.06;
    if (Math.abs(vx) > .25) flip = vx > 0 ? -1 : 1;
    const bank = Math.max(-16, Math.min(16, vx*2.2));   // lean into the turn
    el.style.transform = `translate(${x}px, ${y}px) rotate(${bank}deg) scale(${flip*scale}, ${scale})`;
    requestAnimationFrame(step);
  })();
})();

boot();
