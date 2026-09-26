#!/bin/bash

mkdir -p ./gen

ft() {
  uvx --with brotli --from 'fonttools[woff]@latest' \
      -- fonttools "$@"
}

SRC="../node_modules/@fontsource/prosto-one/files"
SRC="$SRC/prosto-one-latin-400-normal.woff2"

OUT="./gen/prosto-one.woff2"

ft subset $SRC --output-file=$OUT --flavor=woff2 \
    --unicodes="53,61,63,65,68,6B,77"

SRC="../node_modules/@fontsource-variable/spline-sans/files"
SRC="$SRC/spline-sans-latin-wght-normal.woff2"

OUT="./gen/spline-sans-subset.woff2"

ft subset $SRC --output-file=$OUT --flavor=woff2 \
    --unicodes="U+0020-007F"
ft varLib.instancer $OUT wght=400

rm $OUT
mv "./gen/spline-sans-subset-instance.woff2" \
   "./gen/spline-sans.woff2"
