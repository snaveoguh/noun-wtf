#!/bin/sh
# Put a music excerpt onto an already-cut clip, in place, without
# re-encoding the video (when its frames are gone). cut.mjs does the same
# from an edit list's "music" when it cuts.
#   sh scripts/sizzle/mux.sh public/home/hero-breaks scripts/sizzle/music/noun-breaks.mp3 [in]
set -e
base=$1; src=$2; at=${3:-0}
d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$base.mp4")
st=$(python3 -c "print(max(0, $d - 0.9))")
af="afade=t=out:st=$st:d=0.9,loudnorm=I=-16:TP=-1.5:LRA=11"
tmp=$(mktemp -d)
cp "$base.mp4" "$base.webm" "$tmp/"
ffmpeg -v error -y -i "$tmp/$(basename "$base").mp4" -ss "$at" -t "$d" -i "$src" -map 0:v -map 1:a -c:v copy -af "$af" -c:a aac -b:a 128k -ar 48000 -shortest -movflags +faststart "$base.mp4"
ffmpeg -v error -y -i "$tmp/$(basename "$base").webm" -ss "$at" -t "$d" -i "$src" -map 0:v -map 1:a -c:v copy -af "$af" -c:a libopus -b:a 112k -ar 48000 -shortest "$base.webm"
rm -rf "$tmp"
