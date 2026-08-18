mod api;
mod state;
mod theme;
mod ui;

use gpui::*;
use state::AppState;
use theme as t;

impl Render for AppState {
    fn render(&mut self, window: &mut Window, cx: &mut Context<'_, Self>) -> impl IntoElement {
        let state = &*self;
        div()
            .flex()
            .flex_row()
            .size_full()
            .bg(t::BG_BASE)
            .text_color(t::TEXT)
            .child(ui::sidebar(state, window, cx))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .child(ui::chat_view(state, window, cx))
                    .child(ui::composer(state, window, cx)),
            )
            .children(state.toast.iter().map(|message| {
                div()
                    .absolute()
                    .bottom_3()
                    .right_3()
                    .bg(t::BG_LAYER_2)
                    .border_1()
                    .border_color(t::ERROR)
                    .text_color(t::TEXT)
                    .rounded_md()
                    .px_3()
                    .py_2()
                    .text_size(rems(0.75))
                    .child(message.clone())
            }))
    }
}

fn main() {
    let base = std::env::var("DEEP_AGENT_URL").unwrap_or_else(|_| api::DEFAULT_BASE.to_string());
    Application::new().run(|app: &mut App| {
        app.activate(true);
        let window = WindowOptions {
            titlebar: Some(TitlebarOptions {
                title: Some("Deep Agent".into()),
                appears_transparent: false,
                traffic_light_position: None,
            }),
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                None,
                size(px(1280.0), px(820.0)),
                app,
            ))),
            ..Default::default()
        };
        app.open_window(window, |_window, app| {
            app.new(|cx| {
                let state = AppState::new(api::Client::new(base), cx);
                state.init(cx);
                state
            })
        })
        .unwrap();
    });
}
