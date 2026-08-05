#!/usr/bin/env python3
"""Assemble templates/birthday-bash from the two templates it merges.

The CSS and the envelope/candle/wishes JS are lifted verbatim from the
sources rather than retyped — ~400 lines of CSS and ~200 of JS where a
transcription slip would stay invisible until someone opened a real gift.
Only the glue (stage router, single music owner, nav) is written by hand.

Re-runnable: always rebuilds the file from the two sources.
"""
import re, pathlib

ROOT = pathlib.Path('/Users/lappyhub/javii.tools')
BD   = (ROOT/'templates/birthday/index.html').read_text()
BC   = (ROOT/'templates/birthday-cartoon/index.html').read_text()
OUT  = ROOT/'templates/birthday-bash'

# A {{token}} ends in }}, so any [^}]* rule-matching below would stop INSIDE
# the token and eat half a CSS block. Mask tokens for the whole of the
# surgery and put them back at the end.
MASK_A, MASK_B = '\x01', '\x02'
def mask(s):   return re.sub(r'\{\{(\w+)\}\}', MASK_A + r'\1' + MASK_B, s)
def unmask(s): return re.sub(MASK_A + r'(\w+)' + MASK_B, r'{{\1}}', s)
BD, BC = mask(BD), mask(BC)

def cut(src, start, end, what):
    """Drop src[start:end); assert both anchors exist so a source edit
    upstream fails here loudly instead of silently shipping."""
    i = src.index(start); j = src.index(end, i)
    return src[:i] + src[j:]

# ══ 1. birthday's CSS ════════════════════════════════════════════════
bd_css = BD[BD.index('<style>')+7 : BD.index('</style>')]
bd_css = re.sub(r'\*\{[^}]*\}\s*', '', bd_css, count=1)    # host owns the reset
bd_css = re.sub(r':root\{[^}]*\}\s*', '', bd_css, count=1) # vars merged below

# body{} centred the envelope and painted the photo — both stages from this
# template still need the painting, so it becomes a class they share.
# The LAYOUT properties must not come along: `.stage{display:none}` and
# `.bshell{display:flex}` have equal specificity, and .bshell lands later in
# the sheet, so it would win and pin the ask and the letter permanently open
# — every room stacked on every other. The `.on` rules own display.
m = re.search(r'\nbody\{(.*?)\n\}\n', bd_css, re.S)
assert m, 'birthday body{} block not found'
body_rules = m.group(1)
for layout in ('height:100vh;', 'display:flex;', 'justify-content:center;', 'align-items:center;'):
    assert layout in body_rules, 'expected %r in birthday body{}' % layout
    body_rules = body_rules.replace(layout, '')
bd_css = (bd_css[:m.start()] +
          '\n.bshell{\nposition:fixed; inset:0;\n' + body_rules + '\n}\n' +
          bd_css[m.end():])

# #hint / .hint is the ONE id collision between the two documents
bd_css = bd_css.replace('#hint', '#l-hint').replace('.hint', '.l-hint')

# The hint fades out via `transition:opacity`, and in this document that
# transition gets created but never advances (playState running, currentTime
# stuck at 0), so it pins opacity at the start value and "tap to pull out the
# letter" stays on screen over the opened letter. visibility isn't in the
# transition list, so it applies immediately and the hint goes regardless.
assert '.l-hint.hidden{ opacity:0; }' in bd_css
bd_css = bd_css.replace('.l-hint.hidden{ opacity:0; }',
                        '.l-hint.hidden{ opacity:0; visibility:hidden; }')

# The background photo is optional here — this template ships no default, so
# url('') would resolve to the page itself and fire a pointless request. The
# glue sets --photo to a real url() or to none.
assert bd_css.count("url('" + MASK_A + "photo_url" + MASK_B + "')") == 2
bd_css = bd_css.replace("url('" + MASK_A + "photo_url" + MASK_B + "')", "var(--photo)")

# ══ 2. birthday's markup for the two stages it contributes ═══════════
def between(src, a, b):
    i = src.index(a); return src[i:src.index(b, i)]

front  = between(BD, '<div id="front-page">', '<div id="surprise-content"').rstrip()
letter = between(BD, '<div id="surprise-content"', '<script>').rstrip()
letter = letter.replace('id="hint"', 'id="l-hint"').replace('class="hint"', 'class="l-hint"')

# ══ 3. birthday's JS — keep the hearts, the runaway No, the envelope,
#       the candle and the wishes carousel. Drop its music (the wall owns
#       music now) and its two-page routing (the stage router owns that).
bd_js = BD[BD.index('<script>')+8 : BD.rindex('</script>')]
bd_js = cut(bd_js, 'const romanticMusic', 'const noBtn', 'music')
bd_js = cut(bd_js, "/* The editor's Front page", 'const envelope = document', 'routing')
# the markup and CSS renamed #hint -> #l-hint; the lookup has to follow, or it
# grabs the WALL's hint and leaves "tap to pull out the letter" on screen
assert 'getElementById("hint")' in bd_js
bd_js = bd_js.replace('getElementById("hint")', 'getElementById("l-hint")')

# ══ 4. birthday-cartoon's CSS and wall engine ════════════════════════
bc_css = BC[BC.index('<style>')+7 : BC.index('</style>')]
bc_css = re.sub(r':root\{[^}]*\}\s*', '', bc_css, count=1)
bc_css = re.sub(r'\*\{[^}]*\}\s*', '', bc_css, count=1)
bc_css = re.sub(r'html,body\{[^}]*\}\s*', '', bc_css, count=1)
bc_css = re.sub(r'\nbody\{[^}]*\}\s*', '\n', bc_css, count=1)   # host owns body
bc_css = bc_css.replace('body.live', '#st-wall.live')

wall_js = BC[BC.rindex('<script>')+8 : BC.rindex('</script>')]
# the dance class belongs to the wall stage now, not the whole document
wall_js = wall_js.replace('document.body.classList', 'WALL.classList')
assert 'WALL.classList' in wall_js
wall_js = wall_js.replace('function goLive(){', 'var WALL=document.getElementById("st-wall");\nfunction goLive(){')
# let the ask stage start the sender's song before the party begins
wall_js = wall_js.replace('window.__partyAudio = function(on){',
                          'window.__bashSong = function(){ return customStart(); };\n'
                          'window.__partyAudio = function(on){')
assert '__bashSong' in wall_js

# ══ 5. the glue ══════════════════════════════════════════════════════
GLUE = r'''
/* ── four stages, one at a time ──────────────────────────────────────
   ask → the friends wall → the letter → the cake scroll.
   The cake keeps living in its own frame: it has its own music and its
   own scroll, and letting its script share this document is exactly the
   clash the iframe was introduced to avoid. */
(function(){
"use strict";
var frame  = document.getElementById('cake-frame');
var hearts = document.getElementById('hearts');
var nav    = document.getElementById('nav');
var navBtn = document.getElementById('navNext');
var ORDER  = ['ask','wall','letter','cake'];

var HF = {
  frm:"{{from}}", age:"{{age}}", who:"{{name}}", tint:"{{bg_tint}}",
  photos:[{src:"{{cphoto1}}",cap:"{{ccap1}}"},{src:"{{cphoto2}}",cap:"{{ccap2}}"},{src:"{{cphoto3}}",cap:"{{ccap3}}"},{src:"{{cphoto4}}",cap:"{{ccap4}}"},{src:"{{cphoto5}}",cap:"{{ccap5}}"},{src:"{{cphoto6}}",cap:"{{ccap6}}"},{src:"{{cphoto7}}",cap:"{{ccap7}}"},{src:"{{cphoto8}}",cap:"{{ccap8}}"},{src:"{{cphoto9}}",cap:"{{ccap9}}"},{src:"{{cphoto10}}",cap:"{{ccap10}}"}],
  letters:[{msg:"{{cl1m}}",frm:"{{cl1f}}"},{msg:"{{cl2m}}",frm:"{{cl2f}}"},{msg:"{{cl3m}}",frm:"{{cl3f}}"},{msg:"{{cl4m}}",frm:"{{cl4f}}"},{msg:"{{cl5m}}",frm:"{{cl5f}}"},{msg:"{{cl6m}}",frm:"{{cl6f}}"},{msg:"{{cl7m}}",frm:"{{cl7f}}"},{msg:"{{cl8m}}",frm:"{{cl8f}}"},{msg:"{{cl9m}}",frm:"{{cl9f}}"},{msg:"{{cl10m}}",frm:"{{cl10f}}"},{msg:"{{cl11m}}",frm:"{{cl11f}}"},{msg:"{{cl12m}}",frm:"{{cl12f}}"}]
};
/* optional background photo — none is a valid background-image layer,
   an empty url() is not (it re-requests this very page) */
var PHOTO = "{{photo_url}}";
document.documentElement.style.setProperty('--photo',
  PHOTO ? 'url("' + PHOTO.replace(/"/g,'%22') + '")' : 'none');

function tell(m){ try{ frame.contentWindow.postMessage(m,"*"); }catch(_){} }
function sendVals(){ tell({__hfvals:1, frm:HF.frm, age:HF.age, who:HF.who, tint:HF.tint,
                           photos:HF.photos, letters:HF.letters}); }

var stage = 'ask';
function go(which){
  if(ORDER.indexOf(which) < 0) return;
  stage = which;
  ['ask','wall','letter'].forEach(function(s){
    var n = document.getElementById('st-'+s);
    if(n) n.classList.toggle('on', s === which);
  });
  /* The hearts belong to the two pages that came from the letter template.
     They have to live INSIDE the active stage, not beside it: the letter is
     a flex item, so its z-index only ranks it against its siblings, and a
     body-level hearts layer would paint straight over the envelope. */
  var host = document.getElementById('st-' + which);
  if(hearts){
    var wanted = (which === 'ask' || which === 'letter' || which === 'wall');
    hearts.style.display = wanted ? 'block' : 'none';
    if(wanted && host && hearts.parentElement !== host) host.insertBefore(hearts, host.firstChild);
  }

  var onCake = (which === 'cake');
  frame.style.display = onCake ? 'block' : 'none';
  // the letter needs its full height, so the nav belongs to the wall alone
  if(nav) nav.style.display = (which === 'wall') ? 'flex' : 'none';

  /* only the page you're looking at is allowed to make noise */
  if(onCake){ sendVals(); tell({__audio:'on'}); if(window.__partyAudio) window.__partyAudio(false); }
  else { tell({__audio:'off'}); if(window.__partyAudio) window.__partyAudio(true); }
}
window.__bashGo = go;

if(navBtn) navBtn.addEventListener('click', function(){ go('letter'); });

/* the cake opens once the candle is out — watch for the class the blow-out
   adds, rather than reaching into the letter's own script */
var cakeBtn = document.getElementById('toCake');
if(cakeBtn) cakeBtn.addEventListener('click', function(){ go('cake'); });
var candle = document.getElementById('cake-container');
if(candle && cakeBtn && window.MutationObserver){
  var mo = new MutationObserver(function(){
    if(candle.classList.contains('blown-out')){ cakeBtn.classList.add('in'); mo.disconnect(); }
  });
  mo.observe(candle, { attributes:true, attributeFilter:['class'] });
}

/* the ask: Yes opens the party */
var yesBtn = document.getElementById('yes-btn');
if(yesBtn) yesBtn.addEventListener('click', function(){
  yesBtn.innerHTML = "Yay! 🥰";
  setTimeout(function(){ go('wall'); }, 550);
});

/* Their song starts on the first touch anywhere, so it's already playing
   by the time the wall gathers. With no song uploaded this does nothing
   and the wall's own tune takes over when the party goes live. */
function firstTouch(){
  if(window.__bashSong) window.__bashSong();
  window.removeEventListener('click', firstTouch);
  window.removeEventListener('touchstart', firstTouch);
}
window.addEventListener('click', firstTouch);
window.addEventListener('touchstart', firstTouch);

window.addEventListener('message', function(e){
  var d = e.data || {};
  if(d.__cakeReady) sendVals();          // cake loaded → hand it the names
  if(d.__cakeBack)  go('letter');
  if(d.__gotoPage){                      // the editor's page tabs
    go(d.__gotoPage === 'surprise' ? 'cake'
     : d.__gotoPage === 'friends'  ? 'wall'
     : d.__gotoPage);
  }
});

go('ask');
})();
'''

# ══ 6. assemble ══════════════════════════════════════════════════════
DOC = '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Happy Birthday {{name}}! 🎂</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎂</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Caveat:wght@700&display=swap" rel="stylesheet">
<!--
════════════════════════════════════════════════
  one birthday, four rooms:
   1. is it your birthday?  (the ask)
   2. the friends wall      (tap anyone → everyone dances)
   3. the letter            (envelope → candle → their wishes)
   4. the cake scroll       (in its own frame — see cake.html)
════════════════════════════════════════════════
-->
<style>
:root{
  --navy:   {{accent_color}};
  --hf-font:{{font_family}};
  --tint:   {{bg_tint}};
  --env:    {{envelope_color}};
  --accent: {{accent_color}};
  --font:   {{font_family}};
  --accent-bright: color-mix(in srgb, var(--accent) 72%, white);
  --env-dark: color-mix(in srgb, var(--env) 82%, #5c4a12);
  --env-mid:  color-mix(in srgb, var(--env) 91%, #5c4a12);
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font-family:var(--hf-font),'Baloo 2',cursive;background:#fff;overflow:hidden;
  color:var(--navy);-webkit-tap-highlight-color:transparent}

/* ── the four rooms ── */
.stage{display:none}
/* the wall used to be a white page between two pink ones, which read as a
   different site mid-gift. Same wash as the ask and the letter now. */
#st-wall{position:fixed; inset:0; overflow:hidden;
  background: linear-gradient(color-mix(in srgb, var(--tint) 35%, transparent),
              color-mix(in srgb, var(--tint) 50%, transparent)),
              var(--photo) no-repeat center center;
  background-size: cover}
#st-wall.on{display:block}
#st-ask.on,#st-letter.on{display:flex;justify-content:center;align-items:center}
#st-letter{flex-direction:column}
/* the letter used to be shown by hand by the old two-page router, so it
   still carries display:none/opacity:0 — the stage owns that now */
#st-letter #surprise-content{display:flex;opacity:1}

/* the wall's own hearts sit behind its characters */
#st-wall #hearts{z-index:0}

/* On to the cake — but only once the candle is out, so nobody skips the
   wishes. The letter needs the full height, which is why the wall's nav
   doesn't follow it here. */
#toCake{position:fixed;right:16px;bottom:16px;z-index:70;font-family:Arial,Helvetica,sans-serif;
  font-weight:700;font-size:15px;color:#1a1a1a;background:#f5c518;border:0;border-radius:999px;
  padding:11px 22px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.22);
  opacity:0;pointer-events:none;transform:translateY(8px);transition:opacity .5s,transform .5s}
#toCake.in{opacity:1;pointer-events:auto;transform:translateY(0)}

/* ══ from the party wall ══════════════════════════════════ */
__BC_CSS__

/* ══ from the letter ══════════════════════════════════════ */
__BD_CSS__

/* ══ overrides ════════════════════════════════════════════
   These have to sit AFTER both imported sheets. Equal specificity is
   decided by order, so anything competing with a rule that came in from
   a source template belongs here, not up top. */

/* With the brand and the birthday line gone, a full-width white bar with a
   border read as a site header sitting on someone's gift. The button floats
   on its own instead. */
#nav{background:none;border:0;box-shadow:none;height:auto;padding:14px 16px 0;
  justify-content:flex-end;pointer-events:none}
#nav .nextbtn{pointer-events:auto}
</style>
</head>
<body>

<!-- the hearts drift behind the ask and the letter -->
<div id="hearts"></div>

<!-- just the way onward: no brand, no birthday line. This is the sender's
     gift, not a masthead. -->
<div id="nav" style="display:none">
  <span class="spacer"></span>
  <button class="nextbtn" id="navNext" type="button">the letter →</button>
</div>

<!-- ═ 1 ─ the ask ═ -->
<div class="stage bshell" id="st-ask">
__FRONT__
</div>

<!-- ═ 2 ─ the friends wall ═ -->
<div class="stage" id="st-wall">
  <div id="wall"></div>
  <div id="hint">gathering your friends…</div>
  <div id="cue">tap anyone to start the music ♫</div>
  <div id="credit"></div>
  <button id="replay">↺ again</button>
</div>

<!-- ═ 3 ─ the letter ═ -->
<div class="stage bshell" id="st-letter">
__LETTER__
  <button id="toCake" type="button">the cake →</button>
</div>

<!-- ═ 4 ─ the cake scroll, in its own frame so scripts never clash ═
     ?v=2 is a cache key, not a version: cake.html used to be served with
     X-Frame-Options, which stops it rendering inside the sandboxed gift
     frame (an opaque origin is same-origin with nothing). Dropping the
     header server-side isn't enough — a 304 revalidation can't REMOVE a
     stored header, so browsers that saw the old response keep refusing it
     forever. A different URL is a different cache entry. -->
<iframe id="cake-frame" src="cake.html?v=2" title="the cake"
  style="position:fixed;inset:0;width:100%;height:100%;border:0;z-index:120;background:#fff;display:none"></iframe>

<div id="hf-stage" style="position:fixed;inset:0;pointer-events:none;z-index:60"></div>

<script>
__GLUE__
</script>

<script>
/* ── the envelope, the candle and their wishes ── */
__BD_JS__
</script>

<script>
/* ── the friends wall ── */
__WALL_JS__
</script>
</body>
</html>
'''

doc = (DOC.replace('__BC_CSS__', bc_css.strip())
          .replace('__BD_CSS__', bd_css.strip())
          .replace('__FRONT__', front)
          .replace('__LETTER__', letter)
          .replace('__GLUE__', GLUE.strip())
          .replace('__BD_JS__', bd_js.strip())
          .replace('__WALL_JS__', wall_js.strip()))
doc = unmask(doc)

OUT.mkdir(exist_ok=True)
(OUT/'index.html').write_text(doc)

# ── the cake scroll: same source, restyled to match the other rooms ──
import shutil
cake = (ROOT/'templates/birthday-cartoon/cake.html').read_text()

# only the Back button up top — the brand and the birthday line belong to
# the party template this was borrowed from, not to this gift
assert '<span class="brand">wiki day.</span>' in cake
cake = cake.replace('  <span class="brand">wiki day.</span>\n'
                    '  <span class="friends-line">happy birthday saj</span>\n', '')

# the white page made this room look like a different site from the three
# before it. --tint arrives with the values; hearts drift behind the scroll.
assert "background:#fff;color:var(--ink)" in cake
cake = cake.replace("background:#fff;color:var(--ink)",
                    "background:var(--room);color:var(--ink)")
cake = cake.replace(':root{ --navy:#16307a; --ink:#2a2a2a; }',
  ':root{ --navy:#16307a; --ink:#2a2a2a; --tint:#f4a5b5;\n'
  '  --room:linear-gradient(color-mix(in srgb, var(--tint) 35%, transparent),\n'
  '         color-mix(in srgb, var(--tint) 50%, transparent)) fixed, #fff; }\n'
  '#hearts{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden}\n'
  '.heart{position:absolute;bottom:-100px;opacity:0;animation:floatUp linear infinite}\n'
  '.heart::before,.heart::after{content:"";position:absolute;width:50%;height:80%;\n'
  '  background:currentColor;border-radius:50% 50% 0 0}\n'
  '.heart::before{left:50%;transform-origin:left bottom;transform:rotate(-45deg)}\n'
  '.heart::after{left:0;transform-origin:right bottom;transform:rotate(45deg)}\n'
  '@keyframes floatUp{0%{transform:translateY(0);opacity:0}10%{opacity:.55}\n'
  '  100%{transform:translateY(-120vh) translateX(40px) rotate(20deg);opacity:0}}\n'
  '#page,#nav{position:relative;z-index:1}')
cake = cake.replace('<div id="page">', '<div id="hearts"></div>\n<div id="page">')

# build the hearts, and take the sender's tint when the values arrive
assert 'var cb=document.getElementById("cakeBack");' in cake
cake = cake.replace('var cb=document.getElementById("cakeBack");', '''
(function(){
  var box=document.getElementById("hearts"); if(!box) return;
  for(var i=0;i<44;i++){
    var h=document.createElement("span"); h.className="heart";
    var s=10+Math.random()*46;
    h.style.width=s+"px"; h.style.height=s+"px";
    h.style.left=Math.random()*100+"vw";
    h.style.color="color-mix(in srgb, var(--tint) "+(55+Math.random()*45)+"%, white)";
    h.style.animationDuration=(6+Math.random()*10)+"s";
    h.style.animationDelay=(-Math.random()*12)+"s";
    box.appendChild(h);
  }
})();
window.addEventListener("message",function(e){
  var d=e.data||{}; if(!d.__hfvals||!d.tint) return;
  document.documentElement.style.setProperty("--tint", d.tint);
});
var cb=document.getElementById("cakeBack");''')

(OUT/'cake.html').write_text(cake)
assets = OUT/'birthday-assets'
if assets.exists(): shutil.rmtree(assets)
shutil.copytree(ROOT/'templates/birthday-cartoon/birthday-assets', assets)

print('wrote', OUT/'index.html', len(doc), 'bytes')
print('assets:', len(list(assets.rglob('*'))), 'files')
stray = sorted(set(re.findall(r'\{\{(\w+)\}\}', doc)))
print('tokens used:', stray)
