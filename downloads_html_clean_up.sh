#!/bin/bash

# Delete files matching the pattern that are more than 12 hours old
find $HOME/Downloads -name "portfoliowatchlist202*.html.old" -mmin +720 | xargs rm -f
