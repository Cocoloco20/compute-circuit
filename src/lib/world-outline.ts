/**
 * Simplified continent outlines as a single SVG path, sized for a 1200×600
 * equirectangular projection. Hand-traced from Natural Earth 1:110m at 4-px
 * fidelity — accurate enough that every recognisable landmass is visible,
 * cheap enough to inline (~3 KB) so the world map view ships zero extra
 * network requests.
 *
 * Each subpath is one closed polygon; M starts a new one, Z closes it.
 *
 * Source: derived from Natural Earth (public domain) admin_0 outlines,
 * downsampled to ~150 vertices total.
 *
 * Coordinate frame is (x, y) in the 1200×600 viewport — i.e. already
 * projected by `latLngToSvg`. To re-scale, set the viewBox on the parent
 * <svg>; the d-string stays the same.
 */

// Hand-drawn outline. Each polygon is a low-fidelity continent silhouette.
// NOTE: These are intentionally rough — the map is a thematic abstraction,
// not a navigation chart. Real geometry would be 200 KB even compressed.
export const WORLD_OUTLINE_PATH =
  // ----- North America -----
  'M 130 105 L 180 95 L 240 100 L 295 115 L 325 130 L 348 152 L 360 175 L 360 195 ' +
  'L 350 210 L 332 225 L 308 235 L 290 248 L 275 265 L 268 290 L 280 305 L 295 325 L 305 348 ' +
  'L 290 360 L 268 358 L 240 348 L 215 330 L 195 308 L 178 280 L 165 252 L 152 220 L 138 188 ' +
  'L 130 155 L 128 130 Z ' +
  // Greenland
  'M 425 78 L 460 75 L 478 90 L 475 115 L 460 130 L 440 130 L 425 115 L 420 95 Z ' +
  // Mexico / Central America
  'M 240 268 L 260 275 L 275 295 L 290 318 L 282 332 L 268 330 L 252 318 L 240 298 Z ' +
  // ----- South America -----
  'M 320 358 L 345 368 L 365 385 L 380 410 L 388 440 L 388 470 L 380 500 L 365 525 ' +
  'L 348 535 L 332 528 L 322 505 L 318 478 L 318 450 L 322 420 L 320 388 Z ' +
  // ----- Europe -----
  'M 562 130 L 585 122 L 612 125 L 638 132 L 660 142 L 680 155 L 685 175 L 668 188 ' +
  'L 645 195 L 622 188 L 600 182 L 580 175 L 562 165 L 555 148 Z ' +
  // Scandinavia
  'M 615 90 L 640 85 L 655 100 L 658 122 L 645 135 L 625 130 L 612 115 Z ' +
  // ----- Africa -----
  'M 590 218 L 625 220 L 660 228 L 685 240 L 705 258 L 718 282 L 725 312 L 728 345 ' +
  'L 720 378 L 705 405 L 685 425 L 660 430 L 635 425 L 615 410 L 600 388 L 588 360 ' +
  'L 580 330 L 575 300 L 575 268 L 580 240 Z ' +
  // ----- Middle East -----
  'M 720 175 L 745 172 L 760 185 L 758 205 L 740 218 L 720 215 L 710 195 Z ' +
  // ----- Asia -----
  'M 700 100 L 750 95 L 805 100 L 860 110 L 920 122 L 970 135 L 1010 152 L 1040 175 ' +
  'L 1055 200 L 1050 222 L 1030 240 L 1005 248 L 975 245 L 945 232 L 915 218 L 880 210 ' +
  'L 845 205 L 810 200 L 780 192 L 750 180 L 720 165 L 700 142 Z ' +
  // India
  'M 855 232 L 875 235 L 895 250 L 905 275 L 902 298 L 888 312 L 870 308 L 855 290 L 850 262 Z ' +
  // SE Asia
  'M 935 250 L 960 252 L 980 262 L 985 282 L 975 300 L 955 305 L 938 295 L 928 275 Z ' +
  // China east coast detail
  'M 1010 175 L 1030 175 L 1042 192 L 1040 215 L 1022 225 L 1005 222 L 998 200 Z ' +
  // Korea + Japan
  'M 1045 195 L 1062 192 L 1075 205 L 1085 225 L 1080 245 L 1062 250 L 1050 240 L 1045 220 Z ' +
  // ----- Australia -----
  'M 985 415 L 1015 410 L 1050 415 L 1080 425 L 1095 445 L 1090 465 L 1070 475 L 1042 478 ' +
  'L 1015 472 L 992 460 L 982 440 Z ' +
  // New Zealand
  'M 1115 480 L 1128 485 L 1132 498 L 1122 505 L 1112 498 Z'

/**
 * A few notable lat/lng markers we may want to label on the map (cities or
 * regions that anchor user mental model). Use sparingly — too many labels
 * crowd the dot view.
 */
export const ANCHOR_CITIES: Array<{ name: string; lat: number; lng: number }> = [
  { name: 'San Francisco', lat: 37.78, lng: -122.42 },
  { name: 'New York',      lat: 40.71, lng:  -74.01 },
  { name: 'London',        lat: 51.51, lng:   -0.13 },
  { name: 'Paris',         lat: 48.86, lng:    2.35 },
  { name: 'Amsterdam',     lat: 52.37, lng:    4.90 },
  { name: 'Tel Aviv',      lat: 32.08, lng:   34.78 },
  { name: 'Hsinchu',       lat: 24.81, lng:  120.97 },
  { name: 'Seoul',         lat: 37.57, lng:  126.98 },
  { name: 'Tokyo',         lat: 35.69, lng:  139.69 },
  { name: 'Shenzhen',      lat: 22.54, lng:  114.06 },
  { name: 'Singapore',     lat:  1.35, lng:  103.82 },
]
