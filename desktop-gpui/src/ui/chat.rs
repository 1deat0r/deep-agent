//! Center column: transcript bubbles + streaming draft, capped content width.

use gpui::*;

use crate::api::TranscriptEntry;
use crate::state::AppState;
use crate::theme;

pub fn chat_view(state: &AppState, _window: &mut Window, _cx: &mut Context<AppState>) -> Stateful<Div> {
    let Some(detail) = state.detail.as_ref() else {
        return div()
            .id("chat-empty")
            .flex_1()
            .flex()
            .flex_col()
            .justify_center()
            .items_center()
            .gap_2()
            .text_color(theme::TEXT_FAINT)
            .child("No session selected");
    };

    div()
        .id("chat")
        .flex_1()
        .flex()
        .flex_col()
        .overflow_y_scroll()
        .child(
            div()
                .flex()
                .flex_col()
                .gap_2()
                .w_full()
                .max_w(px(theme::CONTENT_MAX_WIDTH))
                .mx_auto()
                .px_4()
                .py_3()
                .children(detail.transcript.iter().map(|entry| entry_bubble(entry)))
                .children(
                    (state.streaming && !state.draft.is_empty())
                        .then(|| streaming_bubble(&state.draft)),
                ),
        )
        .child(div().flex_1().child(""))
}

fn entry_bubble(entry: &TranscriptEntry) -> Div {
    match entry {
        TranscriptEntry::Message {
            role,
            content,
            name,
            tool_calls,
            ..
        } => match role.as_str() {
            "user" => div()
                .flex()
                .justify_end()
                .child(
                    div()
                        .max_w(DefiniteLength::Fraction(0.78))
                        .bg(theme::USER_BUBBLE)
                        .text_color(gpui::white())
                        .rounded_xl()
                        .px_3()
                        .py_2()
                        .text_size(rems(0.875))
                        .child(content.clone().unwrap_or_default()),
                ),
            "tool" => div()
                .text_color(theme::TEXT_FAINT)
                .text_size(rems(0.75))
                .child(format!(
                    "tool {}",
                    content.clone().unwrap_or_default().chars().take(200).collect::<String>()
                )),
            "system" => div()
                .w_full()
                .text_center()
                .text_color(theme::TEXT_FAINT)
                .text_size(rems(0.75))
                .child(content.clone().unwrap_or_default()),
            _ => {
                let mut bubble = div()
                    .flex()
                    .justify_start()
                    .child(
                        div()
                            .max_w(DefiniteLength::Fraction(0.78))
                            .bg(theme::BG_LAYER_2)
                            .text_color(theme::TEXT)
                            .rounded_xl()
                            .border_1()
                            .border_color(theme::BORDER)
                            .px_3()
                            .py_2()
                            .text_size(rems(0.875))
                            .child(content.clone().unwrap_or_default()),
                    );
                if let Some(name) = name {
                    bubble = bubble.child(
                        div()
                            .text_color(theme::TEXT_FAINT)
                            .text_size(rems(0.6875))
                            .child(format!("({})", name)),
                    );
                }
                if let Some(calls) = tool_calls {
                    let label = calls
                        .iter()
                        .map(|c| c.function.name.clone())
                        .collect::<Vec<_>>()
                        .join(", ");
                    bubble = bubble.child(
                        div()
                            .mt_1()
                            .text_color(theme::TEXT_FAINT)
                            .text_size(rems(0.6875))
                            .child(format!("⚙ {}", label)),
                    );
                }
                bubble
            }
        },
        TranscriptEntry::Cell {
            code,
            result_repr,
            error,
            ..
        } => div()
            .w_full()
            .bg(theme::BG_LAYER_1)
            .rounded_md()
            .border_1()
            .border_color(theme::BORDER)
            .overflow_hidden()
            .child(
                div()
                    .px_2()
                    .py_1()
                    .text_color(theme::TEXT_FAINT)
                    .text_size(rems(0.6875))
                    .border_b_1()
                    .border_color(theme::BORDER)
                    .child("ipython"),
            )
            .child(
                div()
                    .px_3()
                    .py_2()
                    .text_color(theme::TEXT_MUTED)
                    .text_size(rems(0.75))
                    .child(code.lines().take(12).collect::<Vec<_>>().join("\n")),
            )
            .children(
                [result_repr.clone(), error.clone()]
                    .into_iter()
                    .flatten()
                    .map(|text| {
                        div()
                            .px_3()
                            .pb_2()
                            .text_color(theme::TEXT)
                            .text_size(rems(0.75))
                            .child(text)
                    }),
            ),
        TranscriptEntry::Compaction { summary, .. } => div()
            .w_full()
            .text_center()
            .text_color(theme::TEXT_FAINT)
            .text_size(rems(0.75))
            .child(format!("context compacted — {}", summary)),
        _ => div().child(""),
    }
}

fn streaming_bubble(draft: &str) -> Div {
    div()
        .flex()
        .justify_start()
        .child(
            div()
                .max_w(DefiniteLength::Fraction(0.78))
                .bg(theme::BG_LAYER_2)
                .text_color(theme::TEXT)
                .rounded_xl()
                .border_1()
                .border_color(theme::ACCENT)
                .px_3()
                .py_2()
                .text_size(rems(0.875))
                .child(format!("{}▍", draft)),
        )
}
