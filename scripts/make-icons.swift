// Generates the PWA / iOS home-screen icons: the red Xiangqi general (帥), styled like the in-app pieces.
// Run (macOS):  swift scripts/make-icons.swift
// Needs a CJK serif font; "Songti SC" ships with macOS.
import AppKit

let outDir = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().appendingPathComponent("../icons").standardized
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> NSColor {
  NSColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
          blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
}

func render(size: Int, maskable: Bool) -> Data {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                             samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                             bytesPerRow: 0, bitsPerPixel: 0)!
  rep.size = NSSize(width: size, height: size)          // 1 point == 1 pixel
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let s = CGFloat(size)
  let c = NSPoint(x: s / 2, y: s / 2)
  // Maskable icons get cropped by the OS: keep the art inside the 80% safe zone.
  let r = s * (maskable ? 0.34 : 0.43)

  color(0x0d1117).setFill()                              // app background (theme-color)
  NSRect(x: 0, y: 0, width: s, height: s).fill()

  func circle(_ radius: CGFloat) -> NSBezierPath {
    NSBezierPath(ovalIn: NSRect(x: c.x - radius, y: c.y - radius, width: radius * 2, height: radius * 2))
  }

  // Drop shadow
  NSGraphicsContext.saveGraphicsState()
  let shadow = NSShadow()
  shadow.shadowColor = color(0x000000, 0.6)
  shadow.shadowBlurRadius = s * 0.03
  shadow.shadowOffset = NSSize(width: 0, height: -s * 0.015)
  shadow.set()
  color(0x8a1515).setFill()
  circle(r).fill()
  NSGraphicsContext.restoreGraphicsState()

  // Red body: radial gradient, highlight at the upper left (same stops as the in-app red piece)
  let body = NSGradient(colorsAndLocations: (color(0xff7f7f), 0.0), (color(0xe84c4c), 0.4), (color(0x8a1515), 1.0))!
  body.draw(in: circle(r), relativeCenterPosition: NSPoint(x: -0.3, y: 0.3))

  // Gold rim and inner ring
  color(0xf5c842).setStroke()
  let rim = circle(r - s * 0.006); rim.lineWidth = s * 0.016; rim.stroke()
  color(0xf5c842, 0.55).setStroke()
  let inner = circle(r * 0.80); inner.lineWidth = s * 0.006; inner.stroke()

  // The character 帥
  let font = NSFont(name: "Songti SC Bold", size: r * 1.22) ?? NSFont(name: "Songti SC", size: r * 1.22)!
  let glow = NSShadow()
  glow.shadowColor = color(0x000000, 0.45)
  glow.shadowBlurRadius = s * 0.012
  glow.shadowOffset = NSSize(width: 0, height: -s * 0.006)
  let text = NSAttributedString(string: "帥", attributes: [
    .font: font, .foregroundColor: color(0xffd700), .shadow: glow,
  ])
  let box = text.size()
  text.draw(at: NSPoint(x: c.x - box.width / 2, y: c.y - box.height / 2 - r * 0.02))

  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])!
}

for (name, size, maskable) in [
  ("apple-touch-icon.png", 180, false),    // iOS home screen
  ("icon-192.png", 192, false),
  ("icon-512.png", 512, false),
  ("icon-maskable-512.png", 512, true),
] {
  try! render(size: size, maskable: maskable).write(to: outDir.appendingPathComponent(name))
  print("wrote \(name)")
}
