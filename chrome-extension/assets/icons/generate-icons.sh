#!/bin/bash
# Generate placeholder icons for the Chrome extension
# In production, replace with actual designed icons

for size in 16 19 32 38 48 64 96 128; do
  # Create a simple SVG icon and convert to PNG
  cat > "icon${size}.svg" << 'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea"/>
      <stop offset="100%" style="stop-color:#764ba2"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="24" fill="url(#g)"/>
  <text x="64" y="82" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="48" fill="white">W2F</text>
</svg>
SVG

  # If ImageMagick is available, convert to PNG
  if command -v convert &> /dev/null; then
    convert -background none -resize "${size}x${size}" "icon${size}.svg" "icon${size}.png"
    rm "icon${size}.svg"
  else
    # Just keep SVG as placeholder - use an online converter for actual PNGs
    mv "icon${size}.svg" "icon${size}.png"  # rename for now
  fi
done

echo "Icons generated in: $(pwd)"
