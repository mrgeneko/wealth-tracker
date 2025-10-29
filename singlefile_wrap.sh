timestamp=$(date +"%Y%m%d%H%M%S")
log_file="$HOME/singlefile_html/singlefile_wrap.$timestamp.log"
#!/bin/bash

# The google chrome browser extension, singlefile, writes output to the $HOME/Downloads folder.
# We do not want the parse_investing_com_html.sh script to read from this directory since it may
# contain personal information. We will move it to $HOME/singlefile_html directory which has read
# permissions for all, including ssh.

# Log the date at the start of the log file for this run
echo "$(date)" >> "$log_file"

#/usr/bin/osascript $HOME/Library/Mobile\ Documents/com\~apple\~ScriptEditor2/Documents/chrome_singlefile.scpt
/usr/bin/osascript "$HOME/Library/Mobile Documents/com~apple~ScriptEditor2/Documents/chrome_singlefile.scpt" >> "$log_file" 2>&1
echo "$(date)" >> "$log_file"
echo "chrome_singlefile.scpt done" >> "$log_file"


# Prefer the canonical saved script location, but fall back to the current working directory
#SCPT_PRIMARY="$HOME/Library/Mobile Documents/com~apple~ScriptEditor2/Documents/chrome_singlefile.scpt"
#SCPT_CWD="$(pwd)/chrome_singlefile.scpt"
#if [ -f "$SCPT_PRIMARY" ]; then
#	/usr/bin/osascript "$SCPT_PRIMARY"
#elif [ -f "$SCPT_CWD" ]; then
#	/usr/bin/osascript "$SCPT_CWD"
#else
#	echo "Warning: chrome_singlefile.scpt not found at $SCPT_PRIMARY or $SCPT_CWD" >> "$log_file"
#fi

# it may take chrome_singlefile.scpt several seconds to write the output html file, so sleep
sleep 10

# Move generated files to singlefile_html directory
src_dir="$HOME/Downloads"
dest_dir="$HOME/singlefile_html"
mkdir -p "$dest_dir"
for f in "$src_dir"/portfoliowatchlist202*.html; do
	echo "check file " $f >> "$log_file" 2>&1
	[ -e "$f" ] || continue
	base_name="$(basename "$f")"
	if echo "$base_name" | grep -qE '\([12]\)'; then
		rm -- "$f"
		echo "Deleted $f (matched (1) or (2) in filename)" >> "$log_file"
		continue
	fi
	dest_file="$dest_dir/$base_name"
	if [ -e "$dest_file" ]; then
		echo "Skipped $f: $dest_file already exists" >> "$log_file"
		echo "Deleting $f"
		rm $f
		continue
	fi
	mv -- "$f" "$dest_dir/"
	echo "Moved $f to $dest_dir/" >> "$log_file"
done
