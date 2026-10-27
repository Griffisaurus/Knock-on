#!/bin/bash
# quick (no Matter) run: ball track every 3 s + events
cd "$(dirname "$0")"
POKE="btn@1.0" SPEC=${SPEC:-lwh2.mjs} PRESET=warehouse POS="^bo$" timeout 1500 node --disable-warning=ExperimentalWarning sim.ts $1 "." "${2:-^(buzz|bowl|goo|grab|cell|cell2|sing|stasis|rgA|rgB|tr|slam|gate)$}" > quick.log 2>&1
grep -E "^  [0-9]+\.[0-9]+ " quick.log | grep -v "Sound\|Emote\|Impact\|CritterState\|Lit mag" | head -${3:-60}
grep "bo base" quick.log | awk '{split($1,a,"t"); if (a[2]==int(a[2]) && int(a[2])%3==0) print $1,$4}'
