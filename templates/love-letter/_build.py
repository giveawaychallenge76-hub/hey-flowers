#!/usr/bin/env python3
"""Build templates/love-letter from the (retired) birthday template.

Only the envelope survives: the ask, the candle and the four-wish carousel
are birthday things. What's left is one envelope holding one short letter.

The envelope's CSS and its open/close animation are lifted verbatim rather
than retyped — that's ~200 lines where a slip would only show up when
someone actually opened a gift. Re-runnable.
"""
import re, pathlib

ROOT = pathlib.Path('/Users/lappyhub/javii.tools')
SRC  = (ROOT/'templates/birthday/index.html').read_text()
OUT  = ROOT/'templates/love-letter'

# A {{token}} ends in }}, so any [^}]* rule-matching below would stop INSIDE
# a token and eat half a CSS block. Mask for the surgery, restore at the end.
MASK_A, MASK_B = '\x01', '\x02'
SRC = re.sub(r'\{\{(\w+)\}\}', MASK_A + r'\1' + MASK_B, SRC)
def unmask(s): return re.sub(MASK_A + r'(\w+)' + MASK_B, r'{{\1}}', s)

# ══ CSS ═════════════════════════════════════════════════════════════
css = SRC[SRC.index('<style>')+7 : SRC.index('</style>')]

# the background photo is optional here, and url('') refetches the page
assert css.count("url('" + MASK_A + "photo_url" + MASK_B + "')") == 2
css = css.replace("url('" + MASK_A + "photo_url" + MASK_B + "')", "var(--photo)")

# ══ the envelope, without the birthday ══════════════════════════════
def between(s, a, b):
    i = s.index(a); return s[i:s.index(b, i)]

letter = between(SRC, '<div id="surprise-content"', '<script>').rstrip()

# swap the whole card — heading, candle and wish carousel — for one note
old_card = between(letter, '<div class="content">', '</div>  \n        </div>')
assert 'cake-container' in old_card and 'note-scroller' in old_card
letter = letter.replace(old_card, '''<div class="content">
                <div class="love-note">{note}</div>
                <div class="love-sign">{sign}</div>
            '''.replace('{note}', MASK_A+'letter_text'+MASK_B)
               .replace('{sign}', MASK_A+'sign_off'+MASK_B))

# ══ JS: keep the hearts, the envelope and the confetti ══════════════
js = SRC[SRC.index('<script>')+8 : SRC.rindex('</script>')]
hearts   = between(js, 'const hearts = document.getElementById("hearts")', 'const romanticMusic')
envelope = between(js, 'const envelope = document.getElementById("envelope")',
                       '/* Most people never got the candle out')
confetti = between(js, 'function triggerConfettiExplosion()', 'function runMemoryNoteCarousel()')

# the envelope used to arm the candle on first open; now it just celebrates
assert 'initBlowDetection' in envelope
envelope = envelope.replace('setTimeout(initBlowDetection, 1000);', 'setTimeout(triggerConfettiExplosion, 450);')

DOC = '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>a letter for you</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💌</text></svg>">
<!--
════════════════════════════════════════════════
  one envelope, one letter. Tap it and it opens.
  Built from templates/birthday by _build.py —
  edit that template or this script, not this file.
════════════════════════════════════════════════
-->
<style>
__CSS__

/* ══ the letter itself ════════════════════════════════════════════ */
.love-note{
  font-family: var(--font), Georgia, serif;
  /* sized so ~25-30 words clear the envelope front without pulling the
     letter so far up that its top leaves the screen on a short phone */
  font-size: clamp(14px, 3.6vw, 17px);
  line-height: 1.58;
  color: var(--accent);
  text-align: center;
  padding: 4px 6px;
  white-space: pre-wrap;      /* keep the sender's own line breaks */
}
.love-sign{
  margin-top: 10px;
  font-family: var(--font), Georgia, serif;
  font-style: italic;
  font-size: clamp(13px, 3.4vw, 16px);
  color: color-mix(in srgb, var(--accent) 72%, white);
  text-align: right;
  padding-right: 6px;
}
/* the card is shorter without a candle and a carousel in it */
.content{ display:flex; flex-direction:column; justify-content:center; }

/* The birthday card only ever had to clear the envelope front with a
   heading and one line — the rest scrolled inside a carousel. A whole
   letter has to be readable in one go, so it comes further out. Measured
   against .front-pocket: the old -215px left 213px of clear space for
   ~275px of letter, and the last two lines sat behind the envelope. */
.envelope.pulled .letter{ transform:translateY(-296px); height:340px; }

/* The old template showed this by hand when you pressed Yes on the front
   page. There is no front page now, so it has to start visible — and this
   has to sit after the imported rules to win on order. */
#surprise-content{ display:flex; opacity:1; }

/* The tint is painted as a translucent gradient, and the source template
   always had a background photo underneath it. This one ships without a
   photo, so without an opaque base the page renders against whatever sits
   behind the frame. */
body{ background-color:#fff9f2; }
</style>
</head>
<body>

<div id="hearts"></div>

__LETTER__

<script>
/* an optional background photo — `none` is a valid background-image layer,
   an empty url() is not (it re-requests this very page) */
var PHOTO = "{{photo_url}}";
document.documentElement.style.setProperty('--photo',
  PHOTO ? 'url("' + PHOTO.replace(/"/g,'%22') + '")' : 'none');

/* ── the drifting hearts ── */
__HEARTS__

/* ── confetti when the letter comes out ── */
function triggerConfettiExplosion() {
__CONFETTI_BODY__
}

/* ── the envelope ── */
__ENVELOPE__

/* the editor has one page, so there is nothing to route — but it still
   posts here when you switch to it, and an unhandled message is fine. */
</script>
</body>
</html>
'''

doc = (DOC.replace('__CSS__', css.strip())
          .replace('__LETTER__', letter)
          .replace('__HEARTS__', hearts.strip())
          .replace('__CONFETTI_BODY__', confetti[confetti.index('{')+1 : confetti.rindex('}')].strip())
          .replace('__ENVELOPE__', envelope.strip()))
doc = unmask(doc)

OUT.mkdir(exist_ok=True)
(OUT/'index.html').write_text(doc)
print('wrote', OUT/'index.html', len(doc), 'bytes')
print('tokens:', sorted(set(re.findall(r'\{\{(\w+)\}\}', doc))))
