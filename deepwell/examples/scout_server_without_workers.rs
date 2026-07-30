use deepwell::config::SetupConfig;
use deepwell::error::Result;

#[tokio::main]
async fn main() -> Result<()> {
    let SetupConfig { secrets, config } = SetupConfig::load().await;
    let address = config.address;
    let state =
        deepwell::api::build_server_state_without_workers(config, secrets).await?;
    let server = deepwell::api::build_server(state).await?;
    eprintln!("scout server listening on {address} without job workers");
    server.stopped().await;
    Ok(())
}
