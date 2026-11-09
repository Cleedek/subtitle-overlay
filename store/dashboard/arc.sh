#!/bin/zsh
# Runs the JS file $1 in Arc and prints the result. With ARC_TAB set, in the first tab whose URL contains it
# (works while another tab is active); otherwise in the active tab.
osascript -e 'on run argv
  set js to read POSIX file (item 1 of argv) as «class utf8»
  set needle to item 2 of argv
  tell application "Arc"
    if needle is "" then tell front window to tell active tab to return (execute javascript js)
    repeat with w in windows
      repeat with t in tabs of w
        if (URL of t) contains needle then tell t to return (execute javascript js)
      end repeat
    end repeat
  end tell
  return "NO TAB"
end run' "$1" "${ARC_TAB:-}"
