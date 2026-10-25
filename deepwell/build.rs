fn main() {
    // Compile-time build information.
    built::write_built_file().expect("Failed to write build information");

    // The `built` crate records the rustc version but not the cargo
    // version. Capture it so the platform information (WJ-1279) can
    // report the full toolchain that produced this binary.
    println!("cargo:rustc-env=DEEPWELL_CARGO_VERSION={}", cargo_version());

    // Trigger recompilation when a new migration is added.
    println!("cargo:rerun-if-changed=migrations");
}

fn cargo_version() -> String {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned());

    match std::process::Command::new(cargo).arg("--version").output() {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).trim().to_owned()
        }
        _ => "unknown".to_owned(),
    }
}
