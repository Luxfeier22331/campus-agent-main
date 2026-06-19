# OpenAI ChatKit Runtime Mirror

Version: 2026-06-17
Source: https://cdn.platform.openai.com/deployments/chatkit/chatkit.js

This directory contains a self-hosted mirror of the OpenAI ChatKit browser runtime used by campus-web.
It is not the official npm runtime package.
The vendoring script removes Cloudflare challenge injection, favicon links, and source map comments, and rewrites root /assets/ck1/ references to relative assets/ck1/ references.
Update this mirror manually and review the generated manifest before committing changes.
