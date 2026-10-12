// One-off: turn the ChatGPT logo into the icon.png + splash.png that
// @capacitor/assets consumes. Uses sharp (already a dep of @capacitor/assets).
import sharp from "sharp";

const SRC = "assets/ChatGPT Image 23 Ağu 2026 21_35_56.png";

// App icon: 1024x1024 (iOS fills the square; the source already has a dark bg).
await sharp(SRC).resize(1024, 1024, { fit: "cover" }).png().toFile("assets/icon.png");

// Sample the source's top-left corner so the splash canvas matches its
// background exactly (no visible seam around the composited ball).
const [r, g, b] = await sharp(SRC)
  .extract({ left: 0, top: 0, width: 24, height: 24 })
  .resize(1, 1)
  .removeAlpha()
  .raw()
  .toBuffer();
const bg = { r, g, b };

// Splash: 2732x2732 dark canvas with the ball centered at a comfortable size.
const SP = 2732;
const ball = await sharp(SRC)
  .resize(1120, 1120, { fit: "contain", background: bg })
  .toBuffer();

await sharp({ create: { width: SP, height: SP, channels: 3, background: bg } })
  .composite([{ input: ball, gravity: "center" }])
  .png()
  .toFile("assets/splash.png");

// Same artwork for dark mode.
await sharp({ create: { width: SP, height: SP, channels: 3, background: bg } })
  .composite([{ input: ball, gravity: "center" }])
  .png()
  .toFile("assets/splash-dark.png");

console.log(`icon.png + splash.png ready (bg rgb ${r},${g},${b})`);
