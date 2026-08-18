//! Left rail: Deep Agent wordmark, new session, session list.

use gpui::*;

use crate::state::AppState;
use crate::theme;

pub fn sidebar(state: &AppState, window: &mut Window, cx: &mut Context<AppState>) -> Stateful<Div> {
    div()
        .id("sidebar")
        .flex()
        .flex_col()
        .w(px(theme::SIDEBAR_WIDTH))
        .h_full()
        .bg(theme::BG_LAYER_1)
        .border_r_1()
        .border_color(theme::BORDER)
        .px_2()
        .py_3()
        .gap_2()
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .px_2()
                .pb_2()
                .child(div().text_color(theme::ACCENT).text_size(rems(1.15)).child("◈"))
                .child(
                    div()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(theme::TEXT)
                        .text_size(rems(0.9375))
                        .child("Deep Agent"),
                ),
        )
        .child(
            div()
                .id("new-session")
                .mx_2()
                .mb_1()
                .rounded_lg()
                .bg(theme::ACCENT)
                .text_color(gpui::white())
                .text_size(rems(0.8125))
                .font_weight(FontWeight::MEDIUM)
                .py_1p5()
                .text_center()
                .cursor_pointer()
                .child("+ New session")
                .on_click(window.listener_for(&cx.entity(), |this, _event, _window, cx| this.create_session(cx)))
                .hover(|s| s.bg(theme::ACCENT_HOVER)),
        )
        .child(
            div()
                .id("session-list")
                .flex()
                .flex_col()
                .gap_0p5()
                .overflow_y_scroll()
                .children(state.sessions.iter().map(|meta| {
                    let sid = meta.id.clone();
                    let title = meta.title.clone();
                    let active = state.selected_id.as_deref() == Some(meta.id.as_str());
                    let status_dot = match meta.status.as_str() {
                        "running" => theme::ACCENT,
                        _ => theme::TEXT_FAINT,
                    };
                    div()
                        .id(ElementId::Name(sid.clone().into()))
                        .flex()
                        .items_center()
                        .gap_2()
                        .px_2()
                        .py_1p5()
                        .rounded_md()
                        .bg(if active { Hsla::from(theme::BG_HOVER) } else { gpui::transparent_black() })
                        .cursor_pointer()
                        .child(
                            div()
                                .size_2()
                                .rounded_full()
                                .bg(status_dot)
                                .flex_shrink_0(),
                        )
                        .child(
                            div()
                                .flex_1()
                                .text_color(if active { theme::TEXT } else { theme::TEXT_MUTED })
                                .text_size(rems(0.8125))
                                .truncate()
                                .child(title),
                        )
                        .on_click(window.listener_for(&cx.entity(), move |this, _event, _window, cx| {
                            this.select(sid.clone(), cx);
                        }))
                        .hover(|s| s.bg(theme::BG_HOVER))
                })),
        )
}
