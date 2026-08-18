//! Bottom input card: model + reasoning pills, usage readout, textarea, actions.

use gpui::*;

use crate::state::{apply_input_edit, format_tokens, usage_totals, AppState, InputAction};
use crate::theme;

pub fn composer(state: &AppState, window: &mut Window, cx: &mut Context<AppState>) -> Stateful<Div> {
    let (session_totals, turn_totals) = state
        .detail
        .as_ref()
        .map(|d| usage_totals(&d.transcript))
        .unwrap_or_default();
    let model = state
        .detail
        .as_ref()
        .map(|d| d.meta.model.clone())
        .unwrap_or_default();
    let reasoning = state
        .detail
        .as_ref()
        .and_then(|d| d.meta.reasoning_effort.clone())
        .unwrap_or_else(|| String::from("auto"));
    let running = state.streaming || state.busy;
    let has_session = state.detail.is_some();
    let placeholder = if !has_session {
        "Select a session to start…"
    } else if running {
        "Agent is running — interrupt to type…"
    } else {
        "Send a message…"
    };

    div()
        .id("composer")
        .w_full()
        .flex()
        .justify_center()
        .px_4()
        .pb_4()
        .child(
            div()
                .w_full()
                .max_w(px(theme::COMPOSER_MAX_WIDTH))
                .bg(theme::BG_LAYER_1)
                .rounded_xl()
                .border_1()
                .border_color(theme::BORDER)
                .p_2()
                .flex()
                .flex_col()
                .gap_2()
                .children(
                    has_session.then(|| {
                        div()
                        .flex()
                        .items_center()
                        .gap_1p5()
                        .child(cycle_pill(
                            "pill-model",
                            format!("◈ {}", model),
                            window.listener_for(&cx.entity(), |this, _event, _window, cx| {
                                this.cycle_model(cx);
                            }),
                        ))
                        .child(cycle_pill(
                            "pill-reasoning",
                            format!("reasoning · {}", reasoning),
                            window.listener_for(&cx.entity(), |this, _event, _window, cx| {
                                this.cycle_reasoning(cx);
                            }),
                        ))
                        .child(div().flex_1().child(""))
                        .child(usage_readout(session_totals, turn_totals))
                    }),
                )
                .child(
                    div()
                        .id("composer-input")
                        .debug_selector(|| "composer-input".to_string())
                        .w_full()
                        .bg(theme::BG_BASE)
                        .rounded_lg()
                        .border_1()
                        .border_color(theme::BORDER)
                        .px_3()
                        .py_2()
                        .min_h(px(56.0))
                        .max_h(px(240.0))
                        .text_color(theme::TEXT)
                        .text_size(rems(0.875))
                        .overflow_y_scroll()
                        .cursor_text()
                        .tab_index(0)
                        .track_focus(&state.input_focus)
                        .child(if state.draft.is_empty() {
                            div().text_color(theme::TEXT_FAINT).child(placeholder)
                        } else {
                            div()
                                .whitespace_normal()
                                .child(render_with_caret(&state.draft, state.caret))
                        })
                        .on_click(window.listener_for(&cx.entity(), |this, _event, window, _cx| {
                            window.focus(&this.input_focus);
                        }))
                        .on_key_down(window.listener_for(&cx.entity(), |this, event, _window, cx| {
                            handle_input_key(this, event, cx);
                        })),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_1p5()
                        .justify_end()
                        .child(
                            div()
                                .text_color(theme::TEXT_FAINT)
                                .text_size(rems(0.6875))
                                .mr_1()
                                .child("⏎ send · shift+⏎ newline"),
                        )
                        .children(
                            running.then(|| {
                                action_button(
                                    "btn-interrupt",
                                    "Interrupt",
                                    false,
                                    window.listener_for(&cx.entity(), |this, _event, _window, cx| {
                                        this.interrupt(cx);
                                    }),
                                )
                            }),
                        )
                        .child(action_button(
                            "btn-continue",
                            "Continue",
                            false,
                            window.listener_for(&cx.entity(), |this, _event, _window, cx| {
                                this.continue_turn(cx);
                            }),
                        ))
                        .child(action_button(
                            "btn-send",
                            "Send",
                            true,
                            window.listener_for(&cx.entity(), |this, _event, _window, cx| {
                                this.send(cx);
                            }),
                        )),
                ),
        )
}

fn cycle_pill(
    id: &'static str,
    label: String,
    listener: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
    div()
        .id(id)
        .debug_selector(move || id.to_string())
        .text_color(theme::TEXT_MUTED)
        .text_size(rems(0.75))
        .px_2()
        .py_1()
        .rounded_full()
        .border_1()
        .border_color(theme::BORDER)
        .bg(theme::BG_LAYER_2)
        .cursor_pointer()
        .child(label)
        .on_click(listener)
        .hover(|s| s.bg(theme::BG_HOVER))
}

fn usage_readout(session: crate::state::Totals, turn: crate::state::Totals) -> Div {
    let mut text = format!(
        "↑{} ↓{}",
        format_tokens(turn.input),
        format_tokens(turn.output)
    );
    if let Some(rate) = turn.cache_rate() {
        text.push_str(&format!(" · cache {:.0}%", rate * 100.0));
    }
    text.push_str(&format!(
        "  |  session ↑{} ↓{}",
        format_tokens(session.input),
        format_tokens(session.output)
    ));
    div()
        .text_color(theme::TEXT_FAINT)
        .text_size(rems(0.6875))
        .child(text)
}

fn action_button(
    id: &'static str,
    label: &'static str,
    primary: bool,
    listener: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
    let base = div()
        .id(id)
        .text_size(rems(0.8125))
        .font_weight(FontWeight::MEDIUM)
        .px_3()
        .py_1p5()
        .rounded_md()
        .cursor_pointer();
    if primary {
        base.bg(theme::ACCENT)
            .text_color(gpui::white())
            .child(label)
            .on_click(listener)
            .hover(|s| s.bg(theme::ACCENT_HOVER))
    } else {
        base.text_color(theme::TEXT_MUTED)
            .bg(theme::BG_LAYER_2)
            .child(label)
            .on_click(listener)
            .hover(|s| s.bg(theme::BG_HOVER))
    }
}

fn render_with_caret(draft: &str, caret: usize) -> String {
    let mut chars = draft.chars();
    let head: String = chars.by_ref().take(caret).collect();
    let tail: String = chars.collect();
    format!("{head}▍{tail}")
}

fn handle_input_key(state: &mut AppState, event: &KeyDownEvent, cx: &mut Context<AppState>) {
    let keystroke = &event.keystroke;
    if keystroke.modifiers.platform || keystroke.modifiers.control || keystroke.modifiers.alt {
        return;
    }
    let action = apply_input_edit(
        &mut state.draft,
        &mut state.caret,
        &keystroke.key,
        keystroke.key_char.as_deref(),
        keystroke.modifiers.shift,
        state.streaming,
    );
    if action == InputAction::Send {
        state.send(cx);
    }
    cx.notify();
}
