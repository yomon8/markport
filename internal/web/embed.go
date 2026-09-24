package web

import "embed"

// Dist contains the complete production browser application.
//
//go:embed dist
var Dist embed.FS
