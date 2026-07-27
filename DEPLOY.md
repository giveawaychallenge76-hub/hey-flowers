# Deploy notes

Live at **https://hey-flowers.vercel.app** — Vercel builds automatically on
every push to `main`. It's a static site: no build command, no framework.

## Gotchas that have already bitten us

### `vercel.json` allows NO extra keys
Its schema sets `additionalProperties: false`, so a stray key fails the build
with *"should NOT have additional property"* — and because it fails at
validation, nothing deploys at all. JSON has no comment syntax, so **never add
`_comment` or similar**; explanations go in this file instead.

Check before pushing:

```bash
python3 -c "import json;json.load(open('vercel.json'));print('ok')"
```

### `cleanUrls` must stay `false`
With it on, Vercel served `/templates/<id>/index.html` as `/templates/<id>`
(no trailing slash). The templates use relative asset paths, so those resolved
one directory too high — `/templates/birthday-assets/…` instead of
`/templates/birthday-cartoon/birthday-assets/…` — and every image 404'd when a
template URL was opened directly.

### `.vercelignore` patterns match at every depth
Same semantics as `.gitignore`. A bare `birthday-assets/` also matched
`templates/birthday-cartoon/birthday-assets/` and stripped all 27 party
characters from the deploy while they sat fine in git. **Anchor every pattern
with a leading slash** (`/birthday-assets/`).

### Don't poll the deployed site in a loop
Hitting the site every few seconds trips Vercel's bot mitigation — it starts
returning `403` with `x-vercel-mitigated: challenge`, which looks exactly like
an outage but isn't. Check a deploy in a real browser, or poll GitHub's API to
confirm a push landed:

```bash
curl -s "https://api.github.com/repos/giveawaychallenge76-hub/hey-flowers/commits?per_page=1" | grep -m1 '"sha"'
```

## When a deploy doesn't appear

Vercel dashboard → **hey-flowers** → **Deployments** → click the top row. A red
**Error** badge shows the build log and the actual reason. To retry: **Redeploy**
with "Use existing Build Cache" unticked.

## Supabase

Project `qzobweooybjemvsjmmet`. After changing the deployed URL, update
**Authentication → URL Configuration**: both *Site URL* and the *Redirect URLs*
allow-list, or sign-in bounces to the wrong place.
