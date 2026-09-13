#!/usr/bin/env bash
#
# Regenerates docs/test-samples/*.jpg — three synthetic "product label" photos.
#
# They exist because a hackathon sandbox has no real packets to photograph, and they are what
# tests/ocrE2E.test.mjs feeds through the real Tesseract.js engine. Needs ImageMagick (`convert`).
# Run from the repo root:  bash docs/make-test-samples.sh
#
# Still test with real packets before a demo: these are cleanly printed and perfectly lit, which
# real labels never are.
set -euo pipefail

# mklabel <outfile> <lines...>  — draws a printed-label-looking white card.
# A leading "!" renders the line at barcode-digit size; "#BAR#" draws the bar block.
mklabel() {
  local out="$1"; shift
  local W=880 H=1080
  local args=(-size ${W}x${H} xc:"#fdfcf8" -fill none -stroke "#c9c4b8" -strokewidth 3 \
    -draw "rectangle 18,18 $((W-18)),$((H-18))" -stroke none)
  local y=96 first=1 size line
  for line in "$@"; do
    size=30
    if [ "$first" = 1 ]; then size=40; first=0; fi
    case "$line" in
      "!"*) line="${line#!}"; size=44 ;;
      "#BAR#")
        args+=(-stroke "#111" -strokewidth 1)
        local x=48 w
        for w in 4 2 6 2 3 5 2 4 2 7 3 2 5 2 3 4 6 2 3 2 5 4 2 6 3 2 4 7 2 3; do
          args+=(-draw "fill black rectangle ${x},${y} $((x+w)),$((y+54))"); x=$((x+w+4))
        done
        args+=(-stroke none)
        y=$((y+124)); continue ;;
    esac
    args+=(-font DejaVu-Sans-Bold -pointsize "$size" -fill "#101010" -annotate +48+${y} "$line")
    y=$((y + size + 26))
  done
  convert "${args[@]}" -quality 88 "$out"
}

mkdir -p docs/test-samples

mklabel docs/test-samples/1-compliant-atta-500g.jpg \
  "SHREE BALAJI MAIDA" "(REFINED WHEAT FLOUR)" "NET QUANTITY: 500 g" \
  "MRP Rs. 35.00 (INCL. OF ALL TAXES)" "MFD: 06/2026  BEST BEFORE 12 MONTHS" \
  "FROM PACKING" "MANUFACTURED & PACKED BY:" "Shree Balaji Foods Pvt. Ltd." \
  "Plot 14, Industrial Area, Sagar, M.P." "470002" "CONSUMER CARE: 07542-220145" \
  "care@balajifoods.example" "COUNTRY OF ORIGIN: INDIA" "FSSAI Lic. No. 10018021000557" \
  "#BAR#" "!8901234567890"

# Deliberately non-compliant: brand name but no generic name, MRP without "inclusive of all
# taxes", no address, no consumer care, no manufacture date.
mklabel docs/test-samples/2-noncompliant-loose-pack.jpg \
  "BALAJI BEST CHOICE" "500g" "MRP 35/-" "Packd at Sagar" "Best before 06/2028"

# Deliberately expired, with an expired FSSAI demo record.
mklabel docs/test-samples/3-expired-milk-powder.jpg \
  "GOKUL SKIMMED MILK POWDER" "NET QUANTITY: 1 kg" "MRP Rs. 45.00 (INCLUSIVE OF ALL TAXES)" \
  "MFD: 01/2024   BEST BEFORE 12/2024" "MANUFACTURED BY:" "Shree Balaji Foods Pvt. Ltd." \
  "Plot 14, Industrial Area, Sagar" "CONSUMER CARE: care@balajifoods.example" "Made in India" \
  "FSSAI Lic. No. 13318025000421" "#BAR#" "!8901234567890"

echo "wrote:"; ls -1 docs/test-samples/
