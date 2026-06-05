---
doc_type: runbook
status: active
created: 2026-06-03
updated: 2026-06-05
---

# MUC Wiki Visual Modernization Runbook

This runbook records the `nc-arm-6c` MediaWiki staging visual modernization
path. The only runtime target for this work is:

- `https://wiki.mucwiki-edge.link`

`https://muc.wiki` is the public production hostname and is outside this
staging-only visual rehearsal. Do not change production DNS, Cloudflare routing,
origin routing, default skin, or production cutover state as part of this
runbook.

## Runtime Truth

- Host: `nc-arm-6c`
- Public production MediaWiki root: `/srv/apps/wiki`
- Staging MediaWiki root: `/srv/apps/wiki-staging`
- Staging compose file: `/srv/apps/wiki-staging/compose.yml`
- Staging image Dockerfile: `/srv/apps/wiki-staging/docker/mediawiki/Dockerfile`
- Staging runtime config: `/srv/apps/wiki-staging/config/LocalSettings.php`
- Staging host: `wiki.mucwiki-edge.link`
- Active staging skin: `MUCWiki`

The public production hostname `muc.wiki` remains on the original
`/srv/apps/wiki` service and is not part of this rehearsal. The staging hostname
`wiki.mucwiki-edge.link` must be routed to the independent
`muc-wiki-staging` compose project before visual smoke is accepted. Do not use a
shared production/staging MediaWiki container as visual acceptance evidence.

The staging host is host-gated to use the custom skin inside the staging
service:

```php
if ( ( $_SERVER['HTTP_HOST'] ?? '' ) === 'wiki.mucwiki-edge.link' ) {
    $wgDefaultSkin = 'mucwiki';
    $wgDefaultMobileSkin = 'mucwiki';
}
```

## Selected Direction

The target is a modern, component-like MediaWiki experience while preserving
MediaWiki editing, revision history, categories, special pages, upload,
permissions, search, and login flows.

The selected implementation is a first-party `MUCWiki` SkinMustache skin:

- Skin shell: `docs/runbooks/muc-wiki-visual-modernization-assets/MUCWikiSkin`
- Shell styling: MediaWiki ResourceLoader modules under `MUCWikiSkin/resources`
- Editable homepage component styling:
  `Template:MUCWikiHome/styles.css`, snapshotted as
  `docs/runbooks/muc-wiki-visual-modernization-assets/Template-MUCWikiHome.styles.css`
- Homepage source:
  `docs/runbooks/muc-wiki-visual-modernization-assets/Template-MUCWikiHome.wiki`

Citizen is useful as a reader-shell comparison, but it is not the staging
target. Chameleon and Tweeki were earlier comparison paths and are not part of
the current staging artifact set.

## Content Boundary

Do not rewrite article copy for visual modernization. Skin CSS must not turn
ordinary article paragraphs into editorial callouts automatically.

Rejected public homepage copy must not be reintroduced:

- `中央民族大学非官方知识整理`
- `查找条目`
- `在页面顶部搜索框输入关键词`

The homepage should preserve the public wiki copy and sections already accepted
for staging:

- `欢迎来到 MUC Wiki！`
- `常用办事与资料`
- `学生事务`
- `建设中的条目`
- `特色条目`
- `参与编辑`

## Asset Sync

Sync the skin from the repo to the staging-only service on `nc-arm-6c`:

```bash
scp -r docs/runbooks/muc-wiki-visual-modernization-assets/MUCWikiSkin \
  nc-arm-6c:/tmp/MUCWikiSkin

ssh nc-arm-6c 'cd /srv/apps/wiki-staging &&
  rm -rf docker/mediawiki/MUCWiki &&
  cp -a /tmp/MUCWikiSkin docker/mediawiki/MUCWiki'
```

The MediaWiki image Dockerfile must copy the skin:

```dockerfile
COPY MUCWiki /var/www/html/skins/MUCWiki
RUN chmod -R a+rX /var/www/html/skins/MUCWiki
```

Build and restart staging:

```bash
ssh nc-arm-6c 'cd /srv/apps/wiki-staging &&
  docker compose -f compose.yml build mediawiki jobrunner &&
  docker compose -f compose.yml up -d mediawiki jobrunner &&
  docker compose -f compose.yml exec -T mediawiki \
    php maintenance/run.php update --quick --skip-external-dependencies'
```

Compile-check the ResourceLoader module:

```bash
ssh nc-arm-6c 'cd /srv/apps/wiki-staging &&
  docker compose -f compose.yml exec -T mediawiki sh -lc \
    "url=\"http://127.0.0.1/load.php\" &&
     url=\"$url?lang=zh-cn\" &&
     url=\"$url&modules=skins.mucwiki.styles\" &&
     url=\"$url&only=styles&skin=mucwiki&debug=true\" &&
     curl -fsS \"$url\" \
       >/tmp/mucwiki.css &&
     ! grep -q \"Fatal exception\" /tmp/mucwiki.css &&
     wc -c /tmp/mucwiki.css"'
```

## Staging Smoke

Run all checks against `wiki.mucwiki-edge.link` only:

```bash
urls=(
  "https://wiki.mucwiki-edge.link/wiki/%E9%A6%96%E9%A1%B5"
  "https://wiki.mucwiki-edge.link/wiki/%E5%AD%A6%E7%94%9F%E5%AE%BF%E8%88%8D"
  "https://wiki.mucwiki-edge.link/wiki/Special:%E7%94%A8%E6%88%B7%E7%99%BB%E5%BD%95"
  "https://wiki.mucwiki-edge.link/wiki/Special:%E6%90%9C%E7%B4%A2?search=%E5%AD%A6%E7%94%9F"
  "https://wiki.mucwiki-edge.link/wiki/Special:%E6%9C%80%E8%BF%91%E6%9B%B4%E6%94%B9"
  "https://wiki.mucwiki-edge.link/index.php?title=%E5%AD%A6%E7%94%9F%E5%AE%BF%E8%88%8D&action=edit"
)

for url in "${urls[@]}"; do
  sep="?"
  case "$url" in *\?*) sep="&";; esac
  tmp="$(mktemp)"
  curl -fsS "${url}${sep}cb=$(date +%s)" > "$tmp"
  grep -q "skin-mucwiki" "$tmp"
  grep -q "skins.mucwiki" "$tmp"
  ! grep -q "中央民族大学非官方知识整理\\|在页面顶部搜索框输入关键词\\|查找条目" "$tmp"
  rm -f "$tmp"
done
```

Browser smoke must inspect desktop and mobile rendering for:

- homepage
- logged-in top bar and personal tools
- ordinary article page
- article history and diff pages
- file page and file history table
- login page with `MUC Wiki Hub` visible
- search page
- recent changes page
- watchlist and user contributions pages
- preferences page while logged in
- upload page while logged in
- create account and password reset pages
- source edit page

Acceptance requires both DOM evidence and screenshots. Passing CSS compilation
alone is not visual acceptance.

Mobile smoke must explicitly verify:

- no document-level horizontal overflow
- homepage keeps `建设中的条目`
- rejected homepage copy remains absent
- logged-in personal tools keep account, preferences, and logout visible
- logged-in mobile top bar renders the account link as a compact account badge
  while keeping preferences and logout visible
- mobile page actions stay in a single horizontal action rail; they may scroll
  horizontally inside the rail, but must not wrap into multiple toolbar rows or
  widen the document
- source edit works in both observed forms:
  - WikiEditor enhanced source editor, when `.wikiEditor-ui` is present
  - plain source textarea, when only `#wpTextbox1` and `.editOptions` are present
- preferences tabs may scroll inside the tab strip, but must not widen the page
- upload form inputs and description fields stay inside the form width
- file history and diff tables may scroll inside their own table region, but
  must not widen the document

## Latest Staging Evidence

The latest staging-only closeout was run against `wiki.mucwiki-edge.link`.
Screenshots were saved under:

```text
.tmp/mucwiki-staging-visual/
```

Key final screenshots:

- `article-mobile-final.png`
- `edit-mobile-final.png`
- `home-mobile-final.png`
- `search-mobile-final.png`
- `preferences-mobile-final.png`
- `upload-mobile-final2.png`
- `recentchanges-mobile-final.png`
- `article-desktop-final.png`
- `history-mobile-final3.png`
- `filepage-real-mobile-final.png`
- `filepage-real-mobile-final2.png`

The final browser smoke checked:

- target host remained `wiki.mucwiki-edge.link`
- body used `skin-mucwiki`
- document-level horizontal overflow was `0`
- rejected homepage copy was absent
- mobile article and edit page action rails computed to `flex-wrap: nowrap`
- source edit exposed `#wpTextbox1` with a skinned input surface
- logged-in account link rendered as the compact `账号` badge
- page history revision rows rendered as card-like grid rows
- real file page `文件:Muc.png` rendered the image preview and mobile file
  history as card-like grid rows

The 2026-06-05 closeout compiled `skins.mucwiki.styles` to `123062`
bytes inside the staging MediaWiki container with no ResourceLoader fatal
exception. The staging compose status after deploy was:

- `muc-wiki-staging-db-1`: running, healthy
- `muc-wiki-staging-mediawiki-1`: running
- `muc-wiki-staging-jobrunner-1`: running

The closeout browser matrix covered desktop `1366x900` and mobile `390x844`
viewports across 13 staging routes, for 26 route/viewport checks total. Every
check used `wiki.mucwiki-edge.link`, `skin-mucwiki`, zero document-level
horizontal overflow, and no rejected homepage copy.

The final browser matrix covered these staging routes:

- homepage
- ordinary article page
- source edit page
- article history page
- real file page
- search page
- preferences page
- upload page
- recent changes page
- create account page
- reset password page
- user contributions page
- special pages index

Additional closeout evidence:

- source edit `#wpTextbox1` computed to `1px` border and `6px` radius on
  desktop and mobile
- article history rows computed to CSS grid rows on desktop and mobile
- mobile action rails computed to `flex-wrap: nowrap`
- login page exposed the `MUC Wiki Hub` OIDC entry
- Playwright viewport screenshots were captured for:
  - `mucwiki-home-mobile-audit.png`
  - `mucwiki-edit-mobile-audit.png`
  - `mucwiki-article-desktop-audit.png`
