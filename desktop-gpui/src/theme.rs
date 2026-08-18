//! DeepSeek-Harness design tokens (from the harness's design-platform.css),
//! rebranded for Deep Agent. Dark bluish neutrals + the DeepSeek blue accent.

const fn c(hex: u32) -> gpui::Rgba {
    gpui::Rgba {
        r: ((hex >> 16) & 0xff) as f32 / 255.0,
        g: ((hex >> 8) & 0xff) as f32 / 255.0,
        b: (hex & 0xff) as f32 / 255.0,
        a: 1.0,
    }
}

/// Base window background — harness `--dsw-static-neutral-bluish-1000`.
pub const BG_BASE: gpui::Rgba = c(0x0f1115);
/// Raised surface (sidebar, cards) — neutral-bluish-850.
pub const BG_LAYER_1: gpui::Rgba = c(0x1b1d21);
/// Nested surface (bubbles, composer) — neutral-bluish-800.
pub const BG_LAYER_2: gpui::Rgba = c(0x23262b);
/// Hover surface.
pub const BG_HOVER: gpui::Rgba = c(0x2b2f35);
/// Accent — harness `--dsw-static-deepseek-500`.
pub const ACCENT: gpui::Rgba = c(0x4176e6);
/// Accent hover — deepseek-450.
pub const ACCENT_HOVER: gpui::Rgba = c(0x5686fe);
/// Primary text — neutral-bluish-100.
pub const TEXT: gpui::Rgba = c(0xebeff2);
/// Secondary text — neutral-bluish-400.
pub const TEXT_MUTED: gpui::Rgba = c(0xadb2b8);
/// Faint text — neutral-bluish-500.
pub const TEXT_FAINT: gpui::Rgba = c(0x979da6);
/// Hairline borders — neutral-bluish-700/750-ish.
pub const BORDER: gpui::Rgba = c(0x2c3138);
/// User message bubble fill (accent-tinted).
pub const USER_BUBBLE: gpui::Rgba = c(0x1d3a6e);
/// Error red.
pub const ERROR: gpui::Rgba = c(0xef4444);

pub const SIDEBAR_WIDTH: f32 = 264.0;
pub const CONTENT_MAX_WIDTH: f32 = 768.0;
pub const COMPOSER_MAX_WIDTH: f32 = 768.0;
