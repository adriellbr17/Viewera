//! Teste real de WGC: seleciona uma tela/janela, recebe um frame e libera a sessão.
//! O frame permanece nativo; nenhum pixel atravessa IPC/JSON.
use std::{sync::mpsc, time::Duration};
use windows_capture::{
    capture::{Context, GraphicsCaptureApiHandler},
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    graphics_capture_picker::GraphicsCapturePicker,
    settings::{ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings},
};

type CaptureError = Box<dyn std::error::Error + Send + Sync>;
struct Probe(mpsc::SyncSender<(u32, u32)>);
impl GraphicsCaptureApiHandler for Probe {
    type Flags = mpsc::SyncSender<(u32, u32)>;
    type Error = CaptureError;
    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> { Ok(Self(ctx.flags)) }
    fn on_frame_arrived(&mut self, frame: &mut Frame, control: InternalCaptureControl) -> Result<(), Self::Error> {
        let _ = self.0.try_send((frame.width(), frame.height()));
        control.stop();
        Ok(())
    }
}

pub fn probe() -> Result<String, String> {
    let item = GraphicsCapturePicker::pick_item().map_err(|e| e.to_string())?
        .ok_or("Seleção cancelada.")?;
    let (tx, rx) = mpsc::sync_channel(1);
    let settings = Settings::new(item, CursorCaptureSettings::Default,
        DrawBorderSettings::Default, SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default, DirtyRegionSettings::Default,
        ColorFormat::Bgra8, tx);
    let session = Probe::start_free_threaded(settings).map_err(|e| e.to_string())?;
    let result = rx.recv_timeout(Duration::from_secs(10));
    session.stop().map_err(|e| e.to_string())?;
    let (width, height) = result.map_err(|e| format!("Nenhum frame WGC em 10 segundos: {e}"))?;
    Ok(format!("WGC recebeu um frame {width}×{height}. Sessão encerrada. Encoder nativo ainda não conectado."))
}

