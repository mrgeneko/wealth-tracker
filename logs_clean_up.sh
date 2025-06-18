#!/bin/bash

# Delete files matching the pattern that are more than 1 day old
find $HOME/logs -name "scrapeman*202*.log" -mmin +720 | xargs rm -f
find $HOME/logs -name "screen.202*" -mmin +720 | xargs rm -f

