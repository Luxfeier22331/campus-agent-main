<?php

// Current visual rehearsal default. This excerpt is not a full LocalSettings.php
// file; apply it manually to /srv/apps/wiki-staging/config/LocalSettings.php.
if ( ( $_SERVER['HTTP_HOST'] ?? '' ) === 'wiki.mucwiki-edge.link' ) {
	$wgDefaultSkin = 'mucwiki';
} else {
	$wgDefaultSkin = '<current-production-skin>';
}

if ( ( $_SERVER['HTTP_HOST'] ?? '' ) === 'wiki.mucwiki-edge.link' ) {
	$wgDefaultMobileSkin = 'mucwiki';
} else {
	$wgDefaultMobileSkin = '<current-production-mobile-skin>';
}
