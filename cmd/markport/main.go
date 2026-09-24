package main

import (
	"github.com/markport/markport/internal/cli"
	"os"
)

func main() { os.Exit(cli.Run(os.Args[1:], os.Stdout, os.Stderr)) }
