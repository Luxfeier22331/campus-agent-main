# MUC Wiki Visual Modernization Artifacts

This directory snapshots the current `wiki.mucwiki-edge.link` MediaWiki visual
modernization staging assets.

These files are reviewable recovery and deployment artifacts for the MediaWiki
staging skin and homepage template currently exercised on `nc-arm-6c`.

## Files

- `MUCWikiSkin/`: first-party SkinMustache skin copied into
  `/srv/apps/wiki-staging/docker/mediawiki/MUCWiki` and then into the staging
  MediaWiki image as `/var/www/html/skins/MUCWiki`.
- `Template-MUCWikiHome.styles.css`: current
  `Template:MUCWikiHome/styles.css` TemplateStyles page.
- `Template-MUCWikiHome.wiki`: current `Template:MUCWikiHome` wikitext.
- `LocalSettings.mucwiki-host-gate.php.inc`: staging host-gated default skin
  excerpt.

## Restore Commands

Run on `nc-arm-6c` from `/srv/apps/wiki-staging` after copying the files to
`/tmp`:

```bash
docker compose exec -T mediawiki php maintenance/run.php edit \
  --bot --summary "Restore MUC Wiki home TemplateStyles" \
  "Template:MUCWikiHome/styles.css" < /tmp/Template-MUCWikiHome.styles.css

docker compose exec -T mediawiki php maintenance/run.php edit \
  --bot --summary "Restore MUC Wiki home template" \
  "Template:MUCWikiHome" < /tmp/Template-MUCWikiHome.wiki
```

Then purge the edited pages and template style:

```bash
docker compose exec -T mediawiki php maintenance/run.php purgeList <<'EOF'
首页
Template:MUCWikiHome/styles.css
Template:MUCWikiHome
EOF
```

`LocalSettings.mucwiki-host-gate.php.inc` is an excerpt, not a full config
file. Apply it manually against
`/srv/apps/wiki-staging/config/LocalSettings.php`, then run:

```bash
docker compose exec -T mediawiki php -l /var/www/html/LocalSettings.php
docker compose up -d --force-recreate mediawiki jobrunner
```

## Public Copy Boundary

The rejected homepage copy must not be reintroduced:

- `中央民族大学非官方知识整理`
- `查找条目`
- `在页面顶部搜索框输入关键词`
